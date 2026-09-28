import React from 'react';
import { Layout, Space, Typography, Button, Segmented } from 'antd';
import { SettingOutlined, MenuFoldOutlined, DesktopOutlined, GithubOutlined } from '@ant-design/icons';
import { LocalRepoControls } from './LocalRepoControls.jsx';
import GithubControls from './GithubControls.jsx';
import { LayerSelector } from './LayerSelector.jsx';

const { Sider } = Layout;
const { Title } = Typography;

export function WorkspaceControlSidebar({
  leftCollapsed,
  setLeftCollapsed,
  onFolderDrop,
  sourceMode,
  onSourceModeChange,
  localProps,
  githubProps,
  layerProps,
}) {
  return (
    <Sider
      width={340}
      collapsible
      collapsed={leftCollapsed}
      collapsedWidth={0}
      trigger={null}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onFolderDrop}
      style={{
        background: '#161821',
        borderRight: leftCollapsed ? 'none' : '1px solid #232738',
        padding: leftCollapsed ? 0 : '20px',
        overflowY: 'auto',
        height: 'calc(100vh - 64px)',
        transition: 'all 0.2s',
      }}
    >
      {!leftCollapsed && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <Title level={5} style={{ margin: 0, color: '#f5f5f5', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SettingOutlined /> Repository Source
              </Title>
              <Button
                type="text"
                size="small"
                icon={<MenuFoldOutlined />}
                onClick={() => setLeftCollapsed(true)}
                title="Hide Controls (Left Panel)"
                style={{ color: '#94a3b8' }}
              />
            </div>

            <Segmented
              block
              options={[
                { label: 'Local Git', value: 'local', icon: <DesktopOutlined /> },
                { label: 'GitHub Cloud', value: 'github', icon: <GithubOutlined /> }
              ]}
              value={sourceMode}
              onChange={onSourceModeChange}
              style={{ marginBottom: '16px', background: '#0f1015' }}
            />

            {sourceMode === 'local' ? (
              <LocalRepoControls {...localProps} />
            ) : (
              <GithubControls {...githubProps} />
            )}
          </div>

          <LayerSelector {...layerProps} />
        </Space>
      )}
    </Sider>
  );
}
