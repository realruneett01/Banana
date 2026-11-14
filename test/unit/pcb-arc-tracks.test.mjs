import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, test } from "node:test";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { calcArcCenter } from "../../frontend/src/editor/footprintRender.js";
import { hitTest, trackPath } from "../../frontend/src/editor/pcbGeometry.js";

const KICAD = "C:/Program Files/KiCad/10.0";
const STICKHUB = `${KICAD}/share/kicad/demos/stickhub/StickHub.kicad_pcb`;
const KIPYTHON = `${KICAD}/bin/python.exe`;
const skip =
	(fs.existsSync(STICKHUB) ? false : `missing ${STICKHUB}`) ||
	(fs.existsSync(KIPYTHON) ? false : `missing ${KIPYTHON}`);

// Quarter arc from (1, 0) through the bottom to (-1, 0), Y down.
const HALF = { start: [1, 0], mid: [0, 1], end: [-1, 0], widthMm: 0.2 };

function arcParams(d) {
	const m = d.match(
		/^M (\S+) (\S+) A (\S+) (\S+) 0 ([01]) ([01]) (\S+) (\S+)$/,
	);
	assert.ok(m, `not a single SVG arc: ${d}`);
	const n = m.slice(1).map(Number);
	return {
		start: n.slice(0, 2),
		r: n[2],
		large: n[4],
		sweep: n[5],
		end: n.slice(6),
	};
}

describe("arc track path", () => {
	test("straight track stays a line", () => {
		assert.equal(trackPath({ start: [0, 0], end: [3, 4] }), "M 0 0 L 3 4");
	});

	test("arc track becomes one SVG arc through its mid point", () => {
		const a = arcParams(trackPath(HALF));
		assert.deepEqual(a.start, [1, 0]);
		assert.deepEqual(a.end, [-1, 0]);
		assert.equal(a.r, 1);
		assert.equal(a.large, 0);
		assert.equal(a.sweep, 1);
	});

	test("mirrored mid point flips the sweep", () => {
		const a = arcParams(trackPath({ ...HALF, mid: [0, -1] }));
		assert.equal(a.sweep, 0);
	});

	test("arc longer than half a turn sets the large-arc flag", () => {
		const s = Math.SQRT1_2;
		const a = arcParams(
			trackPath({ start: [s, s], mid: [0, -1], end: [-s, s] }),
		);
		assert.equal(a.large, 1);
	});
});

describe("arc track hit test", () => {
	const board = {
		tracks: [
			{ ...HALF, start: [10, 0], mid: [0, 10], end: [-10, 0], netId: "N" },
		],
	};
	const hit = (pt) => hitTest({ parts: [] }, board, pt);

	test("a point on the arc hits", () => {
		assert.equal(hit([0, 10])?.kind, "track");
		assert.equal(hit([7.0711, 7.0711])?.kind, "track");
	});

	test("the straight chord between the ends misses", () => {
		assert.equal(hit([0, 0]), null);
	});

	test("the same circle outside the arc's sweep misses", () => {
		assert.equal(hit([0, -10]), null);
	});
});

const DUMP = [
	"import sys, json, pcbnew",
	"b = pcbnew.LoadBoard(sys.argv[1])",
	"out = []",
	"for t in b.GetTracks():",
	"    if t.GetClass() != 'PCB_ARC': continue",
	"    s, c = t.GetStart(), t.GetCenter()",
	"    out.append([s.x, s.y, c.x, c.y, t.GetRadius(), t.GetAngle().AsDegrees()])",
	"print(json.dumps(out))",
].join("\n");

function kicadArcs() {
	const raw = execFileSync(KIPYTHON, ["-I", "-c", DUMP, STICKHUB]);
	const mm = (v) => v / 1e6;
	return JSON.parse(raw).map(([sx, sy, cx, cy, r, deg]) => ({
		start: [mm(sx), mm(sy)],
		center: [mm(cx), mm(cy)],
		radius: mm(r),
		deg,
	}));
}

function near(a, b, tol) {
	return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
}

describe("StickHub arcs match KiCad's own geometry", { skip }, () => {
	test("centre, radius and arc flags agree for every arc track", () => {
		const res = kicadPcbToIr(fs.readFileSync(STICKHUB, "utf8"));
		const ours = res.board.tracks.filter((t) => t.mid);
		const theirs = kicadArcs();
		assert.equal(ours.length, theirs.length);
		assert.ok(ours.length > 100, "StickHub should have many arc tracks");
		for (const k of theirs) {
			const t = ours.find((o) => near(o.start, k.start, 1e-5));
			assert.ok(t, `no arc track starts at ${k.start}`);
			const { center, radius } = calcArcCenter(t.start, t.mid, t.end);
			assert.ok(
				near(center, k.center, 1e-3),
				`centre ${center} vs ${k.center}`,
			);
			assert.ok(
				Math.abs(radius - k.radius) <= 1e-3,
				`radius ${radius} vs ${k.radius}`,
			);
			const a = arcParams(trackPath(t));
			assert.ok(Math.abs(a.r - k.radius) <= 1e-3);
			assert.equal(a.large, Math.abs(k.deg) > 180 ? 1 : 0);
			// KiCad's positive arc angle turns clockwise on screen (Y down), as SVG sweep 1 does.
			assert.equal(a.sweep, k.deg > 0 ? 1 : 0);
		}
	});
});
