// agent/utils/rag-bridge.ts
/**
 * 文档说明：读取 Electron 界面设置中的 RAG 配置（vectorDbConfigs），
 * 并按当前会话选择将配置应用为环境变量覆盖，供存储/检索模块使用。
 *
 * 设计要点：
 * - 设置文件位于 {MF_USER_DATA_DIR}/settings.json（由主进程设置环境变量）。
 * - 本模块不持久化修改，仅在进程内覆盖 process.env（调用结束可恢复原值）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

interface EmbeddingsConfigLite {
  provider: 'openai' | 'gemini'
  model?: string
  apiKey?: string
}

interface VectorDbConfigLite {
  id: string
  name: string
  enabled: boolean
  isDefault?: boolean
  provider: 'chroma'
  connection: { url: string }
  storage: { rootDir: string; rawDir: string }
  defaultCollection?: string
  embeddings?: EmbeddingsConfigLite
  updatedAt?: number
}

interface AppSettingsLite {
  modelConfigs?: unknown[]
  activeModelId?: string
  vectorDbConfigs?: VectorDbConfigLite[]
}

/** 原始环境变量快照（用于恢复） */
const originalEnv: Record<string, string | undefined> = {
  CHROMA_URL: process.env.CHROMA_URL,
  KB_STORAGE_ROOT: process.env.KB_STORAGE_ROOT,
  KB_STORAGE_RAW_DIR: process.env.KB_STORAGE_RAW_DIR,
  KB_EMBED_PROVIDER: process.env.KB_EMBED_PROVIDER,
  KB_EMBED_MODEL: process.env.KB_EMBED_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  KB_COLLECTION: process.env.KB_COLLECTION
}

function getSettingsPath(): string | null {
  const dir = process.env.MF_USER_DATA_DIR
  if (!dir || !dir.trim()) return null
  return path.join(dir, 'settings.json')
}

function readVectorDbConfigs(): VectorDbConfigLite[] {
  try {
    const p = getSettingsPath()
    if (!p || !fs.existsSync(p)) return []
    const raw = fs.readFileSync(p, 'utf-8')
    const json = JSON.parse(raw) as AppSettingsLite
    const arr = Array.isArray(json?.vectorDbConfigs) ? json.vectorDbConfigs : []
    // 仅保留 provider=chroma 的启用项
    return arr.filter((x) => x && x.provider === 'chroma')
  } catch {
    return []
  }
}

function findRagConfig(ragConfigId?: string): VectorDbConfigLite | undefined {
  const list = readVectorDbConfigs()
  if (ragConfigId) return list.find((x) => x.id === ragConfigId && x.enabled)
  return list.find((x) => x.isDefault && x.enabled) || list.find((x) => x.enabled)
}

/**
 * 将当前会话的 RAG 选择应用到环境变量。
 * - ragEnabled=false 时，恢复原始环境变量（不会抛错）。
 * - ragConfigId 未指定时，尝试使用默认项。
 * - ragCollection 指定时，设置 KB_COLLECTION；否则使用配置中的 defaultCollection（若存在）。
 */
export function applyRagSelection(
  ragEnabled?: boolean,
  ragConfigId?: string,
  ragCollection?: string
): void {
  console.log('[rag-bridge] applyRagSelection 调用', { ragEnabled, ragConfigId, ragCollection })
  
  if (!ragEnabled) {
    console.log('[rag-bridge] RAG 未启用，恢复原始环境变量')
    // 恢复原始环境变量
    Object.entries(originalEnv).forEach(([k, v]) => {
      if (typeof v === 'string') process.env[k] = v
      else delete process.env[k]
    })
    return
  }

  const cfg = findRagConfig(ragConfigId)
  if (!cfg) {
    console.warn('[rag-bridge] 找不到可用的 RAG 配置', { 
      ragConfigId, 
      settingsPath: getSettingsPath(),
      availableConfigs: readVectorDbConfigs().map(c => ({ id: c.id, name: c.name, enabled: c.enabled }))
    })
    return
  }

  console.log('[rag-bridge] 找到 RAG 配置，应用环境变量', { 
    id: cfg.id, 
    name: cfg.name,
    chromaUrl: cfg.connection?.url,
    collection: ragCollection || cfg.defaultCollection
  })

  process.env.CHROMA_URL = cfg.connection?.url || ''
  process.env.KB_STORAGE_ROOT = cfg.storage?.rootDir || ''
  process.env.KB_STORAGE_RAW_DIR = cfg.storage?.rawDir || ''
  const provider = (cfg.embeddings?.provider || 'openai').toLowerCase() as 'openai' | 'gemini'
  process.env.KB_EMBED_PROVIDER = provider
  if (provider === 'openai') {
    process.env.KB_EMBED_MODEL = cfg.embeddings?.model || 'text-embedding-3-small'
    if (cfg.embeddings?.apiKey) process.env.OPENAI_API_KEY = cfg.embeddings.apiKey
  } else {
    process.env.KB_EMBED_MODEL = cfg.embeddings?.model || 'embedding-001'
    if (cfg.embeddings?.apiKey) process.env.GOOGLE_API_KEY = cfg.embeddings.apiKey
  }
  const coll = (ragCollection || cfg.defaultCollection || '').trim()
  if (coll) process.env.KB_COLLECTION = coll
  
  console.log('[rag-bridge] 环境变量已设置', {
    CHROMA_URL: process.env.CHROMA_URL ? '已设置' : '未设置',
    KB_COLLECTION: process.env.KB_COLLECTION || '未设置',
    KB_EMBED_PROVIDER: process.env.KB_EMBED_PROVIDER,
    KB_EMBED_MODEL: process.env.KB_EMBED_MODEL
  })
}


