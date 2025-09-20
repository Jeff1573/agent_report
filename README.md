# MindForge 工作区使用说明（npm Workspaces）

> 文档说明：本仓库在根目录启用 npm Workspaces，以便统一安装依赖、在根目录运行各子包脚本。文件编码：UTF-8。

## 环境要求
- Node：建议与团队统一（当前仓库 `engines` 为 `>=20 <21`；本机 `.nvmrc` 为 `22`，请在团队内确认后统一）。
- npm：10.x（本仓库 `packageManager` 记录为 `npm@10.9.2`）。

## 目录结构
- `desktop/`：Electron + React 工作区
- `packages/*`：未来新增的库/应用工作区

## 安装
- 一次性安装全部工作区依赖（在仓库根目录）：
  ```sh
  npm install
  ```
  生成根级 `package-lock.json` 并自动联结所有工作区。

## 常用命令（根目录执行）
- 仅运行 `desktop` 工作区：
  ```sh
  npm run dev -w ./desktop
  npm run build -w ./desktop
  npm run typecheck -w ./desktop
  npm run lint -w ./desktop
  ```
- 批量运行全部工作区（忽略未定义脚本）：
  ```sh
  npm run dev:all
  npm run build:all
  npm run typecheck:all
  npm run lint:all
  npm run test:all
  ```
  说明：根脚本不会被 `--workspaces` 自动包含，若需要把根脚本也并入，请在命令末尾追加 `--include-workspace-root`。

## 依赖管理
- 向指定工作区添加依赖：
  ```sh
  npm install <pkg> -w ./desktop
  npm install <pkg> -w ./packages/<name>
  ```
- 仅在某工作区执行安装脚本：
  ```sh
  npm install -w ./desktop
  ```

## 新建工作区
- 直接创建并登记到根 `workspaces`：
  ```sh
  npm init -w packages/<new-package>
  ```
  将自动创建目录与 `package.json`，并写入根的 `workspaces`。

## 常见问题
- 批量运行顺序：遵循根 `package.json` 中 `workspaces` 数组的声明顺序。
- 根脚本未参与批量：默认不包含，需加 `--include-workspace-root`。
- Node 版本不一致警告：若与 `engines` 不匹配，npm 仅警告（除非启用 engine-strict）。建议团队统一 Node 版本以减少锁文件漂移。

## 参考文档（官方）
- Using npm Workspaces（v11）
- npm run（`--workspaces`、`--workspace/-w`、`--if-present`、`--include-workspace-root`）
- npm init（`npm init -w <dir>` 创建工作区）

