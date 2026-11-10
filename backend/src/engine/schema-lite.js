function isObject(v) {
	if (v === null || Array.isArray(v)) {
		return false;
	}
	return typeof v === "object";
}

const TYPE_PREDICATES = {
	null: (v) => v === null,
	array: (v) => Array.isArray(v),
	object: isObject,
	integer: (v) => Number.isInteger(v),
	number: (v) => typeof v === "number" && !Number.isNaN(v),
	string: (v) => typeof v === "string",
	boolean: (v) => typeof v === "boolean",
};

function matchType(type, val) {
	const predicate = TYPE_PREDICATES[type];
	return predicate ? predicate(val) : false;
}

function joinPath(base, key) {
	if (typeof key === "number") {
		return `${base}[${key}]`;
	}
	if (!base || base === "$") {
		return base ? `$.${key}` : key;
	}
	return `${base}.${key}`;
}

function checkType(schema, value, path, errors) {
	if (schema.type === undefined) {
		return;
	}
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	const matches = types.some((t) => matchType(t, value));
	if (!matches) {
		errors.push(`${path}: expected ${types.join("|")}`);
	}
}

function checkRequired(schema, value, path, errors) {
	if (!Array.isArray(schema.required) || !isObject(value)) {
		return;
	}
	for (const key of schema.required) {
		if (value[key] === undefined) {
			errors.push(`${joinPath(path, key)}: missing`);
		}
	}
}

function checkProperties(schema, value, path, errors) {
	if (!isObject(schema.properties) || !isObject(value)) {
		return;
	}
	for (const key of Object.keys(schema.properties)) {
		if (value[key] !== undefined) {
			validateNode(
				schema.properties[key],
				value[key],
				joinPath(path, key),
				errors,
			);
		}
	}
}

function checkAdditionalProperties(schema, value, path, errors) {
	if (schema.additionalProperties !== false || !isObject(value)) {
		return;
	}
	const allowed = new Set(Object.keys(schema.properties || {}));
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			errors.push(`${joinPath(path, key)}: unexpected property`);
		}
	}
}

function checkItems(schema, value, path, errors) {
	if (!isObject(schema.items) || !Array.isArray(value)) {
		return;
	}
	for (let i = 0; i < value.length; i++) {
		validateNode(schema.items, value[i], joinPath(path, i), errors);
	}
}

function checkEnum(schema, value, path, errors) {
	if (!Array.isArray(schema.enum) || value === undefined) {
		return;
	}
	if (!schema.enum.includes(value)) {
		errors.push(`${path}: must be one of ${schema.enum.join(", ")}`);
	}
}

function checkMinimum(schema, value, path, errors) {
	if (typeof schema.minimum !== "number" || typeof value !== "number") {
		return;
	}
	if (value < schema.minimum) {
		errors.push(`${path}: must be >= ${schema.minimum}`);
	}
}

function checkMaximum(schema, value, path, errors) {
	if (typeof schema.maximum !== "number" || typeof value !== "number") {
		return;
	}
	if (value > schema.maximum) {
		errors.push(`${path}: must be <= ${schema.maximum}`);
	}
}

function checkMinLength(schema, value, path, errors) {
	if (typeof schema.minLength !== "number" || typeof value !== "string") {
		return;
	}
	if (value.length < schema.minLength) {
		errors.push(`${path}: must be at least ${schema.minLength} characters`);
	}
}

function checkPattern(schema, value, path, errors) {
	if (typeof schema.pattern !== "string" || typeof value !== "string") {
		return;
	}
	try {
		const re = new RegExp(schema.pattern);
		if (!re.test(value)) {
			errors.push(`${path}: must match pattern ${schema.pattern}`);
		}
	} catch {
		// Never throw on invalid regex pattern in schema
		errors.push(`${path}: invalid regex pattern ${schema.pattern}`);
	}
}

const KEYWORD_CHECKERS = {
	type: checkType,
	required: checkRequired,
	properties: checkProperties,
	additionalProperties: checkAdditionalProperties,
	items: checkItems,
	enum: checkEnum,
	minimum: checkMinimum,
	maximum: checkMaximum,
	minLength: checkMinLength,
	pattern: checkPattern,
};

function validateNode(schema, value, path, errors) {
	if (!isObject(schema)) {
		errors.push(`${path}: invalid schema`);
		return;
	}
	for (const [keyword, checker] of Object.entries(KEYWORD_CHECKERS)) {
		if (keyword in schema) {
			checker(schema, value, path, errors);
		}
	}
}

export function validate(schema, value, path = "$") {
	const errors = [];
	try {
		validateNode(schema, value, path, errors);
	} catch (err) {
		// Broad catch to guarantee we never throw on any weird input
		errors.push(`${path}: unexpected error: ${err?.message || String(err)}`);
	}
	return {
		ok: errors.length === 0,
		errors,
	};
}
