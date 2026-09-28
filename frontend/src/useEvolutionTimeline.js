import { useState, useRef, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { API_BASE_URL } from './config.js';

async function fetchEvolutionPathApi(repo, base, target, file) {
  if (!repo || !base || !target) return null;
  try {
    const q = new URLSearchParams({
      repoPath: repo,
      baseCommit: base,
      targetCommit: target,
      filePath: file || ''
    });
    const res = await fetch(`${API_BASE_URL}/api/git/evolution?${q.toString()}`);
    return res.ok ? res.json() : null;
  } catch (e) {
    console.warn('[Banana] Evolution path check error:', e.message);
    return null;
  }
}

async function fetchStepDiffApi(repoPath, fromCommit, toCommit, relativeFilePath) {
  const response = await fetch(`${API_BASE_URL}/api/diff/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoPath,
      baseCommit: fromCommit,
      targetCommit: toCommit,
      relativeFilePath,
      isPcb: relativeFilePath ? relativeFilePath.endsWith('.kicad_pcb') : true
    })
  });

  if (!response.ok) throw new Error('Failed to process step');
  return response.json();
}

function useEvolutionAutoPlay({
  evolutionPlaying,
  evolutionEnabled,
  evolutionData,
  setEvolutionStep,
  setEvolutionPlaying,
  loadEvolutionStep
}) {
  useEffect(() => {
    if (!evolutionPlaying || !evolutionEnabled || !evolutionData) return;
    const totalSteps = Math.max(0, evolutionData.commits.length - 1);

    const timer = setInterval(() => {
      setEvolutionStep((prev) => {
        if (prev < totalSteps - 1) {
          const next = prev + 1;
          loadEvolutionStep(next);
          return next;
        }
        setEvolutionPlaying(false);
        return prev;
      });
    }, 2800);

    return () => clearInterval(timer);
  }, [evolutionPlaying, evolutionEnabled, evolutionData, loadEvolutionStep, setEvolutionPlaying, setEvolutionStep]);
}

function resolveStepCommits(dataToUse, targetMode, stepIndex) {
  if (!dataToUse?.commits || dataToUse.commits.length < 2) return null;
  const fromCommit = targetMode === 'cumulative' ? dataToUse.commits[0].hash : dataToUse.commits[stepIndex].hash;
  const toCommit = dataToUse.commits[stepIndex + 1]?.hash;
  return toCommit ? { fromCommit, toCommit } : null;
}

async function fetchStepWithCache(cacheRef, params) {
  const { repoPath, fromCommit, toCommit, relativeFilePath } = params;
  const cacheKey = `${fromCommit}..${toCommit}`;
  if (cacheRef.current[cacheKey]) {
    return cacheRef.current[cacheKey];
  }
  const data = await fetchStepDiffApi(repoPath, fromCommit, toCommit, relativeFilePath);
  cacheRef.current[cacheKey] = data;
  return data;
}

function disableEvolutionMode({ setEvolutionEnabled, setEvolutionPlaying, directDiffDataRef, setDiffData }) {
  setEvolutionEnabled(false);
  setEvolutionPlaying(false);
  if (directDiffDataRef.current) setDiffData(directDiffDataRef.current);
}

async function enableEvolutionMode(ctx) {
  const {
    repoPath, baseCommit, targetCommit, relativeFilePath,
    diffData, evolutionData, evolutionMode,
    setEvolutionData, setEvolutionEnabled, setEvolutionStep,
    directDiffDataRef, loadEvolutionStep
  } = ctx;

  let currentEvData = evolutionData;
  if (!currentEvData?.commits || currentEvData.commits.length < 2) {
    currentEvData = await fetchEvolutionPathApi(repoPath, baseCommit, targetCommit, relativeFilePath);
    if (currentEvData) setEvolutionData(currentEvData);
  }

  if (currentEvData?.commits?.length >= 2) {
    if (!directDiffDataRef.current && diffData) directDiffDataRef.current = diffData;
    setEvolutionEnabled(true);
    setEvolutionStep(0);
    await loadEvolutionStep(0, evolutionMode, currentEvData);
  } else {
    message.info('No intermediate commits found between selected revisions.');
  }
}

function useEvolutionStepLoader({
  evolutionMode,
  evolutionData,
  repoPath,
  relativeFilePath,
  evolutionCacheRef,
  setDiffData,
  setEvolutionStep
}) {
  const [evolutionLoading, setEvolutionLoading] = useState(false);

  const loadEvolutionStep = useCallback(async (stepIndex, targetMode = evolutionMode, evData = evolutionData) => {
    const commits = resolveStepCommits(evData || evolutionData, targetMode, stepIndex);
    if (!commits) return;

    setEvolutionLoading(true);
    try {
      const data = await fetchStepWithCache(evolutionCacheRef, {
        repoPath,
        fromCommit: commits.fromCommit,
        toCommit: commits.toCommit,
        relativeFilePath
      });
      setDiffData(data);
      setEvolutionStep(stepIndex);
    } catch (e) {
      message.error(`Failed to load step: ${e.message}`);
    } finally {
      setEvolutionLoading(false);
    }
  }, [evolutionData, evolutionMode, relativeFilePath, repoPath, setDiffData, evolutionCacheRef, setEvolutionStep]);

  return { evolutionLoading, loadEvolutionStep };
}

function useEvolutionPathInit({ repoPath, baseCommit, targetCommit, relativeFilePath, setEvolutionData, setEvolutionStep }) {
  const checkEvolutionPath = useCallback(async (repo, base, target, file) => {
    const data = await fetchEvolutionPathApi(repo, base, target, file);
    if (data) {
      setEvolutionData(data);
      setEvolutionStep(0);
    }
  }, [setEvolutionData, setEvolutionStep]);

  useEffect(() => {
    if (repoPath && baseCommit && targetCommit) {
      checkEvolutionPath(repoPath, baseCommit, targetCommit, relativeFilePath);
    }
  }, [repoPath, baseCommit, targetCommit, relativeFilePath, checkEvolutionPath]);

  return { checkEvolutionPath };
}

export function useEvolutionTimeline({
  repoPath,
  baseCommit,
  targetCommit,
  relativeFilePath,
  diffData,
  setDiffData
}) {
  const [evolutionEnabled, setEvolutionEnabled] = useState(false);
  const [evolutionData, setEvolutionData] = useState(null);
  const [evolutionStep, setEvolutionStep] = useState(0);
  const [evolutionPlaying, setEvolutionPlaying] = useState(false);
  const [evolutionMode, setEvolutionMode] = useState('step'); // 'step' | 'cumulative'

  const directDiffDataRef = useRef(null);
  const evolutionCacheRef = useRef({});

  const { checkEvolutionPath } = useEvolutionPathInit({
    repoPath, baseCommit, targetCommit, relativeFilePath, setEvolutionData, setEvolutionStep
  });

  const { evolutionLoading, loadEvolutionStep } = useEvolutionStepLoader({
    evolutionMode, evolutionData, repoPath, relativeFilePath, evolutionCacheRef, setDiffData, setEvolutionStep
  });

  const toggleEvolutionMode = useCallback(async (enable) => {
    const nextState = enable !== undefined ? enable : !evolutionEnabled;
    if (!nextState) {
      disableEvolutionMode({ setEvolutionEnabled, setEvolutionPlaying, directDiffDataRef, setDiffData });
      return;
    }

    await enableEvolutionMode({
      repoPath, baseCommit, targetCommit, relativeFilePath,
      diffData, evolutionData, evolutionMode,
      setEvolutionData, setEvolutionEnabled, setEvolutionStep,
      directDiffDataRef, loadEvolutionStep
    });
  }, [baseCommit, diffData, evolutionData, evolutionEnabled, evolutionMode, loadEvolutionStep, relativeFilePath, repoPath, setDiffData, targetCommit]);

  useEvolutionAutoPlay({
    evolutionPlaying,
    evolutionEnabled,
    evolutionData,
    setEvolutionStep,
    setEvolutionPlaying,
    loadEvolutionStep
  });

  return {
    evolutionEnabled,
    setEvolutionEnabled,
    evolutionData,
    evolutionStep,
    evolutionPlaying,
    setEvolutionPlaying,
    evolutionMode,
    setEvolutionMode,
    evolutionLoading,
    directDiffDataRef,
    checkEvolutionPath,
    loadEvolutionStep,
    toggleEvolutionMode
  };
}

