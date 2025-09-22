// agent 入口文件
// 环境变量加载优先级在 agent/config/env.ts 中统一处理（.env 覆盖系统变量）
import { askOnce, askWithHistory, askStream } from './services/chat.js';
import { logger } from './utils/logger.js';

async function main() {
  // 1) 冒烟：最简单调用
  const single = await askOnce('你好，用一句话介绍一下你自己');
  logger.info('invoke content:', single.content);

  // 2) 多轮：带历史
  const res = await askWithHistory([
    { role: 'system', content: '你是一个简洁的助手' },
    { role: 'user', content: '用10个字夸夸 TypeScript' },
  ]);
  logger.info('history content:', res.content);

  // 3) 流式：按块输出（具体是否 token 取决于提供商）
  let acc = '';
  for await (const part of askStream([{ role: 'user', content: '写一条祝福语' }])) {
    acc += part;
    process.stdout.write(part);
  }
  logger.info('\nstream done. total:', acc.length);
}

main().catch((e) => {
  // 这里不使用 logger，避免在 logger 初始化异常时吞掉错误
  console.error(e);
  process.exit(1);
});

