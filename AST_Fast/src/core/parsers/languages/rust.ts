import path from 'node:path'
import Parser from 'tree-sitter'
import Rust from 'tree-sitter-rust'
import { BaseLanguageParser, ParserConfig } from '../base/parser.js'
import { 
  ParseResult, 
  SupportedLanguage, 
  UnifiedSymbol, 
  UnifiedImport, 
  UnifiedExport 
} from '../base/types.js'
import { readFileContent, createRange } from '../base/utils.js'

/**
 * Rust 解析器
 * 支持 Solana、Near、Polkadot 等区块链项目
 */
export class RustParser extends BaseLanguageParser {
  private parser: Parser
  private config: ParserConfig

  constructor(config: ParserConfig = {}) {
    super()
    this.config = config
    this.parser = new Parser()
    this.parser.setLanguage(Rust)
  }

  getLanguageId(): SupportedLanguage {
    return 'rust'
  }

  getSupportedExtensions(): string[] {
    return ['.rs']
  }

  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return ext === '.rs'
  }

  async validateSyntax(sourceCode: string): Promise<boolean> {
    try {
      const tree = this.parser.parse(sourceCode)
      return !tree.rootNode.hasError()
    } catch {
      return false
    }
  }

  async parseFile(filePath: string): Promise<ParseResult> {
    const absolutePath = path.resolve(filePath)
    const sourceCode = await readFileContent(absolutePath)
    
    const [symbols, imports, exports] = await Promise.all([
      this.extractSymbols(sourceCode, absolutePath),
      this.extractImports(sourceCode, absolutePath),
      this.extractExports(sourceCode, absolutePath)
    ])

    return {
      filePath: absolutePath,
      language: this.getLanguageId(),
      symbols,
      imports,
      exports,
      metadata: {
        packageName: this.extractCrateName(sourceCode)
      }
    }
  }

  async extractSymbols(sourceCode: string, filePath: string): Promise<UnifiedSymbol[]> {
    const tree = this.parser.parse(sourceCode)
    const symbols: UnifiedSymbol[] = []

    const traverse = (node: Parser.SyntaxNode) => {
      switch (node.type) {
        case 'function_item':
          symbols.push(this.extractFunctionSymbol(node, sourceCode))
          break
          
        case 'struct_item':
          symbols.push(this.extractStructSymbol(node, sourceCode))
          break
          
        case 'enum_item':
          symbols.push(this.extractEnumSymbol(node, sourceCode))
          break
          
        case 'impl_item':
          symbols.push(this.extractImplSymbol(node, sourceCode))
          break
          
        case 'trait_item':
          symbols.push(this.extractTraitSymbol(node, sourceCode))
          break
          
        case 'const_item':
        case 'static_item':
          symbols.push(this.extractConstantSymbol(node, sourceCode))
          break
          
        case 'mod_item':
          symbols.push(this.extractModuleSymbol(node, sourceCode))
          break
      }

      for (const child of node.children) {
        traverse(child)
      }
    }

    traverse(tree.rootNode)
    return symbols
  }

  async extractImports(sourceCode: string, filePath: string): Promise<UnifiedImport[]> {
    const tree = this.parser.parse(sourceCode)
    const imports: UnifiedImport[] = []

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'use_declaration') {
        const importData = this.extractUseDeclaration(node, sourceCode)
        if (importData) {
          imports.push(importData)
        }
      }

      for (const child of node.children) {
        traverse(child)
      }
    }

    traverse(tree.rootNode)
    return imports
  }

  async extractExports(sourceCode: string, filePath: string): Promise<UnifiedExport[]> {
    // Rust 使用 pub 关键字标记公开项
    const symbols = await this.extractSymbols(sourceCode, filePath)
    
    return symbols
      .filter(symbol => symbol.visibility === 'public')
      .map(symbol => ({
        name: symbol.name,
        type: symbol.type,
        isDefault: false,
        range: symbol.range,
        isPublic: true
      }))
  }

  private extractFunctionSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous'
    
    const visibility = this.extractVisibility(node)
    const parameters = this.extractFunctionParameters(node, sourceCode)
    const returnType = this.extractReturnType(node, sourceCode)
    const annotations = this.extractAnnotations(node, sourceCode)
    
    return {
      name,
      type: 'function' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility,
      parameters,
      returnType,
      annotations
    }
  }

  private extractStructSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'AnonymousStruct'
    
    return {
      name,
      type: 'struct' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.extractVisibility(node),
      annotations: this.extractAnnotations(node, sourceCode)
    }
  }

  private extractEnumSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'AnonymousEnum'
    
    return {
      name,
      type: 'enum' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.extractVisibility(node)
    }
  }

  private extractImplSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const typeNode = node.childForFieldName('type')
    const name = typeNode ? 
      `impl ${sourceCode.slice(typeNode.startIndex, typeNode.endIndex)}` : 
      'impl'
    
    return {
      name,
      type: 'class' as const, // impl 块映射为类
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: 'public'
    }
  }

  private extractTraitSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'AnonymousTrait'
    
    return {
      name,
      type: 'interface' as const, // trait 映射为接口
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.extractVisibility(node)
    }
  }

  private extractConstantSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'ANONYMOUS'
    
    return {
      name,
      type: 'constant' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.extractVisibility(node)
    }
  }

  private extractModuleSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous_mod'
    
    return {
      name,
      type: 'module' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.extractVisibility(node)
    }
  }

  private extractUseDeclaration(node: Parser.SyntaxNode, sourceCode: string): UnifiedImport | null {
    const useTree = node.childForFieldName('argument')
    if (!useTree) return null

    const { source, specifiers } = this.parseUseTree(useTree, sourceCode)
    
    return {
      source,
      specifiers,
      type: 'use' as const
    }
  }

  private parseUseTree(node: Parser.SyntaxNode, sourceCode: string): { source: string; specifiers: string[] } {
    const source = sourceCode.slice(node.startIndex, node.endIndex)
    
    // 简化版本：将整个 use 语句作为一个 specifier
    return {
      source: source.replace(/^use\s+/, '').replace(/;$/, ''),
      specifiers: [source]
    }
  }

  private extractVisibility(node: Parser.SyntaxNode): 'public' | 'private' {
    // 检查是否有 pub 关键字
    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        return 'public'
      }
    }
    return 'private'
  }

  private extractFunctionParameters(node: Parser.SyntaxNode, sourceCode: string): any[] {
    const parameters: any[] = []
    
    const parametersNode = node.childForFieldName('parameters')
    if (!parametersNode) return parameters
    
    for (const child of parametersNode.children) {
      if (child.type === 'parameter') {
        const patternNode = child.childForFieldName('pattern')
        const typeNode = child.childForFieldName('type')
        
        if (patternNode) {
          parameters.push({
            name: sourceCode.slice(patternNode.startIndex, patternNode.endIndex),
            type: typeNode ? sourceCode.slice(typeNode.startIndex, typeNode.endIndex) : 'unknown'
          })
        }
      }
    }
    
    return parameters
  }

  private extractReturnType(node: Parser.SyntaxNode, sourceCode: string): string | undefined {
    const returnTypeNode = node.childForFieldName('return_type')
    if (!returnTypeNode) return undefined
    
    return sourceCode.slice(returnTypeNode.startIndex, returnTypeNode.endIndex)
  }

  private extractAnnotations(node: Parser.SyntaxNode, sourceCode: string): string[] {
    const annotations: string[] = []
    
    // 查找属性注解 #[...]
    for (const child of node.children) {
      if (child.type === 'attribute_item') {
        annotations.push(sourceCode.slice(child.startIndex, child.endIndex))
      }
    }
    
    return annotations
  }

  private extractCrateName(sourceCode: string): string | undefined {
    // 从 Cargo.toml 风格的注释或代码中提取 crate 名称
    const crateMatch = sourceCode.match(/\/\/\s*crate:\s*(\w+)/)
    return crateMatch ? crateMatch[1] : undefined
  }
}


