import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { API_BASE_URL } from './config.js';

async function fetchBackendHealthStatus() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health-check`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'healthy') {
        return { status: 'healthy', version: data.kicadVersion || '' };
      }
    }
  } catch (err) {
    console.debug('[Banana] Health check error:', err);
  }
  return { status: 'unhealthy', version: '' };
}

function handleUrlAuthCallback({ setGithubToken, setSourceMode, verifyGithubToken, existingToken }) {
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get('github_token');
  const errorFromUrl = params.get('github_error');

  if (tokenFromUrl) {
    localStorage.setItem('banana:githubToken', tokenFromUrl);
    setGithubToken(tokenFromUrl);
    setSourceMode('github');
    localStorage.setItem('banana:sourceMode', 'github');
    verifyGithubToken(tokenFromUrl);
    window.history.replaceState({}, document.title, window.location.pathname);
    message.success('GitHub OAuth login successful!');
  } else if (errorFromUrl) {
    message.error(`GitHub login error: ${errorFromUrl}`);
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (existingToken) {
    verifyGithubToken(existingToken);
  }
}

export function useBackendHealthAndGithub({ onMountRepoInit }) {
  const [backendStatus, setBackendStatus] = useState('checking'); // checking | healthy | unhealthy
  const [kicadVersion, setKicadVersion] = useState('');

  const [sourceMode, setSourceMode] = useState(
    localStorage.getItem('banana:sourceMode') || 'local'
  );

  const [githubToken, setGithubToken] = useState(
    localStorage.getItem('banana:githubToken') || ''
  );
  const [githubUser, setGithubUser] = useState(null);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [selectedRemoteRepo, setSelectedRemoteRepo] = useState(null);

  const handleDisconnectGithub = useCallback(() => {
    localStorage.removeItem('banana:githubToken');
    setGithubToken('');
    setGithubUser(null);
    setSelectedRemoteRepo(null);
    setSourceMode('local');
    localStorage.setItem('banana:sourceMode', 'local');
  }, []);

  const verifyGithubToken = useCallback(async (token) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/github/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.ok ? await res.json() : null;
      if (data?.authenticated) {
        setGithubUser(data.user);
      } else {
        handleDisconnectGithub();
      }
    } catch (e) {
      console.warn('GitHub token verify error:', e.message);
    }
  }, [handleDisconnectGithub]);

  const checkHealth = useCallback(async () => {
    setBackendStatus('checking');
    const result = await fetchBackendHealthStatus();
    setBackendStatus(result.status);
    setKicadVersion(result.version);
  }, []);

  useEffect(() => {
    checkHealth();
    if (onMountRepoInit) onMountRepoInit();
    handleUrlAuthCallback({ setGithubToken, setSourceMode, verifyGithubToken, existingToken: githubToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSourceModeChange = useCallback((val) => {
    setSourceMode(val);
    localStorage.setItem('banana:sourceMode', val);
  }, []);

  const handleAuthSuccess = useCallback((token, user) => {
    localStorage.setItem('banana:githubToken', token);
    setGithubToken(token);
    setGithubUser(user);
    setSourceMode('github');
    localStorage.setItem('banana:sourceMode', 'github');
  }, []);

  return {
    backendStatus,
    kicadVersion,
    sourceMode,
    githubToken,
    githubUser,
    githubModalOpen,
    setGithubModalOpen,
    selectedRemoteRepo,
    setSelectedRemoteRepo,
    handleDisconnectGithub,
    handleSourceModeChange,
    handleAuthSuccess,
    checkHealth
  };
}
