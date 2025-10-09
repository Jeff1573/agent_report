import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
      const handler = (_event: IpcRendererEvent, event: AgentStreamEvent) => {
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
    openAppDataFile: (filename) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_OPEN_APP_DATA_FILE, filename),
    // RAG 相关
    ragList: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RAG_LIST),
    ragGetDefault: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RAG_GET_DEFAULT),
    ragUpsert: (cfg) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RAG_UPSERT, cfg),
    ragDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RAG_DELETE, id),
    ragSetDefault: (id) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RAG_SET_DEFAULT, id),
    ragToggleEnabled: (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RAG_TOGGLE_ENABLED, id, enabled),
    ragValidate: (cfg) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RAG_VALIDATE, cfg),
    ragImportFile: (cfgId, filePath, collection, split) => ipcRenderer.invoke(IPC_CHANNELS.RAG_IMPORT_FILE, cfgId, filePath, collection, split),
    ragImportDir: (cfgId, dirPath, collection, split) => ipcRenderer.invoke(IPC_CHANNELS.RAG_IMPORT_DIR, cfgId, dirPath, collection, split)
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
