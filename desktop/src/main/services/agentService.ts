/**
 * Agent 服务：在 Electron Main 进程中运行 Agent Runtime
 * 
 * 注意事项：
 * 1. Agent 需要 Node.js 环境和文件系统访问权限
 * 2. 使用动态导入以避免打包问题
 * 3. 处理流式响应并通过 IPC 回传给渲染进程
 */

import type { AgentStreamEvent, AgentChatOptions } from '../../shared/ipc'

/** Agent Runtime 接口（避免直接导入导致打包问题） */
interface AgentRuntime {
  streamEvents(input: string, options?: { summary?: boolean; threadId?: string }): AsyncGenerator<any>
  streamValues(input: string, options?: { summary?: boolean; threadId?: string }): AsyncGenerator<any>
  close(): Promise<void>
}

let runtime: AgentRuntime | null = null
let isInitializing = false
let abortController: AbortController | null = null

/**
 * 懒加载 Agent Runtime
 * 只在第一次使用时初始化，避免启动延迟
 */
async function getRuntime(): Promise<AgentRuntime> {
  if (runtime) return runtime

  if (isInitializing) {
    // 等待初始化完成
    await new Promise(resolve => setTimeout(resolve, 100))
    return getRuntime()
  }

  isInitializing = true
  try {
    console.log('[AgentService] 正在初始化 Agent Runtime...')
    
    // 配置 Agent 环境变量路径（如果 .env 在 agent 目录）
    // 注意：建议将 .env 放在项目根目录以简化配置
    if (!process.env.DOTENV_CONFIG_PATH) {
      const { app } = require('electron')
      const path = require('path')
      const fs = require('fs')
      
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
        console.warn('[AgentService] 未找到 .env 文件，请确保配置环境变量')
      }
    }
    
    // 动态导入 agent 模块
    // 在 workspace 环境下，agent 作为独立的 workspace 存在于项目根目录
    // 开发环境：直接导入 agent workspace 的编译后文件
    // 生产环境：需要在打包配置中确保 agent 模块被正确包含
    
    let createAgentRuntime: any
    
    try {
      // 使用别名导入（在 electron.vite.config.ts 中配置）
      // Vite 会自动解析 .ts 扩展名
      const module = await import('agent/runtime/index')
      createAgentRuntime = module.createAgentRuntime
      console.log('[AgentService] Agent 模块导入成功')
    } catch (err) {
      console.error('[AgentService] Agent 模块导入失败:', err)
      throw new Error(`无法找到 Agent 模块: ${err instanceof Error ? err.message : String(err)}`)
    }
    
    if (!createAgentRuntime || typeof createAgentRuntime !== 'function') {
      throw new Error('Agent 模块导入成功但 createAgentRuntime 函数不存在')
    }
    
    runtime = await createAgentRuntime()
    console.log('[AgentService] Agent Runtime 初始化成功')
    
    return runtime
  } catch (error) {
    console.error('[AgentService] Agent Runtime 初始化失败:', error)
    throw new Error(`Agent 初始化失败: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isInitializing = false
  }
}

/**
 * 将 Agent 内部事件转换为 IPC 事件格式
 */
function transformEvent(ev: any): AgentStreamEvent {
  return {
    type: ev.type,
    ts: ev.ts || Date.now(),
    role: ev.role,
    token: ev.token,
    content: ev.content,
    name: ev.name,
    args: ev.args,
    output: ev.output,
    error: ev.error
  }
}

/**
 * 执行流式聊天
 * 
 * @param message 用户消息
 * @param onEvent 事件回调（发送给渲染进程）
 * @param options 聊天选项
 */
export async function chatStream(
  message: string,
  onEvent: (event: AgentStreamEvent) => void,
  options?: AgentChatOptions
): Promise<void> {
  // 创建新的 AbortController
  abortController = new AbortController()
  
  try {
    const rt = await getRuntime()
    const streamOptions = {
      summary: options?.summary ?? false,
      threadId: options?.threadId
    }

    // 使用 events 模式（更适合流式 UI）
    const stream = rt.streamEvents(message, streamOptions)

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
