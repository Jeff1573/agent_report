# AST_Fast - Multi-Language MCP Server

🚀 **快速、强大的多语言代码分析 MCP Server，专为 Web3 和全栈开发优化**

## ✨ 特性

- 🌐 **Web3 语言支持**: Solidity, Rust, Go
- 💻 **后端语言支持**: Python, Java  
- 🎨 **前端语言支持**: TypeScript, JavaScript (React/Vue)
- ⚡ **高性能解析**: 基于 Tree-sitter 统一架构
- 🔍 **智能搜索**: 跨语言符号定位和代码提取
- 📊 **项目分析**: 语言统计、结构扫描、符号索引

## 🚀 快速开始

### 安装与构建
```bash
npm install
npm run build
```

### 基础测试（30秒验证）
```bash
npm test
```

### 启动 MCP Server
```bash
npm start
```

### 可视化测试
```bash
npm run test:inspector
```

## 📚 文档

- **📖 [demo-usage.md](./demo-usage.md)** - 完整使用指南和最佳实践
- **🧪 [manual-test.md](./manual-test.md)** - 详细的手动测试指南  
- **🔍 [test-with-inspector.md](./test-with-inspector.md)** - MCP Inspector 可视化测试

## 🛠️ 支持的语言

| 语言 | 扩展名 | 主要符号类型 | 适用场景 |
|------|--------|--------------|----------|
| **Solidity** | `.sol` | contract, function, event | 智能合约开发 |
| **Rust** | `.rs` | struct, impl, trait | Solana/Near 程序 |
| **Go** | `.go` | struct, func, interface | 区块链基础设施 |
| **Python** | `.py` | class, function | Web3 API/后端 |
| **Java** | `.java` | class, method | 企业级后端 |
| **TypeScript** | `.ts/.tsx` | interface, class | React DApp 前端 |
| **JavaScript** | `.js/.jsx` | function, class | Web 前端 |

## 🧪 MCP 工具

- `get_supported_languages` - 获取支持的语言列表
- `get_file_structure_summary` - 分析单个文件结构
- `get_project_structure_summary` - 扫描整个项目
- `get_code_block_for_symbol` - 提取符号代码块
- `find_symbol_definition_in_project` - 查找符号定义
- `find_symbols_by_type` - 按类型查找符号
- `get_project_language_stats` - 项目语言统计
- `build_symbol_index` - 构建符号索引
- `get_symbol_details` - 获取符号详细信息

## 📊 性能指标

- **小文件** (<5KB): ~50ms
- **中等文件** (5-15KB): ~200ms  
- **项目扫描** (10文件): ~500ms
- **内存占用**: ~100-200MB

## 🎯 使用场景

- **智能合约审计** - 分析 Solidity 合约结构
- **Web3 项目分析** - 跨语言代码理解  
- **代码搜索导航** - 快速定位符号和函数
- **项目技术栈分析** - 自动识别语言和框架

## 🔧 开发

```bash
# 开发模式
npm run dev

# 类型检查  
npm run typecheck

# 查看所有命令
npm run guide
```

## 📄 License

MIT License - 详见 [LICENSE](./LICENSE) 文件

---

**🎊 专为 Web3 和现代全栈开发设计的强大代码分析工具！**
