import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
	KICAD_FOOTPRINT_DIR,
	KICAD_SYMBOL_DIR,
} from "../../backend/src/config.js";
import { checkKicadLibraries } from "../../backend/src/routes/health-routes.js";

describe("checkKicadLibraries", () => {
	let tempBase;
	let validSymDir;
	let validFpDir;

	before(() => {
		tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "banana-test-kicad-"));
		validSymDir = path.join(tempBase, "symbols");
		validFpDir = path.join(tempBase, "footprints");
		fs.mkdirSync(validSymDir, { recursive: true });
		fs.mkdirSync(validFpDir, { recursive: true });
	});

	after(() => {
		if (tempBase && fs.existsSync(tempBase)) {
			fs.rmSync(tempBase, { recursive: true, force: true });
		}
	});

	test("returns true for two existing directories", () => {
		assert.equal(checkKicadLibraries(validSymDir, validFpDir), true);
	});

	const invalidCases = [
		["missing symbol dir", "/nonexistent/symbols/dir", null],
		["missing footprint dir", null, "/nonexistent/footprints/dir"],
		["empty string symbol dir", "", null],
		["empty string footprint dir", null, ""],
		["whitespace-only symbol dir", "   ", null],
		["whitespace-only footprint dir", null, "   "],
	];

	for (const [name, symOverride, fpOverride] of invalidCases) {
		test(`returns false when ${name}`, () => {
			const sym = symOverride === null ? validSymDir : symOverride;
			const fp = fpOverride === null ? validFpDir : fpOverride;
			assert.equal(checkKicadLibraries(sym, fp), false);
		});
	}

	test("defaults to config.js exports", () => {
		const expected =
			Boolean(KICAD_SYMBOL_DIR) &&
			Boolean(KICAD_FOOTPRINT_DIR) &&
			fs.existsSync(KICAD_SYMBOL_DIR) &&
			fs.existsSync(KICAD_FOOTPRINT_DIR);
		assert.equal(checkKicadLibraries(), expected);
	});
});
