import path from 'node:path'
import { defaultParserFactory } from './parsers/factory.js'
import { readFileContent } from './parsers/base/utils.js'

/**
 * 新的代码提取器 - 支持多语言
 */

export async function getCodeBlockForSymbol(filePath: string, symbolName: string): Promise<string> {
  const absolutePath = path.resolve(filePath)
  
  // 获取适当的解析器
  const parser = defaultParserFactory.getParserByFileExtension(absolutePath)
  
  if (!parser) {
    throw new Error(`No parser available for file: ${filePath}`)
  }
  
  // 解析文件获取符号信息
  const result = await parser.parseFile(absolutePath)
  
  // 查找指定的符号
  const symbol = result.symbols.find(s => s.name === symbolName)
  
  if (!symbol) {
    throw new Error(`Symbol not found: ${symbolName}`)
  }
  
  // 读取源代码
  const sourceCode = await readFileContent(absolutePath)
  
  // 根据符号的范围提取代码块
  const lines = sourceCode.split('\n')
  const startLine = Math.max(0, symbol.range.start.line - 1) // 转为 0 基索引
  const endLine = Math.min(lines.length - 1, symbol.range.end.line - 1)
  
  return lines.slice(startLine, endLine + 1).join('\n')
}

/**
 * 获取符号的详细信息（包括代码和元数据）
 */
export async function getSymbolDetails(filePath: string, symbolName: string) {
  const absolutePath = path.resolve(filePath)
  const parser = defaultParserFactory.getParserByFileExtension(absolutePath)
  
  if (!parser) {
    throw new Error(`No parser available for file: ${filePath}`)
  }
  
  const result = await parser.parseFile(absolutePath)
  const symbol = result.symbols.find(s => s.name === symbolName)
  
  if (!symbol) {
    throw new Error(`Symbol not found: ${symbolName}`)
  }
  
  const code = await getCodeBlockForSymbol(filePath, symbolName)
  
  return {
    symbol,
    code,
    filePath: absolutePath,
    language: result.language,
    metadata: result.metadata
  }
}

/**
 * 获取文件中的所有符号及其代码
 */
export async function getAllSymbolsWithCode(filePath: string) {
  const absolutePath = path.resolve(filePath)
  const parser = defaultParserFactory.getParserByFileExtension(absolutePath)
  
  if (!parser) {
    throw new Error(`No parser available for file: ${filePath}`)
  }
  
  const result = await parser.parseFile(absolutePath)
  const sourceCode = await readFileContent(absolutePath)
  const lines = sourceCode.split('\n')
  
  return result.symbols.map(symbol => {
    const startLine = Math.max(0, symbol.range.start.line - 1)
    const endLine = Math.min(lines.length - 1, symbol.range.end.line - 1)
    const code = lines.slice(startLine, endLine + 1).join('\n')
    
    return {
      symbol,
      code,
      range: symbol.range
    }
  })
}

/**
 * 按符号类型提取代码块
 */
export async function getSymbolsByType(filePath: string, symbolType: string) {
  const absolutePath = path.resolve(filePath)
  const parser = defaultParserFactory.getParserByFileExtension(absolutePath)
  
  if (!parser) {
    throw new Error(`No parser available for file: ${filePath}`)
  }
  
  const result = await parser.parseFile(absolutePath)
  const filteredSymbols = result.symbols.filter(s => s.type === symbolType)
  
  const symbolsWithCode = []
  for (const symbol of filteredSymbols) {
    const code = await getCodeBlockForSymbol(filePath, symbol.name)
    symbolsWithCode.push({
      symbol,
      code
    })
  }
  
  return symbolsWithCode
}

/**
 * 提取函数签名（不包括函数体）
 */
export async function getFunctionSignature(filePath: string, functionName: string): Promise<string> {
  const details = await getSymbolDetails(filePath, functionName)
  
  if (details.symbol.type !== 'function') {
    throw new Error(`Symbol ${functionName} is not a function`)
  }
  
  // 对于不同语言，提取函数签名的逻辑可能不同
  const lines = details.code.split('\n')
  
  switch (details.language) {
    case 'typescript':
    case 'javascript':
      // 查找函数声明行
      return lines.find(line => 
        line.includes('function') || 
        line.includes('=>') ||
        line.includes(`${functionName}(`)
      ) || lines[0]
      
    case 'python':
      // 查找 def 开头的行
      return lines.find(line => line.trim().startsWith('def ')) || lines[0]
      
    case 'java':
      // 查找包含函数名和参数的行
      return lines.find(line => 
        line.includes(functionName) && line.includes('(')
      ) || lines[0]
      
    case 'go':
      // 查找 func 开头的行
      return lines.find(line => line.trim().startsWith('func ')) || lines[0]
      
    case 'rust':
      // 查找 fn 开头的行
      return lines.find(line => line.trim().startsWith('fn ')) || lines[0]
      
    case 'solidity':
      // 查找 function 开头的行
      return lines.find(line => line.trim().startsWith('function ')) || lines[0]
      
    default:
      return lines[0]
  }
}


