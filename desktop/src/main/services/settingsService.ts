import { app, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings, ModelConfig, StreamingValidationResult, VectorDbConfig, RagValidationResult, RetrieverConfig, ModelConnectionValidationResult } from '../../shared/ipc'

const SETTINGS_FILE = 'settings.json'
const MCP_CONFIG_FILE = 'mcp.json'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

function getSettingsPath(): string {
  const userData = app.getPath('userData')
  return path.join(userData, SETTINGS_FILE)
}

function ensureSettings(): AppSettings {
  const file = getSettingsPath()
  if (!fs.existsSync(file)) {
    const initial: AppSettings = {
      modelConfigs: [
        {
          id: 'default-openai',
          name: '默认OpenAI',
          model: 'gpt-4o-mini',
          // baseURL: 不设置，走默认
          // apiKey: 不写入示例
          temperature: 0,
          timeout: 60000,
          maxRetries: 2,
          streaming: false,
          updatedAt: Date.now()
        }
      ],
      activeModelId: 'default-openai',
      vectorDbConfigs: []
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(initial, null, 2), 'utf-8')
    return initial
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    const json = JSON.parse(raw) as AppSettings
    if (!Array.isArray(json.modelConfigs)) json.modelConfigs = []
    if (!Array.isArray(json.vectorDbConfigs)) json.vectorDbConfigs = []
    return json
  } catch {
    const fallback: AppSettings = { modelConfigs: [], vectorDbConfigs: [] }
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf-8')
    return fallback
  }
}

function saveSettings(s: AppSettings): void {
  const file = getSettingsPath()
  fs.writeFileSync(file, JSON.stringify(s, null, 2), 'utf-8')
}

export async function listModelConfigs(): Promise<ModelConfig[]> {
  return ensureSettings().modelConfigs
}

export async function getActiveModelConfig(): Promise<ModelConfig | null> {
  const s = ensureSettings()
  const id = s.activeModelId
  if (!id) return null
  return s.modelConfigs.find(m => m.id === id) ?? null
}

export async function setActiveModelConfig(id: string): Promise<void> {
  const s = ensureSettings()
  const exists = s.modelConfigs.some(m => m.id === id)
  if (!exists) throw new Error('配置不存在')
  s.activeModelId = id
  saveSettings(s)
}

export async function upsertModelConfig(cfg: ModelConfig): Promise<void> {
  if (!cfg) throw new Error('非法参数')
  const now = Date.now()
  const s = ensureSettings()
  const id = (cfg.id && cfg.id.trim()) || `model-${now}`
  const name = (cfg.name || '').trim()
  const model = (cfg.model || '').trim()
  if (!name) throw new Error('名称必填')
  if (!model) throw new Error('模型名必填')

  const norm: ModelConfig = {
    id,
    name,
    model,
    baseURL: (cfg.baseURL || '').trim() || undefined, // 空则不写，走默认 URL
    apiKey: (cfg.apiKey || '').trim() || undefined,
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0,
    timeout: typeof cfg.timeout === 'number' ? cfg.timeout : 60000,
    maxRetries: typeof cfg.maxRetries === 'number' ? cfg.maxRetries : 2,
    streaming: Boolean(cfg.streaming),
    streamingValidation: cfg.streamingValidation,
    updatedAt: now
  }

  const idx = s.modelConfigs.findIndex(m => m.id === id)
  if (idx >= 0) {
    s.modelConfigs[idx] = { ...s.modelConfigs[idx], ...norm, id }
  } else {
    s.modelConfigs.push(norm)
  }
  if (!s.activeModelId) s.activeModelId = id
  saveSettings(s)
}

export async function deleteModelConfig(id: string): Promise<void> {
  const s = ensureSettings()
  const before = s.modelConfigs.length
  s.modelConfigs = s.modelConfigs.filter(m => m.id !== id)
  if (s.activeModelId === id) {
    s.activeModelId = s.modelConfigs[0]?.id
  }
  if (s.modelConfigs.length !== before) saveSettings(s)
}

export async function exportSettings(): Promise<string> {
  const s = ensureSettings()
  return JSON.stringify(s, null, 2)
}

export async function importSettings(json: string): Promise<void> {
  try {
    const obj = JSON.parse(json) as AppSettings
    if (!obj || !Array.isArray(obj.modelConfigs)) throw new Error('无效的设置格式')
    // 规范化 baseURL 空值
    obj.modelConfigs = obj.modelConfigs.map(m => ({
      ...m,
      baseURL: (m.baseURL || '').trim() || undefined,
      apiKey: (m.apiKey || '').trim() || undefined,
      updatedAt: Date.now()
    }))
    saveSettings(obj)
  } catch (e) {
    throw new Error(`导入失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function buildConnectionFailureResult(
  startTime: number,
  baseURL: string,
  apiKeySource: ModelConnectionValidationResult['apiKeySource'],
  message: string,
  options: {
    httpStatus?: number
    error?: string
  } = {}
): ModelConnectionValidationResult {
  return {
    ok: false,
    duration: Date.now() - startTime,
    httpStatus: options.httpStatus,
    apiKeySource,
    baseURL,
    message,
    error: options.error,
    timestamp: Date.now()
  }
}

function getHttpFailureMessage(status: number, detail?: string): string {
  if (status === 401 || status === 403) return '鉴权失败，请检查 API Key 或服务权限'
  if (status === 404) return '接口或模型不存在，请检查 Base URL 和模型名'
  if (status === 429) return '请求频率或额度受限，请稍后重试'
  if (status >= 500) return '服务端返回异常，请稍后重试或检查兼容端点状态'
  return detail || `请求失败（HTTP ${status}）`
}

function extractApiErrorMessage(text: string): string | undefined {
  if (!text.trim()) return undefined
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return parsed.error?.message || parsed.message || undefined
  } catch {
    return text.slice(0, 500)
  }
}

export async function validateModelConnection(
  cfg: ModelConfig
): Promise<ModelConnectionValidationResult> {
  const startTime = Date.now()
  const rawBaseURL = (cfg.baseURL || '').trim() || DEFAULT_OPENAI_BASE_URL
  const baseURL = rawBaseURL.replace(/\/+$/, '')
  const model = (cfg.model || '').trim()
  const uiApiKey = (cfg.apiKey || '').trim()
  const envApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const apiKey = uiApiKey || envApiKey
  const apiKeySource: ModelConnectionValidationResult['apiKeySource'] = uiApiKey
    ? 'ui'
    : envApiKey
      ? 'env'
      : 'missing'

  if (!model) {
    return buildConnectionFailureResult(startTime, baseURL, apiKeySource, '模型名不能为空')
  }

  if (!apiKey) {
    return buildConnectionFailureResult(
      startTime,
      baseURL,
      apiKeySource,
      'API Key 未配置，请在表单或环境变量 OPENAI_API_KEY 中配置'
    )
  }

  const endpoint = `${baseURL}/chat/completions`
  try {
    new URL(endpoint)
  } catch {
    return buildConnectionFailureResult(startTime, baseURL, apiKeySource, 'Base URL 无效', {
      error: endpoint
    })
  }

  const timeout = Math.min(
    typeof cfg.timeout === 'number' && cfg.timeout > 0 ? cfg.timeout : 15000,
    15000
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '请回复 OK' }],
        stream: false
      }),
      signal: controller.signal
    })

    const responseText = await response.text()
    const apiDetail = extractApiErrorMessage(responseText)

    if (response.ok) {
      return {
        ok: true,
        duration: Date.now() - startTime,
        httpStatus: response.status,
        apiKeySource,
        baseURL,
        message: `连接成功（HTTP ${response.status}）`,
        timestamp: Date.now()
      }
    }

    return buildConnectionFailureResult(
      startTime,
      baseURL,
      apiKeySource,
      getHttpFailureMessage(response.status, apiDetail),
      {
        httpStatus: response.status,
        error: apiDetail || response.statusText
      }
    )
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError'
    return buildConnectionFailureResult(
      startTime,
      baseURL,
      apiKeySource,
      isAbort ? `连接超时（${timeout}ms）` : '网络请求失败，请检查 Base URL 或代理配置',
      {
        error: error instanceof Error ? error.message : String(error)
      }
    )
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------
// RAG（向量数据库）配置相关
// ------------------------

function assertNonEmpty(text: string, name: string): void {
  if (!text || !text.trim()) throw new Error(`${name} 不能为空`)
}

function normalizeVectorDbConfig(input: VectorDbConfig): VectorDbConfig {
  const now = Date.now()
  const id = (input.id || '').trim() || `rag-${now}`
  const name = (input.name || '').trim()
  const provider = (input.provider || 'chroma') as 'chroma'
  const enabled = Boolean(input.enabled)
  const connUrl = (input.connection?.url || '').trim()
  const rootDir = (input.storage?.rootDir || '').trim()
  const rawDir = (input.storage?.rawDir || '').trim()

  assertNonEmpty(name, '名称')
  assertNonEmpty(connUrl, 'Chroma URL')
  assertNonEmpty(rootDir, '知识库根目录')
  assertNonEmpty(rawDir, '原始文件目录')

  const defaultCollection = (input.defaultCollection || '').trim() || undefined

  const embeddings = input.embeddings
    ? {
        provider: input.embeddings.provider,
        model: (input.embeddings.model || '').trim() || undefined,
        apiKey: (input.embeddings.apiKey || '').trim() || undefined
      }
    : undefined

  const retriever: RetrieverConfig = input.retriever
    ? {
        k: typeof input.retriever.k === 'number' ? input.retriever.k : 4,
        searchType: input.retriever.searchType === 'mmr' ? 'mmr' : 'similarity',
        mmrLambda:
          typeof input.retriever.mmrLambda === 'number' ? input.retriever.mmrLambda : 0.5,
        fetchK:
          typeof input.retriever.fetchK === 'number' && input.retriever.fetchK > 0
            ? input.retriever.fetchK
            : 32
      }
    : { k: 4, searchType: 'similarity', mmrLambda: 0.5, fetchK: 32 }

  return {
    id,
    name,
    provider,
    enabled,
    connection: { url: connUrl },
    storage: { rootDir, rawDir },
    defaultCollection,
    embeddings,
    retriever,
    isDefault: Boolean(input.isDefault),
    updatedAt: now
  }
}

export async function listVectorDbConfigs(): Promise<VectorDbConfig[]> {
  const s = ensureSettings()
  return s.vectorDbConfigs
}

export async function getDefaultVectorDb(): Promise<VectorDbConfig | null> {
  const s = ensureSettings()
  return s.vectorDbConfigs.find(v => v.isDefault) ?? null
}

export async function upsertVectorDbConfig(cfg: VectorDbConfig): Promise<void> {
  const s = ensureSettings()
  const norm = normalizeVectorDbConfig(cfg)

  const idx = s.vectorDbConfigs.findIndex(v => v.id === norm.id)
  if (idx >= 0) s.vectorDbConfigs[idx] = { ...s.vectorDbConfigs[idx], ...norm, id: norm.id }
  else s.vectorDbConfigs.push(norm)

  // 若设置为默认，则清除其他默认
  if (norm.isDefault) {
    s.vectorDbConfigs = s.vectorDbConfigs.map(v => ({ ...v, isDefault: v.id === norm.id }))
  }

  saveSettings(s)
}

export async function deleteVectorDbConfig(id: string): Promise<void> {
  const s = ensureSettings()
  const before = s.vectorDbConfigs.length
  s.vectorDbConfigs = s.vectorDbConfigs.filter(v => v.id !== id)
  if (s.vectorDbConfigs.length !== before) saveSettings(s)
}

export async function setDefaultVectorDb(id: string): Promise<void> {
  const s = ensureSettings()
  const exists = s.vectorDbConfigs.some(v => v.id === id)
  if (!exists) throw new Error('RAG 配置不存在')
  s.vectorDbConfigs = s.vectorDbConfigs.map(v => ({ ...v, isDefault: v.id === id }))
  saveSettings(s)
}

export async function toggleVectorDbEnabled(id: string, enabled: boolean): Promise<void> {
  const s = ensureSettings()
  const idx = s.vectorDbConfigs.findIndex(v => v.id === id)
  if (idx < 0) throw new Error('RAG 配置不存在')
  s.vectorDbConfigs[idx].enabled = Boolean(enabled)
  // 若禁用默认项，则清除默认标记
  if (!s.vectorDbConfigs[idx].enabled && s.vectorDbConfigs[idx].isDefault) {
    s.vectorDbConfigs[idx].isDefault = false
  }
  saveSettings(s)
}

export async function validateVectorDb(cfg: VectorDbConfig): Promise<RagValidationResult> {
  // 将校验委托给 @agent/ 实现，主进程不承载 RAG 逻辑
  const norm = normalizeVectorDbConfig(cfg)
  // @ts-ignore 运行时动态导入 agent 工作区
  const { validateRagConfig } = await import('agent/services/rag')
  const res = await validateRagConfig(norm)
  return res as RagValidationResult
}

/**
 * 获取 MCP 配置文件路径
 * @returns MCP 配置文件的绝对路径
 */
function getMcpConfigPath(): string {
  const userData = app.getPath('userData')
  return path.join(userData, MCP_CONFIG_FILE)
}

/**
 * 创建默认的 MCP 配置模板
 * @returns 默认 MCP 配置的 JSON 字符串
 */
function createDefaultMcpConfig(): string {
  const defaultConfig = {
    mcpServers: {
      // 示例配置 - stdio 类型（本地进程）
      // "example-stdio": {
      //   "command": "node",
      //   "args": ["/path/to/your/mcp/server.js"],
      //   "env": {}
      // },
      // 示例配置 - HTTP 类型（远程服务）
      // "example-http": {
      //   "type": "http",
      //   "url": "http://localhost:3000/mcp",
      //   "headers": {
      //     "Authorization": "Bearer your-token"
      //   }
      // }
    }
  }
  return JSON.stringify(defaultConfig, null, 2)
}

/**
 * 确保 MCP 配置文件存在。
 * 首次启动时如果用户尚未创建配置，则写入空的默认配置。
 */
export function ensureMcpConfigFile(): string {
  const mcpConfigPath = getMcpConfigPath()

  if (!fs.existsSync(mcpConfigPath)) {
    const defaultConfig = createDefaultMcpConfig()
    fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true })
    fs.writeFileSync(mcpConfigPath, defaultConfig, 'utf-8')
    console.log(`[SettingsService] 已创建默认 MCP 配置文件: ${mcpConfigPath}`)
  }

  return mcpConfigPath
}

/**
 * 在系统默认编辑器中打开 MCP 配置文件
 * 如果文件不存在，则创建默认模板
 */
export async function openMcpConfig(): Promise<void> {
  const mcpConfigPath = ensureMcpConfigFile()
  
  try {
    // 使用系统默认编辑器打开文件
    const result = await shell.openPath(mcpConfigPath)
    
    // 如果返回非空字符串，说明打开失败
    if (result) {
      throw new Error(`打开文件失败: ${result}`)
    }
    
    console.log(`[SettingsService] 已在默认编辑器中打开 MCP 配置: ${mcpConfigPath}`)
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    console.error(`[SettingsService] 打开 MCP 配置失败:`, errorMsg)
    throw new Error(`无法打开 MCP 配置文件: ${errorMsg}`)
  }
}

/**
 * 基于模型配置执行流式能力验证。
 * 该函数只负责调用验证器，不负责写入 settings.json，避免“验证即创建配置”的副作用。
 */
async function runStreamingValidation(modelConfig: ModelConfig): Promise<StreamingValidationResult> {
  const model = (modelConfig.model || '').trim()
  if (!model) {
    throw new Error('模型名不能为空')
  }

  const userDataPath = app.getPath('userData')
  process.env.MF_USER_DATA_DIR = userDataPath

  // @ts-ignore - agent workspace 在运行时可用，但 TypeScript 配置不包含跨 workspace 引用
  const { validateStreamingSupport } = await import('agent/llm/streaming-validator')

  const validateConfig = {
    provider: modelConfig.baseURL ? 'custom' : 'openai',
    model,
    apiKey: (modelConfig.apiKey || '').trim(),
    baseURL: (modelConfig.baseURL || '').trim() || undefined,
    temperature: modelConfig.temperature ?? 0,
    timeout: modelConfig.timeout ?? 60000,
    maxRetries: modelConfig.maxRetries ?? 2
  }

  console.log(`[SettingsService] 验证配置:`, {
    model: validateConfig.model,
    baseURL: validateConfig.baseURL,
    hasApiKey: !!validateConfig.apiKey
  })

  return validateStreamingSupport(validateConfig, 15000)
}

/**
 * 验证当前表单中的模型配置是否支持流式输出。
 * 用于新增/编辑弹窗中的开关即时校验，不会创建或更新模型配置。
 */
export async function validateModelStreamingConfig(
  cfg: ModelConfig
): Promise<StreamingValidationResult> {
  try {
    console.log(`[SettingsService] 开始验证临时模型配置流式支持`)
    const result = await runStreamingValidation(cfg)

    console.log(`[SettingsService] 临时配置验证完成:`, {
      supported: result.supported,
      duration: result.duration,
      firstTokenLatency: result.firstTokenLatency,
      error: result.error
    })

    return result
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[SettingsService] 验证临时模型配置流式支持失败:`, errorMsg)

    return {
      supported: false,
      duration: 0,
      error: errorMsg,
      timestamp: Date.now()
    }
  }
}

/**
 * 验证模型配置的流式支持
 * 
 * @param modelId 要验证的模型配置ID
 * @returns 验证结果，包含是否支持流式、延迟等信息
 */
export async function validateModelStreaming(modelId: string): Promise<StreamingValidationResult> {
  try {
    console.log(`[SettingsService] 开始验证模型流式支持: ${modelId}`)
    
    // 1. 读取配置
    const settings = ensureSettings()
    const modelConfig = settings.modelConfigs.find(c => c.id === modelId)
    
    if (!modelConfig) {
      throw new Error(`模型配置不存在: ${modelId}`)
    }
    
    // 2. 执行验证（15秒超时）
    const result = await runStreamingValidation(modelConfig)
    
    console.log(`[SettingsService] 验证完成:`, {
      supported: result.supported,
      duration: result.duration,
      firstTokenLatency: result.firstTokenLatency,
      error: result.error
    })
    
    // 6. 保存验证结果到配置
    modelConfig.streamingValidation = result
    saveSettings(settings)
    
    console.log(`[SettingsService] 验证结果已保存到配置文件`)
    
    return result
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[SettingsService] 验证模型流式支持失败:`, errorMsg)
    
    // 返回失败结果
    const failedResult: StreamingValidationResult = {
      supported: false,
      duration: 0,
      error: errorMsg,
      timestamp: Date.now(),
    }
    
    // 尝试保存失败结果
    try {
      const settings = ensureSettings()
      const modelConfig = settings.modelConfigs.find(c => c.id === modelId)
      if (modelConfig) {
        modelConfig.streamingValidation = failedResult
        saveSettings(settings)
      }
    } catch {
      // 忽略保存错误
    }
    
    return failedResult
  }
}

/**
 * 在系统默认编辑器中打开 appData 目录下的文件
 * 
 * @param filename 文件名（如 'settings.json', 'mcp.json'）
 */
export async function openAppDataFile(filename: string): Promise<void> {
  try {
    // 安全验证：防止路径遍历攻击
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('无效的文件名')
    }
    
    // 限制文件扩展名
    const allowedExtensions = ['.json', '.txt', '.log', '.md']
    const hasValidExtension = allowedExtensions.some(ext => filename.endsWith(ext))
    if (!hasValidExtension) {
      throw new Error('不支持的文件类型，仅支持: ' + allowedExtensions.join(', '))
    }
    
    const userDataPath = app.getPath('userData')
    const filePath = path.join(userDataPath, filename)
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      if (filename === MCP_CONFIG_FILE) {
        ensureMcpConfigFile()
      } else {
        throw new Error(`文件不存在: ${filename}`)
      }
    }
    
    const result = await shell.openPath(filePath)
    if (result) {
      throw new Error(`打开文件失败: ${result}`)
    }
    
    console.log(`[SettingsService] 已在默认编辑器中打开文件: ${filePath}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[SettingsService] 打开文件失败:`, errorMsg)
    throw new Error(`打开文件失败: ${errorMsg}`)
  }
}
