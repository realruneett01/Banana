import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../config.js";

const STORAGE_KEY = "banana.recentProjects";
const MAX_RECENT = 12;

function loadRecentProjects() {
	try {
		if (typeof window === "undefined" || !window.localStorage) {
			return [];
		}
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.slice(0, MAX_RECENT);
	} catch {
		// Ignore corrupted localStorage data
		return [];
	}
}

function saveRecentProjects(items) {
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			const bounded = items.slice(0, MAX_RECENT);
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
		}
	} catch (err) {
		console.warn("Failed to save recent projects:", err);
	}
}

function prependRecentProject(list, project) {
	const remaining = list.filter((p) => p.projectRoot !== project.projectRoot);
	return [project, ...remaining].slice(0, MAX_RECENT);
}

async function getAuthHeader() {
	try {
		if (typeof window !== "undefined" && window.banana?.getApiToken) {
			const token = await window.banana.getApiToken();
			if (token) return { "x-banana-auth": token };
		}
	} catch (err) {
		console.warn("Failed to read desktop API token:", err);
	}
	return {};
}

export async function createProjectHeaders() {
	const auth = await getAuthHeader();
	return {
		"Content-Type": "application/json",
		...auth,
	};
}

async function parseJsonResponse(res) {
	try {
		return await res.json();
	} catch {
		// Response body is not JSON
		return null;
	}
}

function buildProjectPayload({ parentDir, name, boardW, boardH }) {
	const payload = { parentDir, name };
	if (boardW !== undefined) payload.boardW = boardW;
	if (boardH !== undefined) payload.boardH = boardH;
	return payload;
}

async function postCreateProject(params) {
	const headers = await createProjectHeaders();
	const body = JSON.stringify(buildProjectPayload(params));
	return await fetch(`${API_BASE_URL}/api/projects/create`, {
		method: "POST",
		headers,
		body,
	});
}

function createProjectRecord(params, data) {
	return {
		name: params.name,
		projectRoot: data.projectRoot,
		files: Array.isArray(data.files) ? data.files : [],
		openedAt: new Date().toISOString(),
	};
}

async function handleCreate(params, setRecent) {
	try {
		const res = await postCreateProject(params);
		const data = await parseJsonResponse(res);
		if (res.status === 201 && data?.projectRoot) {
			const project = createProjectRecord(params, data);
			setRecent((prev) => {
				const next = prependRecentProject(prev, project);
				saveRecentProjects(next);
				return next;
			});
			return { ok: true, project };
		}
		const error = data?.error || res.statusText || "Creation failed";
		return { ok: false, error };
	} catch (err) {
		return { ok: false, error: err?.message || "Network error" };
	}
}

async function fetchKicadStatus() {
	try {
		if (typeof window !== "undefined" && window.banana?.kicad?.status) {
			const status = await window.banana.kicad.status();
			return status || null;
		}
	} catch (err) {
		console.warn("KiCad status query failed:", err);
	}
	return null;
}

export function useProjects() {
	const [recent, setRecent] = useState(loadRecentProjects);
	const [kicadStatus, setKicadStatus] = useState(null);

	useEffect(() => {
		let active = true;
		fetchKicadStatus().then((status) => {
			if (active) setKicadStatus(status);
		});
		return () => {
			active = false;
		};
	}, []);

	const createProject = useCallback(
		(params) => handleCreate(params, setRecent),
		[],
	);

	const removeRecent = useCallback((projectRoot) => {
		setRecent((prev) => {
			const next = prev.filter((item) => item.projectRoot !== projectRoot);
			saveRecentProjects(next);
			return next;
		});
	}, []);

	return { recent, createProject, removeRecent, kicadStatus };
}

export default useProjects;
