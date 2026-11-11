import { useCallback, useEffect, useRef, useState } from "react";

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

async function executeSim({ api, ir, fault, signal, onSuccess, onFailure }) {
	const res = await api.simulateCircuit(
		{ ir, fault: fault || undefined },
		{ signal },
	);
	if (signal.aborted || !res) return;
	if (res.ok) {
		onSuccess(res.data ?? null);
	} else {
		onFailure(resolveErrorMessage(res));
	}
}

function useFaultsLoader({ api, ir, setFaults, setSelectedFault, resetSim }) {
	const abortRef = useRef(null);

	useEffect(() => {
		setSelectedFault(null);
		resetSim();
		if (!api?.suggestFaults || !ir) {
			setFaults([]);
			return;
		}
		const signal = nextSignal(abortRef);
		api.suggestFaults({ ir }, { signal }).then((res) => {
			if (signal.aborted || !res?.ok) return;
			setFaults(res.data?.faults ?? []);
		});
		return () => stopController(abortRef);
	}, [api, ir, setFaults, setSelectedFault, resetSim]);
}

export function useCircuitSim({ api, ir }) {
	const [status, setStatus] = useState("idle");
	const [error, setError] = useState(null);
	const [result, setResult] = useState(null);
	const [faults, setFaults] = useState([]);
	const [selectedFault, setSelectedFault] = useState(null);
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeed] = useState(1);
	const runAbortRef = useRef(null);

	const resetSim = useCallback(() => {
		setResult(null);
		setError(null);
		setStatus("idle");
	}, []);

	useFaultsLoader({ api, ir, setFaults, setSelectedFault, resetSim });
	useEffect(() => () => stopController(runAbortRef), []);

	const run = useCallback(
		async (faultOverride) => {
			if (!api?.simulateCircuit || !ir) return;
			const fault = faultOverride !== undefined ? faultOverride : selectedFault;
			setStatus("running");
			setError(null);
			const signal = nextSignal(runAbortRef);
			await executeSim({
				api,
				ir,
				fault,
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
		[api, ir, selectedFault],
	);

	return {
		status,
		error,
		result,
		faults,
		selectedFault,
		setFault: setSelectedFault,
		run,
		playing,
		setPlaying,
		speed,
		setSpeed,
	};
}
