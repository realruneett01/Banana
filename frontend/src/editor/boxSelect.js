/** KiCad-style box-selection helpers. No React, no side-effects. */

/**
 * Normalise two drag points into a {minX,minY,maxX,maxY} box.
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
export function normalizeBox(start, end) {
	return {
		minX: Math.min(start.x, end.x),
		minY: Math.min(start.y, end.y),
		maxX: Math.max(start.x, end.x),
		maxY: Math.max(start.y, end.y),
	};
}

function isZeroSize(box) {
	return box.minX === box.maxX || box.minY === box.maxY;
}

function fullyInside(bbox, box) {
	return (
		bbox.minX >= box.minX &&
		bbox.minY >= box.minY &&
		bbox.maxX <= box.maxX &&
		bbox.maxY <= box.maxY
	);
}

function intersects(bbox, box) {
	return (
		bbox.minX <= box.maxX &&
		bbox.maxX >= box.minX &&
		bbox.minY <= box.maxY &&
		bbox.maxY >= box.minY
	);
}

/**
 * KiCad box-selection.
 * Left-to-right drag (end.x >= start.x): fully-inside items only.
 * Right-to-left drag (end.x < start.x): any touching/intersecting item.
 * Zero-size box returns [].
 * @param {Array<{id:*, bbox:{minX:number,minY:number,maxX:number,maxY:number}}>} items
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 * @returns {Array<*>} ids in input order
 */
export function boxSelect(items, start, end) {
	const box = normalizeBox(start, end);
	if (isZeroSize(box)) return [];
	const ltr = end.x >= start.x;
	const test = ltr ? fullyInside : intersects;
	return items.filter((item) => test(item.bbox, box)).map((item) => item.id);
}
