function toNum(val) {
	return Number(val) || 0;
}

function nodeSym(node) {
	if (node == null) return "";
	return typeof node === "object" ? (node.sym ?? "") : String(node);
}

function findChild(node, head) {
	if (!Array.isArray(node)) return null;
	for (const child of node) {
		if (Array.isArray(child) && nodeSym(child[0]) === head) {
			return child;
		}
	}
	return null;
}

function resolveCoords(node) {
	const inner = node[1];
	if (Array.isArray(inner) && nodeSym(inner[0]) === "xy") {
		return [toNum(inner[1]), toNum(inner[2])];
	}
	return [toNum(inner), toNum(node[2])];
}

function extractXy(node) {
	if (!Array.isArray(node)) return [0, 0];
	return resolveCoords(node);
}

function extractAt(node) {
	const atNode = findChild(node, "at");
	if (!atNode) return [0, 0, 0];
	const rot = atNode.length > 3 ? toNum(atNode[3]) : 0;
	return [toNum(atNode[1]), toNum(atNode[2]), rot];
}

function round(n, dec = 6) {
	const factor = 10 ** dec;
	return Math.round(n * factor) / factor;
}

const FLIP_VALUES = new Set([true, "x", "B"]);

function isFlipped(placement) {
	return Boolean(placement?.side === "B" || FLIP_VALUES.has(placement?.flip));
}

function rotatePoint(x, y, rotDeg) {
	const rad = (rotDeg * Math.PI) / 180;
	const cos = rotDeg % 90 === 0 ? Math.round(Math.cos(rad)) : Math.cos(rad);
	const sin = rotDeg % 90 === 0 ? Math.round(Math.sin(rad)) : Math.sin(rad);
	return [x * cos - y * sin, x * sin + y * cos];
}

export function transformPoint(pt, placement = {}) {
	const x = Array.isArray(pt) ? pt[0] : (pt?.x ?? 0);
	const y = Array.isArray(pt) ? pt[1] : (pt?.y ?? 0);
	const fx = isFlipped(placement) ? -x : x;
	const rot = placement.rot ?? 0;
	const [rx, ry] = rotatePoint(fx, y, rot);
	const tx = (placement.x ?? 0) + rx;
	const ty = (placement.y ?? 0) + ry;
	return [round(tx), round(ty)];
}

function convertRect(node) {
	const [x1, y1k] = extractXy(findChild(node, "start"));
	const [x2, y2k] = extractXy(findChild(node, "end"));
	const y1 = -y1k;
	const y2 = -y2k;
	const x = round(Math.min(x1, x2));
	const y = round(Math.min(y1, y2));
	const width = round(Math.abs(x2 - x1));
	const height = round(Math.abs(y2 - y1));
	return { type: "rect", x, y, width, height };
}

function convertPolyline(node) {
	const ptsNode = findChild(node, "pts");
	if (!ptsNode) return { type: "polyline", points: [] };
	const points = ptsNode
		.filter((c) => Array.isArray(c) && nodeSym(c[0]) === "xy")
		.map((c) => [round(Number(c[1]) || 0), round(-(Number(c[2]) || 0))]);
	return { type: "polyline", points };
}

function convertCircle(node) {
	const [cx, cyK] = extractXy(findChild(node, "center"));
	const radNode = findChild(node, "radius");
	const r = round(Number(radNode?.[1]) || 0);
	return { type: "circle", cx: round(cx), cy: round(-cyK), r };
}

function computeArcSweep(A, B, C) {
	const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
	return cross > 0 ? 1 : 0;
}

function computeArcAngles(A, B, C, center) {
	const a1 = Math.atan2(A[1] - center[1], A[0] - center[0]);
	const a2 = Math.atan2(B[1] - center[1], B[0] - center[0]);
	const a3 = Math.atan2(C[1] - center[1], C[0] - center[0]);
	return { a1, a2, a3 };
}

function computeArcSpan(angles, sweep) {
	const { a1, a2, a3 } = angles;
	const twoPi = 2 * Math.PI;
	if (sweep === 1) {
		const s1 = (((a2 - a1) % twoPi) + twoPi) % twoPi;
		const s2 = (((a3 - a2) % twoPi) + twoPi) % twoPi;
		return s1 + s2;
	}
	const s1 = (((a1 - a2) % twoPi) + twoPi) % twoPi;
	const s2 = (((a2 - a3) % twoPi) + twoPi) % twoPi;
	return s1 + s2;
}

function calculateCircleCenter(A, B, C, D) {
	const aSq = A[0] ** 2 + A[1] ** 2;
	const bSq = B[0] ** 2 + B[1] ** 2;
	const cSq = C[0] ** 2 + C[1] ** 2;
	const cx = round(
		(aSq * (B[1] - C[1]) + bSq * (C[1] - A[1]) + cSq * (A[1] - B[1])) / D,
	);
	const cy = round(
		(aSq * (C[0] - B[0]) + bSq * (A[0] - C[0]) + cSq * (B[0] - A[0])) / D,
	);
	return [cx, cy];
}

function buildArcPath(A, B, C) {
	const D =
		2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
	if (Math.abs(D) < 1e-9) {
		return { d: `M ${A[0]} ${A[1]} L ${C[0]} ${C[1]}`, collinear: true };
	}
	const [cx, cy] = calculateCircleCenter(A, B, C, D);
	const r = round(Math.hypot(A[0] - cx, A[1] - cy));
	const sweep = computeArcSweep(A, B, C);
	const span = computeArcSpan(computeArcAngles(A, B, C, [cx, cy]), sweep);
	const largeArc = span > Math.PI ? 1 : 0;
	return {
		cx,
		cy,
		r,
		sweep,
		largeArc,
		collinear: false,
		d: `M ${A[0]} ${A[1]} A ${r} ${r} 0 ${largeArc} ${sweep} ${C[0]} ${C[1]}`,
	};
}

function convertArc(node) {
	const [x1, y1k] = extractXy(findChild(node, "start"));
	const [x2, y2k] = extractXy(findChild(node, "mid"));
	const [x3, y3k] = extractXy(findChild(node, "end"));
	const A = [round(x1), round(-y1k)];
	const B = [round(x2), round(-y2k)];
	const C = [round(x3), round(-y3k)];
	const arcData = buildArcPath(A, B, C);
	return { type: "arc", start: A, mid: B, end: C, ...arcData };
}

function convertText(node) {
	const text = typeof node[1] === "string" ? node[1] : nodeSym(node[1]);
	const [x, yk, rot] = extractAt(node);
	return {
		type: "text",
		text,
		x: round(x),
		y: round(-yk),
		rot: rot ? round(-rot) : 0,
	};
}

function computePinEndpoints(at, length) {
	const x0 = round(at[0]);
	const y0 = round(-at[1]);
	const rot = at[2] ?? 0;
	const rad = (rot * Math.PI) / 180;
	const dx = rot % 90 === 0 ? Math.round(Math.cos(rad)) : Math.cos(rad);
	const dy = rot % 90 === 0 ? Math.round(Math.sin(rad)) : Math.sin(rad);
	const x1 = round(x0 + length * dx);
	const y1 = round(y0 - length * dy);
	return { x0, y0, x1, y1, rot, dx, dy: -dy };
}

function computePinLabels(ep, length) {
	const { x0, y0, x1, y1, dx, dy } = ep;
	const mag = Math.hypot(dx, dy) || 1;
	const ux = dx / mag;
	const uy = dy / mag;
	const vx = -uy;
	const vy = ux;
	const numPos = [
		round(x0 + ux * length * 0.5 + vx * 0.5),
		round(y0 + uy * length * 0.5 + vy * 0.5),
	];
	const namePos = [round(x1 + ux * 0.5), round(y1 + uy * 0.5)];
	return { numberPos: numPos, namePos };
}

function convertPin(pin) {
	const ep = computePinEndpoints(pin.at || [0, 0, 0], pin.length || 0);
	const labels = computePinLabels(ep, pin.length || 0);
	return {
		type: "pin",
		number: String(pin.number ?? ""),
		name: String(pin.name ?? ""),
		pinType: pin.type || "passive",
		x: ep.x0,
		y: ep.y0,
		x2: ep.x1,
		y2: ep.y1,
		line: { x1: ep.x0, y1: ep.y0, x2: ep.x1, y2: ep.y1 },
		rot: ep.rot,
		length: pin.length || 0,
		...labels,
	};
}

const GRAPHIC_CONVERTERS = {
	rectangle: convertRect,
	polyline: convertPolyline,
	circle: convertCircle,
	arc: convertArc,
	text: convertText,
};

function convertGraphicNode(node) {
	if (!Array.isArray(node)) return null;
	const converter = GRAPHIC_CONVERTERS[nodeSym(node[0])];
	return converter ? converter(node) : null;
}

export function symbolToSvgPrimitives(symbol) {
	if (!symbol) return [];
	const prims = [];
	for (const node of symbol.graphics ?? []) {
		const prim = convertGraphicNode(node);
		if (prim) prims.push(prim);
	}
	for (const pin of symbol.pins ?? []) {
		prims.push(convertPin(pin));
	}
	return prims;
}

function transformRect(prim, placement) {
	const c1 = transformPoint([prim.x, prim.y], placement);
	const c2 = transformPoint([prim.x + prim.width, prim.y], placement);
	const c3 = transformPoint(
		[prim.x + prim.width, prim.y + prim.height],
		placement,
	);
	const c4 = transformPoint([prim.x, prim.y + prim.height], placement);
	const xs = [c1[0], c2[0], c3[0], c4[0]];
	const ys = [c1[1], c2[1], c3[1], c4[1]];
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return {
		...prim,
		x: round(minX),
		y: round(minY),
		width: round(maxX - minX),
		height: round(maxY - minY),
	};
}

function transformArc(prim, placement) {
	const start = transformPoint(prim.start, placement);
	const mid = transformPoint(prim.mid, placement);
	const end = transformPoint(prim.end, placement);
	const arcData = buildArcPath(start, mid, end);
	return { ...prim, start, mid, end, ...arcData };
}

function transformPin(prim, placement) {
	const p0 = transformPoint([prim.x, prim.y], placement);
	const p1 = transformPoint([prim.x2, prim.y2], placement);
	const numPos = transformPoint(prim.numberPos, placement);
	const namePos = transformPoint(prim.namePos, placement);
	return {
		...prim,
		x: p0[0],
		y: p0[1],
		x2: p1[0],
		y2: p1[1],
		line: { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1] },
		numberPos: numPos,
		namePos,
	};
}

function transformPolyline(prim, placement) {
	return {
		...prim,
		points: prim.points.map((pt) => transformPoint(pt, placement)),
	};
}

function transformCircle(prim, placement) {
	const c = transformPoint([prim.cx, prim.cy], placement);
	return { ...prim, cx: c[0], cy: c[1] };
}

function transformText(prim, placement) {
	const p = transformPoint([prim.x, prim.y], placement);
	const rot = ((prim.rot ?? 0) + (placement.rot ?? 0)) % 360;
	return { ...prim, x: p[0], y: p[1], rot };
}

const PRIMITIVE_TRANSFORMS = {
	rect: transformRect,
	polyline: transformPolyline,
	circle: transformCircle,
	arc: transformArc,
	text: transformText,
	pin: transformPin,
};

function transformSinglePrimitive(prim, placement) {
	const transform = PRIMITIVE_TRANSFORMS[prim.type];
	return transform ? transform(prim, placement) : prim;
}

export function transformPrimitives(prims, placement = {}) {
	if (!Array.isArray(prims)) return [];
	return prims.map((prim) => transformSinglePrimitive(prim, placement));
}

export function getPrimKey(prim, idx) {
	if (prim.type === "pin") return `pin-${prim.number ?? idx}-${idx}`;
	if (prim.type === "rect")
		return `rect-${prim.x}-${prim.y}-${prim.width}-${idx}`;
	if (prim.type === "circle") return `circle-${prim.cx}-${prim.cy}-${idx}`;
	if (prim.type === "arc") return `arc-${prim.d}-${idx}`;
	if (prim.type === "polyline") {
		return `poly-${prim.points?.[0]?.[0]}-${prim.points?.[0]?.[1]}-${idx}`;
	}
	return `prim-${prim.type}-${idx}`;
}

export function symbolPinPositions(symbol, placement = {}) {
	const result = {};
	for (const pin of symbol?.pins ?? []) {
		const at = pin.at || [0, 0, 0];
		const pt = transformPoint([at[0], -at[1]], placement);
		result[String(pin.number)] = [pt[0], pt[1]];
	}
	Object.defineProperty(result, "get", {
		value: (k) => result[k] ?? result[String(k)] ?? null,
		enumerable: false,
	});
	return result;
}
