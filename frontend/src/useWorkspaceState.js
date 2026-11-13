import { Form } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickDiffCommits, planProjectOpen } from "./projects/openProject.js";
import { useBackendHealthAndGithub } from "./useBackendHealthAndGithub.js";
import { useDiffFocus } from "./useDiffFocus.js";
import { useDiffLoader } from "./useDiffLoader.js";
import { useEvolutionTimeline } from "./useEvolutionTimeline.js";
import { useLocalGitRepo } from "./useLocalGitRepo.js";
import { findCopilotModIndex } from "./utils/auditLogUtils.js";
import { createPadLabelProps } from "./utils/diffLayerUtils.js";

function pick(source, keys) {
	const out = {};
	for (let i = 0; i < keys.length; i++) {
		const k = keys[i];
		out[k] = source[k];
	}
	return out;
}

const COLLAPSE_KEYS = [
	"leftCollapsed",
	"setLeftCollapsed",
	"rightCollapsed",
	"setRightCollapsed",
];

const REVISION_KEYS = [
	"repoPath",
	"baseCommit",
	"targetCommit",
	"relativeFilePath",
];

const LAYER_KEYS = [
	"diffMode",
	"setDiffMode",
	"selectedLayers",
	"setSelectedLayers",
	"soloLayer",
	"setSoloLayer",
	"layerOpacities",
	"setLayerOpacities",
];

const EVOLUTION_KEYS = [
	"evolutionEnabled",
	"evolutionData",
	"evolutionStep",
	"evolutionPlaying",
	"evolutionLoading",
	"evolutionMode",
	"toggleEvolutionMode",
	"loadEvolutionStep",
	"setEvolutionPlaying",
	"setEvolutionMode",
];

const LOCAL_REPO_KEYS = [
	"loadRepoInfo",
	"repoInfo",
	"compareBranches",
	"setCompareBranches",
	"changedFiles",
	"setChangedFiles",
	"fetchChangedFiles",
];

const VIEWPORT_VIEWER_KEYS = [
	"diffMode",
	"leftCollapsed",
	"setLeftCollapsed",
	"rightCollapsed",
	"setRightCollapsed",
	"selectedLayers",
	"soloLayer",
	"layerOpacities",
	"activeAuditIdx",
	"setActiveAuditIdx",
	"sliderValue",
	"setSliderValue",
];

const DIFF_LOADER_EVOLUTION_KEYS = [
	"directDiffDataRef",
	"setEvolutionEnabled",
	"setEvolutionPlaying",
	"checkEvolutionPath",
];

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
	return pick(viewer, COLLAPSE_KEYS);
}

function extractRevisionPaths(revisions) {
	return pick(revisions, REVISION_KEYS);
}

function buildSidebarProps(options) {
	const { gh, ...rest } = options;
	return {
		...rest,
		sourceMode: gh.sourceMode,
		onSourceModeChange: gh.handleSourceModeChange,
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
		relativeFilePath: revisions.relativeFilePath,
		baseCommit: revisions.baseCommit,
		targetCommit: revisions.targetCommit,
		sideBySideRef,
		diffCanvasRef,
		padLabelProps,
		...pick(viewer, VIEWPORT_VIEWER_KEYS),
		...pick(evolution, EVOLUTION_KEYS),
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
		...pick(localRepo, LOCAL_REPO_KEYS),
		form,
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
	return pick(viewer, LAYER_KEYS);
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
		...pick(evolution, DIFF_LOADER_EVOLUTION_KEYS),
	});

	useEffect(() => {
		if (diffLoader.diffData) setDiffDataState(diffLoader.diffData);
	}, [diffLoader.diffData]);

	const activeDiffData = diffDataState || diffLoader.diffData;

	return { evolution, diffLoader, activeDiffData };
}

function useWorkspaceLocalRepo(form, revisions, onCommitsAutoSelected) {
	return useLocalGitRepo({ form, ...revisions, onCommitsAutoSelected });
}

function useWorkspaceFocus(viewer, sideBySideRef, diffCanvasRef) {
	return useDiffFocus({
		sideBySideRef,
		diffCanvasRef,
		...viewer,
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

function useWorkspaceIntegrations(form, revisions) {
	const fetchDiffRef = useRef(null);
	const onCommitsAutoSelected = useCallback(
		(selection) => {
			fetchDiffRef.current?.({
				repoPath: revisions.repoPath,
				...selection,
			});
		},
		[revisions.repoPath],
	);
	const localRepo = useWorkspaceLocalRepo(
		form,
		revisions,
		onCommitsAutoSelected,
	);
	const gh = useBackendHealthAndGithub({
		onMountRepoInit: () => localRepo.loadRepoInfo(revisions.repoPath, true),
	});
	const diffSync = useWorkspaceDiffSync({ revisions, gh });
	useEffect(() => {
		fetchDiffRef.current = diffSync.diffLoader.fetchDiff;
	}, [diffSync.diffLoader.fetchDiff]);
	return { localRepo, gh, ...diffSync };
}

function useWorkspaceInteractions({
	activeDiffData,
	viewer,
	sideBySideRef,
	diffCanvasRef,
	revisions,
	gh,
}) {
	const focus = useWorkspaceFocus(viewer, sideBySideRef, diffCanvasRef);
	const padLabelProps = useWorkspacePadLabelProps(revisions, gh);
	const handleSelectCopilotMod = useWorkspaceCopilotModSelect(
		activeDiffData,
		focus,
	);
	return { focus, padLabelProps, handleSelectCopilotMod };
}

function applyOpenSelection(selection, { form, revisions }) {
	revisions.setRelativeFilePath(selection.relativeFilePath);
	revisions.setBaseCommit(selection.baseCommit);
	revisions.setTargetCommit(selection.targetCommit);
	form.setFieldsValue({
		relativeFilePath: selection.relativeFilePath,
		baseCommit: selection.baseCommit,
		targetCommit: selection.targetCommit,
	});
}

async function runOpenProjectFile(target, ctx) {
	const plan = planProjectOpen(target);
	if (!plan) return null;
	const info = await ctx.localRepo.loadRepoInfo(plan.repoPath, true);
	if (!info) return null;
	const pair = pickDiffCommits(info.commits);
	const selection = {
		repoPath: info.resolvedPath,
		relativeFilePath: plan.relativeFilePath,
		...(pair ?? { baseCommit: "", targetCommit: "" }),
	};
	applyOpenSelection(selection, ctx);
	if (pair) ctx.fetchDiff(selection);
	return { ...plan.editorRepo, repoPath: info.resolvedPath };
}

function useOpenProjectFile(ctx) {
	const { form, revisions, localRepo, fetchDiff } = ctx;
	return useCallback(
		(target) =>
			runOpenProjectFile(target, { form, revisions, localRepo, fetchDiff }),
		[form, revisions, localRepo, fetchDiff],
	);
}

export function useWorkspaceState() {
	const [form] = Form.useForm();
	const sideBySideRef = useRef(null);
	const diffCanvasRef = useRef(null);
	const revisions = useWorkspaceRevisions();
	const viewer = useWorkspaceViewerState();
	const integrations = useWorkspaceIntegrations(form, revisions);
	const interactions = useWorkspaceInteractions({
		activeDiffData: integrations.activeDiffData,
		viewer,
		sideBySideRef,
		diffCanvasRef,
		revisions,
		gh: integrations.gh,
	});

	const openProjectFile = useOpenProjectFile({
		form,
		revisions,
		localRepo: integrations.localRepo,
		fetchDiff: integrations.diffLoader.fetchDiff,
	});

	return {
		...assembleWorkspaceState({
			form,
			sideBySideRef,
			diffCanvasRef,
			revisions,
			viewer,
			...integrations,
			...interactions,
		}),
		openProjectFile,
	};
}
