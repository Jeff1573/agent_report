// agent/utils/settings-bridge.ts
/**
 * 桥接模块：从 Electron 界面配置中读取运行时配置
 * 
 * 配置存储位置：{userData}/settings.json
 * 环境变量：MF_USER_DATA_DIR 指定用户数据目录
 * 
 * 配置读取支持缓存，避免频繁读文件，但每次对话时会强制刷新。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 模型配置覆盖项（向后兼容）
 */
export type ModelOverrides = Partial<{
  model: string
  baseURL: string
  apiKey: string
  temperature: number
  timeout: number
  maxRetries: number
  streaming: boolean
}>

/**
 * 完整的 UI 运行时配置（包含所有可配置项）
 */
export interface UIRuntimeConfig {
  model?: string;
  baseURL?: string;
  apiKey?: string;
  temperature?: number;
  timeout?: number;
  maxRetries?: number;
  streaming?: boolean;
}

/**
 * 配置缓存（避免频繁读文件）
 */
interface ConfigCache {
  data: UIRuntimeConfig | undefined;
  timestamp: number;
  ttl: number; // 缓存过期时间（毫秒）
}

const cache: ConfigCache = {
  data: undefined,
  timestamp: 0,
  ttl: 1000, // 1秒缓存，确保界面切换能快速生效
};

/**
 * 获取用户数据目录
 * 
 * @returns {string | null} 用户数据目录路径，未设置则返回 null
 */
function getUserDataDir(): string | null {
  const hint = process.env.MF_USER_DATA_DIR
  if (typeof hint === 'string' && hint.trim().length > 0) return hint
  return null
}

/**
 * 读取界面配置文件
 * 
 * @param {boolean} forceRefresh 是否强制刷新缓存
 * @returns {UIRuntimeConfig | undefined} 配置对象或 undefined
 */
function readSettingsFile(forceRefresh = false): UIRuntimeConfig | undefined {
  // 检查缓存
  const now = Date.now();
  if (!forceRefresh && cache.data && (now - cache.timestamp) < cache.ttl) {
    return cache.data;
  }

  try {
    const userData = getUserDataDir();
    if (!userData) {
      cache.data = undefined;
      cache.timestamp = now;
      return undefined;
    }

    const settingsPath = path.join(userData, 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      cache.data = undefined;
      cache.timestamp = now;
      return undefined;
    }

    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const json = JSON.parse(raw) as { modelConfigs?: any[]; activeModelId?: string };
    const id = json?.activeModelId;
    
    if (!id || !Array.isArray(json?.modelConfigs)) {
      cache.data = undefined;
      cache.timestamp = now;
      return undefined;
    }

    const cfg = json.modelConfigs.find((c) => c?.id === id);
    if (!cfg) {
      cache.data = undefined;
      cache.timestamp = now;
      return undefined;
    }

    const config: UIRuntimeConfig = {};
    if (typeof cfg.model === 'string' && cfg.model) config.model = cfg.model;
    if (typeof cfg.baseURL === 'string' && cfg.baseURL) config.baseURL = cfg.baseURL;
    if (typeof cfg.apiKey === 'string' && cfg.apiKey) config.apiKey = cfg.apiKey;
    if (typeof cfg.temperature === 'number') config.temperature = cfg.temperature;
    if (typeof cfg.timeout === 'number') config.timeout = cfg.timeout;
    if (typeof cfg.maxRetries === 'number') config.maxRetries = cfg.maxRetries;
    if (typeof cfg.streaming === 'boolean') config.streaming = cfg.streaming;

    // 更新缓存
    cache.data = config;
    cache.timestamp = now;
    
    return config;
  } catch {
    cache.data = undefined;
    cache.timestamp = now;
    return undefined;
  }
}

/**
 * 获取完整的 UI 运行时配置
 * 
 * 此函数用于配置合并系统，每次调用都会强制刷新缓存，
 * 确保界面配置切换能立即生效。
 * 
 * @returns {Promise<UIRuntimeConfig | undefined>} UI 配置或 undefined
 * 
 * @example
 * const uiConfig = await getUIRuntimeConfig();
 * if (uiConfig?.apiKey) {
 *   console.log('使用界面配置的 API Key');
 * }
 */
export async function getUIRuntimeConfig(): Promise<UIRuntimeConfig | undefined> {
  // 强制刷新缓存，确保每次对话都能获取最新配置
  return Promise.resolve(readSettingsFile(true));
}

/**
 * 获取激活的模型配置覆盖项（向后兼容）
 * 
 * @deprecated 建议使用 getUIRuntimeConfig() 获取完整配置
 * @returns {Promise<ModelOverrides | undefined>} 模型覆盖配置
 */
export async function getActiveModelOverrides(): Promise<ModelOverrides | undefined> {
  return getUIRuntimeConfig();
}


