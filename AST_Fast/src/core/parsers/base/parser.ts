import { ParseResult, SupportedLanguage, UnifiedSymbol, UnifiedImport, UnifiedExport } from './types.js'

/**
 * 抽象语言解析器基类
 * 定义所有语言解析器必须实现的接口
 */
export abstract class BaseLanguageParser {
  abstract getLanguageId(): SupportedLanguage
  abstract getSupportedExtensions(): string[]
  abstract parseFile(filePath: string): Promise<ParseResult>
  
  // 核心解析方法
  abstract extractSymbols(sourceCode: string, filePath: string): Promise<UnifiedSymbol[]>
  abstract extractImports(sourceCode: string, filePath: string): Promise<UnifiedImport[]>
  abstract extractExports(sourceCode: string, filePath: string): Promise<UnifiedExport[]>
  
  // 工具方法
  abstract isSupported(filePath: string): boolean
  abstract validateSyntax(sourceCode: string): Promise<boolean>
  
  // 可选的语言特定方法
  extractComments?(sourceCode: string): string[]
  extractDocstrings?(sourceCode: string): string[]
  extractPragmas?(sourceCode: string): string[]  // Solidity 特有
  extractMacros?(sourceCode: string): string[]   // Rust 特有
}

/**
 * 解析器配置接口
 */
export interface ParserConfig {
  // 通用配置
  skipComments?: boolean
  skipDocstrings?: boolean
  includePrivateSymbols?: boolean
  
  // Web3 特定配置
  includePragmas?: boolean      // Solidity
  includeModifiers?: boolean    // Solidity
  includeAnnotations?: boolean  // Move/Rust
  
  // 性能配置
  timeout?: number
  maxFileSize?: number
}

/**
 * 解析器工厂接口
 */
export interface IParserFactory {
  createParser(language: SupportedLanguage): BaseLanguageParser
  getParserByFileExtension(filePath: string): BaseLanguageParser | null
  getSupportedLanguages(): SupportedLanguage[]
  getSupportedExtensions(): string[]
}


