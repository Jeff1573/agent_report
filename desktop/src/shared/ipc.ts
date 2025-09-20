/**
 * 文件说明：集中管理 IPC 通道与类型，避免魔法字符串。
 * 仅暴露白名单通道，主/预加载/渲染三端共享此定义。
 */

/** IPC 通道常量（白名单） */
export const IPC_CHANNELS = {
  APP_VERSION: 'app/version'
} as const

/** 预加载向渲染暴露的受控 API 类型 */
export interface PreloadApi {
  app: {
    /** 获取应用版本号（来自主进程 app.getVersion） */
    getVersion: () => Promise<string>
  }
}

