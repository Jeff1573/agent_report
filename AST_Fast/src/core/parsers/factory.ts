import { BaseLanguageParser, IParserFactory, ParserConfig } from './base/parser.js'
import { SupportedLanguage } from './base/types.js'
import { detectLanguageFromExtension, getAllSupportedExtensions } from './base/utils.js'

// 语言解析器导入
import { TypeScriptParser } from './languages/typescript.js'
import { SolidityParser } from './languages/solidity.js'
import { RustParser } from './languages/rust.js'
import { GoParser } from './languages/go.js'
import { PythonParser } from './languages/python.js'
import { JavaParser } from './languages/java.js'
// TODO: Move 解析器尚未实现
// import { MoveParser } from './languages/move.js'

/**
 * 语言解析器工厂
 * 负责创建和管理各种语言解析器实例
 */
export class ParserFactory implements IParserFactory {
  private parsers: Map<SupportedLanguage, BaseLanguageParser> = new Map()
  private config: ParserConfig

  constructor(config: ParserConfig = {}) {
    this.config = config
    this.initializeParsers()
  }

  /**
   * 初始化所有可用的解析器
   */
  private initializeParsers(): void {
    // 前端语言解析器
    this.parsers.set('typescript', new TypeScriptParser(this.config))
    this.parsers.set('javascript', new TypeScriptParser(this.config)) // JS 使用 TS 解析器

    // Web3 解析器
    this.parsers.set('solidity', new SolidityParser(this.config))
    this.parsers.set('rust', new RustParser(this.config))
    this.parsers.set('go', new GoParser(this.config))
    // TODO: Move 解析器需要手动集成或等待官方包
    // this.parsers.set('move', new MoveParser(this.config))
    
    // 后端解析器
    this.parsers.set('python', new PythonParser(this.config))
    this.parsers.set('java', new JavaParser(this.config))
  }

  /**
   * 根据语言类型创建解析器
   */
  createParser(language: SupportedLanguage): BaseLanguageParser {
    const parser = this.parsers.get(language)
    if (!parser) {
      throw new Error(`Parser for language '${language}' is not implemented yet`)
    }
    return parser
  }

  /**
   * 根据文件扩展名获取解析器
   */
  getParserByFileExtension(filePath: string): BaseLanguageParser | null {
    const language = detectLanguageFromExtension(filePath)
    if (!language || !this.parsers.has(language)) {
      return null
    }
    return this.parsers.get(language)!
  }

  /**
   * 获取所有支持的语言
   */
  getSupportedLanguages(): SupportedLanguage[] {
    return Array.from(this.parsers.keys())
  }

  /**
   * 获取所有支持的文件扩展名
   */
  getSupportedExtensions(): string[] {
    return getAllSupportedExtensions()
  }

  /**
   * 检查是否支持某种语言
   */
  isLanguageSupported(language: SupportedLanguage): boolean {
    return this.parsers.has(language)
  }

  /**
   * 检查是否支持某个文件
   */
  isFileSupported(filePath: string): boolean {
    return this.getParserByFileExtension(filePath) !== null
  }

  /**
   * 获取语言统计信息
   */
  getLanguageStats(): Record<SupportedLanguage, { implemented: boolean; extensions: string[] }> {
    const stats: any = {}
    
    const languageExtensions: Record<SupportedLanguage, string[]> = {
      // Web3
      solidity: ['.sol'],
      rust: ['.rs'],
      go: ['.go'],
      // 前端
      typescript: ['.ts', '.tsx'],
      javascript: ['.js', '.jsx', '.mjs', '.cjs'],
      // 后端
      python: ['.py', '.pyw', '.pyi'],
      java: ['.java']
    }

    for (const [language, extensions] of Object.entries(languageExtensions)) {
      stats[language] = {
        implemented: this.parsers.has(language as SupportedLanguage),
        extensions
      }
    }

    return stats
  }
}

/**
 * 默认解析器工厂实例
 */
export const defaultParserFactory = new ParserFactory()

/**
 * 便捷方法：解析单个文件
 */
export async function parseFile(filePath: string, config?: ParserConfig) {
  const factory = config ? new ParserFactory(config) : defaultParserFactory
  const parser = factory.getParserByFileExtension(filePath)
  
  if (!parser) {
    throw new Error(`No parser available for file: ${filePath}`)
  }
  
  return parser.parseFile(filePath)
}

/**
 * 便捷方法：检查文件是否受支持
 */
export function isFileSupported(filePath: string): boolean {
  return defaultParserFactory.isFileSupported(filePath)
}
