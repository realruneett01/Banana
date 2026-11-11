function nodeSym(node) {
	if (node === null || node === undefined) return "";
	return typeof node === "object" ? (node.sym ?? "") : String(node);
}

function findChild(node, head) {
	if (!Array.isArray(node)) return null;
	return node.find((c) => Array.isArray(c) && nodeSym(c[0]) === head) ?? null;
}

function childNum(node, head, index, fallback = 0) {
	const sub = findChild(node, head);
	if (!sub || sub.length <= index) return fallback;
	const n = Number(sub[index]);
	return Number.isFinite(n) ? n : fallback;
}

function childPt(node, head, fallback = [0, 0]) {
	const sub = findChild(node, head);
	if (!sub || sub.length < 3) return fallback;
	return [Number(sub[1]) || 0, Number(sub[2]) || 0];
}

function extractLayer(node, fallback = "F.SilkS") {
	const sub = findChild(node, "layer");
	if (!sub || sub.length < 2) return fallback;
	return nodeSym(sub[1]) || fallback;
}

function extractWidth(node, fallback = 0.15) {
	const stroke = findChild(node, "stroke");
	if (stroke) {
		const w = childNum(stroke, "width", 1, 0);
		if (w > 0) return w;
	}
	const directW = childNum(node, "width", 1, 0);
	return directW > 0 ? directW : fallback;
}

function calcArcCenter(p1, pm, p2) {
	const d1mX = pm[0] - p1[0];
	const d1mY = pm[1] - p1[1];
	const dm2X = p2[0] - pm[0];
	const dm2Y = p2[1] - pm[1];
	const ma = [(p1[0] + pm[0]) / 2, (p1[1] + pm[1]) / 2];
	const mb = [(pm[0] + p2[0]) / 2, (pm[1] + p2[1]) / 2];
	const na = [-d1mY, d1mX];
	const nb = [-dm2Y, dm2X];
	const det = na[1] * nb[0] - na[0] * nb[1];
	if (Math.abs(det) < 1e-10) {
		return { center: ma, radius: Math.hypot(d1mX, d1mY) };
	}
	const s = ((mb[0] - ma[0]) * -nb[1] - (mb[1] - ma[1]) * -nb[0]) / det;
	const center = [ma[0] + s * na[0], ma[1] + s * na[1]];
	const radius = Math.hypot(p1[0] - center[0], p1[1] - center[1]);
	return { center, radius };
}

function calcArcSweep(p1, pm, p2, c) {
	const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
	const am = Math.atan2(pm[1] - c[1], pm[0] - c[0]);
	const a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
	const dm = (((am - a1) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
	const d2 = (((a2 - a1) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
	const swept = dm < d2 ? d2 : 2 * Math.PI - d2;
	return swept > Math.PI ? 1 : 0;
}

export function arcToSvgPath(arc) {
	if (arc.d) return arc.d;
	const p1 = arc.start ?? [0, 0];
	const p2 = arc.end ?? [0, 0];
	const pm = arc.mid ?? [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
	const c = arc.center ?? [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
	const r = arc.radius ?? Math.hypot(p1[0] - c[0], p1[1] - c[1]);
	if (r <= 0) return `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]}`;
	const cp =
		(pm[0] - p1[0]) * (p2[1] - p1[1]) - (pm[1] - p1[1]) * (p2[0] - p1[0]);
	const sweep = cp > 0 ? 1 : 0;
	const largeArc = calcArcSweep(p1, pm, p2, c);
	return `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 ${largeArc} ${sweep} ${p2[0]} ${p2[1]}`;
}

function parseAngleArc(startNode, endNode, angleNode, layer, width) {
	const c = [Number(startNode[1]) || 0, Number(startNode[2]) || 0];
	const p1 = [Number(endNode[1]) || 0, Number(endNode[2]) || 0];
	const angleDeg = Number(angleNode[1]) || 0;
	const r = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
	const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
	const sweepRad = (angleDeg * Math.PI) / 180;
	const a2 = a1 + sweepRad;
	const p2 = [c[0] + r * Math.cos(a2), c[1] + r * Math.sin(a2)];
	const aMid = a1 + sweepRad / 2;
	const pm = [c[0] + r * Math.cos(aMid), c[1] + r * Math.sin(aMid)];
	const largeArc = Math.abs(angleDeg) > 180 ? 1 : 0;
	const sweep = angleDeg > 0 ? 1 : 0;
	const d = `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 ${largeArc} ${sweep} ${p2[0]} ${p2[1]}`;
	return {
		type: "arc",
		layer,
		width,
		start: p1,
		mid: pm,
		end: p2,
		center: c,
		radius: r,
		d,
	};
}

function parseMidArc(startNode, midNode, endNode, layer, width) {
	const p1 = [Number(startNode[1]) || 0, Number(startNode[2]) || 0];
	const pm = [Number(midNode[1]) || 0, Number(midNode[2]) || 0];
	const p2 = [Number(endNode[1]) || 0, Number(endNode[2]) || 0];
	const { center, radius } = calcArcCenter(p1, pm, p2);
	const arc = {
		type: "arc",
		layer,
		width,
		start: p1,
		mid: pm,
		end: p2,
		center,
		radius,
	};
	arc.d = arcToSvgPath(arc);
	return arc;
}

function parseArcNode(node, layer, width) {
	const s = findChild(node, "start");
	const m = findChild(node, "mid");
	const e = findChild(node, "end");
	const a = findChild(node, "angle");
	if (s && m && e) return parseMidArc(s, m, e, layer, width);
	if (s && e && a) return parseAngleArc(s, e, a, layer, width);
	return null;
}

function parsePolyNode(node, layer, width) {
	const ptsNode = findChild(node, "pts");
	const pts = [];
	for (const child of ptsNode?.slice(1) ?? []) {
		if (Array.isArray(child) && nodeSym(child[0]) === "xy") {
			pts.push([Number(child[1]) || 0, Number(child[2]) || 0]);
		}
	}
	return { type: "poly", layer, width, pts };
}

function parseGraphicNode(node) {
	if (!Array.isArray(node)) return null;
	const head = nodeSym(node[0]);
	const layer = extractLayer(node);
	const width = extractWidth(node);
	if (head === "fp_line") {
		return {
			type: "line",
			layer,
			width,
			start: childPt(node, "start"),
			end: childPt(node, "end"),
		};
	}
	if (head === "fp_rect") {
		return {
			type: "rect",
			layer,
			width,
			start: childPt(node, "start"),
			end: childPt(node, "end"),
		};
	}
	if (head === "fp_circle") {
		const center = childPt(node, "center");
		const end = childPt(node, "end");
		const radius = Math.hypot(end[0] - center[0], end[1] - center[1]);
		return { type: "circle", layer, width, center, end, radius };
	}
	if (head === "fp_arc") return parseArcNode(node, layer, width);
	if (head === "fp_poly") return parsePolyNode(node, layer, width);
	return null;
}

function normalizePadShape(shape) {
	const s = String(shape || "").toLowerCase();
	if (s === "roundrect" || s === "rounded_rect") return "roundrect";
	if (s === "oval" || s === "oblong") return "oval";
	if (s === "circle" || s === "circular") return "circle";
	return "rect";
}

function parsePad(pad) {
	const at = Array.isArray(pad.at) ? pad.at : [0, 0, 0];
	const size = Array.isArray(pad.size) ? pad.size : [1, 1];
	const shape = normalizePadShape(pad.shape);
	return {
		type: "pad",
		number: String(pad.number ?? ""),
		padType: String(pad.type ?? "smd"),
		shape,
		center: [Number(at[0]) || 0, Number(at[1]) || 0],
		size: [Number(size[0]) || 0, Number(size[1]) || 0],
		rot: Number(at[2]) || 0,
		layers: Array.isArray(pad.layers) ? [...pad.layers] : ["F.Cu"],
		drill: pad.drill ? Number(pad.drill) : undefined,
	};
}

export function footprintToPrimitives(fp) {
	if (!fp) return { pads: [], graphics: [] };
	const rawPads = Array.isArray(fp.pads) ? fp.pads : [];
	const rawGraphics = Array.isArray(fp.graphics) ? fp.graphics : [];
	const pads = rawPads.map(parsePad);
	const graphics = [];
	for (const g of rawGraphics) {
		const parsed = parseGraphicNode(g);
		if (parsed) graphics.push(parsed);
	}
	return { pads, graphics };
}

function mapLayer(layer, side) {
	if (side !== "B" || typeof layer !== "string") return layer;
	if (layer.startsWith("F.")) return `B.${layer.slice(2)}`;
	return layer;
}

function transformPoint(pt, pl) {
	const x = pl.x ?? 0;
	const y = pl.y ?? 0;
	const rot = pl.rot ?? 0;
	const px = pl.side === "B" ? -pt[0] : pt[0];
	const py = pt[1];
	if (!rot) return [x + px, y + py];
	const rad = (rot * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return [x + px * cos - py * sin, y + px * sin + py * cos];
}

function transformRot(padRot, pl) {
	const rot = pl.rot ?? 0;
	const base = pl.side === "B" ? rot - padRot : rot + padRot;
	return ((base % 360) + 360) % 360;
}

function transformPad(pad, pl) {
	return {
		...pad,
		center: transformPoint(pad.center, pl),
		rot: transformRot(pad.rot, pl),
		layers: pad.layers.map((l) => mapLayer(l, pl.side)),
	};
}

function transformGraphic(g, pl) {
	const layer = mapLayer(g.layer, pl.side);
	if (g.type === "line" || g.type === "rect") {
		return {
			...g,
			layer,
			start: transformPoint(g.start, pl),
			end: transformPoint(g.end, pl),
		};
	}
	if (g.type === "circle") {
		return { ...g, layer, center: transformPoint(g.center, pl) };
	}
	if (g.type === "arc") {
		const start = transformPoint(g.start, pl);
		const mid = g.mid ? transformPoint(g.mid, pl) : undefined;
		const end = transformPoint(g.end, pl);
		const center = g.center ? transformPoint(g.center, pl) : undefined;
		const arc = { ...g, layer, start, mid, end, center };
		arc.d = arcToSvgPath(arc);
		return arc;
	}
	if (g.type === "poly") {
		return { ...g, layer, pts: g.pts.map((p) => transformPoint(p, pl)) };
	}
	return { ...g, layer };
}

export function transformPrimitives(prims, placement = {}) {
	if (!prims) return { pads: [], graphics: [] };
	const pl = { x: 0, y: 0, rot: 0, side: "F", ...placement };
	if (Array.isArray(prims)) {
		return prims.map((p) =>
			p.type === "pad" ? transformPad(p, pl) : transformGraphic(p, pl),
		);
	}
	const pads = (prims.pads ?? []).map((p) => transformPad(p, pl));
	const graphics = (prims.graphics ?? []).map((g) => transformGraphic(g, pl));
	return { pads, graphics };
}

export function padWorldPositions(fp, placement = {}) {
	if (!fp) return {};
	const pl = { x: 0, y: 0, rot: 0, side: "F", ...placement };
	const pads = Array.isArray(fp.pads)
		? fp.pads
		: fp.pads
			? Object.values(fp.pads)
			: [];
	const positions = {};
	for (const pad of pads) {
		const num = String(pad.number ?? "");
		if (!num) continue;
		const localPt = Array.isArray(pad.at)
			? [pad.at[0] || 0, pad.at[1] || 0]
			: (pad.center ?? [0, 0]);
		const [wx, wy] = transformPoint(localPt, pl);
		positions[num] = [
			Math.round(wx * 10000) / 10000,
			Math.round(wy * 10000) / 10000,
		];
	}
	return positions;
}

function pointInRotatedBox(lx, ly, hw, hh) {
	return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

function pointInOval(lx, ly, hw, hh) {
	if (hw >= hh) {
		const r = hh;
		const sx = hw - r;
		const px = Math.max(-sx, Math.min(sx, lx));
		return (lx - px) ** 2 + ly ** 2 <= r ** 2;
	}
	const r = hw;
	const sy = hh - r;
	const py = Math.max(-sy, Math.min(sy, ly));
	return lx ** 2 + (ly - py) ** 2 <= r ** 2;
}

function pointInRoundRect(lx, ly, hw, hh) {
	if (!pointInRotatedBox(lx, ly, hw, hh)) return false;
	const r = Math.min(hw, hh) * 0.25;
	const cx = hw - r;
	const cy = hh - r;
	if (Math.abs(lx) > cx && Math.abs(ly) > cy) {
		return (Math.abs(lx) - cx) ** 2 + (Math.abs(ly) - cy) ** 2 <= r ** 2;
	}
	return true;
}

function pointInPad(pt, pad) {
	const [px, py] = pt;
	const [cx, cy] = pad.center;
	const dx = px - cx;
	const dy = py - cy;
	const rot = pad.rot || 0;
	const rad = (-rot * Math.PI) / 180;
	const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
	const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
	const hw = (pad.size[0] || 0) / 2;
	const hh = (pad.size[1] || 0) / 2;
	if (pad.shape === "circle") return lx ** 2 + ly ** 2 <= Math.max(hw, hh) ** 2;
	if (pad.shape === "oval") return pointInOval(lx, ly, hw, hh);
	if (pad.shape === "roundrect") return pointInRoundRect(lx, ly, hw, hh);
	return pointInRotatedBox(lx, ly, hw, hh);
}

export function padHitTest(prims, pt) {
	if (!prims || !Array.isArray(pt)) return null;
	const pads = Array.isArray(prims)
		? prims.filter((p) => p.type === "pad")
		: (prims.pads ?? []);
	for (const pad of pads) {
		if (pointInPad(pt, pad)) return pad.number;
	}
	return null;
}
