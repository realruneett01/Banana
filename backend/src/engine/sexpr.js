export const TAB = "\t";

const NUMERIC_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
// KiCad files nest about 10 deep; deeper input would overflow the stack in recursive walkers.
const MAX_DEPTH = 1000;

export function sym(name) {
	return { sym: name };
}

function isSymbolNode(node) {
	return (
		node !== null && typeof node === "object" && typeof node.sym === "string"
	);
}

function escapeString(str) {
	return str
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r");
}

function serializeNumber(n) {
	if (!Number.isFinite(n)) {
		throw new TypeError(`Cannot serialize non-finite number: ${n}`);
	}
	if (Object.is(n, -0) || Object.is(n, 0)) {
		return "0";
	}
	if (Number.isInteger(n)) {
		return String(n);
	}
	let s = n.toFixed(6);
	if (s.includes(".")) {
		s = s.replace(/0+$/, "").replace(/\.$/, "");
	}
	return s === "-0" ? "0" : s;
}

function serializeAtom(node) {
	if (typeof node === "string") {
		return `"${escapeString(node)}"`;
	}
	if (typeof node === "number") {
		return serializeNumber(node);
	}
	if (typeof node === "boolean") {
		return node ? "yes" : "no";
	}
	if (isSymbolNode(node)) {
		return node.sym;
	}
	throw new TypeError(`Cannot serialize atom of type: ${typeof node}`);
}

function formatChild(item, indentUnit, level) {
	if (Array.isArray(item)) {
		return serializeList(item, indentUnit, level);
	}
	return `${indentUnit.repeat(level)}${serializeAtom(item)}`;
}

function serializeList(node, indentUnit, level) {
	const pad = indentUnit.repeat(level);
	if (node.every((item) => !Array.isArray(item))) {
		return `${pad}(${node.map(serializeAtom).join(" ")})`;
	}
	const firstChild = node.findIndex(Array.isArray);
	const head = node.slice(0, firstChild).map(serializeAtom).join(" ");
	const open = head.length > 0 ? `${pad}(${head}` : `${pad}(`;
	const children = node
		.slice(firstChild)
		.map((item) => formatChild(item, indentUnit, level + 1));
	return [open, ...children, `${pad})`].join("\n");
}

export function serialize(node, { indent = TAB } = {}) {
	if (Array.isArray(node)) {
		return serializeList(node, indent, 0);
	}
	return serializeAtom(node);
}

function unescapeChar(c) {
	if (c === "n") return "\n";
	if (c === "r") return "\r";
	if (c === "t") return "\t";
	if (c === '"') return '"';
	if (c === "\\") return "\\";
	return c;
}

// Sticky regexes scan from lastIndex without slicing; same character classes as before.
const BARE_ATOM = /[^\s()]*/y;
const WHITESPACE = /\s*/y;
const QUOTE_OR_ESCAPE = /["\\]/g;

function matchEnd(pattern, text, start) {
	pattern.lastIndex = start;
	pattern.test(text);
	return pattern.lastIndex;
}

function readQuotedString(text, start) {
	let val = "";
	let i = start + 1;
	while (i < text.length) {
		QUOTE_OR_ESCAPE.lastIndex = i;
		const hit = QUOTE_OR_ESCAPE.exec(text);
		if (hit === null) break;
		val += text.slice(i, hit.index);
		if (hit[0] === '"') {
			return { value: val, nextIndex: hit.index + 1 };
		}
		if (hit.index + 1 >= text.length) break;
		val += unescapeChar(text[hit.index + 1]);
		i = hit.index + 2;
	}
	throw new Error(`Unterminated string starting at offset ${start}`);
}

function parseAtom(raw) {
	if (NUMERIC_PATTERN.test(raw)) {
		const num = Number(raw);
		if (Number.isFinite(num)) {
			return Object.is(num, -0) ? 0 : num;
		}
	}
	return { sym: raw };
}

function readAtom(text, start) {
	if (text[start] === '"') {
		return readQuotedString(text, start);
	}
	const end = matchEnd(BARE_ATOM, text, start);
	return { value: parseAtom(text.slice(start, end)), nextIndex: end };
}

// Strings are lexed before any structure is checked, so an unterminated string
// later in the input is reported ahead of a paren or depth error.
function failAfterLexing(text, from, message) {
	let i = matchEnd(WHITESPACE, text, from);
	while (i < text.length) {
		const isParen = text[i] === "(" || text[i] === ")";
		i = isParen ? i + 1 : readAtom(text, i).nextIndex;
		i = matchEnd(WHITESPACE, text, i);
	}
	throw new Error(message);
}

function addNode(state, node) {
	const { stack } = state;
	const target = stack.length > 0 ? stack[stack.length - 1].list : state.roots;
	target.push(node);
}

function openList(state, offset) {
	state.i = offset + 1;
	if (state.stack.length >= MAX_DEPTH) {
		const message = `Nesting deeper than ${MAX_DEPTH} at offset ${offset}`;
		failAfterLexing(state.text, state.i, message);
	}
	state.stack.push({ list: [], offset });
}

function closeList(state, offset) {
	state.i = offset + 1;
	if (state.stack.length === 0) {
		const message = `Unbalanced parenthesis: unexpected ')' at offset ${offset}`;
		failAfterLexing(state.text, state.i, message);
	}
	addNode(state, state.stack.pop().list);
}

function readNext(state) {
	const start = state.i;
	const c = state.text[start];
	if (c === "(") return openList(state, start);
	if (c === ")") return closeList(state, start);
	const atom = readAtom(state.text, start);
	addNode(state, atom.value);
	state.i = atom.nextIndex;
}

function finish({ stack, roots }) {
	if (stack.length > 0) {
		const unclosed = stack[stack.length - 1];
		throw new Error(
			`Unbalanced parenthesis: unclosed '(' at offset ${unclosed.offset}`,
		);
	}
	if (roots.length === 0) {
		return null;
	}
	return roots.length === 1 ? roots[0] : roots;
}

// Single pass: builds the tree straight from the text, no intermediate token array.
export function parse(text) {
	if (typeof text !== "string") {
		throw new TypeError("parse: input must be a string");
	}
	const state = { text, i: 0, stack: [], roots: [] };
	state.i = matchEnd(WHITESPACE, text, 0);
	while (state.i < text.length) {
		readNext(state);
		state.i = matchEnd(WHITESPACE, text, state.i);
	}
	return finish(state);
}
