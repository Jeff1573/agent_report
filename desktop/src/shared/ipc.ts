/**
 * 文件说明：集中管理 IPC 通道与类型，避免魔法字符串。
 * 仅暴露白名单通道，主/预加载/渲染三端共享此定义。
 */

/** IPC 通道常量（白名单） */
export const IPC_CHANNELS = {
  APP_VERSION: 'app/version',
  // Agent 相关通道
  AGENT_CHAT: 'agent/chat',
  AGENT_CHAT_STREAM: 'agent/chat/stream',
  AGENT_STOP: 'agent/stop',
  // 会话历史相关
  HISTORY_SAVE: 'history/save',
  HISTORY_LOAD: 'history/load',
  HISTORY_LIST: 'history/list',
  HISTORY_DELETE: 'history/delete',
  HISTORY_CLEAR: 'history/clear',
  // 设置（模型配置）相关
  SETTINGS_MODEL_LIST: 'settings/model/list',
  SETTINGS_MODEL_GET_ACTIVE: 'settings/model/getActive',
  SETTINGS_MODEL_SET_ACTIVE: 'settings/model/setActive',
  SETTINGS_MODEL_UPSERT: 'settings/model/upsert',
  SETTINGS_MODEL_DELETE: 'settings/model/delete',
  SETTINGS_EXPORT: 'settings/export',
  SETTINGS_IMPORT: 'settings/import'
} as const

/** 流式事件类型 */
export type StreamEventType =
  | 'model-token'
  | 'assistant-message'
  | 'tool-call'
  | 'tool-result'
  | 'round-end'
  | 'error'

/** Agent 流式事件 */
export interface AgentStreamEvent {
  type: StreamEventType
  ts: number
  role?: 'assistant' | 'tool' | 'user' | 'system' | 'unknown'
  token?: string
  content?: string
  name?: string
  args?: unknown
  output?: unknown
  error?: unknown
}

/** Agent 聊天选项 */
export interface AgentChatOptions {
  /** 是否启用概括 */
  summary?: boolean
  /** 线程ID（用于会话持久化） */
  threadId?: string
  /** 是否使用流式模式 */
  stream?: boolean
  /** 使用的模型配置ID（前端选择后传递给主进程） */
  modelConfigId?: string
}

/** 聊天消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: Array<{ name: string; args: unknown }>
}

/** 会话数据 */
export interface SessionData {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

/** 模型配置（Bearer 鉴权，后续可扩展自定义 Header） */
export interface ModelConfig {
  id: string
  name: string
  model: string
  baseURL?: string
  apiKey?: string
  temperature?: number
  timeout?: number
  maxRetries?: number
  streaming?: boolean
  updatedAt: number
}

/** 设置文件结构（预留向量数据库配置） */
export interface AppSettings {
  modelConfigs: ModelConfig[]
  activeModelId?: string
  vectorDbConfigs?: unknown[]
}

/** 预加载向渲染暴露的受控 API 类型 */
export interface PreloadApi {
  app: {
    /** 获取应用版本号（来自主进程 app.getVersion） */
    getVersion: () => Promise<string>
  }
  agent: {
    /** 发送聊天消息（非流式） */
    chat: (message: string, options?: AgentChatOptions) => Promise<string>
    /** 发送聊天消息（流式），通过回调接收事件 */
    chatStream: (
      message: string,
      onEvent: (event: AgentStreamEvent) => void,
      options?: AgentChatOptions
    ) => Promise<void>
    /** 停止当前对话 */
    stop: () => Promise<void>
  }
  history: {
    /** 保存会话 */
    save: (session: SessionData) => Promise<void>
    /** 加载会话 */
    load: (sessionId: string) => Promise<SessionData | null>
    /** 获取所有会话列表 */
    list: () => Promise<SessionData[]>
    /** 删除会话 */
    delete: (sessionId: string) => Promise<void>
    /** 清空历史（可排除当前会话） */
    clear: (excludeSessionId?: string) => Promise<number>
  }
  settings: {
    /** 列出所有模型配置 */
    modelList: () => Promise<ModelConfig[]>
    /** 获取当前激活配置 */
    getActiveModel: () => Promise<ModelConfig | null>
    /** 设置激活配置 */
    setActiveModel: (id: string) => Promise<void>
    /** 新增或更新模型配置 */
    upsertModel: (config: ModelConfig) => Promise<void>
    /** 删除模型配置 */
    deleteModel: (id: string) => Promise<void>
    /** 导出设置为 JSON 字符串 */
    exportSettings: () => Promise<string>
    /** 导入设置（JSON 字符串） */
    importSettings: (json: string) => Promise<void>
  }
}

