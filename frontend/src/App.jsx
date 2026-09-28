import React from 'react';
import { Layout, ConfigProvider, theme } from 'antd';
import ChatbotDrawer from './ChatbotDrawer';
import WorkspaceShell from './WorkspaceShell';
import GithubConnectModal from './components/GithubConnectModal';
import { DiffViewport } from './components/DiffViewport';
import { EdgeCollapseTabs } from './components/EdgeCollapseTabs';
import { WorkspaceControlSidebar } from './components/WorkspaceControlSidebar';
import { WorkspaceAuditSidebar } from './components/WorkspaceAuditSidebar';
import { useWorkspaceState } from './useWorkspaceState.js';

const { Content } = Layout;

const THEME_CONFIG = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#fadb14',
    colorBgBase: '#0f1015',
    borderRadius: 6,
  },
};

export default function App() {
  const ws = useWorkspaceState();

  return (
    <ConfigProvider theme={THEME_CONFIG}>
      <Layout style={{ minHeight: '100vh', background: '#0f1015' }}>
        <WorkspaceShell {...ws.shellProps} />

        <Layout>
          <WorkspaceControlSidebar {...ws.sidebarProps} />

          <Content style={{
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            height: 'calc(100vh - 64px)',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <EdgeCollapseTabs {...ws.edgeTabsProps} />
            <DiffViewport {...ws.viewportProps} />
          </Content>

          <WorkspaceAuditSidebar {...ws.auditProps} />
        </Layout>

        <ChatbotDrawer {...ws.copilotProps} />
        <GithubConnectModal {...ws.githubModalProps} />
      </Layout>
    </ConfigProvider>
  );
}
