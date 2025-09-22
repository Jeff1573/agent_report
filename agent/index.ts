// agent/index.ts
// 入口：基于 LangGraph 预构建 ReAct Agent，采用流式输出（values）
// 说明：环境变量加载由 agent/config/env.ts 间接完成（logger -> env）。

import { logger } from './utils/logger.js';
import { makeChatModel } from './llm/factory.js';
// 使用 Tavily 作为首选搜索工具，避免 DDG 速率限制
import { tavilyTool } from './tools/tavily.js';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

/**
 * 运行基于 createReactAgent 的最小演示：
 * - 使用 OpenAI Chat 模型（见 makeChatModel）
 * - 工具列表第一项为 DuckDuckGoSearch（网络检索）
 * - 以 stream({ streamMode: 'values' }) 流式输出增量消息
 */
async function main() {
  const llm = makeChatModel();
  const tools = [tavilyTool]; // 第一项：TavilySearch

  const agent = createReactAgent({ llm, tools });

  // 输入：可从命令行读取，否则使用默认查询
  const userInput = process.argv.slice(2).join(' ').trim() ||
    '使用 Tavily 搜索“今天的日期”，并返回结果。';

  logger.info('input:', userInput);

  const inputs = { messages: [{ role: 'user', content: userInput }] };
  const stream = await agent.stream(inputs, { streamMode: 'values' });

  for await (const { messages } of stream) {
    const msg = (messages as any)?.[(messages as any).length - 1];
    if (!msg) continue;
    // 优先打印自然语言内容；若为工具调用增量则打印 tool_calls
    if (msg.content) {
      const text = Array.isArray(msg.content)
        ? msg.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('')
        : String(msg.content);
      process.stdout.write(text);
    }
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      logger.info('\n[tool_calls]', msg.tool_calls);
    }
  }

  logger.info('\nstream done.');
}

main().catch((e) => {
  // 这里不使用 logger，避免 logger 初始化异常时丢失错误
  console.error(e);
  process.exit(1);
});
