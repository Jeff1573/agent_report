// agent/utils/settings-bridge.ts
import * as fs from 'node:fs'
import * as path from 'node:path'

export type ModelOverrides = Partial<{
  model: string
  baseURL: string
  apiKey: string
  temperature: number
  timeout: number
  maxRetries: number
  streaming: boolean
}>

function getUserDataDir(): string | null {
  const hint = process.env.MF_USER_DATA_DIR
  if (typeof hint === 'string' && hint.trim().length > 0) return hint
  return null
}

export async function getActiveModelOverrides(): Promise<ModelOverrides | undefined> {
  try {
    const userData = getUserDataDir()
    if (!userData) return undefined
    const settingsPath = path.join(userData, 'settings.json')
    if (!fs.existsSync(settingsPath)) return undefined
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const json = JSON.parse(raw) as { modelConfigs?: any[]; activeModelId?: string }
    const id = json?.activeModelId
    if (!id || !Array.isArray(json?.modelConfigs)) return undefined
    const cfg = json.modelConfigs.find((c) => c?.id === id)
    if (!cfg) return undefined
    const overrides: ModelOverrides = {}
    if (typeof cfg.model === 'string' && cfg.model) overrides.model = cfg.model
    if (typeof cfg.baseURL === 'string' && cfg.baseURL) overrides.baseURL = cfg.baseURL
    if (typeof cfg.apiKey === 'string' && cfg.apiKey) overrides.apiKey = cfg.apiKey
    if (typeof cfg.temperature === 'number') overrides.temperature = cfg.temperature
    if (typeof cfg.timeout === 'number') overrides.timeout = cfg.timeout
    if (typeof cfg.maxRetries === 'number') overrides.maxRetries = cfg.maxRetries
    if (typeof cfg.streaming === 'boolean') overrides.streaming = cfg.streaming
    return overrides
  } catch {
    return undefined
  }
}


