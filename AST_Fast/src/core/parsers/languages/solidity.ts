import path from 'node:path'
import Parser from 'tree-sitter'
import Solidity from 'tree-sitter-solidity'
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
 * Solidity 智能合约解析器
 * 专门用于解析以太坊智能合约代码
 */
export class SolidityParser extends BaseLanguageParser {
  private parser: Parser
  private config: ParserConfig

  constructor(config: ParserConfig = {}) {
    super()
    this.config = config
    this.parser = new Parser()
    this.parser.setLanguage(Solidity)
  }

  getLanguageId(): SupportedLanguage {
    return 'solidity'
  }

  getSupportedExtensions(): string[] {
    return ['.sol']
  }

  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return ext === '.sol'
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
        version: this.extractPragmaVersion(sourceCode),
        packageName: this.extractContractName(sourceCode)
      }
    }
  }

  async extractSymbols(sourceCode: string, filePath: string): Promise<UnifiedSymbol[]> {
    const tree = this.parser.parse(sourceCode)
    const symbols: UnifiedSymbol[] = []

    const traverse = (node: Parser.SyntaxNode) => {
      switch (node.type) {
        case 'contract_declaration':
          symbols.push(this.extractContractSymbol(node, sourceCode))
          break
        
        case 'interface_declaration':
          symbols.push(this.extractInterfaceSymbol(node, sourceCode))
          break
          
        case 'library_declaration':
          symbols.push(this.extractLibrarySymbol(node, sourceCode))
          break
          
        case 'function_definition':
          symbols.push(this.extractFunctionSymbol(node, sourceCode))
          break
          
        case 'modifier_definition':
          symbols.push(this.extractModifierSymbol(node, sourceCode))
          break
          
        case 'event_definition':
          symbols.push(this.extractEventSymbol(node, sourceCode))
          break
          
        case 'struct_definition':
          symbols.push(this.extractStructSymbol(node, sourceCode))
          break
          
        case 'enum_definition':
          symbols.push(this.extractEnumSymbol(node, sourceCode))
          break
          
        case 'state_variable_declaration':
          symbols.push(...this.extractStateVariables(node, sourceCode))
          break
      }

      // 递归遍历子节点
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
      if (node.type === 'import_directive') {
        const importData = this.extractImportDirective(node, sourceCode)
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
    // Solidity 没有显式的 exports，所有 public/external 符号都是可访问的
    const symbols = await this.extractSymbols(sourceCode, filePath)
    
    return symbols
      .filter(symbol => 
        symbol.visibility === 'public' || 
        symbol.visibility === 'external' ||
        symbol.type === 'contract' ||
        symbol.type === 'interface'
      )
      .map(symbol => ({
        name: symbol.name,
        type: symbol.type,
        isDefault: symbol.type === 'contract', // 主合约作为默认导出
        range: symbol.range,
        isPublic: true
      }))
  }

  private extractContractSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'UnnamedContract'
    
    return {
      name,
      type: 'contract' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: 'public',
      modifiers: this.extractModifiers(node)
    }
  }

  private extractInterfaceSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'UnnamedInterface'
    
    return {
      name,
      type: 'interface' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: 'public'
    }
  }

  private extractLibrarySymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'UnnamedLibrary'
    
    return {
      name,
      type: 'class' as const, // 将 library 映射为 class
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: 'public'
    }
  }

  private extractFunctionSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous'
    
    const visibility = this.extractVisibility(node)
    const stateMutability = this.extractStateMutability(node)
    const isPayable = stateMutability === 'payable'
    
    return {
      name,
      type: 'function' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility,
      isPayable,
      stateMutability,
      parameters: this.extractFunctionParameters(node, sourceCode),
      returnType: this.extractReturnType(node, sourceCode),
      modifiers: this.extractModifiers(node)
    }
  }

  private extractModifierSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous'
    
    return {
      name,
      type: 'function' as const, // modifier 映射为函数
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: 'internal',
      parameters: this.extractFunctionParameters(node, sourceCode)
    }
  }

  private extractEventSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous'
    
    return {
      name,
      type: 'function' as const, // event 映射为函数
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: 'public',
      parameters: this.extractEventParameters(node, sourceCode)
    }
  }

  private extractStructSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous'
    
    return {
      name,
      type: 'struct' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: 'public'
    }
  }

  private extractEnumSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous'
    
    return {
      name,
      type: 'enum' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: 'public'
    }
  }

  private extractStateVariables(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol[] {
    const variables: UnifiedSymbol[] = []
    
    for (const child of node.children) {
      if (child.type === 'variable_declaration') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) {
          const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex)
          const visibility = this.extractVisibility(node)
          
          variables.push({
            name,
            type: 'variable' as const,
            range: createRange(sourceCode, child.startIndex, child.endIndex),
            visibility,
            modifiers: this.extractModifiers(node)
          })
        }
      }
    }
    
    return variables
  }

  private extractImportDirective(node: Parser.SyntaxNode, sourceCode: string): UnifiedImport | null {
    const importPath = this.findImportPath(node, sourceCode)
    if (!importPath) return null

    const symbols = this.findImportSymbols(node, sourceCode)
    
    return {
      source: importPath,
      specifiers: symbols,
      type: 'import' as const
    }
  }

  private findImportPath(node: Parser.SyntaxNode, sourceCode: string): string | null {
    // 查找字符串字面量节点
    const traverse = (n: Parser.SyntaxNode): string | null => {
      if (n.type === 'string_literal') {
        const text = sourceCode.slice(n.startIndex, n.endIndex)
        return text.slice(1, -1) // 移除引号
      }
      
      for (const child of n.children) {
        const result = traverse(child)
        if (result) return result
      }
      
      return null
    }
    
    return traverse(node)
  }

  private findImportSymbols(node: Parser.SyntaxNode, sourceCode: string): string[] {
    const symbols: string[] = []
    
    const traverse = (n: Parser.SyntaxNode) => {
      if (n.type === 'identifier' && n.parent?.type !== 'string_literal') {
        symbols.push(sourceCode.slice(n.startIndex, n.endIndex))
      }
      
      for (const child of n.children) {
        traverse(child)
      }
    }
    
    traverse(node)
    return symbols
  }

  private extractVisibility(node: Parser.SyntaxNode): 'public' | 'private' | 'internal' | 'external' {
    const visibilityKeywords = ['public', 'private', 'internal', 'external']
    
    for (const child of node.children) {
      if (visibilityKeywords.includes(child.type)) {
        return child.type as any
      }
    }
    
    return 'internal' // Solidity 默认可见性
  }

  private extractStateMutability(node: Parser.SyntaxNode): string | undefined {
    const mutabilityKeywords = ['pure', 'view', 'payable', 'nonpayable']
    
    for (const child of node.children) {
      if (mutabilityKeywords.includes(child.type)) {
        return child.type
      }
    }
    
    return undefined
  }

  private extractModifiers(node: Parser.SyntaxNode): string[] {
    const modifiers: string[] = []
    const modifierKeywords = ['virtual', 'override', 'constant', 'immutable']
    
    for (const child of node.children) {
      if (modifierKeywords.includes(child.type)) {
        modifiers.push(child.type)
      }
    }
    
    return modifiers
  }

  private extractFunctionParameters(node: Parser.SyntaxNode, sourceCode: string): any[] {
    const parameters: any[] = []
    
    const parametersNode = node.childForFieldName('parameters')
    if (!parametersNode) return parameters
    
    for (const child of parametersNode.children) {
      if (child.type === 'parameter') {
        const nameNode = child.childForFieldName('name')
        const typeNode = child.childForFieldName('type')
        
        if (nameNode && typeNode) {
          parameters.push({
            name: sourceCode.slice(nameNode.startIndex, nameNode.endIndex),
            type: sourceCode.slice(typeNode.startIndex, typeNode.endIndex)
          })
        }
      }
    }
    
    return parameters
  }

  private extractEventParameters(node: Parser.SyntaxNode, sourceCode: string): any[] {
    // Event 参数解析逻辑类似于函数参数
    return this.extractFunctionParameters(node, sourceCode)
  }

  private extractReturnType(node: Parser.SyntaxNode, sourceCode: string): string | undefined {
    const returnsNode = node.childForFieldName('returns')
    if (!returnsNode) return undefined
    
    return sourceCode.slice(returnsNode.startIndex, returnsNode.endIndex)
  }

  private extractPragmaVersion(sourceCode: string): string | undefined {
    const pragmaMatch = sourceCode.match(/pragma\s+solidity\s+([^;]+);/)
    return pragmaMatch ? pragmaMatch[1].trim() : undefined
  }

  private extractContractName(sourceCode: string): string | undefined {
    const contractMatch = sourceCode.match(/contract\s+(\w+)/)
    return contractMatch ? contractMatch[1] : undefined
  }
}


