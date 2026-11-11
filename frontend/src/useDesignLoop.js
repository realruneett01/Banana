import { useCallback, useMemo, useState } from "react";
import { API_BASE_URL } from "./config.js";
import { applyFixToIr } from "./designFixes.js";
import { createSimApi } from "./simApi.js";

export function isCircuitIr(candidate) {
	if (!candidate || typeof candidate !== "object") {
		return false;
	}
	return !Array.isArray(candidate) && Array.isArray(candidate.parts);
}

function useStudioState(setIr) {
	const [studioOpen, setStudioOpen] = useState(false);
	const closeStudio = useCallback(() => setStudioOpen(false), []);
	const openStudio = useCallback(
		(nextIr) => {
			if (isCircuitIr(nextIr)) {
				setIr(nextIr);
			}
			setStudioOpen(true);
		},
		[setIr],
	);
	return { studioOpen, openStudio, closeStudio };
}

function useEditorState(setIr) {
	const [editorOpen, setEditorOpen] = useState(false);
	const closeEditor = useCallback(() => setEditorOpen(false), []);
	const openEditor = useCallback(
		(nextIr) => {
			if (isCircuitIr(nextIr)) {
				setIr(nextIr);
			}
			setEditorOpen(true);
		},
		[setIr],
	);
	const saveFromEditor = useCallback(
		(payload) => {
			const next = payload?.ir !== undefined ? payload.ir : payload;
			if (isCircuitIr(next)) {
				setIr(next);
			}
		},
		[setIr],
	);
	return { editorOpen, openEditor, closeEditor, saveFromEditor };
}

function useSimState(setIr) {
	const [simOpen, setSimOpen] = useState(false);
	const closeSimulation = useCallback(() => setSimOpen(false), []);
	const openSimulation = useCallback(
		(nextIr) => {
			if (isCircuitIr(nextIr)) {
				setIr(nextIr);
			}
			setSimOpen(true);
		},
		[setIr],
	);
	return { simOpen, openSimulation, closeSimulation };
}

const MAX_UNDO_STACK = 20;

function useFixState(ir, setIr) {
	const [undoStack, setUndoStack] = useState([]);
	const applyFix = useCallback(
		(fix) => {
			const result = applyFixToIr(ir, fix);
			if (result.ok) {
				setUndoStack((prev) => [...prev, ir].slice(-MAX_UNDO_STACK));
				setIr(result.ir);
			}
			return result;
		},
		[ir, setIr],
	);
	const undoFix = useCallback(() => {
		if (undoStack.length === 0) {
			return false;
		}
		const prevIr = undoStack[undoStack.length - 1];
		setUndoStack((prev) => prev.slice(0, -1));
		setIr(prevIr);
		return true;
	}, [undoStack, setIr]);
	return { applyFix, undoFix, canUndoFix: undoStack.length > 0 };
}

export function useDesignLoop({ baseUrl = API_BASE_URL, api: customApi } = {}) {
	const [agentOpen, setAgentOpen] = useState(false);
	const [ir, setIr] = useState(null);
	const api = useMemo(
		() => customApi ?? createSimApi({ baseUrl }),
		[customApi, baseUrl],
	);
	const openAgent = useCallback(() => setAgentOpen(true), []);
	const closeAgent = useCallback(() => setAgentOpen(false), []);
	const sim = useSimState(setIr);
	const studio = useStudioState(setIr);
	const editor = useEditorState(setIr);
	const fixes = useFixState(ir, setIr);

	return {
		api,
		agentOpen,
		openAgent,
		closeAgent,
		...sim,
		...studio,
		...editor,
		...fixes,
		ir,
		setIr,
	};
}
