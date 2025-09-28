import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// 导入新的多语言解析器
import { getProjectStructureSummary, getProjectLanguageStats, quickProjectScan, deepProjectAnalysis } from './core/projectScanner-new.js'
import { getFileStructureSummary, getSupportedLanguages, isFileSupported } from './core/fileAnalyzer-new.js'
import { getCodeBlockForSymbol, getSymbolDetails, getFunctionSignature } from './core/codeExtractor-new.js'
import { findSymbolDefinitionInProject, findSymbolsByType, fuzzyFindSymbols, buildSymbolIndex } from './core/symbolLocator-new.js'

// 保留向后兼容性的导入
import { getProjectStructureSummary as getProjectStructureSummaryLegacy } from './core/projectScanner.js'
import { getFileStructureSummary as getFileStructureSummaryLegacy } from './core/fileAnalyzer.js'
import { getCodeBlockForSymbol as getCodeBlockForSymbolLegacy } from './core/codeExtractor.js'
import { findSymbolDefinitionInProject as findSymbolDefinitionInProjectLegacy } from './core/symbolLocator.js'

async function main() {
  const server = new McpServer({ name: 'ast-fast', version: '0.1.0' })

  server.tool(
    'get_project_structure_summary',
    'Scans the entire project directory to provide a high-level summary. Now supports Web3 languages (Solidity, Rust, Go) and backend languages (Python, Java) in addition to TypeScript/JavaScript.',
    { 
      projectPath: z.string().describe('Absolute or workspace-relative project root path'),
      mode: z.enum(['quick', 'deep']).optional().describe('Scan mode: quick (file stats only) or deep (full symbol analysis)')
    },
    async ({ projectPath, mode = 'deep' }) => {
      const json = mode === 'quick' ? 
        await quickProjectScan(projectPath) : 
        await getProjectStructureSummary(projectPath)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  server.tool(
    'get_file_structure_summary',
    'Parses a single code file and returns its imports, exports, functions, and classes. Now supports Solidity smart contracts, Rust, Go, Python, Java in addition to TypeScript/JavaScript.',
    { filePath: z.string().describe('Absolute or workspace-relative file path') },
    async ({ filePath }) => {
      if (!isFileSupported(filePath)) {
        throw new Error(`File type not supported: ${filePath}`)
      }
      const json = await getFileStructureSummary(filePath)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  server.tool(
    'get_code_block_for_symbol',
    'Extracts the full source code of a specific function, class, contract, or other symbol from a multi-language file.',
    {
      filePath: z.string().describe('File path containing the symbol'),
      symbolName: z.string().describe('Symbol name (function, class, contract, etc.)'),
      mode: z.enum(['full', 'signature']).optional().describe('Extract full code or just signature')
    },
    async ({ filePath, symbolName, mode = 'full' }) => {
      const code = mode === 'signature' ? 
        await getFunctionSignature(filePath, symbolName) :
        await getCodeBlockForSymbol(filePath, symbolName)
      return { content: [{ type: 'text', text: code }] }
    }
  )

  server.tool(
    'find_symbol_definition_in_project',
    'Searches the entire multi-language project to find symbol definitions. Supports exact match and fuzzy search.',
    {
      projectPath: z.string().describe('Project root path to scan'),
      symbolName: z.string().describe('Symbol to search for'),
      searchMode: z.enum(['exact', 'fuzzy']).optional().describe('Search mode: exact match or fuzzy search')
    },
    async ({ projectPath, symbolName, searchMode = 'exact' }) => {
      const json = searchMode === 'fuzzy' ?
        await fuzzyFindSymbols(projectPath, symbolName) :
        await findSymbolDefinitionInProject(projectPath, symbolName)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  // 新增工具：获取支持的语言信息
  server.tool(
    'get_supported_languages',
    'Returns information about all supported programming languages and their current implementation status.',
    {},
    async () => {
      const json = getSupportedLanguages()
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  // 新增工具：按类型查找符号
  server.tool(
    'find_symbols_by_type',
    'Finds all symbols of a specific type across the project (e.g., all functions, classes, contracts).',
    {
      projectPath: z.string().describe('Project root path to scan'),
      symbolType: z.string().describe('Symbol type: function, class, interface, struct, contract, enum, variable, constant')
    },
    async ({ projectPath, symbolType }) => {
      const json = await findSymbolsByType(projectPath, symbolType)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  // 新增工具：获取项目语言统计
  server.tool(
    'get_project_language_stats',
    'Returns detailed statistics about programming languages used in the project.',
    {
      projectPath: z.string().describe('Project root path to scan')
    },
    async ({ projectPath }) => {
      const json = await getProjectLanguageStats(projectPath)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  // 新增工具：构建符号索引
  server.tool(
    'build_symbol_index',
    'Builds a comprehensive index of all symbols in the project for fast lookup.',
    {
      projectPath: z.string().describe('Project root path to scan')
    },
    async ({ projectPath }) => {
      const json = await buildSymbolIndex(projectPath)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    }
  )

  // 新增工具：获取符号详细信息
  server.tool(
    'get_symbol_details',
    'Gets detailed information about a specific symbol including its code, metadata, and context.',
    {
      filePath: z.string().describe('File path containing the symbol'),
      symbolName: z.string().describe('Symbol name to get details for')
    },
    async ({ filePath, symbolName }) => {
      const json = await getSymbolDetails(filePath, symbolName)
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


