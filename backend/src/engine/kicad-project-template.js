import { irToKicadPcb } from "./kicad-pcb-writer.js";
import { irToKicadSch } from "./kicad-sch-writer.js";

const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export function sanitizeProjectName(name) {
	if (typeof name !== "string") {
		return null;
	}
	let s = name.trim().replace(/[^A-Za-z0-9 _.-]/g, "_");
	s = s.replace(/ +/g, "_").replace(/^\.+/, "");
	if (s.length > 64) {
		s = s.slice(0, 64);
	}
	if (!s || WINDOWS_RESERVED.test(s)) {
		return null;
	}
	return s;
}

function buildEmptyIR(base) {
	return {
		schemaVersion: 1,
		name: base,
		parts: [],
		nets: [],
		constraints: [],
	};
}

function buildProJson(base) {
	const pro = {
		meta: {
			filename: `${base}.kicad_pro`,
			version: 1,
		},
		board: {},
		schematic: {},
		libraries: {
			pinned_footprint_libs: [],
			pinned_symbol_libs: [],
		},
		sheets: [],
		text_variables: {},
	};
	return `${JSON.stringify(pro, null, 2)}\n`;
}

export function createProjectFiles(name, { boardW = 100, boardH = 80 } = {}) {
	const base = sanitizeProjectName(name);
	if (!base) {
		return { ok: false, error: "Invalid project name" };
	}
	const ir = buildEmptyIR(base);
	const schResult = irToKicadSch(ir, { title: base });
	const pcbResult = irToKicadPcb(ir, { boardW, boardH });
	const proText = buildProJson(base);
	return {
		ok: true,
		base,
		files: {
			[`${base}.kicad_pro`]: proText,
			[`${base}.kicad_sch`]: schResult.text,
			[`${base}.kicad_pcb`]: pcbResult.text,
		},
	};
}
