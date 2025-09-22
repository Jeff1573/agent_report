// src/services/chat.ts
import { BaseMessageLike } from "@langchain/core/messages";
import { makeChatModel } from "../llm/factory.js";

/** 非流式一次性调用（最稳的冒烟路径） */
export async function askOnce(input: string) {
  const llm = makeChatModel();
  const res = await llm.invoke([{ role: "user", content: input }]);
  return res; // 返回 AIMessage，含 content/usage_metadata/response_metadata 等
}

/** 多消息调用（保留对话历史） */
export async function askWithHistory(messages: BaseMessageLike[]) {
  const llm = makeChatModel();
  return llm.invoke(messages);
}

/** 流式调用（token 级流式由提供商支持情况决定） */
export async function* askStream(messages: BaseMessageLike[]) {
  const llm = makeChatModel();
  // 所有 Runnable 都有 stream/streamEvents；token 级流式取决于集成是否实现
  // 这里用最通用的 stream：若提供商不支持逐 token，也能得到完整块（官方说明）
  const it = await llm.stream(messages);
  for await (const chunk of it) {
    // chunk 通常是 AIMessageChunk，拿到增量文本
    yield chunk?.content?.toString?.() ?? "";
  }
}
