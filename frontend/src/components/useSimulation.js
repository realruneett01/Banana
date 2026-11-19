import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diffIssues } from "./issueDelta.js";

function pickFirstKind(list) {
	if (!Array.isArray(list) || list.length === 0) return "";
	const first = list[0];
	if (typeof first === "object" && first !== null) {
		return first.id ?? first.value ?? first.key ?? "";
	}
	return String(first);
}

function updateIssueList(issues, id, nextStatus) {
	return issues.map((item) =>
		item.id === id ? { ...item, status: nextStatus } : item,
	);
}

function stopController(ref) {
	if (ref.current) {
		ref.current.abort();
		ref.current = null;
	}
}

function nextSignal(ref) {
	stopController(ref);
	const controller = new AbortController();
	ref.current = controller;
	return controller.signal;
}

function handleSimResult(res, setters, isAuto) {
	if (res.ok) {
		const nextIssues = res.data?.issues ?? [];
		setters.applySimResult?.(nextIssues, isAuto);
		setters.setRun(res.data?.run ?? null);
		setters.setIssues(nextIssues);
		setters.setStatus("done");
		return;
	}
	setters.setError(res.error || "Simulation failed");
	setters.setStatus("error");
}

function handleErcResult(res, setters) {
	if (res.ok) {
		setters.setRun(null);
		setters.setIssues(res.data?.issues ?? []);
		setters.setStatus("done");
		return;
	}
	setters.setError(res.error || "ERC failed");
	setters.setStatus("error");
}

function canRunSim(status, commit, env, kind) {
	if (status === "running") return false;
	if (!commit) return false;
	if (!env?.id) return false;
	return Boolean(kind);
}

function canRunErc(status, commit) {
	if (status === "running") return false;
	return Boolean(commit);
}

function extractKinds(data) {
	if (Array.isArray(data?.kinds)) return data.kinds;
	if (Array.isArray(data)) return data;
	return [];
}

function useKindsLoader(api, setKinds, setKind) {
	useEffect(() => {
		let active = true;
		async function fetchKinds() {
			if (!api?.getKinds) return;
			const res = await api.getKinds();
			if (!active || !res?.ok) return;
			const list = extractKinds(res.data);
			setKinds(list);
			setKind((prev) => prev || pickFirstKind(list));
		}
		fetchKinds();
		return () => {
			active = false;
		};
	}, [api, setKinds, setKind]);
}

function useSimState() {
	const [kinds, setKinds] = useState([]);
	const [kind, setKind] = useState("");
	const [env, setEnv] = useState(null);
	const [issues, setIssues] = useState([]);
	const [run, setRun] = useState(null);
	const [status, setStatus] = useState("idle");
	const [error, setError] = useState(null);
	return {
		kinds,
		setKinds,
		kind,
		setKind,
		env,
		setEnv,
		issues,
		setIssues,
		run,
		setRun,
		status,
		setStatus,
		error,
		setError,
	};
}

async function startSim({
	api,
	ir,
	commit,
	s,
	abortRef,
	setters,
	isAuto = false,
}) {
	s.setStatus("running");
	s.setError(null);
	const signal = nextSignal(abortRef);
	const res = await api?.runSim?.(
		{ kind: s.kind, env: s.env, commit, inputs: { ir } },
		{ signal },
	);
	if (signal.aborted || !res) return;
	handleSimResult(res, setters, isAuto);
}

async function startErc({ api, ir, commit, s, abortRef, setters }) {
	s.setStatus("running");
	s.setError(null);
	const signal = nextSignal(abortRef);
	const res = await api?.runErc?.({ ir, commit }, { signal });
	if (signal.aborted || !res) return;
	handleErcResult(res, setters);
}

function useAutoSim({
	api,
	ir,
	commit,
	s,
	abortRef,
	setters,
	setDelta,
	prevIr,
	hasResult,
}) {
	useEffect(() => {
		if (prevIr.current === ir) return;
		if (!hasResult.current) {
			prevIr.current = ir;
			return;
		}
		if (!canRunSim(s.status, commit, s.env, s.kind)) return;
		prevIr.current = ir;
		setDelta(null);
		startSim({ api, ir, commit, s, abortRef, setters, isAuto: true });
	}, [api, ir, commit, s, abortRef, setters, setDelta, prevIr, hasResult]);
}

function useSimActions({
	api,
	ir,
	commit,
	s,
	abortRef,
	setters,
	setDelta,
	prevIr,
}) {
	const cancel = useCallback(() => {
		stopController(abortRef);
		s.setStatus("idle");
	}, [s.setStatus, abortRef]);

	const runSelected = useCallback(() => {
		if (!canRunSim(s.status, commit, s.env, s.kind)) return;
		prevIr.current = ir;
		setDelta(null);
		startSim({ api, ir, commit, s, abortRef, setters, isAuto: false });
	}, [api, ir, commit, s, abortRef, setters, setDelta, prevIr]);

	const runErc = useCallback(() => {
		if (!canRunErc(s.status, commit)) return;
		setDelta(null);
		startErc({ api, ir, commit, s, abortRef, setters });
	}, [api, ir, commit, s, abortRef, setters, setDelta]);

	const setIssueStatus = useCallback(
		(id, nextStatus) => {
			s.setIssues((prev) => updateIssueList(prev, id, nextStatus));
		},
		[s.setIssues],
	);

	return { cancel, runSelected, runErc, setIssueStatus };
}

export function useSimulation({ api, ir, commit }) {
	const s = useSimState();
	const abortRef = useRef(null);
	const prevIr = useRef(ir);
	const prevIssues = useRef(null);
	const hasResult = useRef(false);
	const [delta, setDelta] = useState(null);

	const applySimResult = useCallback((nextIssues, isAuto) => {
		hasResult.current = true;
		setDelta(isAuto ? diffIssues(prevIssues.current ?? [], nextIssues) : null);
		prevIssues.current = nextIssues;
	}, []);

	const setters = useMemo(
		() => ({
			setRun: s.setRun,
			setIssues: s.setIssues,
			setStatus: s.setStatus,
			setError: s.setError,
			applySimResult,
		}),
		[s.setRun, s.setIssues, s.setStatus, s.setError, applySimResult],
	);

	useKindsLoader(api, s.setKinds, s.setKind);
	useEffect(() => () => stopController(abortRef), []);
	useAutoSim({
		api,
		ir,
		commit,
		s,
		abortRef,
		setters,
		setDelta,
		prevIr,
		hasResult,
	});
	const actions = useSimActions({
		api,
		ir,
		commit,
		s,
		abortRef,
		setters,
		setDelta,
		prevIr,
	});

	return {
		kinds: s.kinds,
		kind: s.kind,
		setKind: s.setKind,
		env: s.env,
		setEnv: s.setEnv,
		issues: s.issues,
		run: s.run,
		status: s.status,
		error: s.error,
		delta,
		...actions,
	};
}
