/**
 * 配置合并模块
 * 
 * 实现配置优先级系统：
 * 1. 优先使用界面配置（settings.json）
 * 2. 其次使用环境变量（.env）
 * 3. 最后使用默认值
 * 
 * 每次对话时动态读取最新配置，确保界面切换立即生效。
 */

import { logger } from '../utils/logger.js';
import { getUIRuntimeConfig } from '../utils/settings-bridge.js';
import {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  OPENAI_STREAM_USAGE,
  TIMEOUT_MS,
  MAX_RETRIES,
  CUSTOM_AUTH_HEADER,
  CUSTOM_AUTH_VALUE,
} from './env.js';

/**
 * 运行时配置类型（包含所有必需和可选的配置项）
 */
export interface RuntimeConfig {
  // LLM 基础配置
  apiKey: string;
  model: string;
  baseURL?: string;
  
  // LLM 行为配置
  temperature?: number;
  timeout?: number;
  maxRetries?: number;
  streaming?: boolean;
  streamUsage?: boolean;
  
  // 自定义认证（某些兼容端点需要）
  customAuthHeader?: string;
  customAuthValue?: string;
}

/**
 * 配置来源信息（用于调试和日志）
 */
export interface ConfigSource {
  apiKey: 'ui' | 'env' | 'missing';
  model: 'ui' | 'env' | 'missing';
  baseURL: 'ui' | 'env' | 'default';
  temperature: 'ui' | 'env' | 'default';
  timeout: 'ui' | 'env' | 'default';
  maxRetries: 'ui' | 'env' | 'default';
  streaming: 'ui' | 'env' | 'default';
}

/**
 * 合并配置结果
 */
export interface MergedConfigResult {
  config: RuntimeConfig;
  sources: ConfigSource;
}

/**
 * 获取合并后的运行时配置
 * 
 * 配置优先级：
 * 1. 界面配置（settings.json）- 最高优先级
 * 2. 环境变量（.env）- 中等优先级
 * 3. 默认值 - 最低优先级
 * 
 * @returns {Promise<MergedConfigResult>} 合并后的配置和来源信息
 * 
 * @example
 * const { config, sources } = await getMergedConfig();
 * console.log('API Key 来源:', sources.apiKey); // 'ui' | 'env' | 'missing'
 * const llm = makeChatModel(config);
 */
export async function getMergedConfig(): Promise<MergedConfigResult> {
  // 1. 读取界面配置
  const uiConfig = await getUIRuntimeConfig().catch((err: unknown) => {
    logger.debug('读取界面配置失败（可能未设置）:', err);
    return undefined;
  });

  // 2. 初始化配置来源追踪
  const sources: ConfigSource = {
    apiKey: 'missing',
    model: 'missing',
    baseURL: 'default',
    temperature: 'default',
    timeout: 'default',
    maxRetries: 'default',
    streaming: 'default',
  };

  // 3. 合并配置（优先级：UI > ENV > Default）
  const config: RuntimeConfig = {
    // 必需项：API Key
    apiKey: '',
    // 必需项：Model
    model: '',
  };

  // === API Key ===
  if (uiConfig?.apiKey) {
    config.apiKey = uiConfig.apiKey;
    sources.apiKey = 'ui';
  } else if (OPENAI_API_KEY) {
    config.apiKey = OPENAI_API_KEY;
    sources.apiKey = 'env';
  }

  // === Model ===
  if (uiConfig?.model) {
    config.model = uiConfig.model;
    sources.model = 'ui';
  } else if (OPENAI_MODEL) {
    config.model = OPENAI_MODEL;
    sources.model = 'env';
  }

  // === Base URL ===
  if (uiConfig?.baseURL) {
    config.baseURL = uiConfig.baseURL;
    sources.baseURL = 'ui';
  } else if (OPENAI_BASE_URL) {
    config.baseURL = OPENAI_BASE_URL;
    sources.baseURL = 'env';
  }
  // baseURL 可以为 undefined（使用 LangChain 默认值）

  // === Temperature ===
  if (typeof uiConfig?.temperature === 'number') {
    config.temperature = uiConfig.temperature;
    sources.temperature = 'ui';
  }
  // temperature 可选，不设置则使用 LLM 默认值

  // === Timeout ===
  if (typeof uiConfig?.timeout === 'number') {
    config.timeout = uiConfig.timeout;
    sources.timeout = 'ui';
  } else if (TIMEOUT_MS) {
    config.timeout = TIMEOUT_MS;
    sources.timeout = 'env';
  }

  // === Max Retries ===
  if (typeof uiConfig?.maxRetries === 'number') {
    config.maxRetries = uiConfig.maxRetries;
    sources.maxRetries = 'ui';
  } else if (MAX_RETRIES) {
    config.maxRetries = MAX_RETRIES;
    sources.maxRetries = 'env';
  }

  // === Streaming ===
  if (typeof uiConfig?.streaming === 'boolean') {
    config.streaming = uiConfig.streaming;
    sources.streaming = 'ui';
  }
  // streaming 可选，默认由调用方控制

  // === Stream Usage ===
  config.streamUsage = OPENAI_STREAM_USAGE;

  // === Custom Auth (仅从环境变量读取，不暴露到 UI) ===
  if (CUSTOM_AUTH_HEADER && CUSTOM_AUTH_VALUE) {
    config.customAuthHeader = CUSTOM_AUTH_HEADER;
    config.customAuthValue = CUSTOM_AUTH_VALUE;
  }

  // 4. 记录配置来源（便于调试）
  logger.debug('配置合并完成:', {
    sources,
    hasApiKey: Boolean(config.apiKey),
    hasModel: Boolean(config.model),
    hasBaseURL: Boolean(config.baseURL),
  });

  return { config, sources };
}

/**
 * 获取配置摘要（用于日志和调试，不包含敏感信息）
 * 
 * @param {MergedConfigResult} result 合并配置结果
 * @returns {object} 配置摘要
 */
export function getConfigSummary(result: MergedConfigResult): Record<string, unknown> {
  const { config, sources } = result;
  
  return {
    llm: {
      model: config.model || 'NOT_SET',
      modelSource: sources.model,
      baseURL: config.baseURL || 'default',
      baseURLSource: sources.baseURL,
      hasApiKey: Boolean(config.apiKey),
      apiKeySource: sources.apiKey,
    },
    behavior: {
      temperature: config.temperature ?? 'default',
      temperatureSource: sources.temperature,
      timeout: config.timeout ?? 'default',
      timeoutSource: sources.timeout,
      maxRetries: config.maxRetries ?? 'default',
      maxRetriesSource: sources.maxRetries,
      streaming: config.streaming ?? 'default',
      streamingSource: sources.streaming,
    },
  };
}

/**
 * 验证运行时配置的完整性
 * 
 * 确保合并后的配置包含所有必需项，用于对话前的严格验证。
 * 
 * @param {RuntimeConfig} config 要验证的运行时配置
 * @throws {Error} 当配置缺少必需项时抛出
 * 
 * @example
 * const { config } = await getMergedConfig();
 * validateRuntimeConfig(config); // 对话前验证
 */
export function validateRuntimeConfig(config: RuntimeConfig): void {
  const errors: string[] = [];

  // 验证必需项
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    errors.push('API Key 未配置（请在界面设置或 .env 文件中配置 OPENAI_API_KEY）');
  }

  if (!config.model || config.model.trim().length === 0) {
    errors.push('模型名称未配置（请在界面设置或 .env 文件中配置 OPENAI_MODEL）');
  }

  if (errors.length > 0) {
    const errorMessage = [
      '❌ 运行时配置验证失败，缺少以下必需配置：\n',
      ...errors.map((err, i) => `  ${i + 1}. ${err}`),
      '\n💡 请在界面设置中配置模型，或在 .env 文件中设置环境变量',
      '\n📝 参考 desktop/ENV_CONFIG.md 了解配置说明'
    ].join('\n');
    
    throw new Error(errorMessage);
  }
}

