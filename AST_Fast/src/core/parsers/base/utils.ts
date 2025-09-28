import path from 'node:path'
import fs from 'node:fs/promises'
import { Position, Range, SupportedLanguage } from './types.js'

/**
 * 通用工具函数
 */

/**
 * 根据文件扩展名推断语言类型
 */
export function detectLanguageFromExtension(filePath: string): SupportedLanguage | null {
  const ext = path.extname(filePath).toLowerCase()
  
  const extensionMap: Record<string, SupportedLanguage> = {
    // Web3 语言
    '.sol': 'solidity',
    '.rs': 'rust',
    '.go': 'go',
    
    // 前端语言
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    
    // 后端语言
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python',
    '.java': 'java',
    // TODO: 暂未实现
    // '.cs': 'csharp',
    // '.php': 'php',
  }
  
  return extensionMap[ext] || null
}

/**
 * 获取所有支持的文件扩展名
 */
export function getAllSupportedExtensions(): string[] {
  return [
    // Web3
    '.sol', '.rs', '.go',
    // 前端  
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    // 后端
    '.py', '.pyw', '.pyi', '.java'
    // TODO: 暂未实现
    // '.cs', '.php', '.move'
  ]
}

/**
 * 检查文件是否为支持的代码文件
 */
export function isCodeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return getAllSupportedExtensions().includes(ext)
}

/**
 * 安全读取文件内容
 */
export async function readFileContent(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`)
  }
}

/**
 * 位置转换工具 - 从字符偏移量转换为行列位置
 */
export function offsetToPosition(text: string, offset: number): Position {
  const lines = text.slice(0, offset).split('\n')
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  }
}

/**
 * 创建范围对象
 */
export function createRange(text: string, start: number, end: number): Range {
  return {
    start: offsetToPosition(text, start),
    end: offsetToPosition(text, end)
  }
}

/**
 * 提取文件名（不含扩展名）
 */
export function getFileNameWithoutExtension(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

/**
 * 标准化文件路径
 */
export function normalizePath(filePath: string): string {
  return path.resolve(filePath)
}

/**
 * 验证语言是否受支持
 */
export function isSupportedLanguage(language: string): language is SupportedLanguage {
  const supportedLanguages: SupportedLanguage[] = [
    'solidity', 'rust', 'go',
    'typescript', 'javascript', 
    'python', 'java'
    // TODO: 暂未实现
    // 'move', 'csharp', 'php'
  ]
  return supportedLanguages.includes(language as SupportedLanguage)
}

/**
 * 性能监控装饰器
 */
export function measureTime<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  label: string
): T {
  return (async (...args: any[]) => {
    const start = performance.now()
    try {
      const result = await fn(...args)
      const duration = performance.now() - start
      console.debug(`${label} took ${duration.toFixed(2)}ms`)
      return result
    } catch (error) {
      const duration = performance.now() - start
      console.error(`${label} failed after ${duration.toFixed(2)}ms:`, error)
      throw error
    }
  }) as T
}
