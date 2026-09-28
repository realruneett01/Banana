import React from 'react';
import {
  Space,
  Button,
  Tag,
  Typography,
  Badge,
  Tooltip,
  Avatar
} from 'antd';
import {
  FileSearchOutlined,
  RobotOutlined,
  GithubOutlined
} from '@ant-design/icons';

const { Title } = Typography;

const BANANA_GRADIENT = 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)';
const BANANA_GLOW = '0 0 12px rgba(250, 219, 20, 0.45)';
const BUTTON_HEIGHT = '32px';

function BrandLogo() {
  return (
    <Space size="large" align="center">
      <Space size="small" align="center">
        <div style={{
          width: 32,
          height: 32,
          background: BANANA_GRADIENT,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'bold',
          color: '#000',
          fontSize: 16,
          boxShadow: BANANA_GLOW
        }}>
          🍌
        </div>
        <div>
          <Title level={5} style={{ margin: 0, color: '#fff', lineHeight: 1.2, fontWeight: 700 }}>
            Banana 2.0
          </Title>
          <div style={{ fontSize: '10px', color: '#8890a6', lineHeight: 1, letterSpacing: '0.4px' }}>
            Visual Hardware Diff Studio
          </div>
        </div>
      </Space>

      <Tag
        icon={<FileSearchOutlined style={{ color: '#fadb14' }} />}
        style={{
          background: 'rgba(250, 219, 20, 0.08)',
          border: '1px solid rgba(250, 219, 20, 0.25)',
          color: '#fadb14',
          fontWeight: 600,
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '4px'
        }}
      >
        PCB Diff Engine
      </Tag>
    </Space>
  );
}

function GithubUserButton({ githubUser, onOpenGithubModal }) {
  if (githubUser) {
    return (
      <Tooltip title={`Connected as @${githubUser.login} (Click to manage)`}>
        <Button
          type="text"
          onClick={onOpenGithubModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 10px',
            height: BUTTON_HEIGHT,
            background: '#0f1015',
            border: '1px solid #30363d',
            borderRadius: '6px',
            color: '#fff'
          }}
        >
          <Avatar
            src={githubUser.avatarUrl}
            size={20}
            icon={<GithubOutlined />}
          />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{githubUser.login}</span>
          <span style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#00ff66',
            display: 'inline-block',
            boxShadow: '0 0 6px #00ff66'
          }} />
        </Button>
      </Tooltip>
    );
  }

  return (
    <Tooltip title="Connect GitHub to diff remote repos & Pull Requests">
      <Button
        type="default"
        icon={<GithubOutlined />}
        onClick={onOpenGithubModal}
        style={{
          background: '#1c1f2b',
          borderColor: '#30363d',
          color: '#e2e8f0',
          fontSize: '12px',
          fontWeight: 500,
          height: BUTTON_HEIGHT
        }}
      >
        Connect GitHub
      </Button>
    </Tooltip>
  );
}

function BackendStatusBadge({ backendStatus, kicadVersion }) {
  const isHealthy = backendStatus === 'healthy';
  const label = isHealthy ? `KiCad ${kicadVersion || 'CLI'}` : 'Backend Offline';
  const color = isHealthy ? '#237804' : '#cf1322';

  return (
    <Badge
      count={label}
      style={{ backgroundColor: color, fontSize: '10px', fontWeight: isHealthy ? 600 : 400 }}
    />
  );
}

function CopilotButton({ onOpenCopilot }) {
  return (
    <Tooltip title="Open Banana Hardware Copilot (AI PCB Diff Assistant)">
      <Button
        type="primary"
        icon={<RobotOutlined />}
        onClick={() => onOpenCopilot?.()}
        style={{
          background: BANANA_GRADIENT,
          color: '#000',
          fontWeight: 600,
          border: 'none',
          boxShadow: BANANA_GLOW
        }}
      >
        Copilot ✨
      </Button>
    </Tooltip>
  );
}

export default function WorkspaceShell({
  onOpenCopilot,
  kicadVersion,
  backendStatus,
  githubUser,
  onOpenGithubModal
}) {
  return (
    <div style={{
      background: '#161821',
      borderBottom: '1px solid #232738',
      padding: '0 20px',
      height: '56px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }}>
      <BrandLogo />

      <Space size="middle" align="center">
        <GithubUserButton
          githubUser={githubUser}
          onOpenGithubModal={onOpenGithubModal}
        />
        <BackendStatusBadge
          backendStatus={backendStatus}
          kicadVersion={kicadVersion}
        />
        <CopilotButton
          onOpenCopilot={onOpenCopilot}
        />
      </Space>
    </div>
  );
}
