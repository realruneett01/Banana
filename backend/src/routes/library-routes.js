import express from "express";
import { createKicadLibrary } from "../engine/kicad-library.js";

const LIB_ID_REGEX = /^[A-Za-z0-9_.+-]+:[A-Za-z0-9_.+ -]+$/;
const CACHE_CONTROL_HEADER = "public, max-age=3600";
const UNAVAILABLE_ERROR = "KiCad libraries are not installed on this server";

let lazyLibrary = null;

function resolveLibrary(req) {
	if (req.app?.locals?.kicadLibrary) {
		return req.app.locals.kicadLibrary;
	}
	lazyLibrary ??= createKicadLibrary();
	return lazyLibrary;
}

function isValidQueryString(q) {
	if (typeof q !== "string") return false;
	const trimmed = q.trim();
	return trimmed.length >= 1 && q.length <= 100;
}

function parseLimit(rawLimit) {
	if (rawLimit === undefined || rawLimit === "") {
		return { ok: true, limit: 50 };
	}
	const num = Number(rawLimit);
	if (!Number.isInteger(num) || num < 1 || num > 100) {
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

async function handleStatus(req, res) {
	try {
		const library = resolveLibrary(req);
		const available = Boolean(await library.available());
		res.set("Cache-Control", CACHE_CONTROL_HEADER);
		return res.status(200).json({ available });
	} catch (_err) {
		// Broad catch to guarantee route never leaks paths or stack traces
		return res.status(500).json({ error: "Failed to check library status" });
	}
}

async function handleSearchSymbols(req, res) {
	const library = resolveLibrary(req);
	if (!(await ensureAvailable(library, res))) return;

	const val = validateSearch(req.query);
	if (!val.ok) {
		return res.status(400).json({ error: val.error });
	}

	try {
		const symbols = await library.searchSymbols(req.query.q, {
			limit: val.limit,
		});
		res.set("Cache-Control", CACHE_CONTROL_HEADER);
		return res.status(200).json({ symbols });
	} catch (_err) {
		// Broad catch to guarantee route never leaks paths or stack traces
		return res.status(500).json({ error: "Failed to search symbols" });
	}
}

async function handleGetSymbol(req, res) {
	const library = resolveLibrary(req);
	if (!(await ensureAvailable(library, res))) return;

	const { libId } = req.params;
	if (!isValidLibId(libId)) {
		return res.status(400).json({ error: "Invalid library identifier" });
	}

	try {
		const symbol = await library.getSymbol(libId);
		if (!symbol) {
			return res.status(404).json({ error: `Symbol not found: ${libId}` });
		}
		res.set("Cache-Control", CACHE_CONTROL_HEADER);
		return res.status(200).json({ symbol });
	} catch (_err) {
		// Broad catch to guarantee route never leaks paths or stack traces
		return res.status(500).json({ error: "Failed to get symbol" });
	}
}

async function handleSearchFootprints(req, res) {
	const library = resolveLibrary(req);
	if (!(await ensureAvailable(library, res))) return;

	const val = validateSearch(req.query);
	if (!val.ok) {
		return res.status(400).json({ error: val.error });
	}

	try {
		const footprints = await library.searchFootprints(req.query.q, {
			limit: val.limit,
		});
		res.set("Cache-Control", CACHE_CONTROL_HEADER);
		return res.status(200).json({ footprints });
	} catch (_err) {
		// Broad catch to guarantee route never leaks paths or stack traces
		return res.status(500).json({ error: "Failed to search footprints" });
	}
}

async function handleGetFootprint(req, res) {
	const library = resolveLibrary(req);
	if (!(await ensureAvailable(library, res))) return;

	const { libId } = req.params;
	if (!isValidLibId(libId)) {
		return res.status(400).json({ error: "Invalid library identifier" });
	}

	try {
		const footprint = await library.getFootprint(libId);
		if (!footprint) {
			return res.status(404).json({ error: `Footprint not found: ${libId}` });
		}
		res.set("Cache-Control", CACHE_CONTROL_HEADER);
		return res.status(200).json({ footprint });
	} catch (_err) {
		// Broad catch to guarantee route never leaks paths or stack traces
		return res.status(500).json({ error: "Failed to get footprint" });
	}
}

export function createLibraryRouter() {
	const router = express.Router();
	router.get(["/library/status", "/api/library/status"], handleStatus);
	router.get(["/library/symbols", "/api/library/symbols"], handleSearchSymbols);
	router.get(
		["/library/symbols/:libId", "/api/library/symbols/:libId"],
		handleGetSymbol,
	);
	router.get(
		["/library/footprints", "/api/library/footprints"],
		handleSearchFootprints,
	);
	router.get(
		["/library/footprints/:libId", "/api/library/footprints/:libId"],
		handleGetFootprint,
	);
	return router;
}

const defaultRouter = createLibraryRouter();
export default defaultRouter;
