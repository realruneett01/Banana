import { useCallback, useMemo, useState } from "react";
import { API_BASE_URL } from "./config.js";
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

export function useDesignLoop({ baseUrl = API_BASE_URL, api: customApi } = {}) {
	const [agentOpen, setAgentOpen] = useState(false);
	const [simOpen, setSimOpen] = useState(false);
	const [ir, setIr] = useState(null);
	const api = useMemo(
		() => customApi ?? createSimApi({ baseUrl }),
		[customApi, baseUrl],
	);
	const openAgent = useCallback(() => setAgentOpen(true), []);
	const closeAgent = useCallback(() => setAgentOpen(false), []);
	const closeSimulation = useCallback(() => setSimOpen(false), []);
	const openSimulation = useCallback((nextIr) => {
		if (isCircuitIr(nextIr)) {
			setIr(nextIr);
		}
		setSimOpen(true);
	}, []);
	const studio = useStudioState(setIr);
	const editor = useEditorState(setIr);

	return {
		api,
		agentOpen,
		openAgent,
		closeAgent,
		simOpen,
		openSimulation,
		closeSimulation,
		...studio,
		...editor,
		ir,
		setIr,
	};
}
