// 文件：rag-agent-streamEvents.ts
import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { tool } from "@langchain/core/tools";

// 简易 logger
const log = (...args: any[]) => console.log(new Date().toISOString(), "[INFO]", ...args);

log(process.env.OPENAI_MODEL, "RAG Agent Demo");
log("使用的 OpenAI Base URL:", process.env.OPENAI_BASE_URL);
log("使用的 Google API Key:", process.env.GOOGLE_API_KEY ? "✔️ 已设置" : "❌ 未设置");

// 主函数
async function main() {
  // 1) 连接 OpenAI 兼容 LLM —— 关键：关闭模型级 streaming（避免不完整的“流式函数调用”片段）
  const baseLLM = new ChatOpenAI({
    model: process.env.OPENAI_MODEL || "your-custom-model",
    temperature: 0,
    streaming: false,     // ⭐ 重要：不要逐 token 流；函数调用一次性返回，最稳
    streamUsage: false,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      defaultHeaders: process.env.OPENAI_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
        : {}, // 如果你走自定义头，在这里替换 defaultHeaders
    },
  });

  // 2) 准备一个最小向量库（用 Gemini 向量模型）
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY!,
    model: "text-embedding-004",
  });

  const docs = [
    new Document({ pageContent: "东京是日本的首都，以寿司、金枪鱼拍卖和筑地市场闻名。" }),
    new Document({ pageContent: "大阪以章鱼烧、串炸和道顿堀夜生活出名。" }),
    new Document({ pageContent: "札幌位于北海道，以雪祭和味噌拉面著称。" }),
  ];
  const store = await MemoryVectorStore.fromDocuments(docs, embeddings);
  const retriever = store.asRetriever();

  // 3) 把 retriever 包成 Tool —— 注意 tool(fn, { name, description, schema }) 的双参写法
  const searchInternal = tool(
    async ({ query }: { query: string }) => {
      const hits = await retriever.invoke(query);
      return hits.map((d, i) => `#${i + 1}: ${d.pageContent}`).join("\n"); // 工具需返回 string
    },
    {
      name: "search_internal_knowledge",
      description: "在内部知识库做语义检索，输入中文查询，返回最相关片段。",
      schema: z.object({ query: z.string().min(1) }),
    }
  );

  // 4) 强制至少使用一个工具，避免模型“凭记忆直接回答”
  const llm = baseLLM.bindTools([searchInternal], { tool_choice: "any" });

  // 5) 组装 LangGraph 预构建 ReAct agent
  const agent = createReactAgent({
    llm,
    tools: [searchInternal],
    messageModifier: "你是检索增强助手。必要时调用内部检索工具回答问题。",
  });

  // 6) 事件流（v2）：可观察工具开始/结束与模型事件（即使关闭了逐 token，工具依然会触发）
  const input = {
    messages: [
      {
        role: "user",
        content:
          "和东京相关的本地美食有哪些？请从内部知识中检索并给出要点列表。",
      },
    ],
  };

  const stream = await agent.streamEvents(input, {
    version: "v2",
    includeTypes: ["tool", "chat_model", "chain"], // 调试期可去掉以拿全量
  });

  for await (const ev of stream) {
    const kind = ev.event;       // 事件名
    const name = ev.name;        // 触发该事件的 runnable 名称
    const data: any = ev.data;   // 事件负载

    if (kind === "on_tool_start") {
      log("🔧 TOOL START:", name, "\n   input:", data?.input);
    }
    if (kind === "on_tool_end") {
      const outPreview =
        typeof data?.output === "string"
          ? data.output.slice(0, 200)
          : JSON.stringify(data?.output)?.slice(0, 200);
      log("🔧 TOOL END:", name, "\n   output:", outPreview);
    }
    if (kind === "on_chat_model_start") {
      log("🧠 LLM START");
    }
    if (kind === "on_chat_model_end") {
      // 非流式下，这里通常直接拿到最终 AIMessage（可能含 tool_calls）
      log("🧠 LLM END");
    }
    if (kind === "on_chain_end" && name?.includes("create_react_agent")) {
      log("✅ Agent done.");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
