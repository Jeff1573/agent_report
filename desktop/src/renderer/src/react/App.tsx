/**
 * 文件说明：渲染进程 React 根组件，接入 antd 做基础验证。
 * 约束：仅演示基础交互，不包含状态管理/路由，后续可按需扩展。
 */
import React, { useState } from 'react'
import { Button, ConfigProvider, App as AntApp } from 'antd'

export const App: React.FC = () => {
  const [version, setVersion] = useState<string>('')

  const handleGetVersion = async (): Promise<void> => {
    const v = await window.api.app.getVersion()
    setVersion(v)
  }

  return (
    <ConfigProvider>
      <AntApp>
        <div style={{ padding: 24 }}>
          <h1>Electron + React 18 + antd</h1>
          <p>验证渲染层 React/TypeScript 与 antd 样式是否正常。</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button type="primary" onClick={handleGetVersion}>
              获取应用版本
            </Button>
            {version && <span>当前版本：{version}</span>}
          </div>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}
