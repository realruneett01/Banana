const DEFAULT_STATE = Object.freeze({
	x: 0,
	y: 0,
	dx: 0,
	dy: 0,
	zoom: 1,
	units: "mm",
	grid: 1.27,
});

let state = DEFAULT_STATE;
let originX = 0;
let originY = 0;
const listeners = new Set();

function notify() {
	for (const fn of listeners) {
		fn(state);
	}
}

export function get() {
	return state;
}

export function subscribe(listener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function set(patch) {
	const next = typeof patch === "function" ? patch(state) : patch;
	state = { ...state, ...next };
	notify();
}

export function setCursor(pt) {
	if (!pt) return;
	const x = pt.x ?? state.x;
	const y = pt.y ?? state.y;
	const dx = x - originX;
	const dy = y - originY;
	set({ x, y, dx, dy });
}

export function setOrigin(pt) {
	originX = pt?.x ?? state.x;
	originY = pt?.y ?? state.y;
	const dx = state.x - originX;
	const dy = state.y - originY;
	set({ dx, dy });
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
