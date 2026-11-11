import { applyCommand } from "./editor/editorModel.js";

function isValidIr(ir) {
	if (!ir || typeof ir !== "object") {
		return false;
	}
	if (Array.isArray(ir)) {
		return false;
	}
	return Array.isArray(ir.parts);
}

function hasCommands(fix) {
	if (!fix || !Array.isArray(fix.commands)) {
		return false;
	}
	return fix.commands.length > 0;
}

export function applyFixToIr(ir, fix) {
	if (!isValidIr(ir)) {
		return {
			ok: false,
			error: "Invalid IR: must be an object with parts array",
		};
	}
	if (!hasCommands(fix)) {
		return { ok: false, error: "Fix commands are missing or empty" };
	}
	try {
		const doc = {
			ir: structuredClone(ir),
			selection: [],
			history: { past: [], future: [] },
		};
		const res = applyCommand(doc, { type: "batch", commands: fix.commands });
		if (res.error) {
			return { ok: false, error: res.error };
		}
		return { ok: true, ir: res.ir };
	} catch (err) {
		const error =
			typeof err?.message === "string" ? err.message : "Failed to apply fix";
		return { ok: false, error };
	}
}
