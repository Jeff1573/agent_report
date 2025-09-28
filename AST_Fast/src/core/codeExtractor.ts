import path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'

export async function getCodeBlockForSymbol(filePath: string, symbolName: string) {
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
  const fullText = sourceFile.getFullText()

  const fn = sourceFile.getFunction(symbolName)
  if (fn) return fullText.slice(fn.getStart(), fn.getEnd())

  const cls = sourceFile.getClass(symbolName)
  if (cls) return fullText.slice(cls.getStart(), cls.getEnd())

  for (const vd of sourceFile.getVariableDeclarations()) {
    if (vd.getName() !== symbolName) continue
    const init = vd.getInitializer()
    if (!init) continue
    const k = init.getKind()
    if (k === SyntaxKind.FunctionExpression || k === SyntaxKind.ArrowFunction) {
      return fullText.slice(init.getStart(), init.getEnd())
    }
  }

  throw new Error(`Symbol not found: ${symbolName}`)
}


