import { isId } from "./ids.js";
import { validate } from "./schema-lite.js";

const stringProp = { type: "string" };

function arrayOfObjects(required, properties) {
	return {
		type: "array",
		items: {
			type: "object",
			required,
			additionalProperties: false,
			properties,
		},
	};
}

export const CIRCUIT_IR_SCHEMA = {
	type: "object",
	required: ["schemaVersion", "name", "parts", "nets", "constraints"],
	additionalProperties: false,
	properties: {
		schemaVersion: {
			type: "integer",
			enum: [1],
		},
		name: stringProp,
		parts: arrayOfObjects(
			["id", "ref", "value", "symbol", "footprint", "props"],
			{
				id: stringProp,
				ref: stringProp,
				value: stringProp,
				symbol: stringProp,
				footprint: stringProp,
				props: { type: "object" },
				pinTypes: { type: "object" },
				pinNames: { type: "object" },
				placement: {
					type: "object",
					required: ["x", "y", "rot", "side"],
					additionalProperties: false,
					properties: {
						x: { type: "number" },
						y: { type: "number" },
						rot: { type: "number" },
						side: {
							type: "string",
							enum: ["F", "B"],
						},
					},
				},
			},
		),
		nets: arrayOfObjects(["id", "name", "pins"], {
			id: stringProp,
			name: stringProp,
			// true when a power port, PWR_FLAG or off-sheet link drives the net
			driven: { type: "boolean" },
			pins: arrayOfObjects(["partId", "pin"], {
				partId: stringProp,
				pin: stringProp,
			}),
			// ERC-only typed pins of PWR_FLAG and power ports (not parts)
			ercPins: arrayOfObjects(["ref", "pin", "type"], {
				ref: stringProp,
				pin: stringProp,
				type: stringProp,
			}),
		}),
		constraints: arrayOfObjects(["id", "kind", "target", "value", "unit"], {
			id: stringProp,
			kind: {
				type: "string",
				enum: ["rail", "current", "impedance", "keepout", "size", "layers"],
			},
			target: stringProp,
			value: {},
			unit: stringProp,
		}),
		annotations: arrayOfObjects(["id", "kind", "x", "y"], {
			id: stringProp,
			kind: {
				type: "string",
				enum: [
					"label",
					"globalLabel",
					"hierLabel",
					"noConnect",
					"junction",
					"text",
					"line",
					"bus",
				],
			},
			x: { type: "number" },
			y: { type: "number" },
			x2: { type: "number" },
			y2: { type: "number" },
			rot: { type: "number" },
			text: stringProp,
			uuid: stringProp,
		}),
	},
};

function joinPath(base, key) {
	if (typeof key === "number") {
		return `${base}[${key}]`;
	}
	if (!base || base === "$") {
		return base ? `$.${key}` : key;
	}
	return `${base}.${key}`;
}

function itemPath(base, section, index) {
	return joinPath(joinPath(base, section), index);
}

function isValidObject(val) {
	return Boolean(val && typeof val === "object");
}

function startEntityCheck(entity, section, index, path) {
	if (!isValidObject(entity)) {
		return null;
	}
	return itemPath(path, section, index);
}

function checkUnique(val, valPath, field, ctx) {
	if (typeof val !== "string") {
		return;
	}
	const seen = field === "id" ? ctx.seenIds : ctx.seenRefs;
	if (seen.has(val)) {
		ctx.errors.push(`${valPath}: duplicate ${field} '${val}'`);
		return;
	}
	seen.add(val);
}

function checkId(id, idPath, expectedKind, ctx) {
	if (typeof id !== "string") {
		return;
	}
	if (expectedKind && !isId(id, expectedKind)) {
		ctx.errors.push(`${idPath}: must be a ${expectedKind} id`);
	}
	checkUnique(id, idPath, "id", ctx);
}

function checkRef(ref, refPath, ctx) {
	checkUnique(ref, refPath, "ref", ctx);
}

function checkNetPin(pin, pinPath, ctx) {
	if (!isValidObject(pin) || typeof pin.partId !== "string") {
		return;
	}
	if (!ctx.partIds.has(pin.partId)) {
		ctx.errors.push(`${pinPath}.partId: partId '${pin.partId}' not found`);
	}
}

function forEachItem(list, fn) {
	if (!Array.isArray(list)) {
		return;
	}
	for (let i = 0; i < list.length; i++) {
		fn(list[i], i);
	}
}

function checkNetPins(pins, netPath, ctx) {
	forEachItem(pins, (pin, i) =>
		checkNetPin(pin, itemPath(netPath, "pins", i), ctx),
	);
}

function checkPart(part, index, path, ctx) {
	const partPath = startEntityCheck(part, "parts", index, path);
	if (!partPath) {
		return;
	}
	checkId(part.id, joinPath(partPath, "id"), "part", ctx);
	if (typeof part.id === "string") {
		ctx.partIds.add(part.id);
	}
	checkRef(part.ref, joinPath(partPath, "ref"), ctx);
}

function checkNet(net, index, path, ctx) {
	const netPath = startEntityCheck(net, "nets", index, path);
	if (!netPath) {
		return;
	}
	checkId(net.id, joinPath(netPath, "id"), "net", ctx);
	checkNetPins(net.pins, netPath, ctx);
}

function checkConstraint(constraint, index, path, ctx) {
	const constraintPath = startEntityCheck(
		constraint,
		"constraints",
		index,
		path,
	);
	if (!constraintPath) {
		return;
	}
	checkId(constraint.id, joinPath(constraintPath, "id"), null, ctx);
}

function checkItems(items, path, ctx, checkFn) {
	forEachItem(items, (item, i) => checkFn(item, i, path, ctx));
}

function checkCircuitIRSemantics(ir, path, errors) {
	if (!isValidObject(ir)) {
		return;
	}
	const ctx = {
		errors,
		seenIds: new Set(),
		seenRefs: new Set(),
		partIds: new Set(),
	};
	checkItems(ir.parts, path, ctx, checkPart);
	checkItems(ir.nets, path, ctx, checkNet);
	checkItems(ir.constraints, path, ctx, checkConstraint);
}

export function validateCircuitIR(ir, path = "$") {
	try {
		const result = validate(CIRCUIT_IR_SCHEMA, ir, path);
		const errors = [...result.errors];
		checkCircuitIRSemantics(ir, path, errors);
		return {
			ok: errors.length === 0,
			errors,
		};
	} catch (err) {
		// Broad catch to guarantee validator never throws on malformed input
		return {
			ok: false,
			errors: [`${path}: unexpected error: ${err?.message || String(err)}`],
		};
	}
}
