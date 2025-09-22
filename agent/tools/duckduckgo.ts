// agent/tools/duckduckgo.ts
/**
 * 文档说明：DuckDuckGoSearch 工具封装
 * - 基于 LangChain JS 社区包：`@langchain/community/tools/duckduckgo_search`
 * - 官方 API 参考：v0.3 docs => DuckDuckGoSearch 类，支持 `new DuckDuckGoSearch({ maxResults })`
 *   链接（API 文档）：https://v03.api.js.langchain.com/classes/_langchain_community.tools_duckduckgo_search
 * - 本模块导出一个工厂函数 `makeDuckDuckGoSearch` 以便在不同场景自定义实例参数；
 *   同时导出一个默认实例 `duckDuckGoTool`，在工具列表中优先放到第一位。
 */
import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";

export type DuckDuckOptions = Partial<{
  /**
   * 结果条数上限（官方示例：{ maxResults: 1 }）。
   * 注意：搜索引擎返回结构可能包含 title/link/snippet 等字段；模型将基于文本进行推理。
   */
  maxResults: number;
}>;

/**
 * 创建 DuckDuckGoSearch 工具实例。
 * @param options 可选配置（目前仅透传 `maxResults`）。
 */
export function makeDuckDuckGoSearch(options: DuckDuckOptions = {}) {
  // 仅使用官方文档明确的构造参数，避免猜测更多字段
  const tool = new DuckDuckGoSearch({
    maxResults: options.maxResults ?? 5,
  });
  return tool;
}

/** 默认工具实例：将优先放置到 tools 数组第一位 */
export const duckDuckGoTool = makeDuckDuckGoSearch();

