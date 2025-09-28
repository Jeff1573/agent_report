import path from 'node:path'
import fg from 'fast-glob'
import fs from 'node:fs/promises'
import ignore from 'ignore'
import { Project, SyntaxKind } from 'ts-morph'

async function loadGitignore(projectPath: string) {
  try {
    const content = await fs.readFile(path.join(projectPath, '.gitignore'), 'utf8')
    return ignore().add(content)
  } catch {
    return ignore()
  }
}

export async function findSymbolDefinitionInProject(projectPath: string, symbolName: string) {
  const ig = await loadGitignore(projectPath)
  const entries = await fg(['**/*.{ts,tsx,js,jsx,mjs,cjs}'], {
    cwd: projectPath,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'out/**', '.git/**'],
  })

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

  const results: { filePath: string; symbolName: string; type: 'function' | 'class'; startLine: number }[] = []

  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    const abs = path.join(projectPath, rel)
    const sf = project.addSourceFileAtPath(abs)

    const posToLine = (pos: number) => sf.getLineAndColumnAtPos(pos).line

    const fn = sf.getFunction(symbolName)
    if (fn) results.push({ filePath: abs, symbolName, type: 'function', startLine: posToLine(fn.getStart()) })

    const cls = sf.getClass(symbolName)
    if (cls) results.push({ filePath: abs, symbolName, type: 'class', startLine: posToLine(cls.getStart()) })

    for (const vd of sf.getVariableDeclarations()) {
      if (vd.getName() !== symbolName) continue
      const init = vd.getInitializer()
      if (!init) continue
      const k = init.getKind()
      if (k === SyntaxKind.FunctionExpression || k === SyntaxKind.ArrowFunction) {
        results.push({ filePath: abs, symbolName, type: 'function', startLine: posToLine(init.getStart()) })
      }
    }
  }

  return results
}


