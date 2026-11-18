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

export function triggerEditorSave() {
	if (typeof document === "undefined") return;
	const saveBtn = document.querySelector("button[aria-label='Save']");
	if (saveBtn && !saveBtn.disabled) {
		saveBtn.click();
	}
}

function useStudioState(setIr) {
	const [studioOpen, setStudioOpen] = useState(false);
	const closeStudio = useCallback(() => setStudioOpen(false), []);
	const openStudio = useCallback(
		(nextIr) => {
			triggerEditorSave();
			if (isCircuitIr(nextIr)) {
				setIr(nextIr);
			}
			setStudioOpen(true);
		},
		[setIr],
	);
	return { studioOpen, openStudio, closeStudio };
}

function resolveFocusId(itemId, issue) {
	const id = itemId ?? issue?.itemIds?.[0];
	if (typeof id !== "string") {
		return null;
	}
	return id.length > 0 ? id : null;
}

function useEditorFocus(setEditorOpen) {
	const [focusItemId, setFocusItemId] = useState(null);
	const clearFocus = useCallback(() => setFocusItemId(null), []);
	const focusInEditor = useCallback(
		(itemId, issue) => {
			const id = resolveFocusId(itemId, issue);
			if (id) {
				setFocusItemId(id);
				setEditorOpen(true);
			}
		},
		[setEditorOpen],
	);
	return { focusItemId, clearFocus, focusInEditor };
}

function createFreshIr() {
	return {
		schemaVersion: 1,
		name: "untitled",
		parts: [],
		nets: [],
		constraints: [],
	};
}

function resolveTab(tab) {
	return tab === "pcb" ? "pcb" : "schematic";
}

function useEditorDocument(setIr, setEditorOpen) {
	const [board, setBoard] = useState(null);
	const [symbols, setSymbols] = useState(null);
	const [editorTab, setEditorTab] = useState("schematic");
	const [docKey, setDocKey] = useState(0);

	const newDesign = useCallback(
		(kind) => {
			setIr(createFreshIr());
			setBoard(null);
			setSymbols(null);
			setEditorTab(resolveTab(kind));
			setDocKey((k) => k + 1);
			setEditorOpen(true);
		},
		[setIr, setEditorOpen],
	);

	const openDesign = useCallback(
		({ ir, board: nextBoard, tab, symbols: nextSymbols } = {}) => {
			if (!isCircuitIr(ir)) {
				return false;
			}
			setIr(ir);
			setBoard(nextBoard ?? null);
			setSymbols(nextSymbols ?? null);
			setEditorTab(resolveTab(tab));
			setDocKey((k) => k + 1);
			setEditorOpen(true);
			return true;
		},
		[setIr, setEditorOpen],
	);

	return {
		board,
		setBoard,
		symbols,
		editorTab,
		docKey,
		newDesign,
		openDesign,
	};
}

function useSaveFromEditor(setIr, setBoard) {
	return useCallback(
		(payload) => {
			const next = payload?.ir !== undefined ? payload.ir : payload;
			if (isCircuitIr(next)) {
				setIr(next);
			}
			if (payload?.board !== undefined && typeof setBoard === "function") {
				setBoard(payload.board);
			}
		},
		[setIr, setBoard],
	);
}

function useEditorState(setIr) {
	const [editorOpen, setEditorOpen] = useState(false);
	const { focusItemId, clearFocus, focusInEditor } =
		useEditorFocus(setEditorOpen);
	const closeEditor = useCallback(() => {
		triggerEditorSave();
		setEditorOpen(false);
		clearFocus();
	}, [clearFocus]);
	const openEditor = useCallback(
		(nextIr) => {
			if (isCircuitIr(nextIr)) {
				setIr(nextIr);
			}
			setEditorOpen(true);
		},
		[setIr],
	);
	const doc = useEditorDocument(setIr, setEditorOpen);
	const saveFromEditor = useSaveFromEditor(setIr, doc.setBoard);
	return {
		editorOpen,
		openEditor,
		closeEditor,
		saveFromEditor,
		focusItemId,
		focusInEditor,
		...doc,
	};
}

function useSimState(setIr) {
	const [simOpen, setSimOpen] = useState(false);
	const closeSimulation = useCallback(() => setSimOpen(false), []);
	const openSimulation = useCallback(
		(nextIr) => {
			triggerEditorSave();
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
