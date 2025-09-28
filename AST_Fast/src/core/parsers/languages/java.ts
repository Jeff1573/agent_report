import path from 'node:path'
import Parser from 'tree-sitter'
import Java from 'tree-sitter-java'
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
 * Java 解析器
 * 支持企业级后端 Java 应用解析
 */
export class JavaParser extends BaseLanguageParser {
  private parser: Parser
  private config: ParserConfig

  constructor(config: ParserConfig = {}) {
    super()
    this.config = config
    this.parser = new Parser()
    this.parser.setLanguage(Java)
  }

  getLanguageId(): SupportedLanguage {
    return 'java'
  }

  getSupportedExtensions(): string[] {
    return ['.java']
  }

  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return ext === '.java'
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
        packageName: this.extractPackageName(sourceCode),
        framework: this.detectFramework(sourceCode)
      }
    }
  }

  async extractSymbols(sourceCode: string, filePath: string): Promise<UnifiedSymbol[]> {
    const tree = this.parser.parse(sourceCode)
    const symbols: UnifiedSymbol[] = []

    const traverse = (node: Parser.SyntaxNode) => {
      switch (node.type) {
        case 'method_declaration':
        case 'constructor_declaration':
          symbols.push(this.extractMethodSymbol(node, sourceCode))
          break
          
        case 'class_declaration':
          symbols.push(this.extractClassSymbol(node, sourceCode))
          break
          
        case 'interface_declaration':
          symbols.push(this.extractInterfaceSymbol(node, sourceCode))
          break
          
        case 'enum_declaration':
          symbols.push(this.extractEnumSymbol(node, sourceCode))
          break
          
        case 'field_declaration':
          symbols.push(...this.extractFieldDeclaration(node, sourceCode))
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
    // Java 使用 public 修饰符标识公开符号
    const symbols = await this.extractSymbols(sourceCode, filePath)
    
    return symbols
      .filter(symbol => symbol.visibility === 'public')
      .map(symbol => ({
        name: symbol.name,
        type: symbol.type,
        isDefault: symbol.type === 'class', // public class 作为主要导出
        range: symbol.range,
        isPublic: true
      }))
  }

  private extractMethodSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous'
    
    const visibility = this.extractVisibility(node)
    const parameters = this.extractMethodParameters(node, sourceCode)
    const returnType = this.extractReturnType(node, sourceCode)
    const modifiers = this.extractModifiers(node, sourceCode)
    
    return {
      name,
      type: 'function' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility,
      parameters,
      returnType,
      modifiers
    }
  }

  private extractClassSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'AnonymousClass'
    
    return {
      name,
      type: 'class' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.extractVisibility(node),
      modifiers: this.extractModifiers(node, sourceCode)
    }
  }

  private extractInterfaceSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'AnonymousInterface'
    
    return {
      name,
      type: 'interface' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: this.extractVisibility(node)
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

  private extractFieldDeclaration(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol[] {
    const symbols: UnifiedSymbol[] = []
    const visibility = this.extractVisibility(node)
    const modifiers = this.extractModifiers(node, sourceCode)
    const isConstant = modifiers.includes('final') && modifiers.includes('static')
    
    for (const child of node.children) {
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) {
          const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex)
          
          symbols.push({
            name,
            type: isConstant ? 'constant' : 'variable',
            range: createRange(sourceCode, child.startIndex, child.endIndex),
            visibility,
            modifiers
          })
        }
      }
    }
    
    return symbols
  }

  private extractImportDeclaration(node: Parser.SyntaxNode, sourceCode: string): UnifiedImport | null {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const source = sourceCode.slice(nameNode.startIndex, nameNode.endIndex)
    const isStatic = this.hasStaticModifier(node)
    const isWildcard = source.endsWith('*')
    
    return {
      source: source.replace(/\.\*$/, ''),
      specifiers: isWildcard ? ['*'] : [source.split('.').pop() || source],
      type: isStatic ? 'import' : 'import',
      alias: isStatic ? 'static' : undefined
    }
  }

  private extractVisibility(node: Parser.SyntaxNode): 'public' | 'private' | 'protected' | 'internal' {
    const modifiersNode = node.childForFieldName('modifiers')
    if (!modifiersNode) return 'internal' // package-private
    
    for (const child of modifiersNode.children) {
      if (['public', 'private', 'protected'].includes(child.type)) {
        return child.type as any
      }
    }
    
    return 'internal'
  }

  private extractModifiers(node: Parser.SyntaxNode, sourceCode: string): string[] {
    const modifiers: string[] = []
    const modifiersNode = node.childForFieldName('modifiers')
    
    if (modifiersNode) {
      for (const child of modifiersNode.children) {
        if (child.type !== 'public' && child.type !== 'private' && child.type !== 'protected') {
          modifiers.push(child.type)
        }
      }
    }
    
    return modifiers
  }

  private extractMethodParameters(node: Parser.SyntaxNode, sourceCode: string): any[] {
    const parameters: any[] = []
    
    const parametersNode = node.childForFieldName('parameters')
    if (!parametersNode) return parameters
    
    for (const child of parametersNode.children) {
      if (child.type === 'formal_parameter') {
        const nameNode = child.childForFieldName('name')
        const typeNode = child.childForFieldName('type')
        
        if (nameNode) {
          parameters.push({
            name: sourceCode.slice(nameNode.startIndex, nameNode.endIndex),
            type: typeNode ? sourceCode.slice(typeNode.startIndex, typeNode.endIndex) : 'Object'
          })
        }
      }
    }
    
    return parameters
  }

  private extractReturnType(node: Parser.SyntaxNode, sourceCode: string): string | undefined {
    const typeNode = node.childForFieldName('type')
    if (!typeNode) return 'void'
    
    return sourceCode.slice(typeNode.startIndex, typeNode.endIndex)
  }

  private hasStaticModifier(node: Parser.SyntaxNode): boolean {
    const modifiersNode = node.childForFieldName('modifiers')
    if (!modifiersNode) return false
    
    for (const child of modifiersNode.children) {
      if (child.type === 'static') {
        return true
      }
    }
    
    return false
  }

  private extractPackageName(sourceCode: string): string | undefined {
    const packageMatch = sourceCode.match(/^package\s+([\w.]+);/)
    return packageMatch ? packageMatch[1] : undefined
  }

  private detectFramework(sourceCode: string): string | undefined {
    if (sourceCode.includes('org.springframework')) {
      return 'Spring'
    }
    if (sourceCode.includes('javax.servlet') || sourceCode.includes('jakarta.servlet')) {
      return 'Servlet'
    }
    if (sourceCode.includes('org.hibernate')) {
      return 'Hibernate'
    }
    return undefined
  }
}


