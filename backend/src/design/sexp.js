/**
 * Small string-aware helpers for working with KiCad S-expression text without a full parse.
 * Library files are tens of thousands of lines; slicing blocks by offset keeps them exact and fast.
 */

/** Index of the ")" matching the "(" at `start`, or -1 when unbalanced. */
export function matchParen(text, start) {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
		} else if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** Direct child lists of the list starting at `start`: [{head, start, end}] (end is inclusive). */
export function childLists(text, start = 0, end = matchParen(text, start)) {
	const out = [];
	for (let i = start + 1; i < end; i++) {
		const c = text[i];
		if (c === '"') {
			for (i++; i < end && text[i] !== '"'; i++) if (text[i] === "\\") i++;
		} else if (c === "(") {
			const close = matchParen(text, i);
			if (close < 0 || close > end) break;
			const m = /^\(\s*([^\s()"]+)/.exec(text.slice(i, i + 80));
			out.push({ head: m ? m[1] : "", start: i, end: close });
			i = close;
		}
	}
	return out;
}

/** First quoted-or-bare atom after the head of a list: `(symbol "R" ...)` -> "R". */
export function firstAtom(text, block) {
	const m = /^\(\s*[^\s()"]+\s+(?:"((?:[^"\\]|\\.)*)"|([^\s()"]+))/.exec(text.slice(block.start, block.start + 400));
	return m ? (m[1] ?? m[2]) : null;
}

/** Escapes a value for use inside a KiCad quoted string. */
export function q(value) {
	return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

export function uuid() {
	const b = [...cryptoBytes(16)];
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

import crypto from "node:crypto";
function cryptoBytes(n) {
	return crypto.randomBytes(n);
}

/** Deterministic UUID derived from a seed string, so regenerating a design yields identical files (clean diffs). */
export function stableUuid(seed) {
	const h = crypto.createHash("sha256").update(String(seed)).digest();
	h[6] = (h[6] & 0x0f) | 0x40;
	h[8] = (h[8] & 0x3f) | 0x80;
	const x = [...h.subarray(0, 16)].map((v) => v.toString(16).padStart(2, "0")).join("");
	return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
