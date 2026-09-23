import React from 'react';
import {
  Space,
  Button,
  Tag,
  Typography,
  Badge,
  Tooltip
} from 'antd';
import {
  FileSearchOutlined,
  RobotOutlined
} from '@ant-design/icons';

const { Text, Title } = Typography;

export default function WorkspaceShell({
  onOpenCopilot,
  kicadVersion,
  backendStatus
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
      {/* Left: Branding & Studio Mode */}
      <Space size="large" align="center">
        <Space size="small" align="center">
          <div style={{
            width: 32,
            height: 32,
            background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            color: '#000',
            fontSize: 16,
            boxShadow: '0 0 12px rgba(250, 219, 20, 0.45)'
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

      {/* Right: KiCad Status + Copilot Launcher */}
      <Space size="middle" align="center">
        {backendStatus === 'healthy' ? (
          <Badge
            count={`KiCad ${kicadVersion || 'CLI'}`}
            style={{ backgroundColor: '#237804', fontSize: '10px', fontWeight: 600 }}
          />
        ) : (
          <Badge
            count="Backend Offline"
            style={{ backgroundColor: '#cf1322', fontSize: '10px' }}
          />
        )}

        <Tooltip title="Open Banana Hardware Copilot (AI PCB Diff Assistant)">
          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={() => onOpenCopilot && onOpenCopilot()}
            style={{
              background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
              color: '#000',
              fontWeight: 600,
              border: 'none',
              boxShadow: '0 0 12px rgba(250, 219, 20, 0.35)'
            }}
          >
            Copilot ✨
          </Button>
        </Tooltip>
      </Space>
    </div>
  );
}
