## MindForge Agent（Electron + React 18 + TypeScript + antd）

本项目提供基于 Electron（electron-vite）+ React 18 + TypeScript + antd 的桌面端脚手架，支持 Windows 打包（NSIS）。

### 1. 开发环境与准备

- Node.js：使用全局 Node.js LTS v22（建议 22.x）。不再内置本地 Node，可通过 nvm 管理：`nvm use 22`。
- 包管理器：npm（使用系统全局安装）。
- 平台建议：
  - 开发与运行验证：Windows 宿主或带完整 GUI 的 Linux 桌面环境。
  - Linux 容器/WSL：可执行编译与打包，但运行 Electron 可能缺少 GUI 依赖（如 `libnspr4.so`）。

### 2. 目录结构

- `src/main`：主进程代码（入口：`src/main/index.ts`）。
- `src/preload`：预加载脚本，通过 `contextBridge` 暴露受控 API（入口：`src/preload/index.ts`）。
- `src/renderer`：渲染层（React 18 + antd），入口：`index.html` + `src/renderer/src/main.tsx`。
- `src/shared`：三端共享类型与常量（如 IPC 通道与接口）。
- 构建产物：`out/`（electron-vite 输出），安装包产物：`dist/`（electron-builder）。

### 3. 常用命令（在 `desktop/` 内）

- 安装依赖：`npm ci`（首次或切换平台建议使用）或 `npm install`
- 启动开发（HMR）：`npm run dev`
- 类型检查：`npm run typecheck`
- 代码检查：`npm run lint`
- 生产构建：`npm run build`
- Windows 打包（NSIS）：`npm run build:win`

### 4. 运行与调试

- 开发模式（`npm run dev`）会同时启动 main/preload/renderer 的 HMR/热重载。
- 渲染层入口根节点为 `#root`（见 `src/renderer/index.html`），React 18 使用 `createRoot`。
- 打开 DevTools：默认支持通过快捷键（F12）在开发模式下打开（`@electron-toolkit/utils`）。

### 5. 安全基线与 IPC

- 主窗口 `webPreferences`：`contextIsolation: true`、`nodeIntegration: false`，仅通过 preload 暴露 API。
- 白名单 IPC 与类型集中于 `src/shared/ipc.ts`。
- 示例：
  - 主进程注册：`ipcMain.handle('app/version', () => app.getVersion())`。
  - 预加载暴露：`window.api.app.getVersion()`（内部走 `ipcRenderer.invoke`）。
  - 渲染层调用示例：见 `src/renderer/src/react/App.tsx`（点击按钮展示版本）。

### 6. 打包（Windows / NSIS）

- 配置文件：`electron-builder.yml`
  - `appId: com.mindforge.desktop`
  - `productName: MindForge Agent`
  - `win.target: nsis`
  - `nsis.artifactName: ${productName}-${version}-setup.${ext}`
- 生成安装包：`npm run build:win`
- 产物位置：`dist/` 目录。
- 代码签名/自动更新：本项目未启用，若需要可参考 electron-builder 文档与 `publish` 配置。

### 7. WSL / Linux 容器注意事项

- 运行 Electron 需要宿主具备 GUI 与相关系统库；在容器内通常缺失，如 `libnspr4.so`。
- 建议在 Windows 宿主或完整 Linux 桌面执行 `npm run dev` 验证三进程与 HMR。
- 仅做构建/打包可在容器内完成。

### 8. 常见问题（FAQ）

- esbuild/Node 版本冲突：统一使用 Node 22 LTS；如仍异常，可通过 `overrides.esbuild` 固定版本，并在切换平台后执行 `npm rebuild`。
- 依赖安装慢或失败：检查网络代理，或切换官方/镜像源；electron 二进制下载可配置镜像（见 `electron-builder.yml` 的 `electronDownload.mirror`）。
- antd 样式：v5 使用 CSS-in-JS，默认无需 less 配置；如需主题自定义可结合 Token 系统与 `ConfigProvider`。

### 9. 约定与风格

- 全量 TypeScript 严格模式；公共 API 与关键模块包含中文注释（为何/约束/边界）。
- 渲染层只通过白名单 IPC 获取主进程能力，禁止直接引入 Node API。
