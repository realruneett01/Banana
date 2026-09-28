import { useState, useCallback } from 'react';
import { message } from 'antd';
import { API_BASE_URL } from './config.js';

async function executeDiffRequest({
  url,
  payload,
  headers = {},
  loadingMsg,
  errorPrefix
}) {
  const hideLoading = message.loading(loadingMsg, 0);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload)
    });
    hideLoading();
    if (response.ok) {
      const data = await response.json();
      return { success: true, data };
    }
    const errorData = await response.json();
    const errMsg = `${errorPrefix}: ${errorData.error || 'Server error'}. ${errorData.details || ''}`;
    message.error(errMsg, 6);
    return { success: false, error: errMsg };
  } catch (e) {
    hideLoading();
    const errMsg = `Connection error: ${e.message}`;
    message.error(errMsg, 6);
    return { success: false, error: errMsg };
  }
}

function applyDiffResult(data, options) {
  const { setDiffData, directDiffDataRef, setEvolutionEnabled, setEvolutionPlaying } = options;
  setDiffData(data);
  if (directDiffDataRef) directDiffDataRef.current = data;
  if (setEvolutionEnabled) setEvolutionEnabled(false);
  if (setEvolutionPlaying) setEvolutionPlaying(false);
}

function useLocalDiffFetch({
  setLoading,
  setDiffData,
  directDiffDataRef,
  setEvolutionEnabled,
  setEvolutionPlaying,
  checkEvolutionPath
}) {
  return useCallback(async (values) => {
    setLoading(true);
    const result = await executeDiffRequest({
      url: `${API_BASE_URL}/api/diff/process`,
      payload: {
        repoPath: values.repoPath,
        baseCommit: values.baseCommit,
        targetCommit: values.targetCommit,
        relativeFilePath: values.relativeFilePath,
        isPcb: values.relativeFilePath.endsWith('.kicad_pcb')
      },
      loadingMsg: 'Extracting and rendering commits...',
      errorPrefix: 'Failed'
    });
    setLoading(false);

    if (result.success) {
      applyDiffResult(result.data, { setDiffData, directDiffDataRef, setEvolutionEnabled, setEvolutionPlaying });
      message.success('Diff loaded successfully!');
      if (checkEvolutionPath) {
        checkEvolutionPath(values.repoPath, values.baseCommit, values.targetCommit, values.relativeFilePath);
      }
    }
  }, [checkEvolutionPath, directDiffDataRef, setDiffData, setEvolutionEnabled, setEvolutionPlaying, setLoading]);
}

function useRemoteDiffFetch({
  setLoading,
  setDiffData,
  githubToken,
  setGithubModalOpen,
  directDiffDataRef,
  setEvolutionEnabled,
  setEvolutionPlaying
}) {
  return useCallback(async ({ owner, repo, baseCommit, targetCommit, filePath, isPcb }) => {
    if (!githubToken) {
      setGithubModalOpen(true);
      return;
    }
    setLoading(true);
    const result = await executeDiffRequest({
      url: `${API_BASE_URL}/api/github/diff/process`,
      headers: { Authorization: `Bearer ${githubToken}` },
      payload: {
        owner,
        repo,
        baseCommit,
        targetCommit,
        filePath,
        isPcb: isPcb !== undefined ? isPcb : filePath.endsWith('.kicad_pcb')
      },
      loadingMsg: `Downloading & rendering ${filePath} from GitHub...`,
      errorPrefix: 'GitHub Diff Failed'
    });
    setLoading(false);

    if (result.success) {
      applyDiffResult(result.data, { setDiffData, directDiffDataRef, setEvolutionEnabled, setEvolutionPlaying });
      message.success(`Remote GitHub diff loaded! (${result.data.telemetry?.tTotal || 0}ms total)`);
    }
  }, [directDiffDataRef, githubToken, setDiffData, setEvolutionEnabled, setEvolutionPlaying, setGithubModalOpen, setLoading]);
}

export function useDiffLoader(options) {
  const [loading, setLoading] = useState(false);
  const [diffData, setDiffData] = useState(null);

  const fetchDiff = useLocalDiffFetch({ setLoading, setDiffData, ...options });
  const fetchRemoteDiff = useRemoteDiffFetch({ setLoading, setDiffData, ...options });

  return {
    loading,
    diffData,
    setDiffData,
    fetchDiff,
    fetchRemoteDiff,
  };
}
