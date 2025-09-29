/**
 * 集中管理入库与检索共用的 metadata 字段定义。
 */

export const METADATA_KEYS = {
  filePath: 'filePath',
  symbolName: 'symbolName',
  symbolType: 'symbolType',
  language: 'language',
  startLine: 'startLine',
  endLine: 'endLine'
} as const

export type MetadataKey = typeof METADATA_KEYS[keyof typeof METADATA_KEYS]

export interface SymbolMetadata {
  [METADATA_KEYS.filePath]?: string
  [METADATA_KEYS.symbolName]?: string
  [METADATA_KEYS.symbolType]?: string
  [METADATA_KEYS.language]?: string
  [METADATA_KEYS.startLine]?: number
  [METADATA_KEYS.endLine]?: number
}



