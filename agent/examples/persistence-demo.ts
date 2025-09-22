/**
 * 文档说明：
 * 持久化记忆冒烟脚本（同进程演示）
 * - 运行前：若需跨进程回放，请将 CHECKPOINT_MODE=postgres 且配置 CHECKPOINT_POSTGRES_URL
 * - 运行方式：npm run demo:persistence -w ./agent
 */
import { createAgentRuntime } from '../runtime/index.js';

async function run() {
  const threadId = process.env.THREAD_ID || 'demo-thread-001';
  const runtime = await createAgentRuntime();

  // 第一次对话：告知名字
  const q1 = '从现在起记住：我的名字是小明。只需回复“好的”。';
  process.stdout.write('\n[Round 1] ' + q1 + '\n');
  for await (const ev of runtime.streamValues(q1, { summary: false, threadId })) {
    if (ev.type === 'assistant-message') process.stdout.write(ev.content);
  }

  // 第二次对话：询问名字，触发记忆回放
  const q2 = '我叫什么名字？尽量简短作答。';
  process.stdout.write('\n\n[Round 2] ' + q2 + '\n');
  for await (const ev of runtime.streamValues(q2, { summary: false, threadId })) {
    if (ev.type === 'assistant-message') process.stdout.write(ev.content);
  }

  process.stdout.write('\n\n[Done]\n');
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

