import path from 'node:path'
import fg from 'fast-glob'
import fs from 'node:fs/promises'
import ignore from 'ignore'
import { defaultParserFactory } from './parsers/factory.js'
import { getAllSupportedExtensions } from './parsers/base/utils.js'

async function loadGitignore(projectPath: string) {
  try {
    const content = await fs.readFile(path.join(projectPath, '.gitignore'), 'utf8')
    return ignore().add(content)
  } catch {
    return ignore()
  }
}

/**
 * 新的符号定位器 - 支持多语言
 */

export async function findSymbolDefinitionInProject(projectPath: string, symbolName: string) {
  const ig = await loadGitignore(projectPath)
  
  // 构建支持的文件扩展名模式
  const supportedExtensions = getAllSupportedExtensions()
  const patterns = supportedExtensions.map(ext => `**/*${ext}`)
  
  const entries = await fg(patterns, {
    cwd: projectPath,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'out/**', '.git/**'],
  })

  const results: Array<{
    filePath: string
    symbolName: string
    type: string
    startLine: number
    language: string
    symbol: any
  }> = []

  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    
    const abs = path.join(projectPath, rel)
    const parser = defaultParserFactory.getParserByFileExtension(abs)
    
    if (!parser) continue
    
    try {
      const parseResult = await parser.parseFile(abs)
      
      // 查找匹配的符号
      for (const symbol of parseResult.symbols) {
        if (symbol.name === symbolName) {
          results.push({
            filePath: abs,
            symbolName: symbol.name,
            type: symbol.type,
            startLine: symbol.range.start.line,
            language: parseResult.language,
            symbol
          })
        }
      }
    } catch (error) {
      console.error(`Error parsing ${abs}:`, error)
      // 继续处理其他文件
    }
  }

  return results
}

/**
 * 按符号类型查找定义
 */
export async function findSymbolsByType(projectPath: string, symbolType: string) {
  const ig = await loadGitignore(projectPath)
  const supportedExtensions = getAllSupportedExtensions()
  const patterns = supportedExtensions.map(ext => `**/*${ext}`)
  
  const entries = await fg(patterns, {
    cwd: projectPath,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'out/**', '.git/**'],
  })

  const results: Array<{
    filePath: string
    symbols: any[]
    language: string
  }> = []

  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    
    const abs = path.join(projectPath, rel)
    const parser = defaultParserFactory.getParserByFileExtension(abs)
    
    if (!parser) continue
    
    try {
      const parseResult = await parser.parseFile(abs)
      const matchingSymbols = parseResult.symbols.filter(s => s.type === symbolType)
      
      if (matchingSymbols.length > 0) {
        results.push({
          filePath: abs,
          symbols: matchingSymbols,
          language: parseResult.language
        })
      }
    } catch (error) {
      console.error(`Error parsing ${abs}:`, error)
    }
  }

  return results
}

/**
 * 模糊搜索符号名称
 */
export async function fuzzyFindSymbols(projectPath: string, partialName: string) {
  const ig = await loadGitignore(projectPath)
  const supportedExtensions = getAllSupportedExtensions()
  const patterns = supportedExtensions.map(ext => `**/*${ext}`)
  
  const entries = await fg(patterns, {
    cwd: projectPath,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'out/**', '.git/**'],
  })

  const results: Array<{
    filePath: string
    symbolName: string
    type: string
    startLine: number
    language: string
    matchScore: number
  }> = []

  const lowerPartialName = partialName.toLowerCase()

  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    
    const abs = path.join(projectPath, rel)
    const parser = defaultParserFactory.getParserByFileExtension(abs)
    
    if (!parser) continue
    
    try {
      const parseResult = await parser.parseFile(abs)
      
      for (const symbol of parseResult.symbols) {
        const lowerSymbolName = symbol.name.toLowerCase()
        
        // 计算匹配分数
        let matchScore = 0
        if (lowerSymbolName === lowerPartialName) {
          matchScore = 100 // 完全匹配
        } else if (lowerSymbolName.startsWith(lowerPartialName)) {
          matchScore = 80 // 前缀匹配
        } else if (lowerSymbolName.includes(lowerPartialName)) {
          matchScore = 60 // 包含匹配
        } else {
          continue // 不匹配，跳过
        }
        
        results.push({
          filePath: abs,
          symbolName: symbol.name,
          type: symbol.type,
          startLine: symbol.range.start.line,
          language: parseResult.language,
          matchScore
        })
      }
    } catch (error) {
      console.error(`Error parsing ${abs}:`, error)
    }
  }

  // 按匹配分数排序
  return results.sort((a, b) => b.matchScore - a.matchScore)
}

/**
 * 查找符号的所有引用
 */
export async function findSymbolReferences(projectPath: string, symbolName: string) {
  // 这是一个简化版本，实际的引用查找需要更复杂的分析
  // 比如分析 import 语句、函数调用等
  
  const definitions = await findSymbolDefinitionInProject(projectPath, symbolName)
  
  // TODO: 实现真正的引用查找
  // 1. 分析导入语句
  // 2. 分析函数调用
  // 3. 分析变量使用
  
  return {
    definitions,
    references: [], // 占位符
    summary: {
      definitionCount: definitions.length,
      referenceCount: 0,
      totalOccurrences: definitions.length
    }
  }
}

/**
 * 获取项目中所有符号的索引
 */
export async function buildSymbolIndex(projectPath: string) {
  const ig = await loadGitignore(projectPath)
  const supportedExtensions = getAllSupportedExtensions()
  const patterns = supportedExtensions.map(ext => `**/*${ext}`)
  
  const entries = await fg(patterns, {
    cwd: projectPath,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'out/**', '.git/**'],
  })

  const symbolIndex: Record<string, Array<{
    filePath: string
    type: string
    startLine: number
    language: string
  }>> = {}

  console.log(`Building symbol index for ${entries.length} files...`)

  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    
    const abs = path.join(projectPath, rel)
    const parser = defaultParserFactory.getParserByFileExtension(abs)
    
    if (!parser) continue
    
    try {
      const parseResult = await parser.parseFile(abs)
      
      for (const symbol of parseResult.symbols) {
        if (!symbolIndex[symbol.name]) {
          symbolIndex[symbol.name] = []
        }
        
        symbolIndex[symbol.name].push({
          filePath: abs,
          type: symbol.type,
          startLine: symbol.range.start.line,
          language: parseResult.language
        })
      }
    } catch (error) {
      console.error(`Error indexing ${abs}:`, error)
    }
  }

  return {
    symbolIndex,
    stats: {
      totalFiles: entries.filter(rel => !ig.ignores(rel)).length,
      uniqueSymbols: Object.keys(symbolIndex).length,
      totalSymbols: Object.values(symbolIndex).reduce((sum, arr) => sum + arr.length, 0)
    }
  }
}


