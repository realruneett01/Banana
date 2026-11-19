import { fitToBounds, panBy, zoomAt } from "./viewport.js";

export const ZOOM_STEP = 1.15;

const KEY_MAP = Object.freeze({
	f1: "zoomIn",
	f2: "zoomOut",
	f4: "centerCursor",
	home: "zoomFit",
});

function isPinch(ctrlKey, dy) {
	if (!ctrlKey) return false;
	return Math.abs(dy) < 10 && !Number.isInteger(dy);
}

function normalizeDeltas(deltaX, deltaY, deltaMode) {
	const factor = deltaMode === 1 ? 16 : 1;
	return {
		dx: (deltaX ?? 0) * factor,
		dy: (deltaY ?? 0) * factor,
	};
}

function cleanNeg(val) {
	return val === 0 ? 0 : -val;
}

function resolveModifierAction(event, dy) {
	if (isPinch(event.ctrlKey, dy)) {
		return { type: "zoom", factor: Math.exp(-dy * 0.01) };
	}
	if (event.ctrlKey) {
		return { type: "pan", dx: cleanNeg(dy), dy: 0 };
	}
	if (event.shiftKey) {
		return { type: "pan", dx: 0, dy: cleanNeg(dy) };
	}
	return null;
}

function resolvePlainWheel(event, dx, dy) {
	if (dx !== 0) {
		return { type: "pan", dx: cleanNeg(dx), dy: cleanNeg(dy) };
	}
	if (event.metaKey) {
		return null;
	}
	const factor = dy < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
	return { type: "zoom", factor };
}

export function wheelAction(event = {}) {
	const { dx, dy } = normalizeDeltas(
		event.deltaX,
		event.deltaY,
		event.deltaMode,
	);
	if (dx === 0 && dy === 0) {
		return null;
	}
	const modAction = resolveModifierAction(event, dy);
	if (modAction) {
		return modAction;
	}
	return resolvePlainWheel(event, dx, dy);
}

export function keyAction(key) {
	if (!key || typeof key !== "string") {
		return null;
	}
	return KEY_MAP[key.toLowerCase()] ?? null;
}

function resolveAnchor(cursor, size) {
	if (cursor) return cursor;
	if (size) return { x: size.width / 2, y: size.height / 2 };
	return { x: 0, y: 0 };
}

function centerOnCursor(view, cursor, size) {
	if (!cursor || !size) {
		return view;
	}
	const dx = size.width / 2 - cursor.x;
	const dy = size.height / 2 - cursor.y;
	return panBy(view, dx, dy);
}

function getZoomFactor(type, action) {
	if (type === "zoomIn") return ZOOM_STEP;
	if (type === "zoomOut") return 1 / ZOOM_STEP;
	return action?.factor ?? 1;
}

function getActionType(action) {
	if (typeof action === "string") {
		return action;
	}
	return action?.type ?? null;
}

function applyPan(view, action) {
	const dx = action.dx ?? 0;
	const dy = action.dy ?? 0;
	return panBy(view, dx, dy);
}

function applyFit(view, bounds, size) {
	if (!bounds || !size) {
		return view;
	}
	return fitToBounds(bounds, size);
}

function applyZoom(view, type, action, ctx) {
	const pt = resolveAnchor(ctx.cursor, ctx.size);
	return zoomAt(view, pt, getZoomFactor(type, action));
}

const NAV_HANDLERS = {
	pan: (view, act) => applyPan(view, act),
	zoom: (view, act, ctx) => applyZoom(view, "zoom", act, ctx),
	zoomIn: (view, act, ctx) => applyZoom(view, "zoomIn", act, ctx),
	zoomOut: (view, act, ctx) => applyZoom(view, "zoomOut", act, ctx),
	centerCursor: (view, _act, ctx) => centerOnCursor(view, ctx.cursor, ctx.size),
	zoomFit: (view, _act, ctx) => applyFit(view, ctx.bounds, ctx.size),
};

export function applyNav(view, action, ctx = {}) {
	if (!view) return view;
	if (!action) return view;
	const type = getActionType(action);
	const handler = NAV_HANDLERS[type];
	if (!handler) return view;
	return handler(view, action, ctx);
}

function panAxis(pos, max, margin, speed) {
	if (pos < margin) return speed;
	if (pos > max - margin) return -speed;
	return 0;
}

export function edgePan(cursor, size, margin = 24, speed = 12) {
	if (!cursor || !size) {
		return { dx: 0, dy: 0 };
	}
	return {
		dx: panAxis(cursor.x, size.width, margin, speed),
		dy: panAxis(cursor.y, size.height, margin, speed),
	};
}
