const bus = new EventTarget();
const EDITOR_TOOL_EVENT = "banana:editor-tool";
const ACTIVE_TOOL_EVENT = "banana:active-tool";

function isValidTab(tab) {
	return tab === "schematic" || tab === "pcb";
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function validatePayload(payload) {
	const { tab, tool, item } = payload ?? {};
	if (!isValidTab(tab)) {
		return null;
	}
	if (!isNonEmptyString(tool)) {
		return null;
	}
	return { tab, tool, item: item ?? null };
}

function emitBusEvent(eventName, payload) {
	const detail = validatePayload(payload);
	if (!detail) {
		return;
	}
	bus.dispatchEvent(new CustomEvent(eventName, { detail }));
}

function subscribeBusEvent(eventName, handler, tab) {
	const listener = (event) => {
		const detail = event.detail;
		if (tab && detail.tab !== tab) {
			return;
		}
		handler?.(detail);
	};
	bus.addEventListener(eventName, listener);
	return () => {
		bus.removeEventListener(eventName, listener);
	};
}

export function emitEditorTool(payload) {
	emitBusEvent(EDITOR_TOOL_EVENT, payload);
}

export function onEditorTool(handler, tab) {
	return subscribeBusEvent(EDITOR_TOOL_EVENT, handler, tab);
}

export function emitActiveTool(payload) {
	emitBusEvent(ACTIVE_TOOL_EVENT, payload);
}

export function onActiveTool(handler, tab) {
	return subscribeBusEvent(ACTIVE_TOOL_EVENT, handler, tab);
}
