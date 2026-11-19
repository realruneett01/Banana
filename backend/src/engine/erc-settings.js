// Project ERC settings from a KiCad .kicad_pro (JSON): the "erc" section's
// rule_severities, which kicad-cli applies when it checks the project.
import fs from "node:fs";

const SEVERITIES = new Set(["error", "warning", "ignore"]);

function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export function parseErcSettings(proText) {
	const rules = parseJson(proText)?.erc?.rule_severities ?? {};
	const valid = Object.entries(rules).filter(([, s]) => SEVERITIES.has(s));
	return { ruleSeverities: Object.fromEntries(valid) };
}

// kicad-cli reads <name>.kicad_pro next to the root sheet <name>.kicad_sch.
export function loadErcSettings(rootSchPath) {
	const proPath = rootSchPath.replace(/\.kicad_sch$/, ".kicad_pro");
	if (!fs.existsSync(proPath)) return parseErcSettings("{}");
	return parseErcSettings(fs.readFileSync(proPath, "utf8"));
}

// Rules whose severity comes from the pin map: the project can only ignore
// them (kicad-cli 10 keeps pin_to_pin warnings under "error", and errors
// under "warning").
const PIN_MAP_RULES = new Set(["pin_to_pin"]);

// A rule's severity under the settings: the project's override, else the
// rule's default. "ignore" means the issue is dropped.
export function ruleSeverity(settings, rule, severity) {
	const override = settings?.ruleSeverities?.[rule];
	if (PIN_MAP_RULES.has(rule) && override !== "ignore") return severity;
	return override ?? severity;
}
