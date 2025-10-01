// agent/examples/test-glm-streaming.ts
/**
 * 文档说明：测试 GLM 提供商的流式输出和非流式输出
 * 
 * 功能：
 * 1. 从指定配置文件中读取 GLM 配置
 * 2. 验证流式输出和非流式输出的区别
 * 3. 展示两种输出方式的差异和特点
 * 4. 绑定 MCP 工具（exa-code）测试工具调用效果
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeChatModel } from '../llm/factory.js';
import { logger } from '../utils/logger.js';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { getMCPTools, cleanupMCPClient } from '../tools/mcp.js';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';

/**
 * 读取指定路径的配置文件
 * 
 * @param {string} settingsPath - 配置文件路径
 * @returns {object | null} GLM 配置对象或 null
 */
function readGLMConfig(settingsPath: string): {
  model: string;
  baseURL: string;
  apiKey: string;
  temperature?: number;
} | null {
  try {
    // 检查文件是否存在
    if (!fs.existsSync(settingsPath)) {
      logger.error('配置文件不存在:', settingsPath);
      return null;
    }

    // 读取并解析配置文件
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const json = JSON.parse(raw) as { modelConfigs?: any[]; activeModelId?: string };
    
    const activeId = json?.activeModelId;
    if (!activeId || !Array.isArray(json?.modelConfigs)) {
      logger.error('配置文件格式错误：缺少 activeModelId 或 modelConfigs');
      return null;
    }

    // 查找当前激活的配置
    const activeConfig = json.modelConfigs.find((c) => c?.id === activeId);
    if (!activeConfig) {
      logger.error('未找到激活的配置:', activeId);
      return null;
    }

    // 验证必需字段
    if (!activeConfig.model || !activeConfig.baseURL || !activeConfig.apiKey) {
      logger.error('配置不完整：缺少 model、baseURL 或 apiKey');
      return null;
    }

    logger.info('成功加载配置:', {
      id: activeConfig.id,
      name: activeConfig.name,
      model: activeConfig.model,
      baseURL: activeConfig.baseURL,
      hasApiKey: Boolean(activeConfig.apiKey),
    });

    return {
      model: activeConfig.model,
      baseURL: activeConfig.baseURL,
      apiKey: activeConfig.apiKey,
      temperature: activeConfig.temperature ?? 0.7,
    };
  } catch (error) {
    logger.error('读取配置文件失败:', error);
    return null;
  }
}

/**
 * 测试非流式输出
 * 
 * @param {string} model - 模型名称
 * @param {string} baseURL - API 端点
 * @param {string} apiKey - API 密钥
 * @param {number} temperature - 温度参数
 */
async function testNonStreamingOutput(
  model: string,
  baseURL: string,
  apiKey: string,
  temperature: number
) {
  console.log('\n=====================================');
  console.log('测试 1: 非流式输出 (streaming: false)');
  console.log('=====================================\n');

  try {
    // 创建非流式 LLM 实例
    const llm = makeChatModel({
      model,
      baseURL,
      apiKey,
      temperature,
      streaming: false,
      timeout: 30000,
    });

    console.log('发送请求...\n');

    // 调用模型
    const response = await llm.invoke([
      new HumanMessage('vite 最新版本是？use exa-code'),
    ]);

    // 打印回复消息
    console.log('【非流式回复】');
    console.log(response.content);
    console.log();

  } catch (error) {
    console.error('非流式输出测试失败:', error);
    throw error;
  }
}

/**
 * 测试流式输出
 * 
 * @param {string} model - 模型名称
 * @param {string} baseURL - API 端点
 * @param {string} apiKey - API 密钥
 * @param {number} temperature - 温度参数
 */
async function testStreamingOutput(
  model: string,
  baseURL: string,
  apiKey: string,
  temperature: number
) {
  console.log('\n=====================================');
  console.log('测试 2: 流式输出 (streaming: true)');
  console.log('=====================================\n');

  try {
    // 创建流式 LLM 实例
    const llm = makeChatModel({
      model,
      baseURL,
      apiKey,
      temperature,
      streaming: true,
      streamUsage: true,
      timeout: 30000,
    });

    console.log('发送请求...\n');
    console.log('【流式回复】');

    // 使用流式调用
    const stream = await llm.stream([
      new HumanMessage('vite 最新版本是？use exa-code'),
    ]);

    // 处理流式响应 - 直接打印每个块
    for await (const chunk of stream) {
      const chunkContent = String(chunk.content || '');
      if (chunkContent) {
        process.stdout.write(chunkContent);
      }
    }

    console.log('\n');

  } catch (error) {
    console.error('流式输出测试失败:', error);
    throw error;
  }
}

/**
 * 测试带 MCP 工具的输出（显示完整交互过程）
 * 
 * @param {string} model - 模型名称
 * @param {string} baseURL - API 端点
 * @param {string} apiKey - API 密钥
 * @param {number} temperature - 温度参数
 * @param {string} mcpConfigPath - MCP 配置文件路径
 */
async function testWithMCPTools(
  model: string,
  baseURL: string,
  apiKey: string,
  temperature: number,
  mcpConfigPath: string
) {
  console.log('\n=====================================');
  console.log('测试 3: 带 MCP 工具的 Agent 交互');
  console.log('=====================================\n');

  let mcpClient = null;

  try {
    // 加载 MCP 工具
    console.log('🔧 加载 MCP 工具...');
    const { tools, client } = await getMCPTools(mcpConfigPath);
    mcpClient = client;
    
    console.log(`✅ 成功加载 ${tools.length} 个 MCP 工具\n`);
    tools.forEach((tool: any) => {
      console.log(`  📦 ${tool.name}`);
      console.log(`     ${tool.description}\n`);
    });

    // 创建带工具的 LLM 实例
    const llm = makeChatModel({
      model,
      baseURL,
      apiKey,
      temperature,
      streaming: true,
      timeout: 60000,
    });

    // 绑定工具
    const llmWithTools = llm.bindTools(tools as any);

    console.log('═══════════════════════════════════════');
    console.log('💬 用户问题: vite 最新版本是？use exa-code');
    console.log('═══════════════════════════════════════\n');

    // Agent 循环：模拟 LLM 和工具的交互过程
    const messages: any[] = [
      new HumanMessage('vite 最新版本是？use exa-code'),
    ];

    let iteration = 0;
    const maxIterations = 5;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n┌─────────────────────────────────────┐`);
      console.log(`│  第 ${iteration} 轮交互`);
      console.log(`└─────────────────────────────────────┘\n`);

      // 调用 LLM
      console.log('🤖 调用 LLM...\n');
      const response = await llmWithTools.invoke(messages);

      // 显示 LLM 的文本回复
      if (response.content) {
        console.log('💭 LLM 回复:');
        console.log(response.content);
        console.log();
      }

      // 检查是否有工具调用
      if (response.tool_calls && response.tool_calls.length > 0) {
        console.log('🔧 LLM 决定调用工具:\n');
        
        // 显示工具调用信息
        response.tool_calls.forEach((toolCall: any, index: number) => {
          console.log(`  [Tool Call ${index + 1}]`);
          console.log(`  📌 工具名称: ${toolCall.name}`);
          console.log(`  📝 调用参数:`, JSON.stringify(toolCall.args, null, 2));
          console.log();
        });

        // 将 LLM 响应添加到消息历史
        messages.push(response);

        // 执行工具并收集结果
        console.log('⚙️  执行工具...\n');
        
        for (const toolCall of response.tool_calls) {
          const tool = tools.find((t: any) => t.name === toolCall.name);
          if (tool) {
            try {
              console.log(`  ▶ 执行: ${toolCall.name}`);
              const toolResult = await (tool as any).invoke(toolCall.args);
              
              console.log(`  ✅ 工具执行成功`);
              console.log(`  📄 结果预览: ${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)}`);
              console.log();

              // 将工具结果添加到消息历史
              messages.push({
                role: 'tool',
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                tool_call_id: toolCall.id,
              });

            } catch (error) {
              console.error(`  ❌ 工具执行失败: ${error}`);
              
              // 即使失败也要添加错误信息到消息历史
              messages.push({
                role: 'tool',
                content: `Error: ${error}`,
                tool_call_id: toolCall.id,
              });
            }
          } else {
            console.log(`  ⚠️  未找到工具: ${toolCall.name}`);
          }
        }

        // 继续下一轮，让 LLM 根据工具结果生成最终回复
        console.log('🔄 继续下一轮，让 LLM 处理工具结果...\n');
        
      } else {
        // 没有工具调用，说明 LLM 已经给出最终答案
        console.log('✅ LLM 已给出最终答案，无需调用工具\n');
        break;
      }
    }

    if (iteration >= maxIterations) {
      console.log('⚠️  达到最大交互轮数限制\n');
    }

    console.log('═══════════════════════════════════════');
    console.log('✨ Agent 交互完成');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ MCP 工具测试失败:', error);
    throw error;
  } finally {
    // 清理 MCP 客户端
    if (mcpClient) {
      await cleanupMCPClient(mcpClient);
    }
  }
}

/**
 * 测试带 MCP 工具的流式打印输出
 * 
 * @param {string} model - 模型名称
 * @param {string} baseURL - API 端点
 * @param {string} apiKey - API 密钥
 * @param {number} temperature - 温度参数
 * @param {string} mcpConfigPath - MCP 配置文件路径
 */
async function testWithMCPToolsStreaming(
  model: string,
  baseURL: string,
  apiKey: string,
  temperature: number,
  mcpConfigPath: string
) {
  console.log('\n=====================================');
  console.log('测试 4: 流式打印 Agent 交互');
  console.log('=====================================\n');

  let mcpClient = null;

  try {
    // 加载 MCP 工具
    console.log('🔧 加载 MCP 工具...');
    const { tools, client } = await getMCPTools(mcpConfigPath);
    mcpClient = client;
    
    console.log(`✅ 成功加载 ${tools.length} 个 MCP 工具\n`);
    tools.forEach((tool: any) => {
      console.log(`  📦 ${tool.name}`);
      console.log(`     ${tool.description}\n`);
    });

    // 创建带工具的 LLM 实例
    const llm = makeChatModel({
      model,
      baseURL,
      apiKey,
      temperature,
      streaming: true, // 开启流式
      timeout: 60000,
    });

    // 绑定工具
    const llmWithTools = llm.bindTools(tools as any, {
        recursionLimit: 300
    });

    console.log('═══════════════════════════════════════');
    console.log('💬 用户问题: vite 最新版本是？use exa-code');
    console.log('═══════════════════════════════════════\n');

    // Agent 循环：模拟 LLM 和工具的交互过程
    const messages: any[] = [
      new HumanMessage('vite 最新版本是？use exa-code'),
    ];

    let iteration = 0;
    const maxIterations = 5;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n┌─────────────────────────────────────┐`);
      console.log(`│  第 ${iteration} 轮交互`);
      console.log(`└─────────────────────────────────────┘\n`);

      console.log('🤖 调用 LLM...\n');

      // 首先用 invoke 检查是否有 tool_calls
      const response = await llmWithTools.invoke(messages);

      // 检查是否有工具调用
      if (response.tool_calls && response.tool_calls.length > 0) {
        // 有工具调用 - 直接显示完整内容（不需要流式）
        if (response.content) {
          console.log('💭 LLM 回复:');
          console.log(response.content);
          console.log();
        }

        console.log('🔧 LLM 决定调用工具:\n');
        
        // 显示工具调用信息
        response.tool_calls.forEach((toolCall: any, index: number) => {
          console.log(`  [Tool Call ${index + 1}]`);
          console.log(`  📌 工具名称: ${toolCall.name}`);
          console.log(`  📝 调用参数:`, JSON.stringify(toolCall.args, null, 2));
          console.log();
        });

        // 将 LLM 响应添加到消息历史
        messages.push(response);

        // 执行工具并收集结果
        console.log('⚙️  执行工具...\n');
        
        for (const toolCall of response.tool_calls) {
          const tool = tools.find((t: any) => t.name === toolCall.name);
          if (tool) {
            try {
              console.log(`  ▶ 执行: ${toolCall.name}`);
              const toolResult = await (tool as any).invoke(toolCall.args);
              
              console.log(`  ✅ 工具执行成功`);
              console.log(`  📄 结果预览: ${typeof toolResult === 'string' ? toolResult.substring(0, 200) + '...' : JSON.stringify(toolResult).substring(0, 200) + '...'}`);
              console.log();

              // 将工具结果添加到消息历史
              messages.push({
                role: 'tool',
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                tool_call_id: toolCall.id,
              });

            } catch (error) {
              console.error(`  ❌ 工具执行失败: ${error}`);
              
              messages.push({
                role: 'tool',
                content: `Error: ${error}`,
                tool_call_id: toolCall.id,
              });
            }
          } else {
            console.log(`  ⚠️  未找到工具: ${toolCall.name}`);
          }
        }

        // 继续下一轮
        console.log('🔄 继续下一轮，让 LLM 处理工具结果...\n');
        
      } else {
        // 没有工具调用 - 这是最终答案，使用流式打印
        console.log('✨ LLM 最终答案（流式打印）:\n');
        
        // 使用 stream() 进行流式打印
        const stream = await llmWithTools.stream(messages);
        
        for await (const chunk of stream) {
          const content = String(chunk.content || '');
          if (content) {
            process.stdout.write(content);
          }
        }
        
        console.log('\n');
        console.log('\n✅ LLM 已给出最终答案\n');
        break;
      }
    }

    if (iteration >= maxIterations) {
      console.log('⚠️  达到最大交互轮数限制\n');
    }

    console.log('═══════════════════════════════════════');
    console.log('✨ Agent 交互完成');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ 流式打印测试失败:', error);
    throw error;
  } finally {
    // 清理 MCP 客户端
    if (mcpClient) {
      await cleanupMCPClient(mcpClient);
    }
  }
}

/**
 * 测试完全流式的 Agent 交互（方案 2：全流式）
 * 
 * @param {string} model - 模型名称
 * @param {string} baseURL - API 端点
 * @param {string} apiKey - API 密钥
 * @param {number} temperature - 温度参数
 * @param {string} mcpConfigPath - MCP 配置文件路径
 */
async function testFullyStreamingAgent(
  model: string,
  baseURL: string,
  apiKey: string,
  temperature: number,
  mcpConfigPath: string
) {
  console.log('\n=====================================');
  console.log('测试 5: 完全流式 Agent 交互');
  console.log('=====================================\n');

  let mcpClient = null;

  try {
    // 加载 MCP 工具
    console.log('🔧 加载 MCP 工具...');
    const { tools, client } = await getMCPTools(mcpConfigPath);
    mcpClient = client;
    
    console.log(`✅ 成功加载 ${tools.length} 个 MCP 工具\n`);
    tools.forEach((tool: any) => {
      console.log(`  📦 ${tool.name}`);
      console.log(`     ${tool.description}\n`);
    });

    // 创建带工具的 LLM 实例
    const llm = makeChatModel({
      model,
      baseURL,
      apiKey,
      temperature,
      streaming: true, // 全程流式
      timeout: 60000,
    });

    // 绑定工具
    const llmWithTools = llm.bindTools(tools as any, {
        recursionLimit: 300
    });

    console.log('═══════════════════════════════════════');
    console.log('💬 用户问题: vite 最新版本是？use exa-code');
    console.log('═══════════════════════════════════════\n');

    // Agent 循环：完全流式交互
    const messages: any[] = [
      new HumanMessage('vite 最新版本是？use exa-code'),
    ];

    let iteration = 0;
    const maxIterations = 5;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n┌─────────────────────────────────────┐`);
      console.log(`│  第 ${iteration} 轮交互`);
      console.log(`└─────────────────────────────────────┘\n`);

      console.log('🤖 调用 LLM（流式输出）...\n');

      // 使用 stream() 进行流式调用
      const stream = await llmWithTools.stream(messages);

      let fullContent = '';
      let collectedToolCalls: any[] = [];
      let fullResponse: any = null;
      let hasContent = false;

      // 流式处理每个 chunk
      let chunkCount = 0;
      for await (const chunk of stream) {
        chunkCount++;
        const content = String(chunk.content || '');
        
        // 如果有内容，第一次打印标题
        if (content && !hasContent) {
          console.log('💭 LLM 思考:');
          hasContent = true;
        }
        
        // 实时打印内容
        if (content) {
          process.stdout.write(content);
          fullContent += content;
        }
        
        // 收集 tool_calls（如果存在且不为空）
        if ((chunk as any).tool_calls && (chunk as any).tool_calls.length > 0) {
          // 合并新的 tool_calls
          for (const toolCall of (chunk as any).tool_calls) {
            // 避免重复（根据 id 去重）
            if (!collectedToolCalls.find(tc => tc.id === toolCall.id)) {
              collectedToolCalls.push(toolCall);
            }
          }
        }
        
        // 保存完整响应
        fullResponse = chunk;
      }
      

      // 如果有内容输出，换行
      if (hasContent) {
        console.log('\n');
      }

      // 检查是否收集到工具调用
      if (collectedToolCalls.length > 0) {
        console.log('🔧 LLM 决定调用工具:\n');
        
        // 显示工具调用信息
        collectedToolCalls.forEach((toolCall: any, index: number) => {
          console.log(`  [Tool Call ${index + 1}]`);
          console.log(`  📌 工具名称: ${toolCall.name}`);
          console.log(`  📝 调用参数:`, JSON.stringify(toolCall.args, null, 2));
          console.log();
        });

        // 构建完整响应并添加到消息历史（使用 AIMessage）
        const responseWithToolCalls = new AIMessage({
          content: fullContent,
          tool_calls: collectedToolCalls,
        });
        messages.push(responseWithToolCalls);

        // 执行工具并收集结果
        console.log('⚙️  执行工具...\n');
        
        for (const toolCall of collectedToolCalls) {
          const tool = tools.find((t: any) => t.name === toolCall.name);
          if (tool) {
            try {
              console.log(`  ▶ 执行: ${toolCall.name}`);
              const startTime = Date.now();
              const toolResult = await (tool as any).invoke(toolCall.args);
              const duration = Date.now() - startTime;
              
              console.log(`  ✅ 工具执行成功 (耗时: ${duration}ms)`);
              console.log(`  📄 结果预览: ${typeof toolResult === 'string' ? toolResult.substring(0, 200) + '...' : JSON.stringify(toolResult).substring(0, 200) + '...'}`);
              console.log();

              // 将工具结果添加到消息历史
              messages.push({
                role: 'tool',
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                tool_call_id: toolCall.id,
              });

            } catch (error) {
              console.error(`  ❌ 工具执行失败: ${error}`);
              
              messages.push({
                role: 'tool',
                content: `Error: ${error}`,
                tool_call_id: toolCall.id,
              });
            }
          } else {
            console.log(`  ⚠️  未找到工具: ${toolCall.name}`);
          }
        }

        // 继续下一轮
        console.log('🔄 继续下一轮，让 LLM 处理工具结果...\n');
        
      } else {
        // 没有工具调用 - 这是最终答案
        console.log('✅ LLM 已给出最终答案（已流式显示）\n');
        break;
      }
    }

    if (iteration >= maxIterations) {
      console.log('⚠️  达到最大交互轮数限制\n');
    }

    console.log('═══════════════════════════════════════');
    console.log('✨ Agent 交互完成');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ 完全流式测试失败:', error);
    throw error;
  } finally {
    // 清理 MCP 客户端
    if (mcpClient) {
      await cleanupMCPClient(mcpClient);
    }
  }
}

/**
 * 测试使用 AgentExecutor 的流式输出（官方方案）
 * 
 * @param {string} model - 模型名称
 * @param {string} baseURL - API 端点
 * @param {string} apiKey - API 密钥
 * @param {number} temperature - 温度参数
 * @param {string} mcpConfigPath - MCP 配置文件路径
 */
async function testWithAgentExecutor(
  model: string,
  baseURL: string,
  apiKey: string,
  temperature: number,
  mcpConfigPath: string
) {
  console.log('\n=====================================');
  console.log('测试 6: AgentExecutor 流式输出（官方方案）');
  console.log('=====================================\n');

  let mcpClient = null;

  try {
    // 加载 MCP 工具
    console.log('🔧 加载 MCP 工具...');
    const { tools, client } = await getMCPTools(mcpConfigPath);
    mcpClient = client;
    
    console.log(`✅ 成功加载 ${tools.length} 个 MCP 工具\n`);

    // 创建 LLM 实例
    const llm = makeChatModel({
      model,
      baseURL,
      apiKey,
      temperature,
      streaming: true,
      timeout: 60000,
    });

    // 创建 prompt 模板
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", "你是一个有用的助手。使用提供的工具来回答用户的问题。"],
      ["placeholder", "{chat_history}"],
      ["human", "{input}"],
      ["placeholder", "{agent_scratchpad}"],
    ]);

    // 创建 Agent
    const agent = await createToolCallingAgent({
      llm,
      tools: tools as any,
      prompt,
    });

    // 创建 AgentExecutor
    const agentExecutor = new AgentExecutor({
      agent,
      tools: tools as any,
      verbose: false, // 关闭默认日志
    });

    console.log('═══════════════════════════════════════');
    console.log('💬 用户问题: vite 最新版本是？use exa-code');
    console.log('═══════════════════════════════════════\n');

    // 使用流式调用
    const stream = await agentExecutor.stream({
      input: "vite 最新版本是？use exa-code",
    });

    for await (const chunk of stream) {
      // AgentExecutor.stream() 返回两种 chunk：
      // 1. { intermediateSteps: [...] } - 工具调用和结果
      // 2. { output: "..." } - 最终答案
      
      if (chunk.intermediateSteps) {
        // 处理工具调用和执行结果
        console.log('\n🔧 工具调用和执行:\n');
        
        for (const step of chunk.intermediateSteps) {
          console.log(`  📌 调用工具: ${step.action.tool}`);
          console.log(`  📝 参数:`, JSON.stringify(step.action.toolInput, null, 2));
          
          // 显示工具执行结果预览
          const preview = typeof step.observation === 'string' 
            ? step.observation.substring(0, 200) + '...'
            : JSON.stringify(step.observation).substring(0, 200) + '...';
          console.log(`  ✅ 执行成功`);
          console.log(`  📄 结果预览: ${preview}`);
          console.log();
        }
      }
      
      if (chunk.output) {
        // 最终输出
        console.log('✨ Agent 最终回答:\n');
        console.log(chunk.output);
        console.log();
      }
    }

    console.log('═══════════════════════════════════════');
    console.log('✨ AgentExecutor 完成');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ AgentExecutor 测试失败:', error);
    throw error;
  } finally {
    if (mcpClient) {
      await cleanupMCPClient(mcpClient);
    }
  }
}

/**
 * 测试精细分类 + 优化流式体验（推荐用于 UI）
 * 
 * @param {string} model - 模型名称
 * @param {string} baseURL - API 端点
 * @param {string} apiKey - API 密钥
 * @param {number} temperature - 温度参数
 * @param {string} mcpConfigPath - MCP 配置文件路径
 */
async function testCategorizedStreamingAgent(
  model: string,
  baseURL: string,
  apiKey: string,
  temperature: number,
  mcpConfigPath: string
) {
  console.log('\n=====================================');
  console.log('测试 7: 精细分类 + 优化流式（推荐）');
  console.log('=====================================\n');

  let mcpClient = null;

  try {
    // 加载 MCP 工具
    console.log('🔧 加载 MCP 工具...');
    const { tools, client } = await getMCPTools(mcpConfigPath);
    mcpClient = client;
    
    console.log(`✅ 成功加载 ${tools.length} 个 MCP 工具\n`);

    // 创建 LLM 实例
    const llm = makeChatModel({
      model,
      baseURL,
      apiKey,
      temperature,
      streaming: true,
      timeout: 60000,
    });

    // 创建 prompt 模板
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", "你是一个有用的助手。使用提供的工具来回答用户的问题。"],
      ["placeholder", "{chat_history}"],
      ["human", "{input}"],
      ["placeholder", "{agent_scratchpad}"],
    ]);

    // 创建 Agent
    const agent = await createToolCallingAgent({
      llm,
      tools: tools as any,
      prompt,
    });

    // 创建 AgentExecutor（启用中间步骤返回）
    const agentExecutor = new AgentExecutor({
      agent,
      tools: tools as any,
      verbose: false,
      returnIntermediateSteps: true, // 关键：返回所有中间步骤
    });

    console.log('═══════════════════════════════════════');
    console.log('💬 用户问题: vite 最新版本是？use exa-code');
    console.log('═══════════════════════════════════════\n');

    // ========================================
    // 策略：先执行完整流程，再分阶段展示
    // ========================================
    const result = await agentExecutor.invoke({
      input: "vite 最新版本是？use exa-code",
    });

    // ========================================
    // 第一阶段：展示工具调用和执行过程
    // ========================================
    if (result.intermediateSteps && result.intermediateSteps.length > 0) {
      console.log('📋 Agent 执行流程:\n');
      
      for (let i = 0; i < result.intermediateSteps.length; i++) {
        const step = result.intermediateSteps[i];
        
        console.log(`\n┌─ 第 ${i + 1} 轮交互 ─────────────────────┐\n`);
        
        // 1️⃣ 工具调用指令（LLM 的决策）
        console.log('🤖 LLM 决定:');
        console.log(`   📌 调用工具: ${step.action.tool}`);
        console.log(`   📝 调用参数:`, JSON.stringify(step.action.toolInput, null, 2));
        
        // 如果有思考过程，显示
        if (step.action.log) {
          const lines = step.action.log.split('\n');
          const thinking = lines.find(line => 
            !line.startsWith('Invoking') && line.trim().length > 0
          );
          if (thinking) {
            console.log(`   💭 思考: ${thinking.trim()}`);
          }
        }
        console.log();
        
        // 2️⃣ 工具执行结果（Agent 的执行）
        console.log('⚙️  执行结果:');
        const preview = typeof step.observation === 'string' 
          ? step.observation.substring(0, 200)
          : JSON.stringify(step.observation).substring(0, 200);
        
        console.log(`   ✅ 执行成功`);
        console.log(`   📄 结果预览:`);
        console.log(`      ${preview}...`);
        console.log();
        
        console.log(`└─────────────────────────────────────┘`);
      }
    }

    // ========================================
    // 第二阶段：流式展示最终答案
    // ========================================
    console.log('\n💡 LLM 最终回答（流式输出）:\n');
    console.log('┌─ 答案 ─────────────────────────────┐\n');
    
    // 重建消息历史，用于流式输出最终答案
    const messages = [
      new HumanMessage("vite 最新版本是？use exa-code"),
    ];
    
    // 添加所有中间步骤到消息历史
    for (const step of result.intermediateSteps) {
      // 添加 AI 的工具调用
      messages.push(new AIMessage({
        content: "",
        tool_calls: [{
          name: step.action.tool,
          args: step.action.toolInput,
          id: step.action.toolCallId,
          type: 'tool_call',
        }],
      }));
      
      // 添加工具执行结果
      messages.push({
        role: 'tool',
        content: typeof step.observation === 'string' 
          ? step.observation 
          : JSON.stringify(step.observation),
        tool_call_id: step.action.toolCallId,
      } as any);
    }
    
    // 流式输出最终答案
    const finalStream = await llm.stream(messages);
    for await (const chunk of finalStream) {
      const content = String(chunk.content || '');
      if (content) {
        process.stdout.write(content);
      }
    }
    
    console.log('\n\n└─────────────────────────────────────┘\n');

    console.log('═══════════════════════════════════════');
    console.log('✨ 完成');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ 测试失败:', error);
    throw error;
  } finally {
    if (mcpClient) {
      await cleanupMCPClient(mcpClient);
    }
  }
}

/**
 * 主测试函数
 */
async function main() {
  console.log('===========================================');
  console.log('GLM 提供商 + MCP 工具测试脚本');
  console.log('===========================================\n');

  // 配置文件路径
  const settingsPath = '/Users/fj/Library/Application Support/mindforge-agent/settings.json';
  const mcpConfigPath = '/Users/fj/Library/Application Support/mindforge-agent/mcp.json';
  
  console.log('GLM 配置路径:', settingsPath);
  console.log('MCP 配置路径:', mcpConfigPath);

  // 读取配置
  const config = readGLMConfig(settingsPath);
  if (!config) {
    console.error('❌ 无法加载 GLM 配置，测试终止');
    process.exit(1);
  }

  console.log('✅ GLM 配置加载成功\n');

  try {
    // 测试非流式输出
    // await testNonStreamingOutput(
    //   config.model,
    //   config.baseURL,
    //   config.apiKey,
    //   config.temperature ?? 0.7
    // );

    // 等待一小段时间
    // await new Promise((resolve) => setTimeout(resolve, 1000));

    // 测试流式输出
    // await testStreamingOutput(
    //   config.model,
    //   config.baseURL,
    //   config.apiKey,
    //   config.temperature ?? 0.7
    // );

    // 等待一小段时间
    // await new Promise((resolve) => setTimeout(resolve, 1000));

    // 测试带 MCP 工具的输出
    // await testWithMCPTools(
    //   config.model,
    //   config.baseURL,
    //   config.apiKey,
    //   config.temperature ?? 0.7,
    //   mcpConfigPath
    // );

    // 等待一小段时间
    // await new Promise((resolve) => setTimeout(resolve, 1000));

    // 测试带 MCP 工具的流式打印输出
    // await testWithMCPToolsStreaming(
    //   config.model,
    //   config.baseURL,
    //   config.apiKey,
    //   config.temperature ?? 0,
    //   mcpConfigPath
    // );

    // // 等待一小段时间
    // await new Promise((resolve) => setTimeout(resolve, 1000));

    // 测试完全流式 Agent 交互（方案 2）
    // await testFullyStreamingAgent(
    //   config.model,
    //   config.baseURL,
    //   config.apiKey,
    //   config.temperature ?? 0,
    //   mcpConfigPath
    // );

    // // 等待一小段时间
    // await new Promise((resolve) => setTimeout(resolve, 1000));

    // 测试 AgentExecutor（官方方案）
    await testWithAgentExecutor(
      config.model,
      config.baseURL,
      config.apiKey,
      config.temperature ?? 0,
      mcpConfigPath
    );

    // 等待一小段时间
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 测试精细分类 + 优化流式（推荐用于 UI）
    await testCategorizedStreamingAgent(
      config.model,
      config.baseURL,
      config.apiKey,
      config.temperature ?? 0,
      mcpConfigPath
    );

    console.log('\n✅ 所有测试完成！');

  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
main().catch((error) => {
  console.error('测试脚本执行失败:', error);
  process.exit(1);
});

