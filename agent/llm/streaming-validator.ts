// agent/llm/streaming-validator.ts
/**
 * LLM 流式支持验证器
 * 
 * 用于检测当前配置的 LLM 是否真正支持流式输出。
 * 验证结果会被保存，用于优化用户体验。
 */

import { makeChatModel } from './factory.js';
import { logger } from '../utils/logger.js';
import type { RuntimeConfig } from '../config/merge.js';

/**
 * 流式验证结果
 */
export interface StreamingValidationResult {
  /** 是否支持流式 */
  supported: boolean;
  /** 验证耗时（毫秒） */
  duration: number;
  /** 错误信息（如果验证失败） */
  error?: string;
  /** 收到的 token 数量 */
  tokenCount?: number;
  /** 首个 token 延迟（毫秒） */
  firstTokenLatency?: number;
  /** 验证时间戳 */
  timestamp: number;
}

/**
 * 验证 LLM 是否支持流式输出
 * 
 * @param config LLM 配置
 * @param timeout 超时时间（毫秒），默认 15000ms
 * @returns 验证结果
 */
export async function validateStreamingSupport(
  config: RuntimeConfig,
  timeout: number = 15000
): Promise<StreamingValidationResult> {
  const startTime = Date.now();
  let firstTokenTime: number | undefined;
  
  try {
    // 创建一个开启流式的 LLM 实例
    const llm = makeChatModel({
      ...config,
      streaming: true,
      streamUsage: false,
    });

    // 测试消息：简短的问题，期望快速响应
    const testMessage = { role: 'user', content: 'Say "OK"' };
    
    let tokenCount = 0;
    let hasReceivedToken = false;
    let streamError: Error | undefined;
    
    // 创建超时 Promise
    const timeoutPromise = new Promise<StreamingValidationResult>((resolve) => {
      setTimeout(() => {
        resolve({
          supported: false,
          duration: Date.now() - startTime,
          error: `验证超时（${timeout}ms），未收到流式数据`,
          tokenCount: 0,
          timestamp: Date.now(),
        });
      }, timeout);
    });
    
    // 创建流式验证 Promise
    const streamingPromise = new Promise<StreamingValidationResult>(async (resolve, reject) => {
      try {
        const stream = await (llm as any).stream([testMessage]);
        
        for await (const chunk of stream) {
          // 尝试提取 token 内容
          const content = chunk?.content ?? chunk?.text ?? chunk;
          
          if (typeof content === 'string' && content.length > 0) {
            if (!hasReceivedToken) {
              hasReceivedToken = true;
              firstTokenTime = Date.now();
            }
            tokenCount++;
            
            // 收到第一个 token 就认为验证成功
            if (tokenCount >= 1) {
              resolve({
                supported: true,
                duration: Date.now() - startTime,
                tokenCount,
                firstTokenLatency: firstTokenTime ? firstTokenTime - startTime : undefined,
                timestamp: Date.now(),
              });
              break;
            }
          } else if (Array.isArray(content)) {
            // 处理内容数组
            for (const item of content) {
              if (typeof item === 'string' && item.length > 0) {
                if (!hasReceivedToken) {
                  hasReceivedToken = true;
                  firstTokenTime = Date.now();
                }
                tokenCount++;
                break;
              } else if (typeof item === 'object' && item !== null) {
                const text = (item as any)?.text;
                if (typeof text === 'string' && text.length > 0) {
                  if (!hasReceivedToken) {
                    hasReceivedToken = true;
                    firstTokenTime = Date.now();
                  }
                  tokenCount++;
                  break;
                }
              }
            }
            
            if (hasReceivedToken) {
              resolve({
                supported: true,
                duration: Date.now() - startTime,
                tokenCount,
                firstTokenLatency: firstTokenTime ? firstTokenTime - startTime : undefined,
                timestamp: Date.now(),
              });
              break;
            }
          }
        }
        
        // 流结束但没有收到 token
        if (!hasReceivedToken) {
          resolve({
            supported: false,
            duration: Date.now() - startTime,
            error: '流式调用完成但未收到任何 token',
            tokenCount: 0,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        streamError = error as Error;
        reject(error);
      }
    });
    
    // 竞速：谁先完成就用谁的结果
    try {
      const result = await Promise.race([streamingPromise, timeoutPromise]);
      
      if (result.supported) {
        logger.info(`流式验证成功: 收到 ${result.tokenCount} 个 token，首个 token 延迟 ${result.firstTokenLatency}ms`);
      } else {
        logger.warn(`流式验证失败: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      // 流式调用出错
      return {
        supported: false,
        duration: Date.now() - startTime,
        error: `流式调用出错: ${error instanceof Error ? error.message : String(error)}`,
        tokenCount: 0,
        timestamp: Date.now(),
      };
    }
  } catch (error) {
    // LLM 初始化失败
    logger.error('流式验证失败（初始化错误）:', error);
    return {
      supported: false,
      duration: Date.now() - startTime,
      error: `LLM 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      tokenCount: 0,
      timestamp: Date.now(),
    };
  }
}

/**
 * 快速检测流式支持（使用较短的超时时间）
 * 
 * @param config LLM 配置
 * @returns 是否支持流式
 */
export async function quickCheckStreaming(config: RuntimeConfig): Promise<boolean> {
  const result = await validateStreamingSupport(config, 8000);
  return result.supported;
}

/**
 * 带缓存的流式验证器
 * 避免重复验证同一配置
 */
class StreamingValidator {
  private cache = new Map<string, StreamingValidationResult>();
  
  /**
   * 生成配置的缓存键
   */
  private getCacheKey(config: RuntimeConfig): string {
    const provider = config.baseURL ? 'custom' : 'openai';
    return `${provider}-${config.model}-${config.apiKey?.substring(0, 8)}`;
  }
  
  /**
   * 验证并缓存结果
   */
  async validate(config: RuntimeConfig, forceRevalidate: boolean = false): Promise<StreamingValidationResult> {
    const cacheKey = this.getCacheKey(config);
    
    if (!forceRevalidate && this.cache.has(cacheKey)) {
      logger.debug('使用缓存的流式验证结果');
      return this.cache.get(cacheKey)!;
    }
    
    const result = await validateStreamingSupport(config);
    this.cache.set(cacheKey, result);
    
    return result;
  }
  
  /**
   * 清除缓存
   */
  clearCache(config?: RuntimeConfig): void {
    if (config) {
      const cacheKey = this.getCacheKey(config);
      this.cache.delete(cacheKey);
    } else {
      this.cache.clear();
    }
  }
}

/** 全局流式验证器实例 */
export const streamingValidator = new StreamingValidator();

