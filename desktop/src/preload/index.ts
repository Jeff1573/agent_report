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
  },
  history: {
    save: (session) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_SAVE, session),
    load: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LOAD, sessionId),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LIST),
    delete: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_DELETE, sessionId),
    clear: (excludeSessionId) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEAR, excludeSessionId)
  },
  settings: {
    modelList: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_MODEL_LIST),
    getActiveModel: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_MODEL_GET_ACTIVE),
    setActiveModel: (id) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_MODEL_SET_ACTIVE, id),
    upsertModel: (config) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_MODEL_UPSERT, config),
    deleteModel: (id) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_MODEL_DELETE, id),
    validateStreaming: (modelId) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_MODEL_VALIDATE_STREAMING, modelId),
    exportSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_EXPORT),
    importSettings: (json) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_IMPORT, json),
    openMcpConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_OPEN_MCP_CONFIG),
    openConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_OPEN_CONFIG)
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
