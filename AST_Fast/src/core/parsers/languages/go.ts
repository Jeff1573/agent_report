import path from 'node:path'
import Parser from 'tree-sitter'
import Go from 'tree-sitter-go'
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
 * Go 解析器
 * 支持以太坊 Geth、Cosmos SDK 等区块链基础设施
 */
export class GoParser extends BaseLanguageParser {
  private parser: Parser
  private config: ParserConfig

  constructor(config: ParserConfig = {}) {
    super()
    this.config = config
    this.parser = new Parser()
    this.parser.setLanguage(Go)
  }

  getLanguageId(): SupportedLanguage {
    return 'go'
  }

  getSupportedExtensions(): string[] {
    return ['.go']
  }

  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return ext === '.go'
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
        packageName: this.extractPackageName(sourceCode)
      }
    }
  }

  async extractSymbols(sourceCode: string, filePath: string): Promise<UnifiedSymbol[]> {
    const tree = this.parser.parse(sourceCode)
    const symbols: UnifiedSymbol[] = []

    const traverse = (node: Parser.SyntaxNode) => {
      switch (node.type) {
        case 'function_declaration':
        case 'method_declaration':
          symbols.push(this.extractFunctionSymbol(node, sourceCode))
          break
          
        case 'type_declaration':
          symbols.push(...this.extractTypeDeclaration(node, sourceCode))
          break
          
        case 'var_declaration':
        case 'const_declaration':
          symbols.push(...this.extractVariableDeclaration(node, sourceCode))
          break
          
        case 'interface_type':
          if (node.parent?.type === 'type_spec') {
            symbols.push(this.extractInterfaceSymbol(node, sourceCode))
          }
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
      if (node.type === 'import_declaration') {
        const importData = this.extractImportDeclaration(node, sourceCode)
        imports.push(...importData)
      }

      for (const child of node.children) {
        traverse(child)
      }
    }

    traverse(tree.rootNode)
    return imports
  }

  async extractExports(sourceCode: string, filePath: string): Promise<UnifiedExport[]> {
    // Go 使用首字母大写标识公开符号
    const symbols = await this.extractSymbols(sourceCode, filePath)
    
    return symbols
      .filter(symbol => this.isPublicSymbol(symbol.name))
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
    
    const parameters = this.extractFunctionParameters(node, sourceCode)
    const returnType = this.extractReturnType(node, sourceCode)
    
    return {
      name,
      type: 'function' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.isPublicSymbol(name) ? 'public' : 'private',
      parameters,
      returnType
    }
  }

  private extractTypeDeclaration(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol[] {
    const symbols: UnifiedSymbol[] = []
    
    for (const child of node.children) {
      if (child.type === 'type_spec') {
        const nameNode = child.childForFieldName('name')
        const typeNode = child.childForFieldName('type')
        
        if (nameNode && typeNode) {
          const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex)
          let symbolType: UnifiedSymbol['type'] = 'class'
          
          // 根据类型节点确定符号类型
          if (typeNode.type === 'struct_type') {
            symbolType = 'struct'
          } else if (typeNode.type === 'interface_type') {
            symbolType = 'interface'
          }
          
          symbols.push({
            name,
            type: symbolType,
            range: createRange(sourceCode, child.startIndex, child.endIndex),
            visibility: this.isPublicSymbol(name) ? 'public' : 'private'
          })
        }
      }
    }
    
    return symbols
  }

  private extractVariableDeclaration(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol[] {
    const symbols: UnifiedSymbol[] = []
    const isConstant = node.type === 'const_declaration'
    
    for (const child of node.children) {
      if (child.type === 'var_spec' || child.type === 'const_spec') {
        const nameList = child.childForFieldName('name')
        if (nameList) {
          for (const nameNode of nameList.children) {
            if (nameNode.type === 'identifier') {
              const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex)
              
              symbols.push({
                name,
                type: isConstant ? 'constant' : 'variable',
                range: createRange(sourceCode, nameNode.startIndex, nameNode.endIndex),
                visibility: this.isPublicSymbol(name) ? 'public' : 'private'
              })
            }
          }
        }
      }
    }
    
    return symbols
  }

  private extractInterfaceSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const parent = node.parent
    const nameNode = parent?.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'AnonymousInterface'
    
    return {
      name,
      type: 'interface' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.isPublicSymbol(name) ? 'public' : 'private'
    }
  }

  private extractImportDeclaration(node: Parser.SyntaxNode, sourceCode: string): UnifiedImport[] {
    const imports: UnifiedImport[] = []
    
    for (const child of node.children) {
      if (child.type === 'import_spec') {
        const packagePathNode = child.childForFieldName('path')
        const nameNode = child.childForFieldName('name')
        
        if (packagePathNode) {
          const source = sourceCode.slice(packagePathNode.startIndex, packagePathNode.endIndex)
            .replace(/^"/, '').replace(/"$/, '') // 移除引号
          
          const alias = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : undefined
          
          imports.push({
            source,
            specifiers: [alias || source.split('/').pop() || source],
            alias,
            type: 'import' as const
          })
        }
      }
    }
    
    return imports
  }

  private extractFunctionParameters(node: Parser.SyntaxNode, sourceCode: string): any[] {
    const parameters: any[] = []
    
    const parametersNode = node.childForFieldName('parameters')
    if (!parametersNode) return parameters
    
    for (const child of parametersNode.children) {
      if (child.type === 'parameter_declaration') {
        const nameNode = child.childForFieldName('name')
        const typeNode = child.childForFieldName('type')
        
        if (nameNode) {
          parameters.push({
            name: sourceCode.slice(nameNode.startIndex, nameNode.endIndex),
            type: typeNode ? sourceCode.slice(typeNode.startIndex, typeNode.endIndex) : 'interface{}'
          })
        }
      }
    }
    
    return parameters
  }

  private extractReturnType(node: Parser.SyntaxNode, sourceCode: string): string | undefined {
    const resultNode = node.childForFieldName('result')
    if (!resultNode) return undefined
    
    return sourceCode.slice(resultNode.startIndex, resultNode.endIndex)
  }

  private isPublicSymbol(name: string): boolean {
    // Go 中首字母大写的标识符是公开的
    return name.length > 0 && name[0] === name[0].toUpperCase()
  }

  private extractPackageName(sourceCode: string): string | undefined {
    const packageMatch = sourceCode.match(/^package\s+(\w+)/)
    return packageMatch ? packageMatch[1] : undefined
  }
}


