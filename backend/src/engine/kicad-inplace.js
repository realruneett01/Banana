import { parse, serialize } from "./sexpr.js";

const REF_PATTERN = /^[A-Za-z0-9_+-]{1,32}$/;

function nodeSym(node) {
	if (node === null || node === undefined) return "";
	return typeof node === "object" ? (node.sym ?? "") : String(node);
}

function isValidRef(ref) {
	return typeof ref === "string" && REF_PATTERN.test(ref);
}

function hasControlChar(str) {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 32 || code === 127) {
			return true;
		}
	}
	return false;
}

function isValidValue(value) {
	if (typeof value !== "string" || value.length > 200) {
		return false;
	}
	return !hasControlChar(value);
}

function isValidMove(edit) {
	if (!Number.isFinite(edit.x) || !Number.isFinite(edit.y)) {
		return false;
	}
	if (edit.rot !== undefined) {
		return Number.isFinite(edit.rot);
	}
	return true;
}

function validateOpPayload(edit) {
	if (edit.op === "setValue") {
		if (!isValidValue(edit.value)) {
			return "Invalid value: must be string <= 200 chars without control characters";
		}
		return null;
	}
	if (edit.op === "move") {
		if (!isValidMove(edit)) {
			return "Invalid coordinates: x, y, and rot must be finite numbers";
		}
		return null;
	}
	return `Unknown operation: ${String(edit.op)}`;
}

function validateEdit(edit) {
	if (!edit || typeof edit !== "object") {
		return "Edit must be an object";
	}
	if (!isValidRef(edit.ref)) {
		return `Invalid reference: ${String(edit.ref)}`;
	}
	return validateOpPayload(edit);
}

function isTargetItem(node, kind) {
	if (!Array.isArray(node)) return false;
	const head = node[0]?.sym;
	if (kind === "pcb") {
		return head === "footprint" || head === "module";
	}
	return head === "symbol";
}

function extractItemRef(item) {
	for (const child of item) {
		if (!Array.isArray(child) || child.length < 3) continue;
		const head = child[0]?.sym;
		if (head === "property" && nodeSym(child[1]) === "Reference") {
			return nodeSym(child[2]);
		}
		if (head === "fp_text" && nodeSym(child[1]).toLowerCase() === "reference") {
			return nodeSym(child[2]);
		}
	}
	return null;
}

function buildItemIndex(ast, kind) {
	const map = new Map();
	for (const child of ast.slice(1)) {
		if (!isTargetItem(child, kind)) continue;
		const ref = extractItemRef(child);
		if (!ref) continue;
		const items = map.get(ref);
		if (items) {
			items.push(child);
		} else {
			map.set(ref, [child]);
		}
	}
	return map;
}

function findValueNode(item) {
	for (const child of item) {
		if (!Array.isArray(child) || child.length < 3) continue;
		const head = child[0]?.sym;
		if (head === "property" && nodeSym(child[1]) === "Value") {
			return child;
		}
		if (head === "fp_text" && nodeSym(child[1]).toLowerCase() === "value") {
			return child;
		}
	}
	return null;
}

function applySetValue(items, edit) {
	const valNodes = [];
	for (const item of items) {
		const valNode = findValueNode(item);
		if (!valNode) {
			return {
				ok: false,
				reason: `Value property not found for ref ${edit.ref}`,
			};
		}
		valNodes.push(valNode);
	}
	for (const node of valNodes) {
		node[2] = edit.value;
	}
	return { ok: true };
}

function findAtNode(item) {
	return item.find((c) => Array.isArray(c) && c[0]?.sym === "at") ?? null;
}

function applyMove(items, edit) {
	if (items.length > 1) {
		return {
			ok: false,
			reason: `Part ${edit.ref} has several units and must be moved in the editor`,
		};
	}
	const atNode = findAtNode(items[0]);
	if (!atNode) {
		return {
			ok: false,
			reason: `at node not found for ref ${edit.ref}`,
		};
	}
	atNode[1] = edit.x;
	atNode[2] = edit.y;
	if (edit.rot !== undefined) {
		atNode[3] = edit.rot;
	}
	return { ok: true };
}

function applyEdit(items, edit) {
	if (edit.op === "setValue") {
		return applySetValue(items, edit);
	}
	return applyMove(items, edit);
}

function applyEdits(itemMap, edits) {
	let applied = 0;
	const skipped = [];
	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i];
		const err = validateEdit(edit);
		if (err) {
			skipped.push({ index: i, reason: err });
			continue;
		}
		const items = itemMap.get(edit.ref);
		if (!items) {
			skipped.push({ index: i, reason: `Unknown reference: ${edit.ref}` });
			continue;
		}
		const res = applyEdit(items, edit);
		if (!res.ok) {
			skipped.push({ index: i, reason: res.reason });
			continue;
		}
		applied++;
	}
	return { applied, skipped };
}

function validateRootNode(ast, kind) {
	if (!Array.isArray(ast)) {
		return false;
	}
	const expected = kind === "pcb" ? "kicad_pcb" : "kicad_sch";
	return ast[0]?.sym === expected;
}

function isSupportedKind(kind) {
	return kind === "pcb" || kind === "sch";
}

function validateInputs(text, options) {
	if (typeof text !== "string") {
		return "Input text must be a string";
	}
	if (!options || !isSupportedKind(options.kind)) {
		return "Kind must be 'pcb' or 'sch'";
	}
	if (!Array.isArray(options.edits)) {
		return "Edits must be an array";
	}
	return null;
}

function parseTextAst(text, kind) {
	let ast;
	try {
		ast = parse(text);
	} catch (err) {
		// Broad catch to guarantee sexpr parse errors are captured
		return { ok: false, error: err?.message || String(err) };
	}
	if (!validateRootNode(ast, kind)) {
		return { ok: false, error: `Root node does not match kind: ${kind}` };
	}
	return { ok: true, ast };
}

export function patchKicadText(text, options) {
	const inputErr = validateInputs(text, options);
	if (inputErr) {
		return { ok: false, error: inputErr };
	}
	const parsed = parseTextAst(text, options.kind);
	if (!parsed.ok) {
		return parsed;
	}
	const itemMap = buildItemIndex(parsed.ast, options.kind);
	const { applied, skipped } = applyEdits(itemMap, options.edits);
	const outText = serialize(parsed.ast);
	return { ok: true, text: outText, applied, skipped };
}
