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
  // 通用工具
  UTIL_PICK_FILE: 'util/pickFile',
  UTIL_PICK_DIR: 'util/pickDir',
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
  SETTINGS_MODEL_VALIDATE_STREAMING: 'settings/model/validateStreaming',
  SETTINGS_EXPORT: 'settings/export',
  SETTINGS_IMPORT: 'settings/import',
  SETTINGS_OPEN_APP_DATA_FILE: 'settings/openAppDataFile',
  // 设置（RAG 配置）相关
  SETTINGS_RAG_LIST: 'settings/rag/list',
  SETTINGS_RAG_GET_DEFAULT: 'settings/rag/getDefault',
  SETTINGS_RAG_UPSERT: 'settings/rag/upsert',
  SETTINGS_RAG_DELETE: 'settings/rag/delete',
  SETTINGS_RAG_SET_DEFAULT: 'settings/rag/setDefault',
  SETTINGS_RAG_TOGGLE_ENABLED: 'settings/rag/toggleEnabled',
  SETTINGS_RAG_VALIDATE: 'settings/rag/validate',
  // 入库相关（文件/目录）
  RAG_IMPORT_FILE: 'rag/import/file',
  RAG_IMPORT_DIR: 'rag/import/dir'
} as const

/** 流式事件类型 */
export type StreamEventType =
  | 'model-token'
  | 'assistant-message'
  | 'tool-call'
  | 'tool-result'
  | 'round-end'
  | 'error'

/**
 * 事件阶段标识（用于精细分类）
 * - decision: LLM 决策阶段（决定调用哪个工具）
 * - execution: 工具执行阶段（Agent 执行工具）
 * - answer: 最终答案阶段（LLM 生成回答）
 */
export type EventStage = 'decision' | 'execution' | 'answer'

/** Agent 流式事件 */
export interface AgentStreamEvent {
  type: StreamEventType
  ts: number
  role?: 'assistant' | 'tool' | 'user' | 'system' | 'unknown'
  /** 事件阶段（可选，用于精细分类） */
  stage?: EventStage
  token?: string
  content?: string
  name?: string
  args?: unknown
  output?: unknown
  error?: unknown
  /** LLM 的思考过程（可选，仅用于 tool-call 事件） */
  thinking?: string
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
  /** 会话级 RAG 应用选择（禁用则不传或传 false） */
  ragEnabled?: boolean
  /** 指定使用的 RAG 配置ID（不传则按默认） */
  ragConfigId?: string
  /** 可选指定 collection（未传则使用 RAG 配置的默认 collection） */
  ragCollection?: string
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

/** 流式验证结果 */
export interface StreamingValidationResult {
  /** 是否支持流式 */
  supported: boolean
  /** 验证耗时（毫秒） */
  duration: number
  /** 错误信息 */
  error?: string
  /** 收到的 token 数量 */
  tokenCount?: number
  /** 首个 token 延迟（毫秒） */
  firstTokenLatency?: number
  /** 验证时间戳 */
  timestamp: number
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
  /** 流式验证结果（可选，验证后自动填充） */
  streamingValidation?: StreamingValidationResult
}

/** Embeddings 配置（UI 可覆盖 env） */
export interface EmbeddingsConfig {
  /** 提供商：openai | gemini */
  provider: 'openai' | 'gemini'
  /** 模型名，如 text-embedding-3-small 或 gemini-embedding-001 */
  model?: string
  /** 覆盖 API Key（可选） */
  apiKey?: string
}

/** 检索参数配置 */
export interface RetrieverConfig {
  /** 返回条数（默认 4） */
  k?: number
  /** 搜索类型 similarity | mmr（默认 similarity） */
  searchType?: 'similarity' | 'mmr'
  /** MMR 参数（默认 0.5） */
  mmrLambda?: number
  /** 候选集大小（默认 4*k 与 32 取大） */
  fetchK?: number
}

/** RAG 应用配置（首期仅支持 provider=chroma） */
export interface VectorDbConfig {
  id: string
  name: string
  /** 是否启用此应用 */
  enabled: boolean
  /** 是否为默认应用（同一时间仅允许一个） */
  isDefault?: boolean
  /** 提供商（首期固定 chroma，预留扩展） */
  provider: 'chroma'
  /** 连接配置 */
  connection: {
    /** Chroma 服务 URL */
    url: string
  }
  /** 知识库存储目录（入库原始文件与缓存） */
  storage: {
    /** 知识库根目录（KB_STORAGE_ROOT） */
    rootDir: string
    /** 原始文件目录（KB_STORAGE_RAW_DIR） */
    rawDir: string
  }
  /** 默认集合名（导入与对话未指定时使用） */
  defaultCollection?: string
  /** Embeddings 配置（覆盖 env） */
  embeddings?: EmbeddingsConfig
  /** 检索参数默认值 */
  retriever?: RetrieverConfig
  /** 更新时间戳 */
  updatedAt: number
}

/** RAG 配置校验结果 */
export interface RagValidationResult {
  /** 是否通过基本校验 */
  ok: boolean
  /** 错误信息列表（阻断性） */
  errors: string[]
  /** 警告信息列表（非阻断） */
  warnings?: string[]
  /** 附加信息 */
  info?: {
    /** Chroma 心跳连通 */
    heartbeat?: boolean
    /** 默认集合是否存在 */
    defaultCollectionExists?: boolean
  }
  /** 时间戳 */
  timestamp: number
}

/** 设置文件结构（扩展向量数据库配置） */
export interface AppSettings {
  modelConfigs: ModelConfig[]
  activeModelId?: string
  /** RAG 应用配置列表 */
  vectorDbConfigs: VectorDbConfig[]
}

/** 预加载向渲染暴露的受控 API 类型 */
export interface PreloadApi {
  app: {
    /** 获取应用版本号（来自主进程 app.getVersion） */
    getVersion: () => Promise<string>
  }
  util: {
    /** 选择单个文件，返回绝对路径或 null */
    pickFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
    /** 选择单个目录，返回绝对路径或 null */
    pickDirectory: () => Promise<string | null>
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
    /** 验证模型的流式支持 */
    validateStreaming: (modelId: string) => Promise<StreamingValidationResult>
    /** 导出设置为 JSON 字符串 */
    exportSettings: () => Promise<string>
    /** 导入设置（JSON 字符串） */
    importSettings: (json: string) => Promise<void>
    /** 在系统默认编辑器中打开 appData 目录下的文件 */
    openAppDataFile: (filename: string) => Promise<void>

    // ----- RAG 相关 -----
    /** 列出 RAG 应用配置 */
    ragList: () => Promise<VectorDbConfig[]>
    /** 获取默认 RAG 应用 */
    ragGetDefault: () => Promise<VectorDbConfig | null>
    /** 新增或更新 RAG 应用配置 */
    ragUpsert: (cfg: VectorDbConfig) => Promise<void>
    /** 删除 RAG 应用配置 */
    ragDelete: (id: string) => Promise<void>
    /** 设置默认 RAG 应用 */
    ragSetDefault: (id: string) => Promise<void>
    /** 启用/禁用 RAG 应用 */
    ragToggleEnabled: (id: string, enabled: boolean) => Promise<void>
    /** 校验 RAG 应用配置可用性 */
    ragValidate: (cfg: VectorDbConfig) => Promise<RagValidationResult>
    /** 导入单个文件到指定 collection */
    ragImportFile: (
      cfgId: string,
      filePath: string,
      collection: string,
      split?: { chunkSize?: number; chunkOverlap?: number },
      options?: { forceMethod?: 'auto' | 'ast' | 'text' }
    ) => Promise<{ method: string; chunks: number }>
    /** 导入目录到指定 collection */
    ragImportDir: (
      cfgId: string,
      dirPath: string,
      collection: string,
      split?: { chunkSize?: number; chunkOverlap?: number },
      options?: { forceMethod?: 'auto' | 'ast' | 'text' }
    ) => Promise<{ total: number; processed: number; codeFiles: number; docFiles: number }>
  }
}

