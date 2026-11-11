export const TAB = "\t";

const NUMERIC_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

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

function readQuotedString(text, start) {
	let val = "";
	let i = start + 1;
	while (i < text.length) {
		const c = text[i];
		if (c === '"') {
			return { value: val, nextIndex: i + 1 };
		}
		if (c === "\\") {
			i++;
			if (i >= text.length) break;
			val += unescapeChar(text[i]);
		} else {
			val += c;
		}
		i++;
	}
	throw new Error(`Unterminated string starting at offset ${start}`);
}

function readBareToken(text, start) {
	let i = start;
	while (i < text.length && !/[\s()]/.test(text[i])) {
		i++;
	}
	return { raw: text.slice(start, i), nextIndex: i };
}

function skipWhitespace(text, start) {
	let i = start;
	while (i < text.length && /\s/.test(text[i])) {
		i++;
	}
	return i;
}

function nextToken(text, i) {
	const c = text[i];
	if (c === "(") {
		return { token: { type: "LPAREN", offset: i }, nextIndex: i + 1 };
	}
	if (c === ")") {
		return { token: { type: "RPAREN", offset: i }, nextIndex: i + 1 };
	}
	if (c === '"') {
		const str = readQuotedString(text, i);
		return {
			token: { type: "STRING", value: str.value, offset: i },
			nextIndex: str.nextIndex,
		};
	}
	const bare = readBareToken(text, i);
	return {
		token: { type: "ATOM", raw: bare.raw, offset: i },
		nextIndex: bare.nextIndex,
	};
}

function tokenize(text) {
	const tokens = [];
	let i = 0;
	while (i < text.length) {
		i = skipWhitespace(text, i);
		if (i >= text.length) break;
		const next = nextToken(text, i);
		tokens.push(next.token);
		i = next.nextIndex;
	}
	return tokens;
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

function addNodeToStack(node, stack, rootLists) {
	if (stack.length > 0) {
		stack[stack.length - 1].list.push(node);
		return;
	}
	rootLists.push(node);
}

function handleToken(token, stack, rootLists) {
	if (token.type === "LPAREN") {
		stack.push({ list: [], offset: token.offset });
		return;
	}
	if (token.type === "RPAREN") {
		if (stack.length === 0) {
			throw new Error(
				`Unbalanced parenthesis: unexpected ')' at offset ${token.offset}`,
			);
		}
		const frame = stack.pop();
		addNodeToStack(frame.list, stack, rootLists);
		return;
	}
	const val = token.type === "STRING" ? token.value : parseAtom(token.raw);
	addNodeToStack(val, stack, rootLists);
}

function parseTokens(tokens) {
	const rootLists = [];
	const stack = [];
	for (const token of tokens) {
		handleToken(token, stack, rootLists);
	}
	if (stack.length > 0) {
		const unclosed = stack[stack.length - 1];
		throw new Error(
			`Unbalanced parenthesis: unclosed '(' at offset ${unclosed.offset}`,
		);
	}
	if (rootLists.length === 0) {
		return null;
	}
	return rootLists.length === 1 ? rootLists[0] : rootLists;
}

export function parse(text) {
	if (typeof text !== "string") {
		throw new TypeError("parse: input must be a string");
	}
	return parseTokens(tokenize(text));
}
