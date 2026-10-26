import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { getFootprint, getSymbol } from "./kicad-lib.js";

const exec = promisify(execFile);
const issue = (severity, type, message, extra = {}) => ({ severity, type, message, ...extra });

const IGNORED_DRC = new Set(["lib_footprint_issues", "lib_footprint_mismatch"]);
const DRIVERS = new Set(["output", "bidirectional", "tri_state", "passive", "power_out", "open_collector", "open_emitter", "free", "unspecified"]);

/**
 * Electrical rule checks on the design's own connectivity. These run everywhere (no KiCad version
 * dependency) and complement KiCad's ERC where the installed KiCad provides it.
 */
export function ercLite(design) {
	const d = design.data;
	const out = [];
	const pinInfo = new Map(); // "R1.2" -> { type, name, hidden, part }
	for (const part of d.parts) {
		const sym = getSymbol(part.symbol);
		if (!part.footprint) out.push(issue("error", "unassigned_footprint", `${part.ref} has no footprint`, { ref: part.ref }));
		if (!part.value) out.push(issue("warning", "missing_value", `${part.ref} has no value`, { ref: part.ref }));
		for (const p of sym.pins) pinInfo.set(`${part.ref}.${p.number}`, { ...p, ref: part.ref });
	}
	const netOf = new Map();
	for (const [name, net] of Object.entries(d.nets)) for (const p of net.pins) netOf.set(p, name);
	const nc = new Set(d.noConnect);

	for (const [key, info] of pinInfo) {
		if (netOf.has(key) || nc.has(key) || info.type === "no_connect") continue;
		if (info.hidden && info.type.startsWith("power")) {
			out.push(issue("warning", "hidden_power_pin", `${key} (${info.name}) is a hidden power pin; KiCad ties it to the net named "${info.name}"`, { pin: key }));
			continue;
		}
		out.push(issue("error", "pin_not_connected", `${key} (${info.name}) is not connected`, { pin: key }));
	}

	for (const [name, net] of Object.entries(d.nets)) {
		const pins = net.pins.map((p) => pinInfo.get(p)).filter(Boolean);
		const types = pins.map((p) => p.type);
		if (net.pins.length === 1 && !net.external) out.push(issue("warning", "net_single_pin", `Net "${name}" has only one pin (${net.pins[0]})`, { net: name }));
		const outputs = pins.filter((p) => p.type === "output" || p.type === "power_out");
		if (outputs.length > 1) out.push(issue("error", "output_conflict", `Net "${name}" is driven by several outputs: ${outputs.map((p) => `${p.ref}.${p.number}`).join(", ")}`, { net: name }));
		if (types.includes("power_in") && !types.includes("power_out") && !net.external) {
			out.push(issue("error", "power_pin_not_driven", `Power input pin(s) on net "${name}" have no source: add a power output or mark the net external (supplied from off-board)`, { net: name, pins: pins.filter((p) => p.type === "power_in").map((p) => `${p.ref}.${p.number}`) }));
		}
		if (types.includes("input") && !types.some((t) => DRIVERS.has(t)) && !types.includes("power_in") && !net.external) {
			out.push(issue("warning", "input_not_driven", `Input pin(s) on net "${name}" are not driven by anything`, { net: name }));
		}
		if (types.includes("input") && types.includes("output") === false && types.every((t) => t === "input")) {
			// covered above; kept explicit for readability
		}
	}
	return out;
}

// ---- geometry ----
export function rotatePoint(x, y, rotDeg) {
	const r = (rotDeg * Math.PI) / 180;
	return [x * Math.cos(r) + y * Math.sin(r), -x * Math.sin(r) + y * Math.cos(r)];
}

/** Absolute pad positions: Map "R1.2" -> {x, y, w, h, rot, layers, thru} */
export function absolutePads(design, positions) {
	const out = new Map();
	for (const part of design.data.parts) {
		const fp = part.footprint && getFootprint(part.footprint);
		const at = positions[part.ref];
		if (!fp || !at) continue;
		for (const pad of fp.pads) {
			const [dx, dy] = rotatePoint(pad.x, pad.y, at.rot || 0);
			const swap = (at.rot || 0) % 180 !== 0;
			out.set(`${part.ref}.${pad.number}`, {
				x: at.x + dx,
				y: at.y + dy,
				w: swap ? pad.h : pad.w,
				h: swap ? pad.w : pad.h,
				thru: pad.type === "thru_hole" || pad.type === "np_thru_hole",
				drill: pad.drill || 0,
				layers: pad.layers,
			});
		}
	}
	return out;
}

// ---- copper-overlap geometry (what KiCad treats as "connected") ----
function pointSegDist(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function segIntersect(a, b) {
	const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
	const on = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
	const [p1, q1] = a;
	const [p2, q2] = b;
	const o1 = o(p1, q1, p2);
	const o2 = o(p1, q1, q2);
	const o3 = o(p2, q2, p1);
	const o4 = o(p2, q2, q1);
	if (o1 !== o2 && o3 !== o4) return true;
	return (o1 === 0 && on(p1, q1, p2)) || (o2 === 0 && on(p1, q1, q2)) || (o3 === 0 && on(p2, q2, p1)) || (o4 === 0 && on(p2, q2, q1));
}
export function segSegDist(a, b) {
	if (segIntersect(a, b)) return 0;
	return Math.min(pointSegDist(a[0][0], a[0][1], b[0][0], b[0][1], b[1][0], b[1][1]), pointSegDist(a[1][0], a[1][1], b[0][0], b[0][1], b[1][0], b[1][1]), pointSegDist(b[0][0], b[0][1], a[0][0], a[0][1], a[1][0], a[1][1]), pointSegDist(b[1][0], b[1][1], a[0][0], a[0][1], a[1][0], a[1][1]));
}
export function segRectDist(seg, r) {
	const minX = r.x - r.w / 2;
	const maxX = r.x + r.w / 2;
	const minY = r.y - r.h / 2;
	const maxY = r.y + r.h / 2;
	const inside = (p) => p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
	if (inside(seg[0]) || inside(seg[1])) return 0;
	const edges = [[[minX, minY], [maxX, minY]], [[maxX, minY], [maxX, maxY]], [[maxX, maxY], [minX, maxY]], [[minX, maxY], [minX, minY]]];
	return Math.min(...edges.map((e) => segSegDist(seg, e)));
}
function pointRectDist(px, py, r) {
	const dx = Math.max(Math.abs(px - r.x) - r.w / 2, 0);
	const dy = Math.max(Math.abs(py - r.y) - r.h / 2, 0);
	return Math.hypot(dx, dy);
}

/**
 * Which nets still have unconnected pad groups. Two pieces of copper are connected when they overlap or
 * touch on a common layer, including a track ending in the middle of another track, a track passing
 * through a pad, and vias joining both layers - the same notion KiCad uses.
 */
export function routingStatus(design, positions) {
	const d = design.data;
	const pads = absolutePads(design, positions);
	const EPS = 0.011;
	const results = {};
	for (const [net, def] of Object.entries(d.nets)) {
		const items = []; // {kind, id, ...}
		for (const pin of def.pins) {
			const p = pads.get(pin);
			if (p) items.push({ kind: "pad", id: `pad:${pin}`, pad: p, layers: p.thru ? ["F.Cu", "B.Cu"] : [p.layers.includes("B.Cu") && !p.layers.includes("F.Cu") ? "B.Cu" : "F.Cu"] });
		}
		const polylineGroups = [];
		d.tracks.forEach((t, ti) => {
			if (t.net !== net) return;
			const ids = [];
			for (let i = 0; i + 1 < t.points.length; i++) {
				const id = `seg:${ti}:${i}`;
				ids.push(id);
				items.push({ kind: "seg", id, seg: [t.points[i], t.points[i + 1]], width: t.width, layers: [t.layer] });
			}
			polylineGroups.push(ids);
		});
		d.vias.forEach((v, vi) => {
			if (v.net === net) items.push({ kind: "via", id: `via:${vi}`, x: v.x, y: v.y, r: v.size / 2, layers: ["F.Cu", "B.Cu"] });
		});
		const parent = new Map(items.map((i) => [i.id, i.id]));
		const find = (a) => {
			while (parent.get(a) !== a) {
				parent.set(a, parent.get(parent.get(a)));
				a = parent.get(a);
			}
			return a;
		};
		const union = (a, b) => parent.set(find(a), find(b));
		for (const g of polylineGroups) for (let i = 1; i < g.length; i++) union(g[i - 1], g[i]);
		for (let i = 0; i < items.length; i++) {
			for (let j = i + 1; j < items.length; j++) {
				const a = items[i];
				const b = items[j];
				if (a.kind === "pad" && b.kind === "pad") continue;
				if (!a.layers.some((l) => b.layers.includes(l))) continue;
				let touch = false;
				if (a.kind === "seg" && b.kind === "seg") touch = segSegDist(a.seg, b.seg) <= (a.width + b.width) / 2 * 0 + EPS;
				else if (a.kind === "seg" || b.kind === "seg") {
					const [s, o] = a.kind === "seg" ? [a, b] : [b, a];
					if (o.kind === "pad") touch = segRectDist(s.seg, o.pad) <= EPS;
					else touch = pointSegDist(o.x, o.y, s.seg[0][0], s.seg[0][1], s.seg[1][0], s.seg[1][1]) <= o.r;
				} else {
					const [pd, vi] = a.kind === "pad" ? [a, b] : [b, a];
					if (pd.kind === "pad" && vi.kind === "via") touch = pointRectDist(vi.x, vi.y, pd.pad) <= vi.r;
					else if (a.kind === "via" && b.kind === "via") touch = Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r;
				}
				if (touch) union(a.id, b.id);
			}
		}
		const padRoots = new Set(items.filter((i) => i.kind === "pad").map((i) => find(i.id)));
		results[net] = { pads: items.filter((i) => i.kind === "pad").length, islands: padRoots.size, routed: padRoots.size <= 1 };
	}
	return results;
}

/**
 * Copper clearance between different nets: tracks, vias and pads, exact geometry, on each layer.
 * Independent of KiCad's DRC (which this KiCad version does not run for crossing tracks) and of its version.
 */
export function copperLite(design, positions, clearance = 0.2) {
	const d = design.data;
	const pads = absolutePads(design, positions);
	const netOfPin = new Map();
	for (const [name, net] of Object.entries(d.nets)) for (const p of net.pins) netOfPin.set(p, name);
	const items = [];
	for (const [pin, p] of pads) items.push({ kind: "pad", net: netOfPin.get(pin) ?? `(unconnected ${pin})`, label: pin, pad: p, layers: p.thru ? ["F.Cu", "B.Cu"] : [p.layers.includes("B.Cu") && !p.layers.includes("F.Cu") ? "B.Cu" : "F.Cu"] });
	d.tracks.forEach((t, ti) => {
		for (let i = 0; i + 1 < t.points.length; i++) items.push({ kind: "seg", net: t.net, label: `track ${ti} (${t.net}, ${t.layer})`, seg: [t.points[i], t.points[i + 1]], w: t.width, layers: [t.layer] });
	});
	d.vias.forEach((v, vi) => items.push({ kind: "via", net: v.net, label: `via ${vi} (${v.net})`, x: v.x, y: v.y, r: v.size / 2, layers: ["F.Cu", "B.Cu"] }));

	const gapBetween = (a, b) => {
		if (a.kind === "seg" && b.kind === "seg") return segSegDist(a.seg, b.seg) - (a.w + b.w) / 2;
		const seg = a.kind === "seg" ? a : b.kind === "seg" ? b : null;
		const other = seg === a ? b : a;
		if (seg && other.kind === "pad") return segRectDist(seg.seg, other.pad) - seg.w / 2;
		if (seg && other.kind === "via") return pointSegDist(other.x, other.y, seg.seg[0][0], seg.seg[0][1], seg.seg[1][0], seg.seg[1][1]) - seg.w / 2 - other.r;
		if (a.kind === "via" && b.kind === "via") return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
		const via = a.kind === "via" ? a : b;
		const pad = a.kind === "pad" ? a : b;
		return pointRectDist(via.x, via.y, pad.pad) - via.r;
	};

	const out = [];
	const seen = new Set();
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i];
			const b = items[j];
			if (a.net === b.net || (a.kind === "pad" && b.kind === "pad")) continue;
			if (!a.layers.some((l) => b.layers.includes(l))) continue;
			const gap = gapBetween(a, b);
			if (gap >= clearance - 1e-6) continue;
			const key = `${a.net}|${b.net}|${a.label}|${b.label}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(issue("error", gap <= 0 ? "short" : "clearance", `${a.label} and ${b.label} ${gap <= 0 ? "touch or cross (short between nets)" : `are ${gap.toFixed(3)} mm apart (minimum ${clearance} mm)`}`, { nets: [a.net, b.net] }));
		}
	}
	return out;
}

/** Placement checks: courtyards overlapping each other or leaving the board outline. */
export function placementLite(design, positions, board) {
	const out = [];
	const boxes = [];
	for (const part of design.data.parts) {
		const fp = part.footprint && getFootprint(part.footprint);
		const at = positions[part.ref];
		if (!fp || !at) continue;
		const pts = [[fp.bbox.minX, fp.bbox.minY], [fp.bbox.maxX, fp.bbox.minY], [fp.bbox.maxX, fp.bbox.maxY], [fp.bbox.minX, fp.bbox.maxY]].map(([x, y]) => rotatePoint(x, y, at.rot || 0));
		boxes.push({ ref: part.ref, minX: at.x + Math.min(...pts.map((p) => p[0])), maxX: at.x + Math.max(...pts.map((p) => p[0])), minY: at.y + Math.min(...pts.map((p) => p[1])), maxY: at.y + Math.max(...pts.map((p) => p[1])) });
	}
	for (const b of boxes) {
		if (board && (b.minX < board.originX - 0.001 || b.minY < board.originY - 0.001 || b.maxX > board.originX + board.width + 0.001 || b.maxY > board.originY + board.height + 0.001)) {
			out.push(issue("error", "outside_board", `${b.ref} extends beyond the board outline`, { ref: b.ref }));
		}
	}
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i];
			const b = boxes[j];
			if (a.minX < b.maxX - 0.001 && b.minX < a.maxX - 0.001 && a.minY < b.maxY - 0.001 && b.minY < a.maxY - 0.001) out.push(issue("error", "courtyard_overlap", `${a.ref} and ${b.ref} courtyards overlap`, { refs: [a.ref, b.ref] }));
		}
	}
	return out;
}

// ---- KiCad's own checks ----
export function kicadMajor() {
	const m = /^(\d+)/.exec(String(config.kicadVersion || "").trim());
	return m ? Number(m[1]) : 0;
}

export function findPython() {
	for (const exe of [process.env.KICAD_PYTHON, "python3", "python"].filter(Boolean)) {
		try {
			execFileSync(exe, ["-c", "import pcbnew"], { stdio: "ignore", timeout: 15000 });
			return exe;
		} catch {
			/* try next */
		}
	}
	return null;
}

const DRC_PY = `
import sys, json, pcbnew
board = pcbnew.LoadBoard(sys.argv[1])
out = sys.argv[2]
pcbnew.WriteDRCReport(board, out, pcbnew.EDA_UNITS_MILLIMETRES, True)
`;

/** Parses the text report written by pcbnew.WriteDRCReport / kicad-cli into issues. */
export function parseDrcReport(text) {
	const out = [];
	const re = /^\[(\w+)\]: (.+)$/gm;
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const m = /^\[(\w+)\]: (.+)$/.exec(lines[i]);
		if (!m) continue;
		const severity = /Severity: (\w+)/.exec(lines[i + 1] || "")?.[1] ?? /; (error|warning)/i.exec(lines[i])?.[1] ?? "error";
		const items = [];
		for (let j = i + 1; j < lines.length && /^\s+(@|\S.*)/.test(lines[j]) && !/^\[/.test(lines[j]); j++) if (/^\s+@/.test(lines[j]) || /^\s+\w/.test(lines[j])) items.push(lines[j].trim());
		if (IGNORED_DRC.has(m[1])) continue; // the generated project has no library table, so KiCad cannot compare footprints with libraries
		out.push(issue(severity.toLowerCase().startsWith("warn") ? "warning" : "error", m[1], m[2], { items: items.slice(0, 4) }));
	}
	void re;
	return out;
}

export function parseDrcJson(text) {
	const j = JSON.parse(text);
	const out = [];
	for (const v of (j.violations ?? []).filter((x) => !IGNORED_DRC.has(x.type))) out.push(issue(v.severity === "warning" ? "warning" : "error", v.type, v.description, { items: (v.items ?? []).map((i) => i.description).slice(0, 4) }));
	for (const u of j.unconnected_items ?? []) out.push(issue("error", "unconnected_items", u.description || "Unconnected items", { items: (u.items ?? []).map((i) => i.description).slice(0, 4) }));
	return out;
}

export function parseErcJson(text) {
	const j = JSON.parse(text);
	const out = [];
	for (const sheet of j.sheets ?? []) for (const v of sheet.violations ?? []) out.push(issue(v.severity === "warning" ? "warning" : "error", v.type, v.description, { items: (v.items ?? []).map((i) => i.description).slice(0, 4), sheet: sheet.path }));
	return out;
}

/** Runs KiCad's ERC where the CLI has it (KiCad 8+). Returns {engine, status, issues}. */
export async function kicadErc(schPath) {
	if (!config.kicadCliPath) return { engine: "kicad", status: "unavailable", reason: config.kicadError || "kicad-cli not found", issues: [] };
	if (kicadMajor() < 8) return { engine: "kicad", status: "unavailable", reason: `kicad-cli ${config.kicadVersion} has no ERC command (needs KiCad 8 or newer)`, issues: [] };
	const tmp = path.join(os.tmpdir(), `banana-erc-${process.pid}-${Date.now()}.json`);
	try {
		// exit code is non-zero when violations exist unless --exit-code-violations is omitted; both are fine.
		await exec(config.kicadCliPath, ["sch", "erc", "--format", "json", "--severity-all", "--output", tmp, schPath], { timeout: config.renderTimeoutMs }).catch((e) => {
			if (!fs.existsSync(tmp)) throw e;
		});
		return { engine: "kicad", status: "ok", issues: parseErcJson(fs.readFileSync(tmp, "utf8")) };
	} catch (err) {
		return { engine: "kicad", status: "error", reason: err.message, issues: [] };
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

/** Runs KiCad's DRC: kicad-cli on KiCad 8+, pcbnew's Python API on KiCad 7. */
export async function kicadDrc(pcbPath) {
	const tmp = path.join(os.tmpdir(), `banana-drc-${process.pid}-${Date.now()}`);
	try {
		if (config.kicadCliPath && kicadMajor() >= 8) {
			await exec(config.kicadCliPath, ["pcb", "drc", "--format", "json", "--severity-all", "--all-track-errors", "--output", `${tmp}.json`, pcbPath], { timeout: config.renderTimeoutMs }).catch((e) => {
				if (!fs.existsSync(`${tmp}.json`)) throw e;
			});
			return { engine: "kicad-cli", status: "ok", issues: parseDrcJson(fs.readFileSync(`${tmp}.json`, "utf8")) };
		}
		const py = findPython();
		if (!py) return { engine: "pcbnew", status: "unavailable", reason: "KiCad 7 has no DRC command and python with pcbnew was not found", issues: [] };
		const script = `${tmp}.py`;
		fs.writeFileSync(script, DRC_PY);
		await exec(py, [script, pcbPath, `${tmp}.rpt`], { timeout: config.renderTimeoutMs });
		const text = fs.readFileSync(`${tmp}.rpt`, "utf8");
		return { engine: "pcbnew", status: "ok", issues: parseDrcReport(text), raw: text.length > 20000 ? `${text.slice(0, 20000)}…` : text };
	} catch (err) {
		return { engine: "pcbnew", status: "error", reason: err.message, issues: [] };
	} finally {
		for (const e of [".json", ".py", ".rpt"]) fs.rmSync(`${tmp}${e}`, { force: true });
	}
}

/** Connectivity as KiCad itself sees it: exports the netlist and compares it with the design. */
export async function netlistParity(design, schPath) {
	if (!config.kicadCliPath) return { status: "unavailable", reason: config.kicadError || "kicad-cli not found", mismatches: [] };
	const tmp = path.join(os.tmpdir(), `banana-net-${process.pid}-${Date.now()}.net`);
	try {
		await exec(config.kicadCliPath, ["sch", "export", "netlist", "--format", "kicadsexpr", "--output", tmp, schPath], { timeout: config.renderTimeoutMs });
		const text = fs.readFileSync(tmp, "utf8");
		const got = new Map();
		for (const chunk of text.split(/\(net \(code "\d+"\) /).slice(1)) {
			const nameMatch = /^\(name "((?:[^"\\]|\\.)*)"\)/.exec(chunk);
			if (!nameMatch) continue;
			const name = nameMatch[1].replace(/^\//, "");
			const pins = [...chunk.matchAll(/\(node \(ref "([^"]+)"\) \(pin "([^"]+)"\)/g)].map((n) => `${n[1]}.${n[2]}`).filter((p) => !p.startsWith("#"));
			if (pins.length) got.set(name, pins.sort());
		}
		const mismatches = [];
		for (const [name, net] of Object.entries(design.data.nets)) {
			const want = [...net.pins].sort();
			const have = got.get(name) ?? [];
			if (want.length < 2 && !have.length) continue;
			if (JSON.stringify(want) !== JSON.stringify(have)) mismatches.push({ net: name, expected: want, kicad: have });
		}
		return { status: mismatches.length ? "mismatch" : "ok", mismatches };
	} catch (err) {
		return { status: "error", reason: err.message, mismatches: [] };
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}
