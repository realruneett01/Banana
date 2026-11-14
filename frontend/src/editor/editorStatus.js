const DEFAULT_STATE = Object.freeze({
	x: 0,
	y: 0,
	dx: 0,
	dy: 0,
	zoom: 1,
	units: "mm",
	grid: 1.27,
});

/** Minimal external store: get/subscribe plus shallow-merge set(patch | fn). */
export function createStore(initial) {
	let current = initial;
	const listeners = new Set();
	return {
		get: () => current,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		set(patch) {
			const next = typeof patch === "function" ? patch(current) : patch;
			current = { ...current, ...next };
			for (const fn of listeners) fn(current);
		},
	};
}

let originX = 0;
let originY = 0;

export const { get, subscribe, set } = createStore(DEFAULT_STATE);

export function setCursor(pt) {
	if (!pt) return;
	const { x: curX, y: curY, zoom: curZoom } = get();
	const x = pt.x ?? curX;
	const y = pt.y ?? curY;
	const zoom = pt.zoom ?? curZoom;
	set({ x, y, dx: x - originX, dy: y - originY, zoom });
}

export function setOrigin(pt) {
	const { x, y } = get();
	originX = pt?.x ?? x;
	originY = pt?.y ?? y;
	set({ dx: x - originX, dy: y - originY });
}

export function setUnits(u) {
	set({ units: u });
}

export function setGrid(g) {
	set({ grid: Number(g) });
}

export const editorStatus = Object.freeze({
	subscribe,
	get,
	set,
	setCursor,
	setOrigin,
	setUnits,
	setGrid,
});

export const statusStore = editorStatus;
export default editorStatus;
