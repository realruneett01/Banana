import { useEffect, useRef } from "react";
import { applyNav, edgePan, keyAction, wheelAction } from "./canvasNav.js";

function getRelativeCursor(event, el) {
	const rect = el.getBoundingClientRect();
	return {
		x: event.clientX - rect.left,
		y: event.clientY - rect.top,
	};
}

function dispatchNav(action, cursor, el, getContext) {
	if (!action) return;
	const { view, setView, getBounds } = getContext();
	if (typeof setView !== "function") return;
	const rect = el.getBoundingClientRect();
	const size = { width: rect.width, height: rect.height };
	const bounds = getBounds ? getBounds() : null;
	setView((prev) => {
		const baseView = prev ?? view;
		return applyNav(baseView, action, { cursor, size, bounds });
	});
}

function handleMiddleDown(event, el, panState) {
	if (event.button !== 1) return;
	event.preventDefault();
	panState.active = true;
	panState.lastX = event.clientX;
	panState.lastY = event.clientY;
	el.setPointerCapture?.(event.pointerId);
}

function handleMiddleMove(event, el, panState, getContext) {
	if (!panState.active) return;
	const dx = event.clientX - panState.lastX;
	const dy = event.clientY - panState.lastY;
	panState.lastX = event.clientX;
	panState.lastY = event.clientY;
	if (dx === 0 && dy === 0) return;
	dispatchNav({ type: "pan", dx, dy }, null, el, getContext);
}

function handleMiddleUp(event, el, panState) {
	if (!panState.active) return;
	panState.active = false;
	if (el.hasPointerCapture?.(event.pointerId)) {
		el.releasePointerCapture(event.pointerId);
	}
}

function createAutoPanController(el, cursorRef, getContext) {
	let animId = null;
	let leftHeld = false;

	const step = () => {
		if (!leftHeld) {
			animId = null;
			return;
		}
		const cursor = cursorRef.current;
		const rect = el.getBoundingClientRect();
		const size = { width: rect.width, height: rect.height };
		const { dx, dy } = edgePan(cursor, size);
		if (dx !== 0 || dy !== 0) {
			dispatchNav({ type: "pan", dx, dy }, cursor, el, getContext);
		}
		animId = requestAnimationFrame(step);
	};

	return {
		onLeftDown() {
			leftHeld = true;
			if (animId === null) {
				animId = requestAnimationFrame(step);
			}
		},
		onLeftUp() {
			leftHeld = false;
			if (animId !== null) {
				cancelAnimationFrame(animId);
				animId = null;
			}
		},
		stop() {
			leftHeld = false;
			if (animId !== null) {
				cancelAnimationFrame(animId);
				animId = null;
			}
		},
	};
}

function bindNavEvents(el, cursorRef, getContext) {
	const middlePan = { active: false, lastX: 0, lastY: 0 };
	const autoPan = createAutoPanController(el, cursorRef, getContext);

	const onWheel = (e) => {
		e.preventDefault();
		const action = wheelAction(e);
		const cursor = getRelativeCursor(e, el);
		cursorRef.current = cursor;
		dispatchNav(action, cursor, el, getContext);
	};

	const onPointerDown = (e) => {
		cursorRef.current = getRelativeCursor(e, el);
		handleMiddleDown(e, el, middlePan);
		if (e.button === 0) {
			autoPan.onLeftDown();
		}
	};

	const onPointerMove = (e) => {
		cursorRef.current = getRelativeCursor(e, el);
		handleMiddleMove(e, el, middlePan, getContext);
	};

	const onPointerUp = (e) => {
		handleMiddleUp(e, el, middlePan);
		if (e.button === 0) {
			autoPan.onLeftUp();
		}
	};

	const onPointerEnd = () => {
		autoPan.stop();
	};

	const onKeyDown = (e) => {
		const action = keyAction(e.key);
		if (!action) return;
		e.preventDefault();
		dispatchNav(action, cursorRef.current, el, getContext);
	};

	const listeners = [
		["wheel", onWheel, { passive: false }],
		["pointerdown", onPointerDown],
		["pointermove", onPointerMove],
		["pointerup", onPointerUp],
		["pointerleave", onPointerEnd],
		["pointercancel", onPointerEnd],
		["keydown", onKeyDown],
	];

	for (const [evt, fn, opts] of listeners) {
		el.addEventListener(evt, fn, opts);
	}

	return () => {
		autoPan.stop();
		for (const [evt, fn, opts] of listeners) {
			el.removeEventListener(evt, fn, opts);
		}
	};
}

export function useCanvasNav(
	targetRef,
	{ view, setView, getBounds, enabled = true } = {},
) {
	const cursorRef = useRef(null);
	const ctxRef = useRef({ view, setView, getBounds });
	ctxRef.current = { view, setView, getBounds };

	useEffect(() => {
		const el = targetRef?.current;
		if (!el || !enabled) return;
		return bindNavEvents(el, cursorRef, () => ctxRef.current);
	}, [targetRef, enabled]);

	return { cursorRef };
}
