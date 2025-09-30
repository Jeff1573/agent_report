import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS, type PreloadApi, type AgentStreamEvent } from '../shared/ipc'

// 通过受控白名单向渲染端暴露 API
const api: PreloadApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION)
  },
  agent: {
    chat: (message, options) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CHAT, message, options),
    chatStream: (message, onEvent, options) => {
      // 为每次调用生成唯一的回调通道
      const callbackChannel = `${IPC_CHANNELS.AGENT_CHAT_STREAM}-callback-${Date.now()}`
      
      // 注册事件监听器
      const handler = (_event: Electron.IpcRendererEvent, event: AgentStreamEvent) => {
        onEvent(event)
      }
      ipcRenderer.on(callbackChannel, handler)
      
      // 发送请求
      return ipcRenderer.invoke(IPC_CHANNELS.AGENT_CHAT_STREAM, message, callbackChannel, options)
        .finally(() => {
          // 清理监听器
          ipcRenderer.removeListener(callbackChannel, handler)
        })
    },
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_STOP)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
