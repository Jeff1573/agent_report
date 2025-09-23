# Repository Guidelines

<!-- encoding: UTF-8 -->

## 项目结构与模块组织
- `src/`：核心业务与模块边界；子目录按领域命名（如 `core/`, `features/`, `infra/`).
- `tests/`：单元/集成测试，镜像 `src/` 结构。
- `scripts/`：构建/发布脚本（只放可重复执行的自动化）。
- `assets/`：静态资源；大型二进制请用外部存储并保留占位符。
- `.workflow/`：工作流与任务拆分文档（见仓库规范）。

## 构建、测试与本地开发
- 使用 `npm`。先查根目录 `package.json` 或 `Makefile`。
- 常用命令（示例）：
  - `npm ci`：安装依赖（CI/可复现）；本地可用 `npm install`。
  - `npm run dev`：本地启动/热更新。
  - `npm run build`：生产构建产物输出到 `dist/`。
  - `npm test`：运行测试；`npm test -- --coverage` 生成覆盖率。
  - `npm run lint` / `npm run format`：静态检查与格式化。

## 编码风格与命名约定
- 缩进：TS/JS 2 空格；JSON/YAML 2 空格。
- 统一 ESM：所有导入必须置于文件顶部；禁止动态导入除非必要。
- 命名：类型/类 `PascalCase`，函数/变量 `camelCase`，常量 `UPPER_SNAKE_CASE`，文件 `kebab-case`。
- 工具：若存在配置，必须通过 ESLint + Prettier；提交前本地执行 `pnpm lint`。

## 测试规范
- 测试框架以仓库配置为准（如 Vitest/Jest）。
- 命名：`*.test.ts` 或 `*.spec.ts`，与被测文件同名同路径。
- 目标：语句/分支覆盖率≥80%，关键路径需边界用例与错误用例。

## 提交与 Pull Request
- 提交遵循 Conventional Commits：`feat|fix|docs|refactor|test|chore(scope): summary`。
- PR 需：变更说明、关联 Issue、测试证据（覆盖率或截图）、影响评估与回滚方案。
- 小步提交，避免在同一 PR 中混入无关重构。

## 安全与配置
- 机密信息仅存放于 `.env`；提供 `.env.example`；严禁提交真实密钥。
- 依赖最小化；新增依赖需说明来源与用途。

## Agent 指南（本文件适用范围：全仓库）
- 最小变更原则；保持模块边界与现有风格一致。
- 公共 API 必写文档注释；新增文件使用 UTF-8。
- 修改后可运行、可测试、可回滚；必要时在 `.workflow/` 中登记任务与状态。

## 环境变量设置
- agent目录下的所有的环境变量统一从`agent/config/env.ts`中导入导出。