import path from 'node:path'
import { Project, SyntaxKind, Node } from 'ts-morph'
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
 * TypeScript/JavaScript 解析器
 * 基于现有的 ts-morph 实现，适配新的统一接口
 */
export class TypeScriptParser extends BaseLanguageParser {
  private project: Project
  private config: ParserConfig

  constructor(config: ParserConfig = {}) {
    super()
    this.config = config
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        module: 99, // ESNext
        target: 9, // ES2022
        jsx: 1, // Preserve
      },
    })
  }

  getLanguageId(): SupportedLanguage {
    return 'typescript'
  }

  getSupportedExtensions(): string[] {
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
  }

  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return this.getSupportedExtensions().includes(ext)
  }

  async validateSyntax(sourceCode: string): Promise<boolean> {
    try {
      const tempFile = this.project.createSourceFile('temp.ts', sourceCode)
      const diagnostics = tempFile.getPreEmitDiagnostics()
      this.project.removeSourceFile(tempFile)
      return diagnostics.length === 0
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
    const sourceFile = this.project.createSourceFile(filePath, sourceCode, { overwrite: true })
    const symbols: UnifiedSymbol[] = []

    try {
      // 提取函数
      for (const fn of sourceFile.getFunctions()) {
        const name = fn.getName() || 'anonymous_function'
        const range = createRange(sourceCode, fn.getStart(), fn.getEnd())
        
        symbols.push({
          name,
          type: 'function',
          range,
          parameters: fn.getParameters().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || 'any',
            isOptional: p.hasQuestionToken()
          })),
          returnType: fn.getReturnTypeNode()?.getText(),
          modifiers: fn.getModifiers().map(m => m.getText())
        })
      }

      // 提取类
      for (const cls of sourceFile.getClasses()) {
        const name = cls.getName() || 'anonymous_class'
        const range = createRange(sourceCode, cls.getStart(), cls.getEnd())
        
        symbols.push({
          name,
          type: 'class',
          range,
          modifiers: cls.getModifiers().map(m => m.getText())
        })
      }

      // 提取接口
      for (const iface of sourceFile.getInterfaces()) {
        const range = createRange(sourceCode, iface.getStart(), iface.getEnd())
        
        symbols.push({
          name: iface.getName(),
          type: 'interface',
          range,
          modifiers: iface.getModifiers().map(m => m.getText())
        })
      }

      // 提取枚举
      for (const enumDecl of sourceFile.getEnums()) {
        const range = createRange(sourceCode, enumDecl.getStart(), enumDecl.getEnd())
        
        symbols.push({
          name: enumDecl.getName(),
          type: 'enum',
          range
        })
      }

      // 提取变量声明中的函数表达式
      for (const vd of sourceFile.getVariableDeclarations()) {
        const init = vd.getInitializer()
        if (!init) continue
        
        const kind = init.getKind()
        if (kind === SyntaxKind.FunctionExpression || kind === SyntaxKind.ArrowFunction) {
          const range = createRange(sourceCode, init.getStart(), init.getEnd())
          
          symbols.push({
            name: vd.getName(),
            type: 'function',
            range
          })
        }
      }

      return symbols
    } finally {
      this.project.removeSourceFile(sourceFile)
    }
  }

  async extractImports(sourceCode: string, filePath: string): Promise<UnifiedImport[]> {
    const sourceFile = this.project.createSourceFile(filePath, sourceCode, { overwrite: true })
    const imports: UnifiedImport[] = []

    try {
      for (const imp of sourceFile.getImportDeclarations()) {
        const source = imp.getModuleSpecifierValue()
        const defaultImport = imp.getDefaultImport()?.getText()
        const namespaceImport = imp.getNamespaceImport()?.getText()
        const specifiers = imp.getNamedImports().map(ni => ni.getName())

        imports.push({
          source,
          specifiers,
          default: defaultImport,
          namespace: namespaceImport,
          type: 'import'
        })
      }

      return imports
    } finally {
      this.project.removeSourceFile(sourceFile)
    }
  }

  async extractExports(sourceCode: string, filePath: string): Promise<UnifiedExport[]> {
    const sourceFile = this.project.createSourceFile(filePath, sourceCode, { overwrite: true })
    const exports: UnifiedExport[] = []

    try {
      const exportedDecls = sourceFile.getExportedDeclarations()
      
      for (const [name, decls] of exportedDecls) {
        for (const decl of decls) {
          const isDefault = Node.isExportAssignment(decl) || 
            (Node.isModifierable(decl) && 'getFirstModifierByKind' in decl ? 
              !!decl.getFirstModifierByKind(SyntaxKind.DefaultKeyword) : false)
          
          const range = createRange(sourceCode, decl.getStart(), decl.getEnd())
          
          exports.push({
            name,
            type: this.getDeclarationType(decl),
            isDefault,
            range
          })
        }
      }

      // 处理 export default 语句
      for (const ea of sourceFile.getExportAssignments()) {
        if (!ea.isExportEquals()) {
          const range = createRange(sourceCode, ea.getStart(), ea.getEnd())
          exports.push({
            name: 'default',
            type: 'unknown',
            isDefault: true,
            range
          })
        }
      }

      return exports
    } finally {
      this.project.removeSourceFile(sourceFile)
    }
  }

  private getDeclarationType(node: Node): string {
    if (Node.isFunctionDeclaration(node)) return 'function'
    if (Node.isClassDeclaration(node)) return 'class'
    if (Node.isInterfaceDeclaration(node)) return 'interface'
    if (Node.isEnumDeclaration(node)) return 'enum'
    if (Node.isVariableDeclaration(node)) return 'variable'
    return 'unknown'
  }

  private detectFramework(sourceCode: string): string | undefined {
    if (sourceCode.includes('from \'react\'') || sourceCode.includes('import React')) {
      return 'React'
    }
    if (sourceCode.includes('from \'vue\'') || sourceCode.includes('@vue/')) {
      return 'Vue'
    }
    if (sourceCode.includes('from \'@angular/')) {
      return 'Angular'
    }
    return undefined
  }
}
