/* eslint-disable no-unused-vars */
/**
 * Agent 服务：在 Electron Main 进程中运行 Agent Runtime
 * 
 * 注意事项：
 * 1. Agent 需要 Node.js 环境和文件系统访问权限
 * 2. 使用动态导入以避免打包问题
 * 3. 处理流式响应并通过 IPC 回传给渲染进程
 */

import type { AgentStreamEvent, AgentChatOptions } from '../../shared/ipc'
import * as settingsService from './settingsService'

/** Agent Runtime 接口（避免直接导入导致打包问题） */
type AgentRuntime = {
  streamEvents: (...args: unknown[]) => AsyncGenerator<unknown>
  streamValues: (...args: unknown[]) => AsyncGenerator<unknown>
  close: () => Promise<void>
}

/** Agent Runtime 配置接口 */
type RuntimeConfig = {
  agentMode?: 'langgraph' | 'executor'
  tools?: unknown[]
  summarizer?: unknown
  persistenceMode?: 'memory' | 'postgres'
}

let runtime: AgentRuntime | null = null
let isInitializing = false
let abortController: AbortController | null = null
let isChatting = false // 标记是否有进行中的对话

/**
 * 懒加载 Agent Runtime
 * 只在第一次使用时初始化，避免启动延迟
 */
async function getRuntime(): Promise<AgentRuntime> {
  if (runtime) return runtime

  if (isInitializing) {
    // 等待初始化完成
    await new Promise<void>(resolve => setTimeout(resolve, 100))
    return getRuntime()
  }

  isInitializing = true
  try {
    console.log('[AgentService] 正在初始化 Agent Runtime...')
    
    // 【关键】设置用户数据目录环境变量，用于读取界面配置
    const { app } = require('electron')
    const path = require('path')
    const fs = require('fs')
    
    // 设置 MF_USER_DATA_DIR 指向 Electron 用户数据目录
    // 界面配置文件存储在: {userData}/settings.json
    const userDataPath = app.getPath('userData')
    process.env.MF_USER_DATA_DIR = userDataPath
    console.log('[AgentService] 用户数据目录:', userDataPath)
    
    // 设置 MCP 配置文件路径，确保 Agent 运行时读取的路径与界面一致
    // MCP 配置文件存储在: {userData}/mcp.json
    if (!process.env.MCP_CONFIG_PATH) {
      const mcpConfigPath = path.join(userDataPath, 'mcp.json')
      process.env.MCP_CONFIG_PATH = mcpConfigPath
      console.log('[AgentService] MCP 配置路径:', mcpConfigPath)
    }
    
    // 配置 Agent 环境变量路径（如果 .env 在 agent 目录）
    // 注意：建议将 .env 放在项目根目录以简化配置
    if (!process.env.DOTENV_CONFIG_PATH) {
      // 尝试查找 .env 文件的可能位置
      const possiblePaths = [
        path.resolve(process.cwd(), '.env'),                    // 根目录
        path.resolve(app.getAppPath(), '.env'),                 // app 路径
        path.resolve(app.getAppPath(), '../.env'),              // app 上级
        path.resolve(app.getAppPath(), '../../agent/.env'),     // agent 目录
      ]
      
      for (const envPath of possiblePaths) {
        if (fs.existsSync(envPath)) {
          process.env.DOTENV_CONFIG_PATH = envPath
          console.log('[AgentService] 找到 .env 文件:', envPath)
          break
        }
      }
      
      if (!process.env.DOTENV_CONFIG_PATH) {
        console.warn('[AgentService] 未找到 .env 文件，可通过界面设置配置模型')
      }
    }
    
    // 动态导入 agent 模块
    // 在 workspace 环境下，agent 作为独立的 workspace 存在于项目根目录
    // 开发环境：直接导入 agent workspace 的编译后文件
    // 生产环境：需要在打包配置中确保 agent 模块被正确包含
    
    let createAgentRuntime: ((config?: RuntimeConfig) => Promise<AgentRuntime>) | undefined
    
    try {
      // 使用别名导入（在 electron.vite.config.ts 中配置）
      // Vite 会自动解析 .ts 扩展名
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Agent 模块在独立的 workspace，TypeScript 无法静态解析，但运行时动态导入可用
      const module = await import('agent/runtime/index')
      createAgentRuntime = module.createAgentRuntime as ((config?: RuntimeConfig) => Promise<AgentRuntime>) | undefined
      console.log('[AgentService] Agent 模块导入成功')
    } catch (err) {
      console.error('[AgentService] Agent 模块导入失败:', err)
      throw new Error(`无法找到 Agent 模块: ${err instanceof Error ? err.message : String(err)}`)
    }
    
    if (!createAgentRuntime || typeof createAgentRuntime !== 'function') {
      throw new Error('Agent 模块导入成功但 createAgentRuntime 函数不存在')
    }
    
    // 读取 Agent 模式配置（从环境变量）
    // 可选值：'langgraph' (默认) 或 'executor' (新实现，精细分类)
    const agentMode = (process.env.AGENT_MODE || 'langgraph') as 'langgraph' | 'executor'
    console.log('[AgentService] Agent 模式:', agentMode)
    
    runtime = await createAgentRuntime({ agentMode })
    console.log('[AgentService] Agent Runtime 初始化成功')
    
    return runtime!
  } catch (error) {
    console.error('[AgentService] Agent Runtime 初始化失败:', error)
    throw new Error(`Agent 初始化失败: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isInitializing = false
  }
}

/**
 * 预热 Agent：在应用启动时调用，提前完成懒加载初始化
 * 不抛错，避免影响主流程
 */
export async function warmup(): Promise<void> {
  try {
    await getRuntime()
    console.log('[AgentService] Warmup complete')
  } catch (err) {
    console.warn('[AgentService] Warmup failed:', err)
  }
}

/**
 * 将 Agent 内部事件转换为 IPC 事件格式
 * 支持新增的 stage 和 thinking 字段（用于精细分类）
 */
function transformEvent(ev: unknown): AgentStreamEvent {
  const e = (ev as Partial<AgentStreamEvent>) || {}
  return {
    type: (e.type as AgentStreamEvent['type']) ?? 'error',
    ts: typeof e.ts === 'number' ? e.ts : Date.now(),
    role: e.role,
    stage: e.stage, // 🆕 事件阶段
    token: e.token,
    content: e.content,
    name: e.name,
    args: e.args,
    output: e.output,
    error: e.error,
    thinking: e.thinking, // 🆕 LLM 思考过程
  }
}

/**
 * 执行流式聊天
 * 
 * @param message 用户消息
 * @param onEvent 事件回调（发送给渲染进程）
 * @param options 聊天选项
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function chatStream(
  message: string,
  onEvent: (event: AgentStreamEvent) => void,
  options?: AgentChatOptions
): Promise<void> {
  // 创建新的 AbortController
  abortController = new AbortController()
  isChatting = true // 标记对话开始
  
  try {
    const rt = await getRuntime()
    const streamOptions = {
      summary: options?.summary ?? false,
      threadId: options?.threadId
    }

    // 将模型配置选择传递给运行时（通过全局可变上下文或单例存储覆盖）
    if (options?.modelConfigId) {
      await settingsService.setActiveModelConfig(options.modelConfigId)
    }

    // 会话级 RAG 应用选择：在 agent 运行前应用到 env（由 agent 侧读取 settings.json）
    try {
      // @ts-ignore - 运行时导入 agent 模块
      const { applyRagSelection } = await import('agent/utils/rag-bridge')
      applyRagSelection(options?.ragEnabled, options?.ragConfigId, options?.ragCollection)
    } catch (e) {
      console.warn('[AgentService] 应用 RAG 选择失败（忽略）', e)
    }

    // 使用 events 模式（更适合流式 UI）
    const stream = (rt.streamEvents as (msg: string, opts?: { summary?: boolean; threadId?: string }) => AsyncGenerator<unknown>)(message, streamOptions)

    for await (const ev of stream) {
      // 检查是否被中止
      if (abortController.signal.aborted) {
        console.log('[AgentService] 聊天被用户中止')
        break
      }

      // 转换并发送事件
      const ipcEvent = transformEvent(ev)
      onEvent(ipcEvent)
    }
  } catch (error) {
    console.error('[AgentService] 聊天流式处理错误:', error)
    
    // 发送错误事件
    onEvent({
      type: 'error',
      ts: Date.now(),
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    abortController = null
    isChatting = false // 标记对话结束
  }
}

/**
 * 执行非流式聊天（简化版本）
 */
export async function chat(message: string, options?: AgentChatOptions): Promise<string> {
  let result = ''
  
  await chatStream(message, (event) => {
    if (event.type === 'assistant-message' && event.content) {
      result = event.content
    }
  }, options)
  
  return result
}

/**
 * 停止当前对话
 */
export async function stopChat(): Promise<void> {
  if (abortController) {
    abortController.abort()
    console.log('[AgentService] 已发送中止信号')
  }
}

/**
 * 清理资源（应用退出时调用）
 */
export async function cleanup(): Promise<void> {
  if (runtime) {
    try {
      await runtime.close()
      console.log('[AgentService] Agent Runtime 已清理')
    } catch (error) {
      console.error('[AgentService] 清理失败:', error)
    }
    runtime = null
  }
}

/**
 * 重新加载 Agent Runtime（用于 MCP 配置更新）
 * 会关闭旧的 Runtime 并重新初始化，从而重新加载 MCP 工具
 * 
 * @throws 如果当前有进行中的对话，将抛出错误
 */
export async function reloadRuntime(): Promise<void> {
  // 检查是否有进行中的对话
  if (isChatting) {
    console.warn('[AgentService] 无法重载：当前有进行中的对话')
    throw new Error('当前有进行中的对话，请稍后重试')
  }

  // 检查是否正在初始化
  if (isInitializing) {
    console.warn('[AgentService] 无法重载：Runtime 正在初始化中')
    throw new Error('Runtime 正在初始化中，请稍后重试')
  }

  console.log('[AgentService] 开始重新加载 Runtime...')

  try {
    // 清理旧的 Runtime
    if (runtime) {
      await runtime.close()
      console.log('[AgentService] 旧 Runtime 已关闭')
      runtime = null
    }

    // 重新初始化 Runtime
    await getRuntime()
    console.log('[AgentService] Runtime 重新加载成功')
  } catch (error) {
    console.error('[AgentService] Runtime 重新加载失败:', error)
    throw new Error(`Runtime 重新加载失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}
