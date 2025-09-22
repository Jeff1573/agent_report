// agent/tools/tavily.ts
/**
 * 文档说明：TavilySearch 工具封装（首选，避免 DuckDuckGo 速率限制）
 * - 官方建议：使用 `@langchain/tavily` 包中的 `TavilySearch`（社区包的 TavilySearchResults 已弃用）。
 *   证据：v0.3 API 参考标注 Deprecated，推荐 `@langchain/tavily` → TavilySearch。
 *   链接：https://v03.api.js.langchain.com/classes/_langchain_community.tools_tavily_search
 * - 运行前需设置环境变量：`TAVILY_API_KEY`。
 * - 本模块导出默认实例 `tavilyTool` 与工厂 `makeTavily()`。
 */
import '../config/env.js';
import { TavilySearch } from '@langchain/tavily';

export type TavilyOptions = Record<string, never>; // 暂无公开稳定的额外构造参数，避免猜测 API

/** 创建 TavilySearch 实例（读取 process.env.TAVILY_API_KEY） */
export function makeTavily(_: TavilyOptions = {}) {
  // 按官方实现，构造时读取 TAVILY_API_KEY；无 Key 会抛错（提前在 .env 配置）
  return new TavilySearch();
}

/** 默认实例：优先放入 tools 列表 */
export const tavilyTool = makeTavily();

