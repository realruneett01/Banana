function buildToolMap(tools) {
	const map = new Map();
	const list = Array.isArray(tools) ? tools : Object.values(tools ?? {});
	for (const tool of list) {
		if (tool?.id) {
			map.set(tool.id, tool);
		}
	}
	return map;
}

function createToolState({ tools, defaultTool, ctx }) {
	return {
		toolMap: buildToolMap(tools),
		listeners: new Set(),
		activeId: defaultTool,
		defaultTool,
		ctx,
	};
}

function activateTool(state, id) {
	if (!state.toolMap.has(id)) {
		return false;
	}
	if (id === state.activeId) {
		return true;
	}
	state.toolMap.get(state.activeId)?.onDeactivate?.(state.ctx);
	state.activeId = id;
	state.toolMap.get(id)?.onActivate?.(state.ctx);
	for (const listener of state.listeners) {
		listener(state.activeId);
	}
	return true;
}

function cancelTool(state) {
	state.toolMap.get(state.activeId)?.onCancel?.(state.ctx);
	if (state.activeId !== state.defaultTool) {
		activateTool(state, state.defaultTool);
		return true;
	}
	return false;
}

function dispatchTool(state, handlerName, args) {
	const tool = state.toolMap.get(state.activeId);
	const handler = tool?.[handlerName];
	const res = handler?.(state.ctx, ...args);
	if (res === "done") {
		activateTool(state, state.defaultTool);
		return true;
	}
	return res === "consumed";
}

function subscribeListener(state, listener) {
	state.listeners.add(listener);
	return () => {
		state.listeners.delete(listener);
	};
}

export function createToolManager({ tools, defaultTool = "select", ctx } = {}) {
	const state = createToolState({ tools, defaultTool, ctx });
	const dispatch = (name, args) => dispatchTool(state, name, args);

	return {
		activeId: () => state.activeId,
		activate: (id) => activateTool(state, id),
		cancel: () => cancelTool(state),
		cursor: () => state.toolMap.get(state.activeId)?.cursor ?? "default",
		pointerDown: (pt, event) => dispatch("onPointerDown", [pt, event]),
		pointerMove: (pt, event) => dispatch("onPointerMove", [pt, event]),
		pointerUp: (pt, event) => dispatch("onPointerUp", [pt, event]),
		key: (spec, event) => dispatch("onKey", [spec, event]),
		subscribe: (listener) => subscribeListener(state, listener),
	};
}
