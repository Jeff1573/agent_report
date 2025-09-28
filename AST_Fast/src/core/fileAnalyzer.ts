import path from 'node:path'
import fs from 'node:fs/promises'
import { Project, SyntaxKind, Node } from 'ts-morph'

export async function getFileStructureSummary(filePath: string) {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      module: 99,
      target: 9,
      jsx: 1,
    },
  })

  const abs = path.resolve(filePath)
  const sourceFile = project.addSourceFileAtPath(abs)
  const text = sourceFile.getFullText()

  const posToLine = (pos: number) => sourceFile.getLineAndColumnAtPos(pos).line

  const imports = sourceFile.getImportDeclarations().map((imp) => {
    const source = imp.getModuleSpecifierValue()
    const defaultImport = imp.getDefaultImport()?.getText() || null
    const namespaceImport = imp.getNamespaceImport()?.getText() || null
    const specifiers = imp.getNamedImports().map((ni) => ni.getName())
    return { source, specifiers, default: defaultImport, namespace: namespaceImport }
  })

  const exportedDecls = sourceFile.getExportedDeclarations()
  const exports: { name: string; isDefault: boolean }[] = []
  for (const [name, decls] of exportedDecls) {
    for (const d of decls) {
      const isDefault = Node.isExportAssignment(d) ? true : 
        (Node.isModifierable(d) && 'getFirstModifierByKind' in d ? !!d.getFirstModifierByKind(SyntaxKind.DefaultKeyword) : false)
      exports.push({ name, isDefault })
    }
  }
  for (const ea of sourceFile.getExportAssignments()) {
    if (ea.isExportEquals()) continue
    exports.push({ name: 'default', isDefault: true })
  }

  const functions = sourceFile.getFunctions().map((fn) => ({
    name: fn.getName() || 'anonymous_function',
    startLine: posToLine(fn.getStart()),
    endLine: posToLine(fn.getEnd()),
  }))

  const classes = sourceFile.getClasses().map((cls) => ({
    name: cls.getName() || 'anonymous_class',
    startLine: posToLine(cls.getStart()),
    endLine: posToLine(cls.getEnd()),
  }))

  for (const vd of sourceFile.getVariableDeclarations()) {
    const init = vd.getInitializer()
    if (!init) continue
    const k = init.getKind()
    if (k === SyntaxKind.FunctionExpression || k === SyntaxKind.ArrowFunction) {
      const startLine = posToLine(init.getStart())
      const endLine = posToLine(init.getEnd())
      functions.push({ name: vd.getName(), startLine, endLine })
    }
  }

  return { filePath: abs, imports, exports, functions, classes }
}


