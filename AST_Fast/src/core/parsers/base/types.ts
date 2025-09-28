/**
 * 统一的语言解析器类型定义
 * 支持 Web3 + 前后端常见语言的抽象语法树表示
 */

export interface Position {
  line: number
  column: number
}

export interface Range {
  start: Position
  end: Position
}

export interface UnifiedSymbol {
  name: string
  type: 'function' | 'class' | 'interface' | 'struct' | 'enum' | 'variable' | 'constant' | 'contract' | 'module'
  range: Range
  modifiers?: string[]
  parameters?: Parameter[]
  returnType?: string
  visibility?: 'public' | 'private' | 'protected' | 'internal' | 'external'
  // Web3 特有字段
  isPayable?: boolean        // Solidity 函数是否可接收以太币
  stateMutability?: string   // Solidity 状态可变性 (view, pure, payable)
  annotations?: string[]     // Move/Rust 注解
}

export interface Parameter {
  name: string
  type: string
  defaultValue?: string
  isOptional?: boolean
}

export interface UnifiedImport {
  source: string
  specifiers: string[]
  default?: string
  namespace?: string
  alias?: string
  type: 'import' | 'require' | 'use' | 'include' | 'from'
  // Web3 特有
  version?: string          // Solidity pragma 版本
  isAbstract?: boolean      // Solidity abstract contract
}

export interface UnifiedExport {
  name: string
  type: string
  isDefault: boolean
  range: Range
  // Web3 特有
  isPublic?: boolean        // Solidity/Move 公开状态
}

export interface ParseResult {
  filePath: string
  language: string
  symbols: UnifiedSymbol[]
  imports: UnifiedImport[]
  exports: UnifiedExport[]
  errors?: ParseError[]
  metadata?: {
    version?: string         // Solidity pragma, Python version
    framework?: string       // React, Vue, FastAPI
    packageName?: string     // Move package, Rust crate
  }
}

export interface ParseError {
  message: string
  range: Range
  severity: 'error' | 'warning' | 'info'
}

export type SupportedLanguage = 
  // Web3 语言
  | 'solidity' 
  | 'rust' 
  | 'go' 
  // 前端语言
  | 'typescript' 
  | 'javascript'
  // 后端语言  
  | 'python'
  | 'java'
  // TODO: 暂未实现
  // | 'move'
  // | 'csharp'
  // | 'php'
