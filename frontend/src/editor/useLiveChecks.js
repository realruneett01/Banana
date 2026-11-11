import { useCallback, useEffect, useRef, useState } from "react";

const INITIAL_STATE = Object.freeze({
	issues: [],
	markers: [],
	status: "idle",
	lastCheckedAt: null,
});

function isTabHidden() {
	return (
		typeof document !== "undefined" && document.visibilityState === "hidden"
	);
}

function handleSuccess(res, setResult) {
	setResult({
		issues: Array.isArray(res.data?.issues) ? res.data.issues : [],
		markers: Array.isArray(res.data?.markers) ? res.data.markers : [],
		status: "idle",
		lastCheckedAt: Date.now(),
	});
}

function handleError(res, signal, setResult) {
	if (signal?.aborted || res?.error === "aborted") {
		return;
	}
	setResult((prev) => ({ ...prev, status: "error" }));
}

async function executeCheck({ api, ir, board }, signal, setResult) {
	setResult((prev) => ({ ...prev, status: "checking" }));
	try {
		const res = await api.editorCheck({ ir, board }, { signal });
		if (res?.ok) {
			handleSuccess(res, setResult);
		} else {
			handleError(res, signal, setResult);
		}
	} catch {
		handleError(null, signal, setResult);
	}
}

function runCheck(
	{ activeReqRef, pausedRef, latestRef, setResult },
	ir,
	board,
) {
	if (isTabHidden()) {
		pausedRef.current = true;
		return;
	}
	pausedRef.current = false;
	if (activeReqRef.current) {
		activeReqRef.current.abort();
	}
	const ctrl = new AbortController();
	activeReqRef.current = ctrl;
	const payload = {
		...latestRef.current,
		ir: ir ?? latestRef.current.ir,
		board: board ?? latestRef.current.board,
	};
	executeCheck(payload, ctrl.signal, setResult);
}

function useVisibilityListener(runFn, pausedRef) {
	useEffect(() => {
		if (typeof document === "undefined") return;
		const onVisibility = () => {
			if (!isTabHidden() && pausedRef.current) {
				runFn();
			}
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [runFn, pausedRef]);
}

function useDebounceTimer(runFn, deps, timerRef) {
	const { api, ir, board, enabled } = deps;
	useEffect(() => {
		if (!enabled || typeof api?.editorCheck !== "function") {
			return;
		}
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => runFn(ir, board), 600);
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [runFn, api, ir, board, enabled, timerRef]);
}

function useCleanupRefs(activeReqRef, timerRef) {
	useEffect(() => {
		return () => {
			if (activeReqRef.current) activeReqRef.current.abort();
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [activeReqRef, timerRef]);
}

export function useLiveChecks({ api, ir, board, enabled = true }) {
	const [result, setResult] = useState(INITIAL_STATE);
	const activeReqRef = useRef(null);
	const timerRef = useRef(null);
	const pausedRef = useRef(false);
	const latestRef = useRef({ api, ir, board, enabled });
	latestRef.current = { api, ir, board, enabled };

	const run = useCallback((runIr, runBoard) => {
		runCheck(
			{ activeReqRef, pausedRef, latestRef, setResult },
			runIr,
			runBoard,
		);
	}, []);

	useVisibilityListener(run, pausedRef);
	useDebounceTimer(run, { api, ir, board, enabled }, timerRef);
	useCleanupRefs(activeReqRef, timerRef);

	return result;
}
