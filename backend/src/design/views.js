import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { getCapabilities } from "../kicad-compat.js";
import { DesignError } from "./model.js";

const exec = promisify(execFile);

/** Native KiCad views: KiCad itself draws them (its own colours); Banana adds nothing to the picture. */
export const BOARD_VIEWS = {
	front: { layers: ["F.Cu", "F.SilkS", "F.CrtYd", "Edge.Cuts"], mirror: false },
	back: { layers: ["B.Cu", "B.SilkS", "B.CrtYd", "Edge.Cuts"], mirror: true },
	all: {
		layers: [
			"F.Cu",
			"B.Cu",
			"F.SilkS",
			"B.SilkS",
			"F.CrtYd",
			"B.CrtYd",
			"Edge.Cuts",
		],
		mirror: false,
	},
};

/** Half the Edge.Cuts line width Banana writes (0.1 mm): the exported viewBox starts this far outside the outline. */
export const OUTLINE_HALF_WIDTH = 0.05;

/**
 * Maps board millimetres to the exported SVG's user units for views rendered with
 * `--page-size-mode 2` (board area only): scale is 1 (the viewBox is in mm) and the origin sits half an
 * outline stroke outside the board's top-left corner.
 */
export function boardViewTransform(
	board,
	margin = { x: OUTLINE_HALF_WIDTH, y: OUTLINE_HALF_WIDTH },
) {
	return {
		scale: 1,
		offsetX: -(board.originX - margin.x),
		offsetY: -(board.originY - margin.y),
		unit: "mm",
	};
}

const DEFAULT_MARGIN = { x: OUTLINE_HALF_WIDTH, y: OUTLINE_HALF_WIDTH };

/**
 * How far outside the outline the exported viewBox starts, from the viewBox of a render of a board with a known
 * outline (the crop is taken as centred). KiCad 7 to 9 give 0.05 mm (half an outline stroke); KiCad 10.0.7 crops
 * tighter: 49.9872 x 24.9936 for a 50 x 25 mm board (CI), so what a KiCad does is measured, not assumed.
 */
export function marginFromViewBox(viewBox, board) {
	if (!viewBox) return DEFAULT_MARGIN;
	const x = (viewBox[2] - board.width) / 2;
	const y = (viewBox[3] - board.height) / 2;
	return Number.isFinite(x) &&
		Number.isFinite(y) &&
		Math.abs(x) < 1 &&
		Math.abs(y) < 1
		? { x, y }
		: DEFAULT_MARGIN;
}

const CALIBRATION = { width: 50, height: 25, origin: 20 };
const calibrated = new Map();
/** Margin of the installed KiCad, measured once per version with a tiny board and cached by the render cache. */
export async function viewCropMargin() {
	const key = `${config.kicadCliPath}|${config.kicadVersion}`;
	if (calibrated.has(key)) return calibrated.get(key);
	let margin = DEFAULT_MARGIN;
	try {
		const { width, height, origin } = CALIBRATION;
		const corners = [
			[origin, origin, origin + width, origin],
			[origin + width, origin, origin + width, origin + height],
			[origin + width, origin + height, origin, origin + height],
			[origin, origin + height, origin, origin],
		];
		const text = `(kicad_pcb (version 20221018) (generator banana)
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
${corners
	.map(
		([x1, y1, x2, y2], i) =>
			`  (gr_line (start ${x1} ${y1}) (end ${x2} ${y2}) (layer "Edge.Cuts") (width 0.1) (tstamp 00000000-0000-4000-8000-00000000000${i}))`,
	)
	.join("\n")}
)
`;
		const dir = path.join(config.tempRoot, "cache");
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, "view-calibration.kicad_pcb");
		fs.writeFileSync(file, text);
		const r = await renderBoardView(file, { view: "front" });
		margin = marginFromViewBox(svgHealth(r.svg).viewBox, {
			width,
			height,
		});
	} catch {
		/* no KiCad or a render failure: the long-standing value */
	}
	calibrated.set(key, margin);
	return margin;
}

export function toViewCoords(transform, x, y) {
	return {
		x: (x + transform.offsetX) * transform.scale,
		y: (y + transform.offsetY) * transform.scale,
	};
}

export function fromViewCoords(transform, x, y) {
	return {
		x: x / transform.scale - transform.offsetX,
		y: y / transform.scale - transform.offsetY,
	};
}

const inFlight = new Map();
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function cachePath(key) {
	return path.join(config.tempRoot, "cache", "views", `${key}.svg`);
}

/** Builds the kicad-cli argument list for a board view, honouring what the installed KiCad supports. */
export function boardViewArgs({ view, input, output, capabilities }) {
	const def = BOARD_VIEWS[view];
	if (!def) throw new Error(`Unknown board view "${view}"`);
	const args = ["pcb", "export", "svg", "--layers", def.layers.join(",")];
	if (capabilities.svg.pageSizeMode) args.push("--page-size-mode", "2");
	if (capabilities.svg.excludeDrawingSheet)
		args.push("--exclude-drawing-sheet");
	if (def.mirror) args.push("--mirror");
	args.push("--output", output, input);
	return args;
}

async function renderCached(key, produce) {
	const file = cachePath(key);
	if (fs.existsSync(file)) return { file, cached: true };
	if (inFlight.has(key)) return inFlight.get(key);
	const job = (async () => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
		try {
			await produce(tmp);
			if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 200)
				throw new Error("KiCad produced no usable SVG");
			fs.renameSync(tmp, file);
		} finally {
			fs.rmSync(tmp, { force: true });
		}
		return { file, cached: false };
	})().finally(() => inFlight.delete(key));
	inFlight.set(key, job);
	return job;
}

export async function renderBoardView(boardFile, { view = "front" } = {}) {
	if (!config.kicadCliPath)
		throw new Error(config.kicadError || "kicad-cli is not available");
	if (!BOARD_VIEWS[view])
		throw new DesignError(
			`Unknown board view "${view}" (use front, back or all)`,
		);
	const caps = getCapabilities({
		cliPath: config.kicadCliPath,
		version: config.kicadVersion,
	});
	const key = sha(
		`${sha(fs.readFileSync(boardFile))}|${config.kicadVersion}|board|${view}`,
	);
	const r = await renderCached(key, async (out) => {
		await exec(
			config.kicadCliPath,
			boardViewArgs({
				view,
				input: boardFile,
				output: out,
				capabilities: caps,
			}),
			{ timeout: config.renderTimeoutMs },
		);
	});
	return { ...r, svg: fs.readFileSync(r.file, "utf8"), view };
}

export async function renderSchematicView(schFile) {
	if (!config.kicadCliPath)
		throw new Error(config.kicadError || "kicad-cli is not available");
	const caps = getCapabilities({
		cliPath: config.kicadCliPath,
		version: config.kicadVersion,
	});
	const key = sha(
		`${sha(fs.readFileSync(schFile))}|${config.kicadVersion}|sch`,
	);
	const r = await renderCached(key, async (out) => {
		const dir = fs.mkdtempSync(path.join(config.tempRoot, "schview-"));
		try {
			const args = ["sch", "export", "svg"];
			if (caps.schSvg?.excludeDrawingSheet)
				args.push("--exclude-drawing-sheet");
			args.push("--output", dir, schFile);
			await exec(config.kicadCliPath, args, {
				timeout: config.renderTimeoutMs,
			});
			const svgs = fs
				.readdirSync(dir)
				.filter((f) => f.endsWith(".svg"))
				.sort();
			if (svgs.length === 0) throw new Error("KiCad produced no schematic SVG");
			fs.copyFileSync(path.join(dir, svgs[0]), out);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
	return { ...r, svg: fs.readFileSync(r.file, "utf8") };
}

/** Basic sanity of an exported SVG: well-formed root, a viewBox, and some drawn content. */
export function svgHealth(svg) {
	const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
	const vb = /viewBox="([^"]+)"/
		.exec(root)?.[1]
		?.trim()
		.split(/\s+/)
		.map(Number);
	const shapes = (
		svg.match(/<(path|circle|rect|line|polyline|polygon)\b/g) ?? []
	).length;
	return {
		hasRoot: Boolean(root),
		viewBox: vb && vb.length === 4 && vb.every(Number.isFinite) ? vb : null,
		shapes,
		ok:
			Boolean(root) &&
			Boolean(vb && vb.length === 4 && vb.every(Number.isFinite)) &&
			shapes > 0 &&
			svg.includes("</svg>"),
	};
}
