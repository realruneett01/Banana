import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEditor } from "./editorModel.js";

const DEFAULT_IR = Object.freeze({
	schemaVersion: 1,
	parts: [],
	nets: [],
});

function applyDispatchResult(next, cmd, setDoc, setDirty) {
	if (next && !next.error) {
		setDoc(next);
		if (cmd?.type !== "select") setDirty(true);
	}
	return next;
}

function applyStepResult(next, setDoc, setDirty) {
	setDoc(next);
	setDirty(true);
	return next;
}

function useHistoryOperations(base, setDoc, setDirty) {
	const dispatch = useCallback(
		(cmd) => applyDispatchResult(base.dispatch(cmd), cmd, setDoc, setDirty),
		[base, setDoc, setDirty],
	);
	const undo = useCallback(
		() => applyStepResult(base.undo(), setDoc, setDirty),
		[base, setDoc, setDirty],
	);
	const redo = useCallback(
		() => applyStepResult(base.redo(), setDoc, setDirty),
		[base, setDoc, setDirty],
	);
	return { dispatch, undo, redo };
}

function useBoardState(initialBoard, setDirty) {
	const [board, setBoardState] = useState(initialBoard);
	useEffect(() => {
		if (initialBoard !== undefined) setBoardState(initialBoard);
	}, [initialBoard]);

	const setBoard = useCallback(
		(next) => {
			setBoardState((prev) => (typeof next === "function" ? next(prev) : next));
			setDirty(true);
		},
		[setDirty],
	);

	return [board, setBoard];
}

function createEditorWrapper(base, dispatch, undo, redo) {
	return {
		get state() {
			return base.state;
		},
		get selection() {
			return base.selection;
		},
		get canUndo() {
			return base.canUndo;
		},
		get canRedo() {
			return base.canRedo;
		},
		dispatch,
		undo,
		redo,
	};
}

function buildDocumentResult(editor, doc, board, ops) {
	return {
		editor,
		doc,
		ir: doc.ir,
		board,
		setBoard: ops.setBoard,
		dispatch: ops.dispatch,
		undo: ops.undo,
		redo: ops.redo,
		canUndo: doc.history?.past?.length > 0,
		canRedo: doc.history?.future?.length > 0,
		dirty: ops.dirty,
		markSaved: ops.markSaved,
	};
}

export function useEditorDocument({ ir, board: initialBoard } = {}) {
	const editorRef = useRef(null);
	if (!editorRef.current) {
		editorRef.current = createEditor(ir ?? DEFAULT_IR);
	}
	const base = editorRef.current;
	const [doc, setDoc] = useState(() => base.state);
	const [dirty, setDirty] = useState(false);
	const [board, setBoard] = useBoardState(initialBoard, setDirty);
	const { dispatch, undo, redo } = useHistoryOperations(base, setDoc, setDirty);
	const markSaved = useCallback(() => setDirty(false), []);
	const editor = useMemo(
		() => createEditorWrapper(base, dispatch, undo, redo),
		[base, dispatch, undo, redo],
	);

	return buildDocumentResult(editor, doc, board, {
		setBoard,
		dispatch,
		undo,
		redo,
		dirty,
		markSaved,
	});
}
