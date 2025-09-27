// agent/index.ts
// 入口：调用运行时封装，支持 values / events 模式与交互概括

import { logger, createLogger } from './utils/logger.js';
import { createAgentRuntime } from './runtime/index.js';
import { THREAD_ID_FALLBACK, TIMEOUT_MS } from './config/env.js';

type Mode = 'values' | 'events';

/**
 * 读取 STDIN（若可用）。
 *
 * @returns {Promise<string>} 标准输入内容字符串
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const chunks: Buffer[] = [];
      if (process.stdin.isTTY) return resolve('');
      process.stdin.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
      process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
      process.stdin.resume();
    } catch {
      resolve('');
    }
  });
}

/**
 * 解析命令行参数。
 * - 支持：--mode events|values、--summary on|off、--thread <id>、--input "..."
 * - 兼容：裸值传参（events on question...）
 */
function parseCli(argv: string[]) {
  const args = [...argv];
  let mode: Mode | undefined;
  let summary: boolean | undefined;
  let threadId: string | undefined;
  let printSources = false;
  const rest: string[] = [];
  const isOn = (v: string) => !(v.toLowerCase() === 'off' || v.toLowerCase() === 'false' || v === '0');

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') continue;

    if (a === '--mode' || a.startsWith('--mode=')) {
      const v = a.includes('=') ? a.split('=')[1] : args[++i];
      if (v === 'values' || v === 'events') mode = v;
      continue;
    }
    if (a === '--summary' || a.startsWith('--summary=')) {
      const v = a.includes('=') ? a.split('=')[1] : args[++i];
      summary = isOn(String(v));
      continue;
    }
    if (a === '--thread' || a === '-t' || a.startsWith('--thread=')) {
      const v = a.includes('=') ? a.split('=')[1] : args[++i];
      if (typeof v === 'string' && v.trim()) threadId = v.trim();
      continue;
    }
    if (a === '--input' || a.startsWith('--input=')) {
      const v = a.includes('=') ? a.split('=')[1] : args[++i];
      if (typeof v === 'string') rest.push(v);
      continue;
    }
    if (a === '--print-sources' || a.startsWith('--print-sources=')) {
      const v = a.includes('=') ? a.split('=')[1] : 'on';
      printSources = isOn(String(v));
      continue;
    }
    rest.push(a);
  }

  // 兼容 npm/yarn 透传导致的“裸值”形式：`events on question...`
  if (!mode && rest.length > 0 && (rest[0] === 'values' || rest[0] === 'events')) {
    mode = rest.shift() as Mode;
  }
  if (summary === undefined && rest.length > 0) {
    const head = String(rest[0]).toLowerCase();
    if (head === 'on' || head === 'off' || head === 'true' || head === 'false' || head === '0' || head === '1') {
      summary = isOn(head);
      rest.shift();
    }
  }

  return { mode: mode ?? 'events', summary: summary ?? false, threadId, printSources, input: rest.join(' ').trim() };
}

/**
 * 主入口：基于 createAgentRuntime 运行 ReAct 交互。
 */
async function main() {
  const { mode, summary, printSources, threadId: cliThreadId = 'test-thread-001', input } = parseCli(process.argv.slice(2));
  const stdinText = input ? '' : await readStdin();
  const query = (input || stdinText || '根据资料，查询角色定位是什么？').trim();
  const runtime = await createAgentRuntime();
  const threadId = (cliThreadId && cliThreadId.trim()) || (THREAD_ID_FALLBACK && THREAD_ID_FALLBACK.trim()) || undefined;

  const log = threadId ? createLogger({ threadId }) : logger;
  log.info(`mode=${mode} summary=${summary}`);
  if (threadId) log.info(`threadId=${threadId}`);
  log.info('input:', query);

  const collectedSources: Array<{ index: number; ref: string }> = [];
  const print = (e: any) => {
    switch (e.type) {
      case 'model-token':
        process.stdout.write(e.token);
        break;
      case 'assistant-message':
        log.warn('[assistant-message]', { content: e.content });
        break;
      case 'tool-call':
        log.info('[tool-call]', { name: e.name, args: e.args });
        break;
      case 'tool-result':
        log.info('[tool-result]', { name: e.name, output: e.output });
        // 收集 kb_search 的 sources 以便结尾打印
        try {
          if (e.name === 'kb_search') {
            const raw = typeof e.output?.content === 'string' ? e.output.content : undefined;
            if (raw) {
              const j = JSON.parse(raw);
              if (Array.isArray(j?.sources)) {
                collectedSources.splice(0, collectedSources.length, ...j.sources);
              }
            }
          }
        } catch { /* ignore */ }
        break;
      case 'error':
        log.error(e.error);
        break;
      case 'round-end':
        process.stdout.write('\n');
        break;
      default:
        break;
    }
  };

  const controller = new AbortController();
  const deadline = Number.isFinite(TIMEOUT_MS) && Number(TIMEOUT_MS) > 0 ? Number(TIMEOUT_MS) : undefined;
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  if (deadline) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      log.error(`[timeout] 超过 TIMEOUT_MS=${deadline}ms`);
      process.exitCode = 124;
    }, deadline);
  }

  try {
    if (mode === 'events') {
      let eventCount = 0;
      for await (const ev of runtime.streamEvents(query, { summary, threadId })) {
        eventCount++;
        print(ev);
        if (timedOut) {
          log.warn(`Breaking due to timeout after ${eventCount} events`);
          break;
        }
      }
      log.info(`Processed ${eventCount} events`);
    } else {
      let eventCount = 0;
      for await (const ev of runtime.streamValues(query, { summary, threadId })) {
        eventCount++;
        print(ev);
        if (timedOut) {
          log.warn(`Breaking due to timeout after ${eventCount} events`);
          break;
        }
      }
      log.info(`Processed ${eventCount} events`);
    }
  } catch (error) {
    log.error('Stream processing error:', error);
    if (timedOut) {
      log.error('Stream was aborted due to timeout');
    }
  } finally {
    if (timer) clearTimeout(timer);
    // 清理运行时资源
    try {
      await runtime.close();
      log.info('Runtime closed successfully');
    } catch (closeError) {
      log.error('Error closing runtime:', closeError);
    }
  }

  log.info('stream done.');
  if (printSources && collectedSources.length > 0) {
    log.info('Sources:');
    for (const s of collectedSources) {
      log.info(`- [${s.index}] ${s.ref}`);
    }
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
