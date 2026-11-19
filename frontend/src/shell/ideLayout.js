import { useEffect, useReducer } from "react";

export const STORAGE_KEY = "banana:ide-layout";

export const TAB_KINDS = Object.freeze([
	"welcome",
	"schematic",
	"pcb",
	"3d",
	"holo",
	"diff",
	"fields",
	"footprints",
	"settings",
]);

export const ACTIVITIES = Object.freeze([
	Object.freeze({
		id: "explorer",
		label: "Explorer",
		shortcut: "Ctrl+Shift+E",
	}),
	Object.freeze({ id: "search", label: "Search", shortcut: "Ctrl+Shift+F" }),
	Object.freeze({
		id: "scm",
		label: "Source Control",
		shortcut: "Ctrl+Shift+G",
	}),
	Object.freeze({ id: "library", label: "Library", shortcut: "Ctrl+Shift+L" }),
	Object.freeze({
		id: "simulation",
		label: "Simulation",
		shortcut: "Ctrl+Shift+S",
	}),
	Object.freeze({ id: "ai", label: "AI", shortcut: "Ctrl+Shift+A" }),
]);

export const INITIAL_LAYOUT = Object.freeze({
	activity: "explorer",
	sidebarOpen: true,
	auxOpen: true,
	auxTab: "ai",
	bottomOpen: false,
	bottomTab: "problems",
	tabs: Object.freeze([]),
	activeTabId: null,
});

function safeStorageCall(fn) {
	try {
		return typeof localStorage !== "undefined" ? fn(localStorage) : null;
	} catch {
		// localStorage might throw SecurityError in frames or QuotaExceededError
		return null;
	}
}

function readStorageItem(key) {
	return safeStorageCall((storage) => storage.getItem(key));
}

function writeStorageItem(key, value) {
	safeStorageCall((storage) => {
		storage.setItem(key, value);
	});
}

function parseStoredJson(raw) {
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		// return null when JSON string is corrupted
		return null;
	}
}

function pickBool(val, fallback) {
	return typeof val === "boolean" ? val : fallback;
}

export function loadStoredLayout(fallback = INITIAL_LAYOUT) {
	const raw = readStorageItem(STORAGE_KEY);
	if (!raw) return fallback;
	const data = parseStoredJson(raw);
	if (!data) return fallback;
	return {
		...fallback,
		sidebarOpen: pickBool(data.sidebarOpen, fallback.sidebarOpen),
		auxOpen: pickBool(data.auxOpen, fallback.auxOpen),
		bottomOpen: pickBool(data.bottomOpen, fallback.bottomOpen),
		activity:
			typeof data.activity === "string" ? data.activity : fallback.activity,
	};
}

export function saveStoredLayout(state) {
	if (!state) return;
	const payload = {
		sidebarOpen: Boolean(state.sidebarOpen),
		auxOpen: Boolean(state.auxOpen),
		bottomOpen: Boolean(state.bottomOpen),
		activity: state.activity,
	};
	writeStorageItem(STORAGE_KEY, JSON.stringify(payload));
}

function extractActionId(action) {
	return action.id ?? action.payload?.id ?? action.payload;
}

function handleSetActivity(state, action) {
	const id = extractActionId(action);
	if (!id) return state;
	if (state.activity === id) {
		return { ...state, sidebarOpen: !state.sidebarOpen };
	}
	return { ...state, activity: id, sidebarOpen: true };
}

function handleToggleSidebar(state) {
	return { ...state, sidebarOpen: !state.sidebarOpen };
}

function handleToggleAux(state) {
	return { ...state, auxOpen: !state.auxOpen };
}

function handleSetAuxTab(state, action) {
	const id = extractActionId(action);
	if (!id || state.auxTab === id) return state;
	return { ...state, auxTab: id };
}

function handleToggleBottom(state) {
	return { ...state, bottomOpen: !state.bottomOpen };
}

function handleSetBottomTab(state, action) {
	const id = extractActionId(action);
	if (!id) return state;
	return { ...state, bottomTab: id, bottomOpen: true };
}

function handleOpenTab(state, action) {
	const tab = action.tab ?? action.payload?.tab ?? action.payload;
	if (!tab?.id) return state;
	const exists = state.tabs.some((t) => t.id === tab.id);
	if (exists) {
		return state.activeTabId === tab.id
			? state
			: { ...state, activeTabId: tab.id };
	}
	const safeTab = Object.freeze({ ...tab });
	const nextTabs = Object.freeze([...state.tabs, safeTab]);
	return { ...state, tabs: nextTabs, activeTabId: tab.id };
}

function pickActiveOnClose(tabs, index, currentActive, closedId) {
	const isOther = currentActive && currentActive !== closedId;
	if (isOther && tabs.some((t) => t.id === currentActive)) {
		return currentActive;
	}
	if (index < tabs.length) {
		return tabs[index].id;
	}
	if (index > 0) {
		return tabs[index - 1].id;
	}
	return null;
}

function handleCloseTab(state, action) {
	const id = extractActionId(action);
	const index = state.tabs.findIndex((t) => t.id === id);
	if (index === -1) return state;
	const nextTabs = Object.freeze(state.tabs.filter((t) => t.id !== id));
	const nextActiveId = pickActiveOnClose(
		nextTabs,
		index,
		state.activeTabId,
		id,
	);
	return { ...state, tabs: nextTabs, activeTabId: nextActiveId };
}

function handleActivateTab(state, action) {
	const id = extractActionId(action);
	if (!id || state.activeTabId === id) return state;
	const exists = state.tabs.some((t) => t.id === id);
	if (!exists) return state;
	return { ...state, activeTabId: id };
}

function handleMoveTab(state, action) {
	const id = action.id ?? action.payload?.id;
	const toIndex = action.toIndex ?? action.payload?.toIndex;
	if (typeof toIndex !== "number") return state;
	const fromIndex = state.tabs.findIndex((t) => t.id === id);
	if (fromIndex === -1) return state;
	const clamped = Math.max(0, Math.min(state.tabs.length - 1, toIndex));
	if (clamped === fromIndex) return state;
	const next = [...state.tabs];
	const [item] = next.splice(fromIndex, 1);
	next.splice(clamped, 0, item);
	return { ...state, tabs: Object.freeze(next) };
}

const ACTION_HANDLERS = {
	setActivity: handleSetActivity,
	toggleSidebar: handleToggleSidebar,
	toggleAux: handleToggleAux,
	setAuxTab: handleSetAuxTab,
	toggleBottom: handleToggleBottom,
	setBottomTab: handleSetBottomTab,
	openTab: handleOpenTab,
	closeTab: handleCloseTab,
	activateTab: handleActivateTab,
	moveTab: handleMoveTab,
};

export function layoutReducer(state = INITIAL_LAYOUT, action) {
	if (!action || typeof action !== "object") {
		return state;
	}
	const handler = ACTION_HANDLERS[action.type];
	return handler ? handler(state, action) : state;
}

export function useIdeLayout(initial = INITIAL_LAYOUT) {
	const [state, dispatch] = useReducer(
		layoutReducer,
		initial,
		loadStoredLayout,
	);
	const { sidebarOpen, auxOpen, bottomOpen, activity } = state;

	useEffect(() => {
		saveStoredLayout({ sidebarOpen, auxOpen, bottomOpen, activity });
	}, [sidebarOpen, auxOpen, bottomOpen, activity]);

	const result = [state, dispatch];
	result.state = state;
	result.dispatch = dispatch;
	return result;
}
