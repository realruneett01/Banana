/**
 * Minimal JSON-Schema validator for tool inputs (type, enum, required, properties, items, bounds, pattern,
 * additionalProperties). Gives the assistant precise, path-qualified errors instead of crashes.
 */
export function validate(value, schema, at = "arguments") {
	const errors = [];
	const typeOf = (v) =>
		v === null
			? "null"
			: Array.isArray(v)
				? "array"
				: Number.isInteger(v)
					? "integer"
					: typeof v;
	const matchesType = (v, t) =>
		t === "number"
			? typeof v === "number" && Number.isFinite(v)
			: t === "integer"
				? Number.isInteger(v)
				: typeOf(v) === t;
	(function walk(v, s, path) {
		if (!s || typeof s !== "object") return;
		if (s.type) {
			const types = Array.isArray(s.type) ? s.type : [s.type];
			if (!types.some((t) => matchesType(v, t))) {
				errors.push(
					`${path}: expected ${types.join(" or ")}, got ${typeOf(v)}`,
				);
				return;
			}
		}
		if (s.enum && !s.enum.includes(v))
			errors.push(
				`${path}: must be one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}`,
			);
		if (typeof v === "string") {
			if (s.maxLength !== undefined && v.length > s.maxLength)
				errors.push(`${path}: longer than ${s.maxLength} characters`);
			if (s.minLength !== undefined && v.length < s.minLength)
				errors.push(`${path}: shorter than ${s.minLength} characters`);
			if (s.pattern && !new RegExp(s.pattern).test(v))
				errors.push(`${path}: does not match ${s.pattern}`);
		}
		if (typeof v === "number") {
			if (s.minimum !== undefined && v < s.minimum)
				errors.push(`${path}: must be >= ${s.minimum}`);
			if (s.maximum !== undefined && v > s.maximum)
				errors.push(`${path}: must be <= ${s.maximum}`);
		}
		if (Array.isArray(v)) {
			if (s.maxItems !== undefined && v.length > s.maxItems)
				errors.push(`${path}: more than ${s.maxItems} items`);
			if (s.minItems !== undefined && v.length < s.minItems)
				errors.push(`${path}: fewer than ${s.minItems} items`);
			if (s.items) v.forEach((item, i) => walk(item, s.items, `${path}[${i}]`));
		}
		if (v && typeof v === "object" && !Array.isArray(v)) {
			for (const r of s.required ?? [])
				if (v[r] === undefined) errors.push(`${path}.${r}: required`);
			for (const [k, sub] of Object.entries(s.properties ?? {}))
				if (v[k] !== undefined) walk(v[k], sub, `${path}.${k}`);
			if (s.additionalProperties === false)
				for (const k of Object.keys(v))
					if (!(k in (s.properties ?? {})))
						errors.push(`${path}.${k}: unknown property`);
		}
	})(value, schema, at);
	return errors;
}
