import { Form } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBackendHealthAndGithub } from "./useBackendHealthAndGithub.js";
import { useDiffFocus } from "./useDiffFocus.js";
import { useDiffLoader } from "./useDiffLoader.js";
import { useEvolutionTimeline } from "./useEvolutionTimeline.js";
import { useLocalGitRepo } from "./useLocalGitRepo.js";
import { findCopilotModIndex } from "./utils/auditLogUtils.js";
import { createPadLabelProps } from "./utils/diffLayerUtils.js";

function findActiveAuditItem(modifications, activeAuditIdx) {
	if (activeAuditIdx === null) {
		return null;
	}
	const item = modifications.find(
		(m, i) => i === activeAuditIdx || m.diffIdx === activeAuditIdx,
	);
	return item ?? modifications[activeAuditIdx] ?? null;
}

function buildEvolutionInfo(evolution) {
	if (!evolution?.evolutionEnabled) {
		return null;
	}
	return {
		step: evolution.evolutionStep,
		totalSteps: evolution.evolutionData?.totalSteps ?? 0,
		mode: evolution.evolutionMode,
	};
}

function buildBoardContext(options) {
	const {
		revisions,
		selectedLayers,
		diffMode,
		diffData,
		activeAuditIdx,
		evolution,
	} = options;
	const modifications = diffData?.modifications ?? [];

	return {
		relativeFilePath: revisions.relativeFilePath,
		baseCommit: revisions.baseCommit,
		targetCommit: revisions.targetCommit,
		selectedLayers,
		diffMode,
		modifications,
		pcbMetadata: diffData?.pcbMetadata,
		activeAuditIdx,
		activeAuditItem: findActiveAuditItem(modifications, activeAuditIdx),
		evolutionInfo: buildEvolutionInfo(evolution),
		telemetry: diffData?.telemetry,
	};
}

function extractCollapseProps(viewer) {
	return {
		leftCollapsed: viewer.leftCollapsed,
		setLeftCollapsed: viewer.setLeftCollapsed,
		rightCollapsed: viewer.rightCollapsed,
		setRightCollapsed: viewer.setRightCollapsed,
	};
}

function extractRevisionPaths(revisions) {
	return {
		repoPath: revisions.repoPath,
		baseCommit: revisions.baseCommit,
		targetCommit: revisions.targetCommit,
		relativeFilePath: revisions.relativeFilePath,
	};
}

function buildSidebarProps(options) {
	const {
		leftCollapsed,
		setLeftCollapsed,
		onFolderDrop,
		gh,
		localProps,
		githubProps,
		layerProps,
	} = options;
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

function buildEvolutionViewportProps(evolution) {
	return {
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
	};
}

function buildViewportProps(options) {
	const {
		activeDiffData,
		viewer,
		revisions,
		sideBySideRef,
		diffCanvasRef,
		evolution,
		padLabelProps,
	} = options;

	return {
		diffData: activeDiffData,
		diffMode: viewer.diffMode,
		relativeFilePath: revisions.relativeFilePath,
		...extractCollapseProps(viewer),
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
		...buildEvolutionViewportProps(evolution),
		padLabelProps,
	};
}

export function useWorkspaceRevisions() {
	const [repoPath, setRepoPath] = useState(
		() => localStorage.getItem("banana:lastRepoPath") || "",
	);

	useEffect(() => {
		if (repoPath) localStorage.setItem("banana:lastRepoPath", repoPath);
	}, [repoPath]);

	const [baseCommit, setBaseCommit] = useState("ab691fc");
	const [targetCommit, setTargetCommit] = useState("ab691fc");
	const [relativeFilePath, setRelativeFilePath] = useState(
		"debug/examples/starfish.kicad_pcb",
	);

	return {
		repoPath,
		setRepoPath,
		baseCommit,
		setBaseCommit,
		targetCommit,
		setTargetCommit,
		relativeFilePath,
		setRelativeFilePath,
	};
}

function useLayerViewerState() {
	const [diffMode, setDiffMode] = useState("Overlay Slider");
	const [selectedLayers, setSelectedLayers] = useState([
		"F.Cu",
		"F.SilkS",
		"F.Courtyard",
		"Edge.Cuts",
	]);
	const [soloLayer, setSoloLayer] = useState(null);
	const [layerOpacities, setLayerOpacities] = useState({});
	return {
		diffMode,
		setDiffMode,
		selectedLayers,
		setSelectedLayers,
		soloLayer,
		setSoloLayer,
		layerOpacities,
		setLayerOpacities,
	};
}

function usePanelCollapseState() {
	const [leftCollapsed, setLeftCollapsed] = useState(false);
	const [rightCollapsed, setRightCollapsed] = useState(false);
	return { leftCollapsed, setLeftCollapsed, rightCollapsed, setRightCollapsed };
}

export function useWorkspaceViewerState() {
	const layerState = useLayerViewerState();
	const collapseState = usePanelCollapseState();
	const [sliderValue, setSliderValue] = useState(50);
	const [activeAuditIdx, setActiveAuditIdx] = useState(null);
	const [isCopilotOpen, setIsCopilotOpen] = useState(false);

	return {
		...layerState,
		...collapseState,
		sliderValue,
		setSliderValue,
		activeAuditIdx,
		setActiveAuditIdx,
		isCopilotOpen,
		setIsCopilotOpen,
	};
}

function buildLocalProps({ revisions, form, localRepo, diffLoader }) {
	return {
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
}

function buildGithubProps({ revisions, gh, diffLoader }) {
	return {
		...revisions,
		githubToken: gh.githubToken,
		githubUser: gh.githubUser,
		onOpenAuthModal: () => gh.setGithubModalOpen(true),
		onFetchDiff: diffLoader.fetchRemoteDiff,
		loading: diffLoader.loading,
		selectedRepo: gh.selectedRemoteRepo,
		setSelectedRepo: gh.setSelectedRemoteRepo,
	};
}

function extractLayerProps(viewer) {
	return {
		diffMode: viewer.diffMode,
		setDiffMode: viewer.setDiffMode,
		selectedLayers: viewer.selectedLayers,
		setSelectedLayers: viewer.setSelectedLayers,
		soloLayer: viewer.soloLayer,
		setSoloLayer: viewer.setSoloLayer,
		layerOpacities: viewer.layerOpacities,
		setLayerOpacities: viewer.setLayerOpacities,
	};
}

function assembleSubsystemProps(ctx) {
	return {
		localProps: buildLocalProps(ctx),
		githubProps: buildGithubProps(ctx),
		layerProps: extractLayerProps(ctx.viewer),
	};
}

function buildShellProps(viewer, gh) {
	return {
		onOpenCopilot: () => viewer.setIsCopilotOpen(true),
		kicadVersion: gh.kicadVersion,
		backendStatus: gh.backendStatus,
		githubUser: gh.githubUser,
		onOpenGithubModal: () => gh.setGithubModalOpen(true),
	};
}

function buildAuditProps(viewer, focus, activeDiffData) {
	return {
		rightCollapsed: viewer.rightCollapsed,
		setRightCollapsed: viewer.setRightCollapsed,
		activeDiffData,
		activeAuditIdx: viewer.activeAuditIdx,
		onHoverDiff: focus.setHoveredDiff,
		onSelectDiff: focus.selectDiffItem,
		onClearFocus: focus.resetFocusView,
	};
}

function buildCopilotProps(viewer, boardContext, handleSelectCopilotMod) {
	return {
		open: viewer.isCopilotOpen,
		onClose: () => viewer.setIsCopilotOpen(false),
		boardContext,
		onSelectModification: handleSelectCopilotMod,
	};
}

function buildGithubModalProps(gh) {
	return {
		open: gh.githubModalOpen,
		onClose: () => gh.setGithubModalOpen(false),
		githubUser: gh.githubUser,
		githubToken: gh.githubToken,
		onAuthSuccess: gh.handleAuthSuccess,
		onDisconnect: gh.handleDisconnectGithub,
	};
}

function assembleWorkspaceReturn(p) {
	return {
		shellProps: buildShellProps(p.viewer, p.gh),
		sidebarProps: buildSidebarProps({
			leftCollapsed: p.viewer.leftCollapsed,
			setLeftCollapsed: p.viewer.setLeftCollapsed,
			onFolderDrop: p.localRepo.handleFolderDrop,
			gh: p.gh,
			localProps: p.localProps,
			githubProps: p.githubProps,
			layerProps: p.layerProps,
		}),
		edgeTabsProps: extractCollapseProps(p.viewer),
		viewportProps: p.viewportProps,
		auditProps: buildAuditProps(p.viewer, p.focus, p.activeDiffData),
		copilotProps: buildCopilotProps(
			p.viewer,
			p.boardContext,
			p.handleSelectCopilotMod,
		),
		githubModalProps: buildGithubModalProps(p.gh),
	};
}

export function useWorkspaceDiffSync({ revisions, gh }) {
	const [diffDataState, setDiffDataState] = useState(null);

	const evolution = useEvolutionTimeline({
		...extractRevisionPaths(revisions),
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

function useWorkspaceLocalRepo(form, revisions) {
	return useLocalGitRepo({
		form,
		repoPath: revisions.repoPath,
		setRepoPath: revisions.setRepoPath,
		relativeFilePath: revisions.relativeFilePath,
		setRelativeFilePath: revisions.setRelativeFilePath,
		setBaseCommit: revisions.setBaseCommit,
		setTargetCommit: revisions.setTargetCommit,
	});
}

function useWorkspaceFocus(viewer, sideBySideRef, diffCanvasRef) {
	return useDiffFocus({
		diffMode: viewer.diffMode,
		sideBySideRef,
		diffCanvasRef,
		activeAuditIdx: viewer.activeAuditIdx,
		setActiveAuditIdx: viewer.setActiveAuditIdx,
		selectedLayers: viewer.selectedLayers,
		setSelectedLayers: viewer.setSelectedLayers,
	});
}

function useWorkspacePadLabelProps(revisions, gh) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: narrower deps prevent re-running on every render when revisions reference changes
	return useMemo(() => {
		return createPadLabelProps({
			...extractRevisionPaths(revisions),
			selectedRemoteRepo: gh.selectedRemoteRepo,
			githubToken: gh.githubToken,
		});
	}, [
		revisions.baseCommit,
		gh.githubToken,
		gh.selectedRemoteRepo,
		revisions.relativeFilePath,
		revisions.repoPath,
		revisions.targetCommit,
	]);
}

function useWorkspaceCopilotModSelect(activeDiffData, focus) {
	return useCallback(
		(modId, label) => {
			const mods = activeDiffData?.modifications || [];
			const idx = findCopilotModIndex(mods, modId, label);
			if (idx !== -1) {
				focus.selectDiffItem(mods[idx], idx);
			}
		},
		[activeDiffData, focus],
	);
}

function assembleWorkspaceState(ctx) {
	const { viewer, revisions, activeDiffData, evolution } = ctx;
	const subsystemProps = assembleSubsystemProps(ctx);
	const boardContext = buildBoardContext({
		revisions,
		selectedLayers: viewer.selectedLayers,
		diffMode: viewer.diffMode,
		diffData: activeDiffData,
		activeAuditIdx: viewer.activeAuditIdx,
		evolution,
	});
	const viewportProps = buildViewportProps(ctx);

	return assembleWorkspaceReturn({
		...ctx,
		...subsystemProps,
		boardContext,
		viewportProps,
	});
}

export function useWorkspaceState() {
	const [form] = Form.useForm();
	const sideBySideRef = useRef(null);
	const diffCanvasRef = useRef(null);
	const revisions = useWorkspaceRevisions();
	const viewer = useWorkspaceViewerState();

	const localRepo = useWorkspaceLocalRepo(form, revisions);
	const gh = useBackendHealthAndGithub({
		onMountRepoInit: () => localRepo.loadRepoInfo(revisions.repoPath, true),
	});

	const { evolution, diffLoader, activeDiffData } = useWorkspaceDiffSync({
		revisions,
		gh,
	});
	const focus = useWorkspaceFocus(viewer, sideBySideRef, diffCanvasRef);
	const padLabelProps = useWorkspacePadLabelProps(revisions, gh);
	const handleSelectCopilotMod = useWorkspaceCopilotModSelect(
		activeDiffData,
		focus,
	);

	return assembleWorkspaceState({
		form,
		sideBySideRef,
		diffCanvasRef,
		revisions,
		viewer,
		localRepo,
		gh,
		diffLoader,
		evolution,
		activeDiffData,
		focus,
		padLabelProps,
		handleSelectCopilotMod,
	});
}
