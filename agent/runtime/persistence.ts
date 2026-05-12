// agent/runtime/persistence.ts
/**
 * 文档说明：LangGraph Checkpointer 工厂
 * - 开发：使用 MemorySaver（进程内，轻量）
 * - 生产：使用 PostgresSaver（需要连接串，并在首次使用时执行 setup/migrations）
 *
 * 参考文档：
 * - PostgresSaver: https://langchain-ai.github.io/langgraphjs/reference/classes/checkpoint_postgres.PostgresSaver.html
 * - Persistence/Thread ID: https://langchain-ai.github.io/langgraphjs/how-tos/manage-conversation-history/
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINT_POSTGRES_URL } from '../config/env.js';

export type PersistenceMode = 'memory' | 'postgres';

// 运行时对外统一使用 any，避免对第三方类型的强依赖造成收窄失败
export type Checkpointer = any;

/**
 * 创建持久化 checkpointer
 * @param mode memory | postgres
 */
export async function createCheckpointer(mode: PersistenceMode): Promise<Checkpointer> {
  if (mode === 'postgres') {
    const dsn = CHECKPOINT_POSTGRES_URL;
    if (!dsn || typeof dsn !== 'string') {
      // 降级到 memory，但发出警告
      // eslint-disable-next-line no-console
      console.warn('[persistence] CHECKPOINT_POSTGRES_URL 未配置，降级为 MemorySaver');
      return new MemorySaver();
    }
    const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
    const saver = PostgresSaver.fromConnString(String(dsn));
    // 官方建议：首次使用时 setup 以确保表结构存在
    if (typeof (saver as any).setup === 'function') {
      await (saver as any).setup();
    }
    return saver;
  }
  // 默认：内存 Saver
  return new MemorySaver();
}

/**
 * 生成可用于 Runnable 的配置对象（仅包含 thread_id）
 */
export function makeThreadConfig(threadId?: string): Partial<RunnableConfig> | undefined {
  if (!threadId || typeof threadId !== 'string') return undefined;
  const id = threadId.trim();
  if (!id) return undefined;
  return { configurable: { thread_id: id } } as any;
}
