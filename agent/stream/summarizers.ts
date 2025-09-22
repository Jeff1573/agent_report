// agent/stream/summarizers.ts
/**
 * 文档说明：交互片段概括器集合。
 * - 默认提供 BasicSummarizer（纯规则、零依赖）。
 * - 预留 LlmSummarizer 接口实现位置（后续如需引入 LLM 概括）。
 */
import type { Summarizer, InteractionSegment } from './types.js';

/**
 * 截断字符串到指定长度，保留省略号。
 */
function truncate(text: string, max = 160): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * 基础规则概括器：
 * - 汇总工具调用次数与名称集合
 * - 抽取助手文本前若干字符作为摘要
 * - 输出：一行可读描述
 */
export class BasicSummarizer implements Summarizer {
  summarize(segment: InteractionSegment): string {
    const tools = segment.toolCalls.map((t) => t.name).filter(Boolean);
    const uniqueTools = Array.from(new Set(tools));
    const toolPart = uniqueTools.length > 0
      ? `调用工具(${uniqueTools.length}): ${uniqueTools.join(', ')}`
      : '未调用工具';

    const answer = (segment.assistantText ?? '').trim();
    const answerPart = answer ? `助手输出：${truncate(answer, 180)}` : '助手输出为空';

    const tookMs = segment.endedAt && segment.startedAt
      ? `，耗时 ${Math.max(0, segment.endedAt - segment.startedAt)}ms`
      : '';

    return `${toolPart}；${answerPart}${tookMs}`;
  }
}

export const defaultSummarizer = new BasicSummarizer();

