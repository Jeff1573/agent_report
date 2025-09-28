import path from 'node:path'
import fg from 'fast-glob'
import ignore from 'ignore'
import fs from 'node:fs/promises'
import { Project, SyntaxKind } from 'ts-morph'

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

async function loadGitignore(projectPath: string) {
  try {
    const content = await fs.readFile(path.join(projectPath, '.gitignore'), 'utf8')
    return ignore().add(content)
  } catch {
    return ignore()
  }
}

function isCodeFile(filePath: string) {
  return CODE_EXTENSIONS.includes(path.extname(filePath).toLowerCase())
}

function addToTree(tree: any, relParts: string[], value: any) {
  let node = tree
  for (let i = 0; i < relParts.length - 1; i++) {
    const part = relParts[i]
    node[part] ||= {}
    node = node[part]
  }
  node[relParts[relParts.length - 1]] = value
}

export async function getProjectStructureSummary(projectPath: string) {
  const ig = await loadGitignore(projectPath)
  const entries = await fg(['**/*'], {
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
      module: 99, // ESNext
      target: 9, // ES2022
      jsx: 1, // Preserve
    },
  })

  const tree: any = {}

  for (const rel of entries) {
    if (ig.ignores(rel)) continue
    const abs = path.join(projectPath, rel)

    if (isCodeFile(abs)) {
      const sf = project.addSourceFileAtPath(abs)

      const symbols: string[] = []
      for (const f of sf.getFunctions()) symbols.push(f.getName() || 'anonymous_function')
      for (const c of sf.getClasses()) symbols.push(c.getName() || 'anonymous_class')
      for (const vd of sf.getVariableDeclarations()) {
        const init = vd.getInitializer()
        if (!init) continue
        const k = init.getKind()
        if (k === SyntaxKind.FunctionExpression || k === SyntaxKind.ArrowFunction) {
          symbols.push(vd.getName())
        }
      }

      addToTree(tree, rel.split('/'), { symbols })
    } else {
      // non-code file
      addToTree(tree, rel.split('/'), {})
    }
  }

  return tree
}


