// agent/services/metadata.ts
/**
 * 文档说明：RAG 元数据富化模块（最小可行）。
 * - 目标：在不引入额外依赖的前提下，从文件路径/Frontmatter/正文启发式提取业务元数据，
 *   并写回到 LangChain Document.metadata，供检索阶段做 where/filter 过滤。
 * - 字段：module | lang | version | updatedAt | tags
 * - 约束：尽量使用规则与正则推断；若无法判断，不写或留空，避免错误标注。
 */

import { Document } from '@langchain/core/documents'
import * as path from 'node:path'

/** 支持的语言标签 */
export type MetaLang = 'zh' | 'en'

export interface EnrichHint {
  /** 可选模块名提示（如按集合/目录推断） */
  moduleHint?: string
}

/**
 * 尝试从 Markdown 文本的 Frontmatter 提取键值对（只支持简单 key: value 格式）。
 * - 仅解析文首以三短横线包裹的区域：`---\nkey: value\n...\n---`。
 * - 为避免引入外部 YAML 依赖，不支持复杂嵌套，仅支持扁平键值。
 */
function tryParseFrontmatter(text: string): Record<string, unknown> {
  const fm: Record<string, unknown> = {}
  if (!text) return fm
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) return fm
  const body = m[1]
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const raw = line.slice(idx + 1).trim()
    if (!key) continue
    // 处理简单的字符串/数组（逗号分隔）
    if (raw.includes(',') && !raw.includes(':')) {
      fm[key] = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    } else if (/^(true|false)$/i.test(raw)) {
      fm[key] = /^true$/i.test(raw)
    } else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const d = new Date(raw)
      if (!Number.isNaN(d.getTime())) fm[key] = d.toISOString()
    } else {
      fm[key] = raw
    }
  }
  return fm
}

/** 估算中文占比，粗略检测语言 */
function detectLang(text: string): MetaLang {
  if (!text) return 'en'
  const sample = text.slice(0, 2000)
  const zhMatches = sample.match(/[\u4e00-\u9fa5]/g)
  const zhCount = zhMatches ? zhMatches.length : 0
  const ratio = zhCount / Math.max(1, sample.length)
  return ratio >= 0.05 ? 'zh' : 'en'
}

/** 从路径与扩展名推断语言与模块 */
function inferFromPath(filePath: string): { lang?: MetaLang; module?: string; version?: string; tags?: string[] } {
  const res: { lang?: MetaLang; module?: string; version?: string; tags?: string[] } = {}
  const p = (filePath || '').replaceAll('\\', '/').toLowerCase()
  if (p.endsWith('.zh.md') || p.endsWith('.zh.txt')) res.lang = 'zh'
  if (p.endsWith('.en.md') || p.endsWith('.en.txt')) res.lang = 'en'
  // module：优先 docs/<module>/ 或任意一级目录名作为猜测
  const m1 = p.match(/(?:^|\/)docs\/([a-z0-9_-]+)/)
  const m2 = p.match(/\/(?:src|guide|manual|spec|design)\/([a-z0-9_-]+)/)
  const m3 = p.match(/\/(?:[a-z0-9_-]+)\//)
  res.module = (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[0].slice(1, -1)) || undefined
  // version：路径上的 vX.Y(.Z)
  const v = p.match(/\bv(\d+\.\d+(?:\.\d+)?)/)
  if (v && v[1]) res.version = v[1]
  // tags：根据常见路径片段
  const tagMatches = p.match(/\b(guide|api|design|spec|rfc|howto|faq)\b/g)
  if (tagMatches) res.tags = Array.from(new Set(tagMatches))
  return res
}

/** 从正文检出版本与日期 */
function inferFromText(text: string): { version?: string; updatedAt?: string } {
  const out: { version?: string; updatedAt?: string } = {}
  if (!text) return out
  const v = text.match(/\bv(?:\d+\.\d+(?:\.\d+)?)\b/i)
  if (v) out.version = v[0].replace(/^v/i, '')
  const d = text.match(/(20\d{2}-\d{2}-\d{2})/)
  if (d) {
    const dt = new Date(d[1])
    if (!Number.isNaN(dt.getTime())) out.updatedAt = dt.toISOString()
  }
  return out
}

/**
 * 为一组文档就地富化元数据。
 *
 * @param docs LangChain Document 数组
 * @param hint 可选提示（如 moduleHint）
 * @returns 富化后的 Document 数组（同一引用，保持可链式传递）
 */
export function enrichDocuments(docs: Document[], hint?: EnrichHint): Document[] {
  if (!Array.isArray(docs) || docs.length === 0) return docs
  for (const d of docs) {
    const meta = (d.metadata ?? {}) as Record<string, unknown>
    const source = String(meta.source || meta.originalFile || '')
    const text = String(d.pageContent || '')

    const fm = tryParseFrontmatter(text)
    const fromPath = inferFromPath(source)
    const fromText = inferFromText(text)

    // 合并优先级：Frontmatter > hint > path > text > 现有
    const lang: MetaLang | undefined = (fm.lang as MetaLang) || (hint?.moduleHint as any) || fromPath.lang || detectLang(text)
    const moduleName: string | undefined = (fm.module as string) || hint?.moduleHint || fromPath.module
    const version: string | undefined = (fm.version as string) || fromPath.version || fromText.version
    const updatedAt: string | undefined = (fm.updatedAt as string) || (meta.updatedAt as string) || fromText.updatedAt
    const tags: string[] | undefined = Array.isArray(fm.tags)
      ? (fm.tags as string[])
      : (fromPath.tags as string[] | undefined)

    // 回写
    if (moduleName) meta.module = moduleName
    if (lang) meta.lang = lang
    if (version) meta.version = version
    if (updatedAt) meta.updatedAt = updatedAt
    if (tags && tags.length) meta.tags = tags

    d.metadata = meta
  }
  return docs
}

export default enrichDocuments

