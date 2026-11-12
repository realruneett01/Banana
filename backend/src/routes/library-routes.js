import express from "express";
import { config } from "../config.js";
import { createKicadLibrary } from "../engine/kicad-library.js";

const LIB_ID_REGEX = /^[A-Za-z0-9_.+-]+:[A-Za-z0-9_.+ -]+$/;
const CACHE_CONTROL_HEADER = "public, max-age=3600";
const UNAVAILABLE_ERROR = "KiCad libraries are not installed on this server";

const ENTITIES = [
	{
		kind: "symbols",
		single: "symbol",
		title: "Symbol",
		search: "searchSymbols",
		get: "getSymbol",
	},
	{
		kind: "footprints",
		single: "footprint",
		title: "Footprint",
		search: "searchFootprints",
		get: "getFootprint",
	},
];

let lazyLibrary = null;

function resolveLibrary(req) {
	if (req.app?.locals?.kicadLibrary) {
		return req.app.locals.kicadLibrary;
	}
	lazyLibrary ??= createKicadLibrary({
		symbolDir: process.env.KICAD_SYMBOL_DIR || config.kicadSymbolDir,
		footprintDir: process.env.KICAD_FOOTPRINT_DIR || config.kicadFootprintDir,
	});
	return lazyLibrary;
}

function isValidQueryString(q) {
	if (typeof q !== "string") return false;
	const trimmed = q.trim();
	return trimmed.length >= 1 && q.length <= 100;
}

function isValidLimit(num) {
	if (!Number.isInteger(num)) return false;
	return num >= 1 && num <= 100;
}

function parseLimit(rawLimit) {
	if (rawLimit === undefined || rawLimit === "") {
		return { ok: true, limit: 50 };
	}
	const num = Number(rawLimit);
	if (!isValidLimit(num)) {
		return {
			ok: false,
			error: "Query parameter 'limit' must be an integer between 1 and 100",
		};
	}
	return { ok: true, limit: num };
}

function validateSearch(query) {
	if (!isValidQueryString(query?.q)) {
		return {
			ok: false,
			error:
				"Query parameter 'q' must be a non-empty string up to 100 characters",
		};
	}
	return parseLimit(query.limit);
}

function isValidLibId(libId) {
	if (typeof libId !== "string") return false;
	return LIB_ID_REGEX.test(libId);
}

async function ensureAvailable(library, res) {
	const available = await library.available();
	if (!available) {
		res.status(503).json({ error: UNAVAILABLE_ERROR });
		return false;
	}
	return true;
}

function sendCachedJson(res, body) {
	res.set("Cache-Control", CACHE_CONTROL_HEADER);
	return res.status(200).json(body);
}

async function handleStatus(req, res) {
	try {
		const library = resolveLibrary(req);
		const available = Boolean(await library.available());
		return sendCachedJson(res, { available });
	} catch (_err) {
		// Broad catch to guarantee route never leaks paths or stack traces
		return res.status(500).json({ error: "Failed to check library status" });
	}
}

function createSearchHandler(entity) {
	return async (req, res) => {
		const library = resolveLibrary(req);
		if (!(await ensureAvailable(library, res))) return;

		const val = validateSearch(req.query);
		if (!val.ok) {
			return res.status(400).json({ error: val.error });
		}

		try {
			const items = await library[entity.search](req.query.q, {
				limit: val.limit,
			});
			return sendCachedJson(res, { [entity.kind]: items });
		} catch (_err) {
			// Broad catch to guarantee route never leaks paths or stack traces
			return res.status(500).json({ error: `Failed to search ${entity.kind}` });
		}
	};
}

function createGetHandler(entity) {
	return async (req, res) => {
		const library = resolveLibrary(req);
		if (!(await ensureAvailable(library, res))) return;

		const { libId } = req.params;
		if (!isValidLibId(libId)) {
			return res.status(400).json({ error: "Invalid library identifier" });
		}

		try {
			const item = await library[entity.get](libId);
			if (!item) {
				return res
					.status(404)
					.json({ error: `${entity.title} not found: ${libId}` });
			}
			return sendCachedJson(res, { [entity.single]: item });
		} catch (_err) {
			// Broad catch to guarantee route never leaks paths or stack traces
			return res.status(500).json({ error: `Failed to get ${entity.single}` });
		}
	};
}

export function createLibraryRouter() {
	const router = express.Router();
	router.get(["/library/status", "/api/library/status"], handleStatus);

	for (const entity of ENTITIES) {
		router.get(
			[`/library/${entity.kind}`, `/api/library/${entity.kind}`],
			createSearchHandler(entity),
		);
		router.get(
			[`/library/${entity.kind}/:libId`, `/api/library/${entity.kind}/:libId`],
			createGetHandler(entity),
		);
	}

	return router;
}

const defaultRouter = createLibraryRouter();
export default defaultRouter;
