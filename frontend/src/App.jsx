import React, { useState } from 'react';
import { Layout, ConfigProvider, theme } from 'antd';
import ChatbotDrawer from './ChatbotDrawer';
import WorkspaceShell from './WorkspaceShell';
import GithubConnectModal from './components/GithubConnectModal';
import { DiffViewport } from './components/DiffViewport';
import { EdgeCollapseTabs } from './components/EdgeCollapseTabs';
import { WorkspaceControlSidebar } from './components/WorkspaceControlSidebar';
import { WorkspaceAuditSidebar } from './components/WorkspaceAuditSidebar';
import { useWorkspaceState } from './useWorkspaceState.js';
import StudioApp from './studio/StudioApp.jsx';

const { Content } = Layout;

const THEME_CONFIG = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#fadb14',
    colorBgBase: '#0f1015',
    borderRadius: 6,
  },
};

const MODE_KEY = 'banana:mode';

function readMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'studio' ? 'studio' : 'diff';
  } catch {
    return 'diff';
  }
}

export default function App() {
  const ws = useWorkspaceState();
  const [mode, setMode] = useState(readMode);
  // once opened, the Studio stays mounted (a running assistant answer must survive a look at the Diff view)
  const [studioVisited, setStudioVisited] = useState(() => readMode() === 'studio');

  const changeMode = (next) => {
    setMode(next);
    if (next === 'studio') setStudioVisited(true);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };

  const openDiffFromStudio = (request) => {
    changeMode('diff');
    ws.openDiff(request);
  };

  return (
    <ConfigProvider theme={THEME_CONFIG}>
      <Layout style={{ minHeight: '100vh', background: '#0f1015' }}>
        <WorkspaceShell {...ws.shellProps} mode={mode} onModeChange={changeMode} />

        {studioVisited && (
          <div style={{ display: mode === 'studio' ? 'block' : 'none' }}>
            <StudioApp onOpenDiff={openDiffFromStudio} />
          </div>
        )}

        {/* The Diff layout stays mounted while the Studio is shown: its form and state must survive */}
        <Layout style={mode === 'diff' ? undefined : { display: 'none' }}>
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
