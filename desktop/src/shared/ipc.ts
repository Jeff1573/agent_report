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
  HISTORY_CLEAR: 'history/clear'
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
}

