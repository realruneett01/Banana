import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { autoPlace } from "../auto-place.js";
import { createFreerouting, irToDsn, parseSes } from "../freerouting.js";

const ROUTE_INPUT_SCHEMA = {
	type: "object",
	required: ["ir", "boardW", "boardH"],
	additionalProperties: false,
	properties: {
		ir: { type: "object" },
		boardW: { type: "number" },
		boardH: { type: "number" },
		rules: {
			type: "object",
			additionalProperties: false,
			properties: {
				traceWidthMm: { type: "number" },
				clearanceMm: { type: "number" },
			},
		},
	},
};

const ROUTE_OUTPUT_SCHEMA = {
	type: "object",
	required: ["placedIr", "routes"],
	additionalProperties: false,
	properties: {
		placedIr: { type: "object" },
		routes: {
			type: "object",
			required: ["wires", "vias"],
			properties: {
				wires: { type: "array" },
				vias: { type: "array" },
			},
		},
	},
};

function hasPlacement(part) {
	const p = part?.placement;
	return p != null && typeof p.x === "number" && typeof p.y === "number";
}

async function resolvePlacedIr(ir, boardW, boardH, autoPlaceFn) {
	const parts = ir?.parts;
	const needsPlace =
		Array.isArray(parts) && parts.some((p) => !hasPlacement(p));
	if (!needsPlace) {
		return ir;
	}
	const res = await autoPlaceFn(ir, { boardW, boardH });
	return res?.ir ?? ir;
}

function isWithinDir(parent, target) {
	const rel = path.relative(parent, target);
	return Boolean(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

async function createWorkDirectory(resolvedTemp) {
	await fs.promises.mkdir(resolvedTemp, { recursive: true });
	const workDir = await fs.promises.mkdtemp(path.join(resolvedTemp, "route-"));
	const resolvedWork = path.resolve(workDir);
	if (!isWithinDir(resolvedTemp, resolvedWork)) {
		await fs.promises.rm(resolvedWork, { recursive: true, force: true });
		throw new Error("Work directory created outside temp directory");
	}
	return workDir;
}

async function executeRoute(freerouting, dsnText, workDir) {
	const routeResult = await freerouting.route({ dsnText, workDir });
	if (typeof routeResult === "string") {
		return parseSes(routeResult);
	}
	return routeResult;
}

async function runRoutingWorkflow(input, placedIr, deps) {
	const resolvedTemp = path.resolve(deps.tempDir);
	let workDir;
	try {
		workDir = await createWorkDirectory(resolvedTemp);
		const dsnText = irToDsn(placedIr, {
			boardW: input.boardW,
			boardH: input.boardH,
			rules: input.rules,
			footprints: placedIr?.footprints ?? {},
		});
		const routes = await executeRoute(deps.freerouting, dsnText, workDir);
		return { placedIr, routes };
	} catch (err) {
		throw new Error(err?.message || String(err));
	} finally {
		if (workDir && isWithinDir(resolvedTemp, path.resolve(workDir))) {
			await fs.promises.rm(workDir, { recursive: true, force: true });
		}
	}
}

async function handleRoute(input, deps) {
	if (!deps.freerouting.available()) {
		throw new Error("Freerouting is not configured (set FREEROUTING_JAR)");
	}
	if (input.boardW <= 0 || input.boardH <= 0) {
		throw new Error("boardW and boardH must be greater than 0");
	}
	const placedIr = await resolvePlacedIr(
		input.ir,
		input.boardW,
		input.boardH,
		deps.autoPlaceFn,
	);
	return runRoutingWorkflow(input, placedIr, deps);
}

export function registerRouteTools(registry, deps = {}) {
	const resolvedDeps = {
		freerouting: deps.freerouting ?? createFreerouting(),
		tempDir: deps.tempDir ?? config.tempStorageDir,
		autoPlaceFn: deps.autoPlaceFn ?? autoPlace,
	};
	registry.register({
		name: "ir.route",
		description: "Routes PCB tracks using Freerouting",
		inputSchema: ROUTE_INPUT_SCHEMA,
		outputSchema: ROUTE_OUTPUT_SCHEMA,
		permission: "read",
		handler: (input) => handleRoute(input, resolvedDeps),
	});
}
