import React, { useState, useEffect } from 'react';
import {
  Modal,
  Tabs,
  Typography,
  Input,
  Button,
  Space,
  Avatar,
  Tag,
  Alert,
  message,
  Card,
  Divider
} from 'antd';
import {
  GithubOutlined,
  KeyOutlined,
  CheckCircleFilled,
  DisconnectOutlined,
  ExportOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
import { API_BASE_URL } from '../config.js';

const { Text, Title, Paragraph } = Typography;

const NEW_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:user&description=Banana%20Hardware%20Diff%20Studio';

const MODAL_STYLES = Object.freeze({
  content: {
    backgroundColor: '#161821',
    border: '1px solid #232738',
    borderRadius: '8px',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)'
  }
});

function ModalHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: '#24292e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid #30363d'
      }}>
        <GithubOutlined style={{ fontSize: '18px', color: '#fff' }} />
      </div>
      <div>
        <Text strong style={{ fontSize: '15px', color: '#f5f5f5' }}>
          GitHub Cloud Integration
        </Text>
        <div style={{ fontSize: '11px', color: '#8b949e', fontWeight: 'normal' }}>
          Diff remote hardware repositories, branches & Pull Requests
        </div>
      </div>
    </div>
  );
}

function ProfileDetails({ githubUser }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
      <Avatar
        src={githubUser.avatarUrl}
        size={56}
        icon={<GithubOutlined />}
        style={{ border: '2px solid #fadb14' }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Text strong style={{ color: '#fff', fontSize: '16px' }}>
            {githubUser.name || githubUser.login}
          </Text>
          <Tag color="success" icon={<CheckCircleFilled />}>
            Connected
          </Tag>
        </div>
        <div style={{ color: '#8b949e', fontSize: '12px' }}>
          @{githubUser.login}
        </div>
        <div style={{ marginTop: '6px', display: 'flex', gap: '8px' }}>
          <Tag color="default" style={{ background: '#1c1f2b', borderColor: '#30363d', color: '#a6adbb', fontSize: '11px' }}>
            {githubUser.publicRepos} Public Repos
          </Tag>
          {githubUser.totalPrivateRepos > 0 && (
            <Tag color="default" style={{ background: '#1c1f2b', borderColor: '#30363d', color: '#a6adbb', fontSize: '11px' }}>
              {githubUser.totalPrivateRepos} Private Repos
            </Tag>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileFooterActions({ githubUser, onDisconnect }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <a
        href={githubUser.htmlUrl}
        target="_blank"
        rel="noreferrer"
        style={{ color: '#fadb14', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
      >
        View on GitHub <ExportOutlined />
      </a>

      <Button
        danger
        type="text"
        size="small"
        icon={<DisconnectOutlined />}
        onClick={() => {
          onDisconnect();
          message.info('Disconnected from GitHub');
        }}
      >
        Disconnect Account
      </Button>
    </div>
  );
}

function AuthenticatedProfileCard({ githubUser, onDisconnect, onClose }) {
  return (
    <div style={{ padding: '16px 0 8px' }}>
      <Card style={{ background: '#0f1015', borderColor: '#232738', borderRadius: '8px' }}>
        <ProfileDetails githubUser={githubUser} />
        <Divider style={{ borderColor: '#232738', margin: '12px 0' }} />
        <ProfileFooterActions githubUser={githubUser} onDisconnect={onDisconnect} />
      </Card>

      <div style={{ marginTop: '16px', textAlign: 'right' }}>
        <Button type="primary" onClick={onClose} style={{ background: '#fadb14', color: '#000', fontWeight: 600 }}>
          Done
        </Button>
      </div>
    </div>
  );
}

function PatAuthTab({ patInput, setPatInput, verifying, onVerify, onClose }) {
  return (
    <div>
      <Paragraph style={{ color: '#a6adbb', fontSize: '12px', marginBottom: '14px' }}>
        Connect immediately with zero server setup. Generate a GitHub Personal Access Token (Classic or Fine-grained) with <Text code style={{ color: '#fadb14' }}>repo</Text> permissions.
      </Paragraph>

      <div style={{ marginBottom: '16px' }}>
        <Text style={{ fontSize: '12px', color: '#e2e8f0', display: 'block', marginBottom: '6px' }}>
          GitHub Personal Access Token:
        </Text>
        <Input.Password
          placeholder="ghp_... or github_pat_..."
          value={patInput}
          onChange={e => setPatInput(e.target.value)}
          onPressEnter={onVerify}
          style={{ background: '#0f1015', borderColor: '#232738', color: '#fff', fontFamily: 'monospace' }}
        />
      </div>

      <Alert
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined style={{ color: '#fadb14' }} />}
        message="Stored Privately in LocalStorage"
        description="Your token is kept securely inside your browser and transmitted only directly to the backend to authenticate GitHub API calls."
        style={{ background: '#0f1015', borderColor: '#232738', color: '#a6adbb', fontSize: '11px', marginBottom: '16px' }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a
          href={NEW_TOKEN_URL}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#fadb14', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          Generate Token on GitHub <ExportOutlined />
        </a>

        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            loading={verifying}
            onClick={onVerify}
            style={{ background: '#fadb14', color: '#000', fontWeight: 600, border: 'none' }}
          >
            Verify & Connect
          </Button>
        </Space>
      </div>
    </div>
  );
}

function OAuthTab({ oauthConfigured, onOAuthLogin, onSwitchToPat }) {
  if (oauthConfigured) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: '#24292e',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '16px',
          border: '2px solid #fadb14'
        }}>
          <GithubOutlined style={{ fontSize: '32px', color: '#fff' }} />
        </div>
        <Title level={5} style={{ color: '#fff', marginBottom: '8px' }}>
          Authorize with One Click
        </Title>
        <Paragraph style={{ color: '#8b949e', fontSize: '12px', maxWidth: '380px', margin: '0 auto 20px' }}>
          You will be redirected to GitHub to authorize Banana Studio. No tokens to copy-paste.
        </Paragraph>

        <Button
          type="primary"
          size="large"
          icon={<GithubOutlined />}
          onClick={onOAuthLogin}
          style={{
            background: '#24292e',
            borderColor: '#444c56',
            color: '#fff',
            height: '42px',
            fontWeight: 600,
            padding: '0 24px'
          }}
        >
          Continue with GitHub
        </Button>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <Alert
        type="warning"
        showIcon
        message="OAuth App Credentials Not Configured"
        description={
          <div style={{ fontSize: '11px', marginTop: '4px' }}>
            To use 1-click OAuth, configure <Text code>GITHUB_CLIENT_ID</Text> and <Text code>GITHUB_CLIENT_SECRET</Text> in your <Text code>backend/.env</Text> file.
            <div style={{ marginTop: '8px' }}>
              💡 <strong>Tip:</strong> You can switch to the <strong>Personal Access Token</strong> tab to connect immediately without any OAuth setup!
            </div>
          </div>
        }
        style={{ background: '#1c1a11', borderColor: '#42371c', marginBottom: '16px' }}
      />

      <div style={{ textAlign: 'right' }}>
        <Button
          type="primary"
          onClick={onSwitchToPat}
          style={{ background: '#fadb14', color: '#000', fontWeight: 600 }}
        >
          Use Personal Access Token Instead →
        </Button>
      </div>
    </div>
  );
}

async function verifyPatToken(token) {
  const res = await fetch(`${API_BASE_URL}/api/auth/github/verify`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  if (res.ok && data.authenticated) {
    return { ok: true, user: data.user };
  }
  return { ok: false, error: data.error || 'Failed to authenticate token.' };
}

async function fetchOAuthStatus() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/github/url`);
    const data = await res.json();
    return { configured: Boolean(data.configured), url: data.url || '' };
  } catch {
    return { configured: false, url: '' };
  }
}

function useGithubAuthModal(open, onClose, onAuthSuccess) {
  const [activeTab, setActiveTab] = useState('pat');
  const [patInput, setPatInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(null);
  const [oauthUrl, setOauthUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    fetchOAuthStatus().then(status => {
      setOauthConfigured(status.configured);
      if (status.url) setOauthUrl(status.url);
      setActiveTab(status.configured ? 'oauth' : 'pat');
    });
  }, [open]);

  const handleVerifyPat = async () => {
    const trimmed = patInput.trim();
    if (!trimmed) {
      message.error('Please enter a GitHub Personal Access Token');
      return;
    }

    setVerifying(true);
    try {
      const result = await verifyPatToken(trimmed);
      if (result.ok) {
        message.success(`Connected to GitHub as @${result.user.login}!`);
        onAuthSuccess(trimmed, result.user);
        setPatInput('');
        onClose();
      } else {
        message.error(result.error);
      }
    } catch (e) {
      message.error(`Connection error: ${e.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleOAuthLogin = () => {
    window.location.href = oauthUrl || `${API_BASE_URL}/api/auth/github/url`;
  };

  return {
    activeTab,
    setActiveTab,
    patInput,
    setPatInput,
    verifying,
    oauthConfigured,
    handleVerifyPat,
    handleOAuthLogin
  };
}

function buildAuthTabItems(config) {
  const {
    patInput, setPatInput, verifying, onVerify, onClose,
    oauthConfigured, onOAuthLogin, onSwitchToPat
  } = config;

  return [
    {
      key: 'pat',
      label: (
        <span>
          <KeyOutlined style={{ marginRight: '6px' }} />
          Personal Access Token
        </span>
      ),
      children: (
        <PatAuthTab
          patInput={patInput}
          setPatInput={setPatInput}
          verifying={verifying}
          onVerify={onVerify}
          onClose={onClose}
        />
      )
    },
    {
      key: 'oauth',
      label: (
        <span>
          <GithubOutlined style={{ marginRight: '6px' }} />
          GitHub OAuth App
        </span>
      ),
      children: (
        <OAuthTab
          oauthConfigured={oauthConfigured}
          onOAuthLogin={onOAuthLogin}
          onSwitchToPat={onSwitchToPat}
        />
      )
    }
  ];
}

export default function GithubConnectModal({
  open,
  onClose,
  githubUser,
  onAuthSuccess,
  onDisconnect
}) {
  const {
    activeTab,
    setActiveTab,
    patInput,
    setPatInput,
    verifying,
    oauthConfigured,
    handleVerifyPat,
    handleOAuthLogin
  } = useGithubAuthModal(open, onClose, onAuthSuccess);

  const tabItems = buildAuthTabItems({
    patInput,
    setPatInput,
    verifying,
    onVerify: handleVerifyPat,
    onClose,
    oauthConfigured,
    onOAuthLogin: handleOAuthLogin,
    onSwitchToPat: () => setActiveTab('pat')
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
      title={<ModalHeader />}
      styles={MODAL_STYLES}
    >
      {githubUser ? (
        <AuthenticatedProfileCard
          githubUser={githubUser}
          onDisconnect={onDisconnect}
          onClose={onClose}
        />
      ) : (
        <div style={{ padding: '8px 0 0' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
          />
        </div>
      )}
    </Modal>
  );
}
