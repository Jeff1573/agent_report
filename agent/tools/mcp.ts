// agent/tools/mcp.ts
/**
 * 文档说明：MCP（Model Context Protocol）服务器连接工具
 * - 职责：连接MCP服务器并将MCP工具转换为LangChain工具
 * - 支持多种传输方式：stdio、streamable_http、sse
 * - 自动从MCP配置文件加载服务器配置
 */
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { logger } from '../utils/logger.js';
import { MCP_CONFIG_PATH } from '../config/env.js';
import path from 'path';
import { readFileSync } from 'fs';

export interface MCPServerConfig {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  transport?: 'stdio' | 'streamable_http' | 'sse';
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/** 工具类型占位（LangChain Tool 接口为结构化对象） */
export type AnyTool = unknown;

/** 重新导出MCP客户端类型 */
export type { MultiServerMCPClient } from '@langchain/mcp-adapters';

/**
 * 读取MCP配置文件
 * @param configPath MCP配置文件路径，优先级：参数 > 环境变量 > 默认路径
 */
export function readMCPConfig(configPath?: string): MCPConfig {
  // 优先级：参数 > 环境变量 > 默认路径
  const defaultPath = path.join(process.env.HOME || '~', '.cursor', 'mcp.json');
  const finalPath = configPath || MCP_CONFIG_PATH || defaultPath;

  try {
    const configContent = readFileSync(finalPath, 'utf-8');
    const config = JSON.parse(configContent) as MCPConfig;

    logger.info(`Loaded MCP config from ${finalPath}`, { servers: Object.keys(config.mcpServers || {}) });
    return config;
  } catch (error) {
    logger.warn(`Failed to load MCP config from ${finalPath}:`, error);
    return { mcpServers: {} };
  }
}

/**
 * 创建MCP客户端并连接所有配置的服务器
 */
export async function createMCPClient(configPath?: string): Promise<MultiServerMCPClient> {
  const config = readMCPConfig(configPath);

  if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
    logger.warn('No MCP servers configured');
    throw new Error('No MCP servers configured in MCP config file');
  }

  // 转换配置格式以适配MultiServerMCPClient
  const mcpServers: Record<string, any> = {};

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    if (serverConfig.type === 'http' || serverConfig.url) {
      // HTTP类型服务器 - 直接使用URL和headers
      if (serverConfig.url) {
        mcpServers[serverName] = {
          url: serverConfig.url,
          headers: serverConfig.headers || {},
          // transport会根据URL自动推断
        };
      } else {
        logger.warn(`HTTP server ${serverName} missing URL`);
        continue;
      }
    } else if (serverConfig.command) {
      // stdio类型服务器
      mcpServers[serverName] = {
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: serverConfig.env || {},
        // transport默认为stdio
      };
    } else {
      logger.warn(`Invalid MCP server configuration for ${serverName}`);
      continue;
    }
  }

  const client = new MultiServerMCPClient({
    mcpServers,
  });

  logger.info('Created MCP client with servers:', Object.keys(mcpServers));
  return client;
}

/**
 * 获取所有MCP工具和客户端实例
 */
export async function getMCPTools(configPath?: string): Promise<{ tools: AnyTool[], client: MultiServerMCPClient }> {
  const client = await createMCPClient(configPath);
  try {
    const tools = await client.getTools();

    logger.info(`Loaded ${tools.length} MCP tools`);
    return { tools, client };
  } catch (error) {
    logger.error('Failed to load MCP tools:', error);
    // 出错时也要关闭客户端
    try {
      await client.close();
    } catch (closeError) {
      logger.error('Error closing MCP client after failure:', closeError);
    }
    throw error; // 重新抛出错误，让调用者决定如何处理
  }
}

/**
 * 创建单个MCP工具（用于测试或特定服务器）
 */
export async function createMCPServerTool(serverName: string, configPath?: string): Promise<AnyTool[]> {
  try {
    const config = readMCPConfig(configPath);
    const serverConfig = config.mcpServers[serverName];

    if (!serverConfig) {
      throw new Error(`MCP server '${serverName}' not found in configuration`);
    }

    const client = await createMCPClient(configPath);
    const tools = await client.getTools();

    // 筛选出指定服务器的工具
    const serverTools = tools.filter((tool: any) => {
      // 尝试从工具的名称或元数据中识别服务器来源
      const toolName = tool.name || '';
      return toolName.includes(serverName) || toolName.startsWith(serverName + '_');
    });

    logger.info(`Loaded ${serverTools.length} tools from MCP server '${serverName}'`);
    return serverTools;
  } catch (error) {
    logger.error(`Failed to load tools from MCP server '${serverName}':`, error);
    return [];
  }
}

/**
 * 清理MCP客户端连接
 */
export async function cleanupMCPClient(client?: MultiServerMCPClient): Promise<void> {
  if (client) {
    try {
      await client.close();
      logger.info('MCP client connection closed');
    } catch (error) {
      logger.error('Error closing MCP client:', error);
    }
  }
}
