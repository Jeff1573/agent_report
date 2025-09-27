// agent/examples/test-system-prompt.ts
/**
 * 文档说明：测试系统提示词是否正确加载
 */
import { getSystemMessage } from '../config/prompts.js';
import { logger } from '../utils/logger.js';

async function testSystemPrompt() {
  logger.info('Testing system prompt...');

  const systemMessage = getSystemMessage();
  logger.info('System message loaded:', systemMessage.length, 'characters');

  // 检查关键内容
  const checks = [
    { text: '多步思考流程', shouldContain: true },
    { text: 'MCP工具', shouldContain: true },
    { text: 'web_search_exa', shouldContain: true },
    { text: 'get_code_context_exa', shouldContain: true },
    { text: 'MindForge智能助手', shouldContain: true }
  ];

  logger.info('System prompt content validation:');
  checks.forEach(check => {
    const contains = systemMessage.includes(check.text);
    logger.info(`  ${check.text}: ${contains ? '✅' : '❌'} ${contains === check.shouldContain ? 'PASS' : 'FAIL'}`);
  });

  logger.info('System prompt test completed');
}

testSystemPrompt().catch(console.error);
