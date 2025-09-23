// agent/examples/kb-retriever-demo.ts
/**
 * 文档说明（最小演示，参照 rag-demo 成功路径）：
 * - 直接用 createReactAgent + 手工定义的 tool（基于 retriever.invoke），不经 runtime 封装，确保事件输出完整。
 * - 运行：`npm run demo:kb -w agent -- "你的问题"`
 * - 环境：
 *   - 对话模型：OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL（三者按需，兼容网关）
 *   - 向量模型：GOOGLE_API_KEY（Gemini embeddings），默认 model=text-embedding-004
 */
import '../config/env.js'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { makeChatModel } from '../llm/factory.js'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { tool } from '@langchain/core/tools'
import { observeEvents } from '../stream/observer.js'

/** 将命令行参数拼接为单个查询字符串 */
function getCliInput(): string {
  const args = process.argv.slice(2)
  return args.join(' ').trim()
}

/**
 * 组装并运行一次带“内部检索”工具的代理交互。
 */
async function main() {
  const question = getCliInput() || '请检索内部知识库：什么是 RAG？'

  // 1) 构建 embeddings 与最小向量库（Gemini 文本向量）
  const embedModel = process.env.KB_EMBED_MODEL || 'text-embedding-004'
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    model: embedModel
  })
  const texts = [
    'RAG（Retrieval-Augmented Generation，检索增强生成）是一种结合向量检索与生成式模型的技术范式，用于将外部知识注入到模型回答中。',
    'MMR（Maximal Marginal Relevance）是一种在召回阶段平衡相关性与多样性的重排序策略。'
  ]
  const metas = [{ source: 'kb:intro#rag' }, { source: 'kb:intro#mmr' }]
  const store = await MemoryVectorStore.fromTexts(texts, metas, embeddings)
  const retriever = store.asRetriever({ k: 4 })

  // 2) 用 @langchain/core/tools 定义检索工具（函数式），与 rag-demo 一致
  const kbSearch = tool(
    async ({ query }: { query: string }) => {
      const hits = await retriever.invoke(query)
      // 返回简要文本；如果需要原始文档结构，可直接 return hits
      return hits.map((d: any, i: number) => `#${i + 1}: ${d.pageContent}`).join('\n')
    },
    {
      name: 'kb_search',
      description: '检索内部知识库（向量召回）。当问题涉及公司/项目/私有文档信息时优先使用。',
      schema: z.object({ query: z.string() })
    }
  )

  // 3) 组装 ReAct Agent（v2），直接用 createReactAgent，避免额外封装影响事件
  const llm = makeChatModel({
    streaming: false, // ⭐ 重要：不要逐 token 流；函数调用一次性返回，最稳
    streamUsage: false
  })
  const agent = createReactAgent({
    llm: llm as any,
    tools: [kbSearch] as any,
    messageModifier: '你是检索增强助手。必要时调用内部检索工具回答问题。',
    version: 'v2'
  })

  const inputs = { messages: [{ role: 'user', content: question }] }
  const events = observeEvents(agent as any, inputs, {
    configurable: { thread_id: 'kb-demo-thread' }
  })
  for await (const ev of events) {
    logger.info(`ev: `, ev)
    switch (ev.type) {
      case 'tool-call':
        logger.info('[tool-call]', ev.name, ev.args)
        break
      case 'tool-result':
        // 仅打印结果条数与来源，避免长文直出
        try {
          const arr = Array.isArray(ev.output) ? ev.output : []
          const brief = arr.map((d: any) => d?.metadata?.source).filter(Boolean)
          logger.info(`[tool-result] ${ev.name} -> ${arr.length} 条`, brief)
        } catch {
          logger.info('[tool-result]', ev.name)
        }
        break
      case 'assistant-message':
        logger.info('\n[assistant]\n' + ev.content + '\n')
        break
      default:
        break
    }
  }
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
