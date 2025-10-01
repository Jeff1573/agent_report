import { app, shell, BrowserWindow, ipcMain, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'
import { watch, type FSWatcher } from 'fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '../shared/ipc'
import * as settingsService from './services/settingsService'
import * as agentService from './services/agentService'
import * as historyService from './services/historyService'

// MCP 配置文件监听器
let mcpConfigWatcher: FSWatcher | null = null
let reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 监听 MCP 配置文件变化，自动重新加载 Agent Runtime
 */
function watchMCPConfig(): void {
  const mcpConfigPath = join(app.getPath('userData'), 'mcp.json')
  
  try {
    mcpConfigWatcher = watch(mcpConfigPath, (eventType) => {
      if (eventType === 'change') {
        console.log('[Main] 检测到 MCP 配置文件变化')
        
        // 防抖处理：延迟 1.5 秒执行，避免频繁重载
        if (reloadDebounceTimer) {
          clearTimeout(reloadDebounceTimer)
        }
        
        reloadDebounceTimer = setTimeout(async () => {
          console.log('[Main] 开始重新加载 Agent Runtime...')
          
          try {
            await agentService.reloadRuntime()
            console.log('[Main] Agent Runtime 重新加载成功')
            
            // 通知所有渲染进程
            BrowserWindow.getAllWindows().forEach(win => {
              win.webContents.send('mcp-config-reloaded', { success: true })
            })
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            console.error('[Main] Agent Runtime 重新加载失败:', errorMsg)
            
            // 通知所有渲染进程
            BrowserWindow.getAllWindows().forEach(win => {
              win.webContents.send('mcp-config-reloaded', { 
                success: false, 
                error: errorMsg 
              })
            })
          }
        }, 1500) // 1.5 秒防抖
      }
    })
    
    console.log('[Main] MCP 配置文件监听已启动:', mcpConfigPath)
  } catch (error) {
    console.warn('[Main] 无法监听 MCP 配置文件:', error)
  }
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
