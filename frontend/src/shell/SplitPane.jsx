import { Children, useRef, useState } from "react";

// --- Pure SplitPane helpers ---
export function clampSize(size, min, max) {
	const val = typeof size === "number" ? size : Number.parseFloat(size) || 0;
	if (Number.isNaN(val)) return min ?? 0;
	const lower = min != null ? min : -Infinity;
	const upper = max != null ? max : Infinity;
	if (lower > upper) return lower;
	return Math.min(Math.max(val, lower), upper);
}
// --- End Pure SplitPane helpers ---

function handleContainerStyle(isVert) {
	return {
		width: isVert ? "100%" : "4px",
		height: isVert ? "4px" : "100%",
		cursor: isVert ? "row-resize" : "col-resize",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		userSelect: "none",
		touchAction: "none",
		zIndex: 10,
	};
}

function handleLineStyle(isVert, dragging) {
	return {
		width: isVert ? "100%" : "1px",
		height: isVert ? "1px" : "100%",
		backgroundColor: dragging
			? "var(--bn-color-brand, #007acc)"
			: "var(--bn-border-base, #3c3c3c)",
		pointerEvents: "none",
	};
}

export function ResizeHandle({
	direction = "horizontal",
	onResize,
	onReset,
	isInverse = false,
}) {
	const [dragging, setDragging] = useState(false);
	const startRef = useRef({ coord: 0 });
	const isVert = direction === "vertical";

	const onPointerDown = (e) => {
		if (e.button !== 0) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		setDragging(true);
		startRef.current = { coord: isVert ? e.clientY : e.clientX };
	};

	const onPointerMove = (e) => {
		if (!dragging) return;
		const current = isVert ? e.clientY : e.clientX;
		const rawDelta = current - startRef.current.coord;
		const delta = isInverse ? -rawDelta : rawDelta;
		startRef.current.coord = current;
		onResize?.(delta);
	};

	const onPointerUp = (e) => {
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		setDragging(false);
	};

	return (
		<div
			role="slider"
			tabIndex={0}
			aria-label="Resize splitter"
			aria-valuenow={50}
			aria-valuemin={0}
			aria-valuemax={100}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onDoubleClick={onReset}
			style={handleContainerStyle(isVert)}
		>
			<div style={handleLineStyle(isVert, dragging)} />
		</div>
	);
}

function splitContainerStyle(isVert) {
	return {
		display: "flex",
		flexDirection: isVert ? "column" : "row",
		width: "100%",
		height: "100%",
		overflow: "hidden",
	};
}

function firstPaneStyle(isVert, size) {
	return {
		flexShrink: 0,
		overflow: "auto",
		width: isVert ? "100%" : `${size}px`,
		height: isVert ? `${size}px` : "100%",
	};
}

function secondPaneStyle() {
	return {
		flex: 1,
		minWidth: 0,
		minHeight: 0,
		overflow: "auto",
	};
}

export function SplitPane({
	direction = "horizontal",
	size,
	minSize,
	maxSize,
	defaultSize = 200,
	onResize,
	children,
}) {
	const [internalSize, setInternalSize] = useState(() => defaultSize ?? 200);
	const currentSize = size !== undefined ? size : internalSize;
	const isVert = direction === "vertical";
	const clamped = clampSize(currentSize, minSize, maxSize);

	const handleDelta = (delta) => {
		const next = clampSize(clamped + delta, minSize, maxSize);
		setInternalSize(next);
		onResize?.(next);
	};

	const handleReset = () => {
		const reset = clampSize(defaultSize, minSize, maxSize);
		setInternalSize(reset);
		onResize?.(reset);
	};

	const childArray = Children.toArray(children);
	if (childArray.length < 2) return childArray[0] || null;

	return (
		<div style={splitContainerStyle(isVert)}>
			<div style={firstPaneStyle(isVert, clamped)}>{childArray[0]}</div>
			<ResizeHandle
				direction={direction}
				onResize={handleDelta}
				onReset={handleReset}
			/>
			<div style={secondPaneStyle()}>{childArray[1]}</div>
		</div>
	);
}

export default SplitPane;
