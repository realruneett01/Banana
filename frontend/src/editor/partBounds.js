/** Schematic part bounding boxes for box selection. Pure, no React. */
import { partBox } from "./schematicGeometry.js";
import { symbolToSvgPrimitives, transformPrimitives } from "./symbolRender.js";
import { bboxOfPoints } from "./viewport.js";

const PRIM_POINTS = {
	rect: (p) => [
		[p.x, p.y],
		[p.x + p.width, p.y + p.height],
	],
	polyline: (p) => p.points,
	circle: (p) => [
		[p.cx - p.r, p.cy - p.r],
		[p.cx + p.r, p.cy + p.r],
	],
	arc: (p) => [p.start, p.mid, p.end],
	pin: (p) => [
		[p.x, p.y],
		[p.x2, p.y2],
	],
};

function primPoints(prim) {
	const fn = PRIM_POINTS[prim.type];
	return fn ? fn(prim) : [];
}

function symbolBBox(part, symbol) {
	const prims = transformPrimitives(
		symbolToSvgPrimitives(symbol),
		part.placement ?? {},
	);
	return bboxOfPoints(prims.flatMap(primPoints));
}

function boxPartBBox(part) {
	const box = partBox(part);
	const quarter = Math.abs(box.rot) % 180 === 90;
	const w = quarter ? box.height : box.width;
	const h = quarter ? box.width : box.height;
	return {
		minX: box.cx - w / 2,
		minY: box.cy - h / 2,
		maxX: box.cx + w / 2,
		maxY: box.cy + h / 2,
	};
}

function partBBox(part, symbolCache) {
	const symbol = part.symbol ? symbolCache?.[part.symbol] : null;
	return (symbol && symbolBBox(part, symbol)) || boxPartBBox(part);
}

/**
 * One {id, bbox} item per placed part, in world (schematic) coordinates.
 * Symbol parts use their transformed graphics and pins; others use partBox.
 * @param {{parts?: Array<object>}|null} ir
 * @param {Record<string, object>|null|undefined} symbolCache
 * @returns {Array<{id:string, bbox:{minX:number,minY:number,maxX:number,maxY:number}}>}
 */
export function partItems(ir, symbolCache) {
	return (ir?.parts ?? []).map((part) => ({
		id: part.id,
		bbox: partBBox(part, symbolCache),
	}));
}
