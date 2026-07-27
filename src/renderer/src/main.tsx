import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.js'
import './styles.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('应用根节点不存在。')

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#245a8d',
          colorInfo: '#245a8d',
          colorSuccess: '#2f6f4e',
          colorWarning: '#9a6700',
          colorError: '#b42318',
          borderRadius: 5,
          fontFamily:
            '"PingFang SC", "Microsoft YaHei", "SupportPack Sans SC", "Source Han Sans SC", SimSun, sans-serif',
        },
        components: {
          Button: { controlHeight: 30 },
          Input: { controlHeight: 30 },
          Tree: { nodeHoverBg: '#edf3f8', nodeSelectedBg: '#dceaf6' },
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
)
