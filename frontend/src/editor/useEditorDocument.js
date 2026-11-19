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

function findPartMoveCommand(oldPart, newPart) {
	if (!newPart?.placement) return null;
	const oldPl = oldPart?.placement;
	const isNewX = !oldPl || oldPl.x !== newPart.placement.x;
	const isNewY = !oldPl || oldPl.y !== newPart.placement.y;
	if (isNewX || isNewY) {
		return {
			type: "movePart",
			partId: newPart.id,
			x: newPart.placement.x,
			y: newPart.placement.y,
		};
	}
	return null;
}

function buildDiffCommands(oldIr, newIr) {
	const commands = [];
	const oldMap = new Map((oldIr?.parts ?? []).map((p) => [p.id, p]));
	for (const newPart of newIr?.parts ?? []) {
		const oldPart = oldMap.get(newPart.id);
		if (!oldPart) {
			commands.push({ type: "addPart", part: newPart });
			continue;
		}
		const moveCmd = findPartMoveCommand(oldPart, newPart);
		if (moveCmd) commands.push(moveCmd);
	}
	for (const oldPart of oldIr?.parts ?? []) {
		if (!newIr?.parts?.some((p) => p.id === oldPart.id)) {
			commands.push({ type: "deletePart", partId: oldPart.id });
		}
	}
	return commands;
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
	const replaceIr = useCallback(
		(nextIr) => {
			if (!nextIr) return;
			const commands = buildDiffCommands(base.state?.ir, nextIr);
			if (commands.length > 0) {
				dispatch({ type: "batch", commands });
			}
		},
		[base, dispatch],
	);
	return { dispatch, undo, redo, replaceIr };
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

function createEditorWrapper(base, ops) {
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
		dispatch: ops.dispatch,
		undo: ops.undo,
		redo: ops.redo,
		replaceIr: ops.replaceIr,
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
		replaceIr: ops.replaceIr,
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
	const { dispatch, undo, redo, replaceIr } = useHistoryOperations(
		base,
		setDoc,
		setDirty,
	);
	const markSaved = useCallback(() => setDirty(false), []);
	const ops = useMemo(
		() => ({ dispatch, undo, redo, replaceIr }),
		[dispatch, undo, redo, replaceIr],
	);
	const editor = useMemo(() => createEditorWrapper(base, ops), [base, ops]);

	return buildDocumentResult(editor, doc, board, {
		setBoard,
		dispatch,
		replaceIr,
		undo,
		redo,
		dirty,
		markSaved,
	});
}
