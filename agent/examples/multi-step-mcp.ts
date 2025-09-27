// agent/examples/multi-step-mcp.ts
/**
 * 文档说明：多步MCP工具调用演示
 * - 展示如何通过系统提示词指导LLM进行多步推理
 * - 演示复杂的多工具调用场景
 */
import { createAgentRuntime } from '../runtime/index.js';
import { logger } from '../utils/logger.js';

async function demonstrateMultiStepMCP() {
  const runtime = await createAgentRuntime();

  // 复杂查询：需要多步操作来完成
  const complexQuery = `
  我需要了解最新的AI发展趋势。请帮我：
  1. 搜索最新的AI新闻和 breakthrough
  2. 查找相关的技术文档和研究论文
  3. 总结关键趋势并提供未来预测

  请使用系统化的方法来完成这个任务。
  `;

  logger.info('Starting multi-step MCP demonstration...');
  logger.info('Query:', complexQuery);

  try {
    // 使用events模式来观察完整的思考过程
    const events = runtime.streamEvents(complexQuery, {
      summary: true,
      threadId: 'multi-step-demo'
    });

    for await (const event of events) {
      switch (event.type) {
        case 'tool-call':
          logger.info(`🔧 Tool Call: ${event.name}`, {
            args: event.args,
            reasoning: 'Agent decided to use this tool for gathering information'
          });
          break;
        case 'tool-result':
          logger.info(`📊 Tool Result: ${event.name}`, {
            hasContent: !!event.output,
            reasoning: 'Agent received data from tool call'
          });
          break;
        case 'assistant-message':
          logger.info(`🤖 Assistant Response:`, {
            content: event.content.substring(0, 200) + '...',
            reasoning: 'Agent is synthesizing information and planning next steps'
          });
          break;
        case 'round-end':
          logger.info(`🏁 Round Complete`, {
            reasoning: 'Agent completed one iteration, may continue with more tool calls'
          });
          break;
      }
    }

    logger.info('Multi-step MCP demonstration completed');
  } catch (error) {
    logger.error('Multi-step demonstration failed:', error);
  }
}

// 运行演示
demonstrateMultiStepMCP().catch(console.error);
