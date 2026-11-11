import { useCallback, useMemo, useState } from "react";
import { API_BASE_URL } from "./config.js";
import { createSimApi } from "./simApi.js";

export function isCircuitIr(candidate) {
	if (!candidate || typeof candidate !== "object") {
		return false;
	}
	return !Array.isArray(candidate) && Array.isArray(candidate.parts);
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

	return {
		api,
		agentOpen,
		openAgent,
		closeAgent,
		simOpen,
		openSimulation,
		closeSimulation,
		ir,
		setIr,
	};
}
