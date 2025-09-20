/**
 * 文件说明：为渲染端全局 window 注入的 API 提供类型声明。
 */
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { PreloadApi } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: PreloadApi
  }
}

export {}

