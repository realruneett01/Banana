import { message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "./config.js";

async function fetchEvolutionPathApi(repo, base, target, file) {
	if (!repo || !base || !target) return null;
	try {
		const q = new URLSearchParams({
			repoPath: repo,
			baseCommit: base,
			targetCommit: target,
			filePath: file || "",
		});
		const res = await fetch(
			`${API_BASE_URL}/api/git/evolution?${q.toString()}`,
		);
		return res.ok ? res.json() : null;
	} catch (e) {
		console.warn("[Banana] Evolution path check error:", e.message);
		return null;
	}
}

async function fetchStepDiffApi(
	repoPath,
	fromCommit,
	toCommit,
	relativeFilePath,
) {
	const response = await fetch(`${API_BASE_URL}/api/diff/process`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			repoPath,
			baseCommit: fromCommit,
			targetCommit: toCommit,
			relativeFilePath,
			isPcb: relativeFilePath ? relativeFilePath.endsWith(".kicad_pcb") : true,
		}),
	});

	if (!response.ok) throw new Error("Failed to process step");
	return response.json();
}

function advanceEvolutionStep({
	totalSteps,
	loadEvolutionStep,
	setEvolutionPlaying,
}) {
	return (prev) => {
		if (prev < totalSteps - 1) {
			const next = prev + 1;
			loadEvolutionStep(next);
			return next;
		}
		setEvolutionPlaying(false);
		return prev;
	};
}

function useEvolutionAutoPlay(state, loadEvolutionStep) {
	const {
		evolutionPlaying,
		evolutionEnabled,
		evolutionData,
		setEvolutionStep,
		setEvolutionPlaying,
	} = state;

	useEffect(() => {
		if (!evolutionPlaying || !evolutionEnabled || !evolutionData) return;
		const totalSteps = Math.max(0, evolutionData.commits.length - 1);
		const advance = advanceEvolutionStep({
			totalSteps,
			loadEvolutionStep,
			setEvolutionPlaying,
		});
		const timer = setInterval(() => setEvolutionStep(advance), 2800);
		return () => clearInterval(timer);
	}, [
		evolutionPlaying,
		evolutionEnabled,
		evolutionData,
		loadEvolutionStep,
		setEvolutionPlaying,
		setEvolutionStep,
	]);
}

function resolveStepCommits(dataToUse, targetMode, stepIndex) {
	if (!dataToUse?.commits || dataToUse.commits.length < 2) return null;
	const fromCommit =
		targetMode === "cumulative"
			? dataToUse.commits[0].hash
			: dataToUse.commits[stepIndex].hash;
	const toCommit = dataToUse.commits[stepIndex + 1]?.hash;
	return toCommit ? { fromCommit, toCommit } : null;
}

async function fetchStepWithCache(cacheRef, params) {
	const { repoPath, fromCommit, toCommit, relativeFilePath } = params;
	const cacheKey = `${fromCommit}..${toCommit}`;
	if (cacheRef.current[cacheKey]) {
		return cacheRef.current[cacheKey];
	}
	const data = await fetchStepDiffApi(
		repoPath,
		fromCommit,
		toCommit,
		relativeFilePath,
	);
	cacheRef.current[cacheKey] = data;
	return data;
}

async function executeStepDiff(cacheRef, query, commits) {
	return fetchStepWithCache(cacheRef, {
		repoPath: query.repoPath,
		fromCommit: commits.fromCommit,
		toCommit: commits.toCommit,
		relativeFilePath: query.relativeFilePath,
	});
}

function disableEvolutionMode(props, state) {
	state.setEvolutionEnabled(false);
	state.setEvolutionPlaying(false);
	if (state.directDiffDataRef.current) {
		props.setDiffData(state.directDiffDataRef.current);
	}
}

async function ensureEvolutionData(props, state) {
	if (state.evolutionData?.commits?.length >= 2) return state.evolutionData;
	const fetched = await fetchEvolutionPathApi(
		props.repoPath,
		props.baseCommit,
		props.targetCommit,
		props.relativeFilePath,
	);
	if (fetched) state.setEvolutionData(fetched);
	return fetched;
}

async function activateEvolution(
	props,
	state,
	loadEvolutionStep,
	currentEvData,
) {
	if (!state.directDiffDataRef.current && props.diffData) {
		state.directDiffDataRef.current = props.diffData;
	}
	state.setEvolutionEnabled(true);
	state.setEvolutionStep(0);
	await loadEvolutionStep(0, state.evolutionMode, currentEvData);
}

async function enableEvolutionMode(props, state, loadEvolutionStep) {
	const currentEvData = await ensureEvolutionData(props, state);
	if (currentEvData?.commits?.length >= 2) {
		await activateEvolution(props, state, loadEvolutionStep, currentEvData);
		return;
	}
	message.info("No intermediate commits found between selected revisions.");
}

async function performToggleEvolution(enable, props, state, loadEvolutionStep) {
	const nextState = enable !== undefined ? enable : !state.evolutionEnabled;
	if (!nextState) {
		disableEvolutionMode(props, state);
		return;
	}
	await enableEvolutionMode(props, state, loadEvolutionStep);
}

async function runStepLoad(props, state, setEvolutionLoading, step) {
	const commits = resolveStepCommits(
		step.evData || state.evolutionData,
		step.targetMode || state.evolutionMode,
		step.stepIndex,
	);
	if (!commits) return;

	setEvolutionLoading(true);
	try {
		const data = await executeStepDiff(state.evolutionCacheRef, props, commits);
		props.setDiffData(data);
		state.setEvolutionStep(step.stepIndex);
	} catch (e) {
		message.error(`Failed to load step: ${e.message}`);
	} finally {
		setEvolutionLoading(false);
	}
}

function useEvolutionStepLoader(props, state) {
	const [evolutionLoading, setEvolutionLoading] = useState(false);

	const loadEvolutionStep = useCallback(
		(stepIndex, targetMode, evData) =>
			runStepLoad(props, state, setEvolutionLoading, {
				stepIndex,
				targetMode,
				evData,
			}),
		[props, state],
	);

	return { evolutionLoading, loadEvolutionStep };
}

function useEvolutionPathInit(props, state) {
	const { repoPath, baseCommit, targetCommit, relativeFilePath } = props;
	const { setEvolutionData, setEvolutionStep } = state;

	const checkEvolutionPath = useCallback(
		async (repo, base, target, file) => {
			const data = await fetchEvolutionPathApi(repo, base, target, file);
			if (!data) return;
			setEvolutionData(data);
			setEvolutionStep(0);
		},
		[setEvolutionData, setEvolutionStep],
	);

	useEffect(() => {
		if (!repoPath || !baseCommit || !targetCommit) return;
		checkEvolutionPath(repoPath, baseCommit, targetCommit, relativeFilePath);
	}, [
		repoPath,
		baseCommit,
		targetCommit,
		relativeFilePath,
		checkEvolutionPath,
	]);

	return { checkEvolutionPath };
}

function useEvolutionToggle(props, state, loadEvolutionStep) {
	return useCallback(
		(enable) => performToggleEvolution(enable, props, state, loadEvolutionStep),
		[props, state, loadEvolutionStep],
	);
}

function useEvolutionState() {
	const [evolutionEnabled, setEvolutionEnabled] = useState(false);
	const [evolutionData, setEvolutionData] = useState(null);
	const [evolutionStep, setEvolutionStep] = useState(0);
	const [evolutionPlaying, setEvolutionPlaying] = useState(false);
	const [evolutionMode, setEvolutionMode] = useState("step"); // 'step' | 'cumulative'

	const directDiffDataRef = useRef(null);
	const evolutionCacheRef = useRef({});

	return {
		evolutionEnabled,
		setEvolutionEnabled,
		evolutionData,
		setEvolutionData,
		evolutionStep,
		setEvolutionStep,
		evolutionPlaying,
		setEvolutionPlaying,
		evolutionMode,
		setEvolutionMode,
		directDiffDataRef,
		evolutionCacheRef,
	};
}

function buildTimelineResult(state, actions) {
	return {
		evolutionEnabled: state.evolutionEnabled,
		setEvolutionEnabled: state.setEvolutionEnabled,
		evolutionData: state.evolutionData,
		evolutionStep: state.evolutionStep,
		evolutionPlaying: state.evolutionPlaying,
		setEvolutionPlaying: state.setEvolutionPlaying,
		evolutionMode: state.evolutionMode,
		setEvolutionMode: state.setEvolutionMode,
		evolutionLoading: actions.evolutionLoading,
		directDiffDataRef: state.directDiffDataRef,
		checkEvolutionPath: actions.checkEvolutionPath,
		loadEvolutionStep: actions.loadEvolutionStep,
		toggleEvolutionMode: actions.toggleEvolutionMode,
	};
}

export function useEvolutionTimeline({
	repoPath,
	baseCommit,
	targetCommit,
	relativeFilePath,
	diffData,
	setDiffData,
}) {
	const props = {
		repoPath,
		baseCommit,
		targetCommit,
		relativeFilePath,
		diffData,
		setDiffData,
	};
	const state = useEvolutionState();
	const pathInit = useEvolutionPathInit(props, state);
	const loader = useEvolutionStepLoader(props, state);
	const toggle = useEvolutionToggle(props, state, loader.loadEvolutionStep);

	useEvolutionAutoPlay(state, loader.loadEvolutionStep);

	return buildTimelineResult(state, {
		evolutionLoading: loader.evolutionLoading,
		checkEvolutionPath: pathInit.checkEvolutionPath,
		loadEvolutionStep: loader.loadEvolutionStep,
		toggleEvolutionMode: toggle,
	});
}
