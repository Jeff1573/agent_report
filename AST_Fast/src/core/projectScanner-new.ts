import path from 'node:path'
import fg from 'fast-glob'
import ignore from 'ignore'
import fs from 'node:fs/promises'
import { defaultParserFactory } from './parsers/factory.js'
import { analyzeMultipleFiles, groupResultsByLanguage, generateLanguageStats } from './fileAnalyzer-new.js'
import { getAllSupportedExtensions } from './parsers/base/utils.js'

async function loadGitignore(projectPath: string) {
  try {
    const content = await fs.readFile(path.join(projectPath, '.gitignore'), 'utf8')
    return ignore().add(content)
  } catch {
    return ignore()
  }
}

function addToTree(tree: any, relParts: string[], value: any) {
  let node = tree
  for (let i = 0; i < relParts.length - 1; i++) {
    const part = relParts[i]
    node[part] ||= {}
    node = node[part]
  }
  node[relParts[relParts.length - 1]] = value
}

/**
 * 新的项目结构扫描器 - 支持多语言
 */
export async function getProjectStructureSummary(projectPath: string) {
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

  const tree: any = {}
  const supportedFiles: string[] = []

  // 第一遍：构建树结构，收集支持的文件
  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    
    const abs = path.join(projectPath, rel)
    
    if (defaultParserFactory.isFileSupported(abs)) {
      supportedFiles.push(abs)
      addToTree(tree, rel.split('/'), { type: 'code_file', symbols: [] })
    } else {
      addToTree(tree, rel.split('/'), { type: 'other_file' })
    }
  }

  // 第二遍：批量分析所有支持的代码文件
  console.log(`Analyzing ${supportedFiles.length} supported files...`)
  const analysisResults = await analyzeMultipleFiles(supportedFiles)
  
  // 第三遍：将分析结果填入树结构
  for (const result of analysisResults) {
    const relativePath = path.relative(projectPath, result.filePath)
    const pathParts = relativePath.split(path.sep)
    
    // 提取主要符号名称
    const symbols = result.symbols.map(s => s.name)
    
    // 更新树结构中的符号信息
    let node = tree
    for (let i = 0; i < pathParts.length - 1; i++) {
      node = node[pathParts[i]]
    }
    const fileName = pathParts[pathParts.length - 1]
    if (node[fileName]) {
      node[fileName].symbols = symbols
      node[fileName].language = result.language
      node[fileName].symbolCount = symbols.length
    }
  }

  return {
    tree,
    stats: {
      totalFiles: entries.length,
      analyzedFiles: analysisResults.length,
      languageBreakdown: generateLanguageStats(analysisResults),
      supportedLanguages: defaultParserFactory.getSupportedLanguages()
    }
  }
}

/**
 * 向后兼容的项目扫描接口
 */
export async function getProjectStructureSummaryLegacy(projectPath: string) {
  const result = await getProjectStructureSummary(projectPath)
  return result.tree // 返回原有格式的树结构
}

/**
 * 获取项目的语言分布统计
 */
export async function getProjectLanguageStats(projectPath: string) {
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

  const stats: Record<string, number> = {}
  
  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    
    const abs = path.join(projectPath, rel)
    const parser = defaultParserFactory.getParserByFileExtension(abs)
    
    if (parser) {
      const language = parser.getLanguageId()
      stats[language] = (stats[language] || 0) + 1
    }
  }

  return stats
}

/**
 * 快速扫描项目（仅统计文件，不解析内容）
 */
export async function quickProjectScan(projectPath: string) {
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

  const languageStats: Record<string, number> = {}
  const filesByLanguage: Record<string, string[]> = {}
  
  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    
    const abs = path.join(projectPath, rel)
    const parser = defaultParserFactory.getParserByFileExtension(abs)
    
    if (parser) {
      const language = parser.getLanguageId()
      languageStats[language] = (languageStats[language] || 0) + 1
      
      if (!filesByLanguage[language]) {
        filesByLanguage[language] = []
      }
      filesByLanguage[language].push(rel)
    }
  }

  return {
    totalFiles: entries.filter(rel => !ig.ignores(rel)).length,
    languageStats,
    filesByLanguage,
    supportedLanguages: Object.keys(languageStats)
  }
}

/**
 * 深度分析项目（包含完整的符号解析）
 */
export async function deepProjectAnalysis(projectPath: string) {
  console.log('Starting deep project analysis...')
  
  const quickScan = await quickProjectScan(projectPath)
  console.log(`Found ${quickScan.totalFiles} files in ${quickScan.supportedLanguages.length} languages`)
  
  // 收集所有文件路径
  const allFiles: string[] = []
  for (const files of Object.values(quickScan.filesByLanguage)) {
    allFiles.push(...files.map(rel => path.join(projectPath, rel)))
  }
  
  // 批量分析
  console.log('Analyzing file contents...')
  const analysisResults = await analyzeMultipleFiles(allFiles)
  
  // 按语言分组
  const resultsByLanguage = groupResultsByLanguage(analysisResults)
  
  return {
    quickScan,
    analysisResults,
    resultsByLanguage,
    summary: {
      totalSymbols: analysisResults.reduce((sum, r) => sum + r.symbols.length, 0),
      totalImports: analysisResults.reduce((sum, r) => sum + r.imports.length, 0),
      totalExports: analysisResults.reduce((sum, r) => sum + r.exports.length, 0),
      languageStats: generateLanguageStats(analysisResults)
    }
  }
}


