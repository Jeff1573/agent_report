// agent/examples/mcp-test.ts
/**
 * 文档说明：MCP服务器连接测试
 * - 测试连接到配置的MCP服务器并获取工具
 * - 验证MCP工具是否能正确加载和使用
 */
import { getMCPTools, createMCPClient } from '../tools/mcp.js';
import { logger } from '../utils/logger.js';

async function testMCPConnection() {
  try {
    logger.info('Testing MCP connection...');

    // 测试获取MCP工具
    const tools = await getMCPTools();
    logger.info(`Successfully loaded ${tools.length} MCP tools`);

    // 打印工具信息
    tools.forEach((tool: any, index: number) => {
      logger.info(`Tool ${index + 1}: ${tool.name} - ${tool.description}`);
    });

    // 测试MCP客户端创建
    const client = await createMCPClient();
    logger.info('MCP client created successfully');

    // 清理连接
    await client.close();
    logger.info('MCP client closed successfully');

  } catch (error) {
    logger.error('MCP test failed:', error);
  }
}

// 运行测试
testMCPConnection().catch(console.error);
