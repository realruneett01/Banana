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

// A rule's severity under the settings: the project's override, else the
// rule's default. "ignore" means the issue is dropped.
export function ruleSeverity(settings, rule, severity) {
	return settings?.ruleSeverities?.[rule] ?? severity;
}
