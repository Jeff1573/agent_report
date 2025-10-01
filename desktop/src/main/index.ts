import { app, shell, BrowserWindow, ipcMain, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'
import { watch, type FSWatcher, readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '../shared/ipc'
import * as settingsService from './services/settingsService'
import * as agentService from './services/agentService'
import * as historyService from './services/historyService'

// MCP 配置文件监听器
let mcpConfigWatcher: FSWatcher | null = null
let reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null
let lastMcpConfigHash: string | null = null

/**
 * 计算 MCP 配置文件的内容哈希。
 * 说明：采用原始字节的 SHA-256 哈希，任何内容变化（包括空白/换行）都会产生不同哈希。
 *
 * @param filePath 配置文件绝对路径
 * @returns 哈希字符串（hex）或 null（文件不存在）
 */
function computeMcpConfigHash(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null
    const buf = readFileSync(filePath)
    const h = createHash('sha256')
    h.update(buf)
    return h.digest('hex')
  } catch (e) {
    console.warn('[Main] 读取 MCP 配置计算哈希失败：', e)
    return null
  }
}

/**
 * 监听 MCP 配置文件变化，自动重新加载 Agent Runtime
 */
function watchMCPConfig(): void {
  const mcpConfigPath = join(app.getPath('userData'), 'mcp.json')

  /**
   * 尝试关闭已有 watcher。
   */
  function closeWatcher(): void {
    if (mcpConfigWatcher) {
      try {
        mcpConfigWatcher.close()
      } catch (e) {
        // 忽略 watcher 关闭时的异常（可能已被系统回收）
      }
      mcpConfigWatcher = null
    }
  }

  /**
   * 执行内容变更检查并在不同哈希时触发重载。
   */
  async function checkAndReloadIfChanged(reason: 'change' | 'rename'): Promise<void> {
    // 防抖：延迟 1.5s 汇聚多次写入/原子替换
    if (reloadDebounceTimer) clearTimeout(reloadDebounceTimer)
    reloadDebounceTimer = setTimeout(async () => {
      const currentHash = computeMcpConfigHash(mcpConfigPath)
      if (!currentHash) {
        console.warn('[Main] MCP 配置不存在或读取失败，跳过本次检查')
        return
      }
      if (lastMcpConfigHash && currentHash === lastMcpConfigHash) {
        console.log(`[Main] MCP 配置${reason}事件触发，但内容未变化，已忽略。`)
        return
      }

      // 更新基准哈希并尝试重载
      lastMcpConfigHash = currentHash
      console.log(`[Main] 检测到 MCP 配置内容变化（来源: ${reason}），开始重新加载 Agent Runtime...`)
      try {
        await agentService.reloadRuntime()
        console.log('[Main] Agent Runtime 重新加载成功')
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('mcp-config-reloaded', { success: true })
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('[Main] Agent Runtime 重新加载失败:', errorMsg)
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('mcp-config-reloaded', { success: false, error: errorMsg })
        })
      }
    }, 1500)
  }

  /**
   * 创建并启动文件监听；在 rename 后可调用以重建 watcher。
   */
  function startWatching(): void {
    // 初始化一次哈希作为基线，避免应用启动后第一次 change 即误报
    lastMcpConfigHash = computeMcpConfigHash(mcpConfigPath)

    try {
      closeWatcher()
      mcpConfigWatcher = watch(mcpConfigPath, (eventType) => {
        const type = eventType as 'change' | 'rename'
        if (type === 'change') {
          void checkAndReloadIfChanged('change')
        } else if (type === 'rename') {
          // rename 常见于编辑器原子保存；
          // 1) 立即检查内容是否变化；2) 轻微延时后重建 watcher（旧句柄可能失效）。
          void checkAndReloadIfChanged('rename')
          setTimeout(() => {
            // 文件可能被替换/短暂不存在，存在后再重建
            if (existsSync(mcpConfigPath)) {
              console.log('[Main] 检测到 MCP 配置文件 rename，正在重建监听器...')
              startWatching()
            } else {
              // 若仍不存在，稍后再次尝试（最多一次）
              setTimeout(() => {
                if (existsSync(mcpConfigPath)) {
                  console.log('[Main] MCP 配置文件已恢复，重建监听器...')
                  startWatching()
                }
              }, 500)
            }
          }, 200)
        }
      })
      console.log('[Main] MCP 配置文件监听已启动:', mcpConfigPath)
    } catch (error) {
      console.warn('[Main] 无法监听 MCP 配置文件:', error)
    }
  }

  startWatching()
}

function createWindow(): void {
  // 获取应用图标 - 使用 app.isPackaged 判断是否为开发模式
  const isDev = !app.isPackaged
  let appIcon: NativeImage | string
  
  if (isDev) {
    // 开发模式：从项目根目录构建绝对路径
    // app.getAppPath() 在开发模式下指向项目的 desktop 目录
    const projectRoot = app.getAppPath()
    const iconPath = join(projectRoot, 'build/icon.png')
    
    console.log('[Icon Debug] 项目根目录:', projectRoot)
    console.log('[Icon Debug] 图标绝对路径:', iconPath)
    
    appIcon = nativeImage.createFromPath(iconPath)
    console.log('[Icon Debug] 图标是否为空:', appIcon.isEmpty())
    
    if (!appIcon.isEmpty()) {
      console.log('[Icon Debug] 图标大小:', appIcon.getSize())
    } else {
      console.warn('[Icon Warning] 图标加载失败，使用默认图标')
    }
  } else {
    // 生产模式：使用打包后的资源
    appIcon = join(__dirname, '../../resources/icon.png')
  }

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 600,    // 最小宽度
    minHeight: 500,   // 最小高度
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f0f2f5',  // 设置背景色，避免黑色闪烁
    icon: appIcon,
    // 安全基线：禁用 Node、启用上下文隔离，仅通过 preload 暴露受控 API
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  console.log('mainWindow created');

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // 在开发模式下设置 Dock 图标（仅 macOS）
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    const iconPath = join(app.getAppPath(), 'build/icon.png')
    const dockIcon = nativeImage.createFromPath(iconPath)
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon)
      console.log('[Icon Debug] Dock 图标已设置:', iconPath)
    } else {
      console.warn('[Icon Warning] Dock 图标加载失败')
    }
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC 白名单：应用版本
  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion())

  // IPC 白名单：Agent 相关
  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (_event, message: string, options) => {
    return agentService.chat(message, options)
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT_STREAM, async (event, message: string, callbackChannel: string, options) => {
    await agentService.chatStream(
      message,
      (streamEvent) => {
        // 通过回调通道发送事件给渲染进程
        event.sender.send(callbackChannel, streamEvent)
      },
      options
    )
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_STOP, async () => {
    await agentService.stopChat()
  })

  // IPC 白名单：会话历史相关
  ipcMain.handle(IPC_CHANNELS.HISTORY_SAVE, async (_event, session) => {
    await historyService.saveSession(session)
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_LOAD, async (_event, sessionId: string) => {
    return historyService.loadSession(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_LIST, async () => {
    return historyService.listSessions()
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_DELETE, async (_event, sessionId: string) => {
    await historyService.deleteSession(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, async (_event, excludeSessionId?: string) => {
    return historyService.clearSessions(excludeSessionId)
  })

  // IPC 白名单：设置（模型配置）相关
  ipcMain.handle(IPC_CHANNELS.SETTINGS_MODEL_LIST, async () => {
    return settingsService.listModelConfigs()
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_MODEL_GET_ACTIVE, async () => {
    return settingsService.getActiveModelConfig()
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_MODEL_SET_ACTIVE, async (_event, id: string) => {
    await settingsService.setActiveModelConfig(id)
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_MODEL_UPSERT, async (_event, config) => {
    await settingsService.upsertModelConfig(config)
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_MODEL_DELETE, async (_event, id: string) => {
    await settingsService.deleteModelConfig(id)
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_MODEL_VALIDATE_STREAMING, async (_event, modelId: string) => {
    return settingsService.validateModelStreaming(modelId)
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_EXPORT, async () => {
    return settingsService.exportSettings()
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_IMPORT, async (_event, json: string) => {
    await settingsService.importSettings(json)
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_OPEN_APP_DATA_FILE, async (_event, filename: string) => {
    return settingsService.openAppDataFile(filename)
  })

  createWindow()

  // 启动 MCP 配置文件监听
  watchMCPConfig()

  // 在不阻塞 UI 的情况下预热 Agent Runtime（懒加载提前完成）
  setTimeout(() => {
    // 将用户数据目录暴露给 agent 侧（供 settings-bridge 读取）
    try {
      process.env.MF_USER_DATA_DIR = app.getPath('userData')
    } catch (e) {
      console.warn('[AgentService] 无法设置 MF_USER_DATA_DIR', e)
    }
    agentService.warmup().catch(err => console.warn('[AgentService] warmup failed', err))
  }, 0)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前清理资源
app.on('before-quit', async () => {
  await agentService.cleanup()
  // 停止文件监听
  if (mcpConfigWatcher) {
    mcpConfigWatcher.close()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
