import path from 'node:path'
import { defaultParserFactory } from './parsers/factory.js'
import { ParseResult, UnifiedSymbol, UnifiedImport, UnifiedExport } from './parsers/base/types.js'

/**
 * 新的文件分析器 - 支持多语言
 * 替代原有基于 ts-morph 的实现
 */

export async function getFileStructureSummary(filePath: string): Promise<ParseResult> {
  const absolutePath = path.resolve(filePath)
  
  // 获取适当的解析器
  const parser = defaultParserFactory.getParserByFileExtension(absolutePath)
  
  if (!parser) {
    throw new Error(`No parser available for file: ${filePath}`)
  }
  
  // 使用解析器分析文件
  return await parser.parseFile(absolutePath)
}

/**
 * 向后兼容的接口 - 保持与原有 API 一致
 */
export async function getFileStructureSummaryLegacy(filePath: string) {
  const result = await getFileStructureSummary(filePath)
  
  // 转换为原有格式
  return {
    filePath: result.filePath,
    imports: result.imports.map(imp => ({
      source: imp.source,
      specifiers: imp.specifiers,
      default: imp.default || null,
      namespace: imp.namespace || null
    })),
    exports: result.exports.map(exp => ({
      name: exp.name,
      isDefault: exp.isDefault
    })),
    functions: result.symbols
      .filter(s => s.type === 'function')
      .map(s => ({
        name: s.name,
        startLine: s.range.start.line,
        endLine: s.range.end.line
      })),
    classes: result.symbols
      .filter(s => s.type === 'class' || s.type === 'struct' || s.type === 'contract')
      .map(s => ({
        name: s.name,
        startLine: s.range.start.line,
        endLine: s.range.end.line
      }))
  }
}

/**
 * 获取支持的文件类型信息
 */
export function getSupportedLanguages() {
  return defaultParserFactory.getLanguageStats()
}

/**
 * 检查文件是否支持解析
 */
export function isFileSupported(filePath: string): boolean {
  return defaultParserFactory.isFileSupported(filePath)
}

/**
 * 获取所有支持的文件扩展名
 */
export function getSupportedExtensions(): string[] {
  return defaultParserFactory.getSupportedExtensions()
}

/**
 * 批量分析多个文件
 */
export async function analyzeMultipleFiles(filePaths: string[]): Promise<ParseResult[]> {
  const results: ParseResult[] = []
  
  for (const filePath of filePaths) {
    try {
      if (isFileSupported(filePath)) {
        const result = await getFileStructureSummary(filePath)
        results.push(result)
      }
    } catch (error) {
      console.error(`Failed to analyze ${filePath}:`, error)
      // 继续处理其他文件
    }
  }
  
  return results
}

/**
 * 按语言类型分组分析结果
 */
export function groupResultsByLanguage(results: ParseResult[]): Record<string, ParseResult[]> {
  const grouped: Record<string, ParseResult[]> = {}
  
  for (const result of results) {
    if (!grouped[result.language]) {
      grouped[result.language] = []
    }
    grouped[result.language].push(result)
  }
  
  return grouped
}

/**
 * 提取项目中的所有符号
 */
export function extractAllSymbols(results: ParseResult[]): UnifiedSymbol[] {
  return results.flatMap(result => result.symbols)
}

/**
 * 提取项目中的所有导入
 */
export function extractAllImports(results: ParseResult[]): UnifiedImport[] {
  return results.flatMap(result => result.imports)
}

/**
 * 提取项目中的所有导出
 */
export function extractAllExports(results: ParseResult[]): UnifiedExport[] {
  return results.flatMap(result => result.exports)
}

/**
 * 生成项目语言统计
 */
export function generateLanguageStats(results: ParseResult[]) {
  const stats: Record<string, { fileCount: number; symbolCount: number; frameworks?: string[] }> = {}
  
  for (const result of results) {
    if (!stats[result.language]) {
      stats[result.language] = {
        fileCount: 0,
        symbolCount: 0,
        frameworks: []
      }
    }
    
    stats[result.language].fileCount++
    stats[result.language].symbolCount += result.symbols.length
    
    if (result.metadata?.framework && !stats[result.language].frameworks!.includes(result.metadata.framework)) {
      stats[result.language].frameworks!.push(result.metadata.framework)
    }
  }
  
  return stats
}


