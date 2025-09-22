// agent/index.ts
// 入口：调用运行时封装，支持 values / events 模式与交互概括

import { logger } from './utils/logger.js';
import { createAgentRuntime } from './runtime/index.js';

type Mode = 'values' | 'events';

function parseCli(argv: string[]) {
  const args = [...argv];
  let mode: Mode | undefined;
  let summary: boolean | undefined;
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

  return { mode: mode ?? 'values', summary: summary ?? true, input: rest.join(' ').trim() };
}

async function main() {
  const { mode, summary, input } = parseCli(process.argv.slice(2));
  const query = input || '使用 Tavily 搜索“RAG是什么？”，并返回结果。';
  const runtime = createAgentRuntime();
  logger.info(`mode=${mode} summary=${summary}`);
  logger.info('input:', query);

  const print = (e: any) => {
    switch (e.type) {
      case 'model-token':
        process.stdout.write(e.token);
        break;
      case 'assistant-message':
        process.stdout.write(e.content);
        break;
      case 'tool-call':
        logger.info('[tool-call]', { name: e.name, args: e.args });
        break;
      case 'tool-result':
        logger.info('[tool-result]', { name: e.name, output: e.output });
        break;
      case 'error':
        logger.error(e.error);
        break;
      case 'round-end':
        process.stdout.write('\n');
        break;
      default:
        break;
    }
  };

  if (mode === 'events') {
    for await (const ev of runtime.streamEvents(query, { summary })) {
      print(ev);
    }
  } else {
    for await (const ev of runtime.streamValues(query, { summary })) {
      print(ev);
    }
  }

  logger.info('stream done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
