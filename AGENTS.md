# 仓库指南

## 项目结构与模块组织
- 根目录：Monorepo（NPM Workspaces），Node 22（见 `.nvmrc`）。
- 工作区：`desktop/`（Electron + React + TS）、`agent/`（Node.js + TS）。
- 常用目录：`desktop/src/{main,preload,renderer,shared}`、`agent/{api,services,tools,types,utils}`、`.workflow/`、`scripts/`、`logs/`。

## 构建、测试与开发命令
- 安装依赖（根）：`npm i`
- 开发（桌面端）：`npm run dev`（等同于 `-w ./desktop`）
- 构建（桌面端）：`npm run build`；Windows 打包：`npm run build:win`
- 类型检查：`npm run typecheck`（委托 `desktop` 子包）
- 代码检查：`npm run lint`
- 运行 Agent：`npm run start -w ./agent`（入口 `agent/index.ts`，ESM）
- 在子包内同名命令等价：例如 `cd desktop && npm run dev`

## 代码风格与命名约定
- EditorConfig：UTF-8、LF、`indent_size = 2`。
- Prettier：`singleQuote: true`、`semi: false`、`printWidth: 100`。
- ESLint：`@typescript-eslint`、`react`、`react-hooks`；TypeScript `strict: true`。
- 命名：文件/目录使用 `kebab-case`；类型/类用 `PascalCase`；常量 `UPPER_SNAKE_CASE`；变量/函数 `camelCase`。
- 导入规则：ESM 且必须置于文件顶部，禁止在代码块内动态导入。

## 测试规范
- 当前未定义统一 `test` 脚本；锁文件包含 Playwright 依赖，建议用于 E2E。
- 约定示例：单测 `tests/**/*.spec.ts`，端到端 `e2e/**/*.spec.ts`；（可选）在 `desktop/` 内执行 `npx playwright test`。
- 覆盖率建议：新模块 ≥80%，关键路径 ≥90%。

## 提交与 PR 规范
- 提交信息：建议采用 Conventional Commits（如 `feat: …`、`fix: …`、`chore: …`）。
- PR 要求：
  - 说明变更、影响范围与验证步骤，关联 Issue；
  - 附 UI 变更截图/录屏（如涉及 `desktop`）；
  - CI 前置自检：`npm run lint && npm run typecheck` 通过；不提交构建产物与私密文件。

## 安全与配置提示
- 机密：使用 `agent/.env` 本地管理，严禁提交仓库。
- 平台：Windows 打包依赖 electron-builder，首次安装会自动执行 `postinstall` 以拉取本机依赖。


# 严格遵守
- **普通问答**：如果是普通问答，不要修改代码，给出答案后，提出相应得方案供用户确认后再执行。
- **功能实现**：不要直接动代码，先把任务流程理清出，等待确认后在执行