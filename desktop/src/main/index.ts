import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC_CHANNELS } from '../shared/ipc'
import * as agentService from './services/agentService'
import * as historyService from './services/historyService'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 600,    // 最小宽度
    minHeight: 500,   // 最小高度
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f0f2f5',  // 设置背景色，避免黑色闪烁
    icon,
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
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
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

  createWindow()

  // 在不阻塞 UI 的情况下预热 Agent Runtime（懒加载提前完成）
  setTimeout(() => {
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
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
