import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings, ModelConfig } from '../../shared/ipc'

const SETTINGS_FILE = 'settings.json'

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
    if (!('vectorDbConfigs' in json)) json.vectorDbConfigs = []
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



