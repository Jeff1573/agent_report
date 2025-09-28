import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { getProjectStructureSummary } from './core/projectScanner.js'
import { getFileStructureSummary } from './core/fileAnalyzer.js'
import { getCodeBlockForSymbol } from './core/codeExtractor.js'
import { findSymbolDefinitionInProject } from './core/symbolLocator.js'

async function main() {
  const server = new McpServer({ name: 'ast-fast', version: '0.1.0' })

  server.tool(
    'get_project_structure_summary',
    'Scans the entire project directory to provide a high-level summary. Returns a tree-like JSON with directories, files and top-level functions/classes for code files.',
    { projectPath: z.string().describe('Absolute or workspace-relative project root path') },
    async ({ projectPath }) => {
      const json = await getProjectStructureSummary(projectPath)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  server.tool(
    'get_file_structure_summary',
    'Parses a single code file and returns its imports, exports, functions, and classes with their start/end line numbers.',
    { filePath: z.string().describe('Absolute or workspace-relative file path') },
    async ({ filePath }) => {
      const json = await getFileStructureSummary(filePath)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  server.tool(
    'get_code_block_for_symbol',
    'Extracts the full source code of a specific function or class from a file.',
    {
      filePath: z.string().describe('File path containing the symbol'),
      symbolName: z.string().describe('Function or class name'),
    },
    async ({ filePath, symbolName }) => {
      const code = await getCodeBlockForSymbol(filePath, symbolName)
      return { content: [{ type: 'text', text: code }] }
    }
  )

  server.tool(
    'find_symbol_definition_in_project',
    'Searches the entire project to find the definition of a function or class with a specific name.',
    {
      projectPath: z.string().describe('Project root path to scan'),
      symbolName: z.string().describe('Symbol to search for (function/class name)'),
    },
    async ({ projectPath, symbolName }) => {
      const json = await findSymbolDefinitionInProject(projectPath, symbolName)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})


