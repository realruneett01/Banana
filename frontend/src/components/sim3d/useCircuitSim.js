import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectEvents, frameAt, playbackClock } from "./transientModel.js";

const MSG_503 = "The circuit simulator isn't installed on this server yet";

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

function resolveErrorMessage(res) {
	if (res?.status === 503) {
		return MSG_503;
	}
	return res?.error || "Simulation failed";
}

async function executeSim({
	api,
	ir,
	fault,
	analysis,
	signal,
	onSuccess,
	onFailure,
}) {
	const res = await api.simulateCircuit(
		{ ir, fault: fault || undefined, analysis },
		{ signal },
	);
	if (signal.aborted || !res) return;
	if (res.ok) {
		onSuccess(res.data ?? null);
	} else {
		onFailure(resolveErrorMessage(res));
	}
}

function useFaultsLoader({
	api,
	ir,
	setFaults,
	setSelectedFault,
	resetSim,
	hasResultRef,
}) {
	const abortRef = useRef(null);

	useEffect(() => {
		if (!ir) {
			setSelectedFault(null);
			resetSim();
			setFaults([]);
			return;
		}
		if (!hasResultRef.current) {
			setSelectedFault(null);
			resetSim();
		}
		if (!api?.suggestFaults) {
			setFaults([]);
			return;
		}
		const signal = nextSignal(abortRef);
		api.suggestFaults({ ir }, { signal }).then((res) => {
			if (signal.aborted || !res?.ok) return;
			setFaults(res.data?.faults ?? []);
		});
		return () => stopController(abortRef);
	}, [api, ir, setFaults, setSelectedFault, resetSim, hasResultRef]);
}

function usePlaybackAnimation({
	playing,
	setPlaying,
	duration,
	clockRef,
	setTime,
}) {
	const rafRef = useRef(null);

	useEffect(() => {
		const canAnimate =
			playing && duration > 0 && typeof requestAnimationFrame === "function";
		if (!canAnimate) return;

		let lastNow = performance.now();
		const tick = (now) => {
			const dtWallS = Math.max(0, (now - lastNow) / 1000);
			lastNow = now;
			const nextT = clockRef.current?.advance(dtWallS) ?? 0;
			setTime(nextT);
			if (nextT >= duration) {
				setPlaying(false);
				return;
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
		return () => {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
		};
	}, [playing, duration, setPlaying, clockRef, setTime]);

	useEffect(() => {
		return () => {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
		};
	}, []);
}

function useSimPlayback({ result, ir }) {
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeed] = useState(1);
	const [time, setTime] = useState(0);
	const clockRef = useRef(null);
	const speedRef = useRef(speed);
	speedRef.current = speed;

	const duration = useMemo(() => {
		const times = result?.series?.time;
		return times?.length ? (times[times.length - 1] ?? 0) : 0;
	}, [result]);

	const events = useMemo(() => {
		return result?.series ? detectEvents(result.series, ir) : [];
	}, [result, ir]);

	useEffect(() => {
		clockRef.current = playbackClock({
			durationS: duration,
			speed: speedRef.current,
		});
		setTime(0);
	}, [duration]);

	useEffect(() => {
		clockRef.current?.setSpeed(speed);
	}, [speed]);

	usePlaybackAnimation({ playing, setPlaying, duration, clockRef, setTime });

	const seek = useCallback((targetT) => {
		const clamped = clockRef.current ? clockRef.current.seek(targetT) : 0;
		setTime(clamped);
	}, []);

	const currentFrame = useMemo(() => {
		if (result?.series) return frameAt(result.series, time);
		return {
			nodeVoltages: result?.nodeVoltages ?? {},
			partCurrents: result?.partCurrents ?? {},
		};
	}, [result, time]);

	return {
		playing,
		setPlaying,
		speed,
		setSpeed,
		time,
		duration,
		seek,
		events,
		currentFrame,
	};
}

function useSimExecution({
	api,
	ir,
	selectedFault,
	analysisMode,
	setResult,
	setStatus,
	setError,
}) {
	const runAbortRef = useRef(null);
	useEffect(() => () => stopController(runAbortRef), []);

	const run = useCallback(
		async (faultOverride) => {
			if (!api?.simulateCircuit || !ir) return;
			const fault = faultOverride !== undefined ? faultOverride : selectedFault;
			const analysis =
				analysisMode === "over time"
					? { type: "tran", stepS: 1e-5, stopS: 0.01 }
					: undefined;
			setStatus("running");
			setError(null);
			const signal = nextSignal(runAbortRef);
			await executeSim({
				api,
				ir,
				fault,
				analysis,
				signal,
				onSuccess: (data) => {
					setResult(data);
					setStatus("done");
				},
				onFailure: (err) => {
					setError(err);
					setStatus("error");
				},
			});
		},
		[api, ir, selectedFault, analysisMode, setResult, setStatus, setError],
	);

	return run;
}

function shouldResimulate(prevIr, nextIr, hasResult) {
	if (!hasResult) {
		return false;
	}
	if (!prevIr || !nextIr) {
		return false;
	}
	return prevIr !== nextIr;
}

function useAutoResim({ ir, run, hasResultRef }) {
	const prevIrRef = useRef(ir);

	useEffect(() => {
		const prevIr = prevIrRef.current;
		prevIrRef.current = ir;
		if (shouldResimulate(prevIr, ir, hasResultRef.current)) {
			run();
		}
	}, [ir, run, hasResultRef]);
}

function useSimResultState(ir) {
	const [status, setStatus] = useState("idle");
	const [error, setError] = useState(null);
	const [result, setResult] = useState(null);
	const hasResultRef = useRef(false);

	if (result) {
		hasResultRef.current = true;
	} else if (!ir) {
		hasResultRef.current = false;
	}

	const resetSim = useCallback(() => {
		setResult(null);
		setError(null);
		setStatus("idle");
		hasResultRef.current = false;
	}, []);

	return {
		status,
		setStatus,
		error,
		setError,
		result,
		setResult,
		resetSim,
		hasResultRef,
	};
}

export function useCircuitSim({ api, ir }) {
	const resState = useSimResultState(ir);
	const [faults, setFaults] = useState([]);
	const [selectedFault, setSelectedFault] = useState(null);
	const [analysisMode, setAnalysisMode] = useState("snapshot");

	useFaultsLoader({
		api,
		ir,
		setFaults,
		setSelectedFault,
		resetSim: resState.resetSim,
		hasResultRef: resState.hasResultRef,
	});
	const run = useSimExecution({
		api,
		ir,
		selectedFault,
		analysisMode,
		setResult: resState.setResult,
		setStatus: resState.setStatus,
		setError: resState.setError,
	});
	useAutoResim({ ir, run, hasResultRef: resState.hasResultRef });
	const playback = useSimPlayback({ result: resState.result, ir });

	return {
		status: resState.status,
		error: resState.error,
		result: resState.result,
		faults,
		selectedFault,
		setFault: setSelectedFault,
		run,
		analysisMode,
		setAnalysisMode,
		...playback,
	};
}
