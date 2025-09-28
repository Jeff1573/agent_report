import path from 'node:path'
import Parser from 'tree-sitter'
import Python from 'tree-sitter-python'
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
 * Python 解析器
 * 支持 Python 后端代码解析
 */
export class PythonParser extends BaseLanguageParser {
  private parser: Parser
  private config: ParserConfig

  constructor(config: ParserConfig = {}) {
    super()
    this.config = config
    this.parser = new Parser()
    this.parser.setLanguage(Python)
  }

  getLanguageId(): SupportedLanguage {
    return 'python'
  }

  getSupportedExtensions(): string[] {
    return ['.py', '.pyw', '.pyi']
  }

  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return this.getSupportedExtensions().includes(ext)
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
        framework: this.detectFramework(sourceCode)
      }
    }
  }

  async extractSymbols(sourceCode: string, filePath: string): Promise<UnifiedSymbol[]> {
    const tree = this.parser.parse(sourceCode)
    const symbols: UnifiedSymbol[] = []

    const traverse = (node: Parser.SyntaxNode) => {
      switch (node.type) {
        case 'function_definition':
          symbols.push(this.extractFunctionSymbol(node, sourceCode))
          break
          
        case 'class_definition':
          symbols.push(this.extractClassSymbol(node, sourceCode))
          break
          
        case 'assignment':
          // 提取全局变量和常量
          const variables = this.extractVariableAssignment(node, sourceCode)
          symbols.push(...variables)
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
      if (node.type === 'import_statement' || node.type === 'import_from_statement') {
        const importData = this.extractImportStatement(node, sourceCode)
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
    // Python 使用 __all__ 定义显式导出，或所有公开符号（不以_开头）
    const symbols = await this.extractSymbols(sourceCode, filePath)
    
    return symbols
      .filter(symbol => !symbol.name.startsWith('_'))
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
      parameters,
      returnType,
      visibility: name.startsWith('_') ? 'private' : 'public'
    }
  }

  private extractClassSymbol(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol {
    const nameNode = node.childForFieldName('name')
    const name = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'AnonymousClass'
    
    return {
      name,
      type: 'class' as const,
      range: createRange(sourceCode, node.startIndex, node.endIndex),
      visibility: name.startsWith('_') ? 'private' : 'public'
    }
  }

  private extractVariableAssignment(node: Parser.SyntaxNode, sourceCode: string): UnifiedSymbol[] {
    const variables: UnifiedSymbol[] = []
    
    const leftNode = node.childForFieldName('left')
    if (leftNode && leftNode.type === 'identifier') {
      const name = sourceCode.slice(leftNode.startIndex, leftNode.endIndex)
      
      // 检查是否是常量（全大写）
      const isConstant = name === name.toUpperCase() && name.includes('_')
      
      variables.push({
        name,
        type: isConstant ? 'constant' : 'variable',
        range: createRange(sourceCode, node.startIndex, node.endIndex),
        visibility: name.startsWith('_') ? 'private' : 'public'
      })
    }
    
    return variables
  }

  private extractImportStatement(node: Parser.SyntaxNode, sourceCode: string): UnifiedImport | null {
    if (node.type === 'import_statement') {
      // import module1, module2
      const modules = this.extractImportNames(node, sourceCode)
      return {
        source: modules.join(', '),
        specifiers: modules,
        type: 'import' as const
      }
    } else if (node.type === 'import_from_statement') {
      // from module import name1, name2
      const moduleNode = node.childForFieldName('module_name')
      const source = moduleNode ? sourceCode.slice(moduleNode.startIndex, moduleNode.endIndex) : ''
      const specifiers = this.extractFromImportNames(node, sourceCode)
      
      return {
        source,
        specifiers,
        type: 'from' as const
      }
    }
    
    return null
  }

  private extractImportNames(node: Parser.SyntaxNode, sourceCode: string): string[] {
    const names: string[] = []
    
    const traverse = (n: Parser.SyntaxNode) => {
      if (n.type === 'dotted_name' || n.type === 'identifier') {
        names.push(sourceCode.slice(n.startIndex, n.endIndex))
      }
      
      for (const child of n.children) {
        traverse(child)
      }
    }
    
    traverse(node)
    return names
  }

  private extractFromImportNames(node: Parser.SyntaxNode, sourceCode: string): string[] {
    const names: string[] = []
    
    const traverse = (n: Parser.SyntaxNode) => {
      if (n.type === 'import_list') {
        for (const child of n.children) {
          if (child.type === 'identifier' || child.type === 'aliased_import') {
            const nameNode = child.type === 'aliased_import' ? 
              child.childForFieldName('name') : child
            if (nameNode) {
              names.push(sourceCode.slice(nameNode.startIndex, nameNode.endIndex))
            }
          }
        }
      } else if (n.type === 'wildcard_import') {
        names.push('*')
      }
      
      for (const child of n.children) {
        traverse(child)
      }
    }
    
    traverse(node)
    return names
  }

  private extractFunctionParameters(node: Parser.SyntaxNode, sourceCode: string): any[] {
    const parameters: any[] = []
    
    const parametersNode = node.childForFieldName('parameters')
    if (!parametersNode) return parameters
    
    for (const child of parametersNode.children) {
      if (child.type === 'identifier') {
        parameters.push({
          name: sourceCode.slice(child.startIndex, child.endIndex),
          type: 'any' // Python 是动态类型
        })
      } else if (child.type === 'typed_parameter') {
        const nameNode = child.childForFieldName('pattern')
        const typeNode = child.childForFieldName('type')
        
        if (nameNode) {
          parameters.push({
            name: sourceCode.slice(nameNode.startIndex, nameNode.endIndex),
            type: typeNode ? sourceCode.slice(typeNode.startIndex, typeNode.endIndex) : 'any'
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

  private detectFramework(sourceCode: string): string | undefined {
    if (sourceCode.includes('from django') || sourceCode.includes('import django')) {
      return 'Django'
    }
    if (sourceCode.includes('from flask') || sourceCode.includes('import flask')) {
      return 'Flask'
    }
    if (sourceCode.includes('from fastapi') || sourceCode.includes('import fastapi')) {
      return 'FastAPI'
    }
    return undefined
  }
}


