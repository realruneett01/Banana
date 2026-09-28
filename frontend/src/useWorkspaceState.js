import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Form } from 'antd';
import { useLocalGitRepo } from './useLocalGitRepo.js';
import { useBackendHealthAndGithub } from './useBackendHealthAndGithub.js';
import { useEvolutionTimeline } from './useEvolutionTimeline.js';
import { useDiffLoader } from './useDiffLoader.js';
import { useDiffFocus } from './useDiffFocus.js';
import { findCopilotModIndex } from './utils/auditLogUtils.js';
import { createPadLabelProps } from './utils/diffLayerUtils.js';

function buildBoardContext(options) {
  const { revisions, selectedLayers, diffMode, diffData, activeAuditIdx, evolution } = options;
  return {
    relativeFilePath: revisions.relativeFilePath,
    baseCommit: revisions.baseCommit,
    targetCommit: revisions.targetCommit,
    selectedLayers,
    diffMode,
    modifications: diffData?.modifications || [],
    pcbMetadata: diffData?.pcbMetadata,
    activeAuditIdx,
    activeAuditItem: activeAuditIdx !== null
      ? ((diffData?.modifications || []).find((m, i) => i === activeAuditIdx || m.diffIdx === activeAuditIdx) || (diffData?.modifications || [])[activeAuditIdx] || null)
      : null,
    evolutionInfo: evolution.evolutionEnabled ? {
      step: evolution.evolutionStep,
      totalSteps: evolution.evolutionData?.totalSteps || 0,
      mode: evolution.evolutionMode,
    } : null,
    telemetry: diffData?.telemetry,
  };
}

function buildSidebarProps(options) {
  const { leftCollapsed, setLeftCollapsed, onFolderDrop, gh, localProps, githubProps, layerProps } = options;
  return {
    leftCollapsed,
    setLeftCollapsed,
    onFolderDrop,
    sourceMode: gh.sourceMode,
    onSourceModeChange: gh.handleSourceModeChange,
    localProps,
    githubProps,
    layerProps,
  };
}

function buildViewportProps(params) {
  const {
    activeDiffData, diffMode, relativeFilePath,
    leftCollapsed, setLeftCollapsed, rightCollapsed, setRightCollapsed,
    sideBySideRef, diffCanvasRef, selectedLayers, soloLayer, layerOpacities,
    baseCommit, targetCommit, activeAuditIdx, setActiveAuditIdx,
    sliderValue, setSliderValue, evolution, padLabelProps
  } = params;

  return {
    diffData: activeDiffData,
    diffMode,
    relativeFilePath,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    sideBySideRef,
    diffCanvasRef,
    selectedLayers,
    soloLayer,
    layerOpacities,
    baseCommit,
    targetCommit,
    activeAuditIdx,
    setActiveAuditIdx,
    sliderValue,
    setSliderValue,
    evolutionEnabled: evolution.evolutionEnabled,
    evolutionData: evolution.evolutionData,
    evolutionStep: evolution.evolutionStep,
    evolutionPlaying: evolution.evolutionPlaying,
    evolutionLoading: evolution.evolutionLoading,
    evolutionMode: evolution.evolutionMode,
    toggleEvolutionMode: evolution.toggleEvolutionMode,
    loadEvolutionStep: evolution.loadEvolutionStep,
    setEvolutionPlaying: evolution.setEvolutionPlaying,
    setEvolutionMode: evolution.setEvolutionMode,
    padLabelProps,
  };
}

export function useWorkspaceRevisions() {
  const [repoPath, setRepoPath] = useState(
    () => localStorage.getItem('banana:lastRepoPath') || ''
  );

  useEffect(() => {
    if (repoPath) localStorage.setItem('banana:lastRepoPath', repoPath);
  }, [repoPath]);

  const [baseCommit, setBaseCommit] = useState('ab691fc');
  const [targetCommit, setTargetCommit] = useState('ab691fc');
  const [relativeFilePath, setRelativeFilePath] = useState('debug/examples/starfish.kicad_pcb');

  return {
    repoPath,
    setRepoPath,
    baseCommit,
    setBaseCommit,
    targetCommit,
    setTargetCommit,
    relativeFilePath,
    setRelativeFilePath
  };
}

export function useWorkspaceViewerState() {
  const [diffMode, setDiffMode] = useState('Overlay Slider');
  const [selectedLayers, setSelectedLayers] = useState(['F.Cu', 'F.SilkS', 'F.Courtyard', 'Edge.Cuts']);
  const [soloLayer, setSoloLayer] = useState(null);
  const [layerOpacities, setLayerOpacities] = useState({});
  const [sliderValue, setSliderValue] = useState(50);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [activeAuditIdx, setActiveAuditIdx] = useState(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);

  return {
    diffMode,
    setDiffMode,
    selectedLayers,
    setSelectedLayers,
    soloLayer,
    setSoloLayer,
    layerOpacities,
    setLayerOpacities,
    sliderValue,
    setSliderValue,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    activeAuditIdx,
    setActiveAuditIdx,
    isCopilotOpen,
    setIsCopilotOpen,
  };
}

function assembleSubsystemProps({ revisions, form, localRepo, diffLoader, gh, viewer }) {
  const localProps = {
    ...revisions,
    form,
    loadRepoInfo: localRepo.loadRepoInfo,
    repoInfo: localRepo.repoInfo,
    compareBranches: localRepo.compareBranches,
    setCompareBranches: localRepo.setCompareBranches,
    changedFiles: localRepo.changedFiles,
    setChangedFiles: localRepo.setChangedFiles,
    fetchChangedFiles: localRepo.fetchChangedFiles,
    loading: diffLoader.loading,
    onFetchDiff: diffLoader.fetchDiff,
    onFileDropped: localRepo.handleFileDraggedOrDropped,
  };

  const githubProps = {
    ...revisions,
    githubToken: gh.githubToken,
    githubUser: gh.githubUser,
    onOpenAuthModal: () => gh.setGithubModalOpen(true),
    onFetchDiff: diffLoader.fetchRemoteDiff,
    loading: diffLoader.loading,
    selectedRepo: gh.selectedRemoteRepo,
    setSelectedRepo: gh.setSelectedRemoteRepo,
  };

  const layerProps = {
    diffMode: viewer.diffMode,
    setDiffMode: viewer.setDiffMode,
    selectedLayers: viewer.selectedLayers,
    setSelectedLayers: viewer.setSelectedLayers,
    soloLayer: viewer.soloLayer,
    setSoloLayer: viewer.setSoloLayer,
    layerOpacities: viewer.layerOpacities,
    setLayerOpacities: viewer.setLayerOpacities,
  };

  return { localProps, githubProps, layerProps };
}

function assembleWorkspaceReturn(params) {
  const {
    viewer,
    gh,
    localRepo,
    focus,
    localProps,
    githubProps,
    layerProps,
    boardContext,
    viewportProps,
    activeDiffData,
    handleSelectCopilotMod
  } = params;

  return {
    shellProps: {
      onOpenCopilot: () => viewer.setIsCopilotOpen(true),
      kicadVersion: gh.kicadVersion,
      backendStatus: gh.backendStatus,
      githubUser: gh.githubUser,
      onOpenGithubModal: () => gh.setGithubModalOpen(true),
    },
    sidebarProps: buildSidebarProps({
      leftCollapsed: viewer.leftCollapsed,
      setLeftCollapsed: viewer.setLeftCollapsed,
      onFolderDrop: localRepo.handleFolderDrop,
      gh,
      localProps,
      githubProps,
      layerProps
    }),
    edgeTabsProps: {
      leftCollapsed: viewer.leftCollapsed,
      setLeftCollapsed: viewer.setLeftCollapsed,
      rightCollapsed: viewer.rightCollapsed,
      setRightCollapsed: viewer.setRightCollapsed,
    },
    viewportProps,
    auditProps: {
      rightCollapsed: viewer.rightCollapsed,
      setRightCollapsed: viewer.setRightCollapsed,
      activeDiffData,
      activeAuditIdx: viewer.activeAuditIdx,
      onHoverDiff: focus.setHoveredDiff,
      onSelectDiff: focus.selectDiffItem,
      onClearFocus: focus.resetFocusView,
    },
    copilotProps: {
      open: viewer.isCopilotOpen,
      onClose: () => viewer.setIsCopilotOpen(false),
      boardContext,
      onSelectModification: handleSelectCopilotMod,
    },
    githubModalProps: {
      open: gh.githubModalOpen,
      onClose: () => gh.setGithubModalOpen(false),
      githubUser: gh.githubUser,
      githubToken: gh.githubToken,
      onAuthSuccess: gh.handleAuthSuccess,
      onDisconnect: gh.handleDisconnectGithub,
    },
  };
}

export function useWorkspaceDiffSync({ revisions, gh }) {
  const [diffDataState, setDiffDataState] = useState(null);

  const evolution = useEvolutionTimeline({
    repoPath: revisions.repoPath,
    baseCommit: revisions.baseCommit,
    targetCommit: revisions.targetCommit,
    relativeFilePath: revisions.relativeFilePath,
    diffData: diffDataState,
    setDiffData: setDiffDataState,
  });

  const diffLoader = useDiffLoader({
    githubToken: gh.githubToken,
    setGithubModalOpen: gh.setGithubModalOpen,
    directDiffDataRef: evolution.directDiffDataRef,
    setEvolutionEnabled: evolution.setEvolutionEnabled,
    setEvolutionPlaying: evolution.setEvolutionPlaying,
    checkEvolutionPath: evolution.checkEvolutionPath,
  });

  useEffect(() => {
    if (diffLoader.diffData) setDiffDataState(diffLoader.diffData);
  }, [diffLoader.diffData]);

  const activeDiffData = diffDataState || diffLoader.diffData;

  return { evolution, diffLoader, activeDiffData };
}

function createWorkspaceViewportProps(options) {
  const { activeDiffData, viewer, revisions, sideBySideRef, diffCanvasRef, evolution, padLabelProps } = options;
  return buildViewportProps({
    activeDiffData,
    diffMode: viewer.diffMode,
    relativeFilePath: revisions.relativeFilePath,
    leftCollapsed: viewer.leftCollapsed,
    setLeftCollapsed: viewer.setLeftCollapsed,
    rightCollapsed: viewer.rightCollapsed,
    setRightCollapsed: viewer.setRightCollapsed,
    sideBySideRef,
    diffCanvasRef,
    selectedLayers: viewer.selectedLayers,
    soloLayer: viewer.soloLayer,
    layerOpacities: viewer.layerOpacities,
    baseCommit: revisions.baseCommit,
    targetCommit: revisions.targetCommit,
    activeAuditIdx: viewer.activeAuditIdx,
    setActiveAuditIdx: viewer.setActiveAuditIdx,
    sliderValue: viewer.sliderValue,
    setSliderValue: viewer.setSliderValue,
    evolution,
    padLabelProps
  });
}

function useWorkspaceCopilotModSelect(activeDiffData, focus) {
  return useCallback((modId, label) => {
    const mods = activeDiffData?.modifications || [];
    const idx = findCopilotModIndex(mods, modId, label);
    if (idx !== -1) {
      focus.selectDiffItem(mods[idx], idx);
    }
  }, [activeDiffData, focus]);
}

export function useWorkspaceState() {
  const [form] = Form.useForm();
  const sideBySideRef = useRef(null);
  const diffCanvasRef = useRef(null);
  const revisions = useWorkspaceRevisions();
  const viewer = useWorkspaceViewerState();

  const localRepo = useLocalGitRepo({
    form,
    repoPath: revisions.repoPath,
    setRepoPath: revisions.setRepoPath,
    relativeFilePath: revisions.relativeFilePath,
    setRelativeFilePath: revisions.setRelativeFilePath,
    setBaseCommit: revisions.setBaseCommit,
    setTargetCommit: revisions.setTargetCommit,
  });

  const gh = useBackendHealthAndGithub({
    onMountRepoInit: () => localRepo.loadRepoInfo(revisions.repoPath, true),
  });

  const { evolution, diffLoader, activeDiffData } = useWorkspaceDiffSync({ revisions, gh });

  const focus = useDiffFocus({
    diffMode: viewer.diffMode,
    sideBySideRef,
    diffCanvasRef,
    activeAuditIdx: viewer.activeAuditIdx,
    setActiveAuditIdx: viewer.setActiveAuditIdx,
    selectedLayers: viewer.selectedLayers,
    setSelectedLayers: viewer.setSelectedLayers,
  });

  const padLabelProps = useMemo(() => {
    return createPadLabelProps({
      repoPath: revisions.repoPath,
      baseCommit: revisions.baseCommit,
      targetCommit: revisions.targetCommit,
      relativeFilePath: revisions.relativeFilePath,
      selectedRemoteRepo: gh.selectedRemoteRepo,
      githubToken: gh.githubToken,
    });
  }, [revisions.baseCommit, gh.githubToken, gh.selectedRemoteRepo, revisions.relativeFilePath, revisions.repoPath, revisions.targetCommit]);

  const handleSelectCopilotMod = useWorkspaceCopilotModSelect(activeDiffData, focus);

  const { localProps, githubProps, layerProps } = assembleSubsystemProps({
    revisions, form, localRepo, diffLoader, gh, viewer
  });

  const boardContext = buildBoardContext({
    revisions,
    selectedLayers: viewer.selectedLayers,
    diffMode: viewer.diffMode,
    diffData: activeDiffData,
    activeAuditIdx: viewer.activeAuditIdx,
    evolution
  });

  const viewportProps = createWorkspaceViewportProps({
    activeDiffData, viewer, revisions, sideBySideRef, diffCanvasRef, evolution, padLabelProps
  });

  return assembleWorkspaceReturn({
    viewer,
    gh,
    localRepo,
    focus,
    localProps,
    githubProps,
    layerProps,
    boardContext,
    viewportProps,
    activeDiffData,
    handleSelectCopilotMod
  });
}
