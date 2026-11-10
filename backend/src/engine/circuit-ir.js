import { isId } from "./ids.js";
import { validate } from "./schema-lite.js";

export const CIRCUIT_IR_SCHEMA = {
	type: "object",
	required: ["schemaVersion", "name", "parts", "nets", "constraints"],
	additionalProperties: false,
	properties: {
		schemaVersion: {
			type: "integer",
			enum: [1],
		},
		name: { type: "string" },
		parts: {
			type: "array",
			items: {
				type: "object",
				required: ["id", "ref", "value", "symbol", "footprint", "props"],
				additionalProperties: false,
				properties: {
					id: { type: "string" },
					ref: { type: "string" },
					value: { type: "string" },
					symbol: { type: "string" },
					footprint: { type: "string" },
					props: { type: "object" },
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
			},
		},
		nets: {
			type: "array",
			items: {
				type: "object",
				required: ["id", "name", "pins"],
				additionalProperties: false,
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					pins: {
						type: "array",
						items: {
							type: "object",
							required: ["partId", "pin"],
							additionalProperties: false,
							properties: {
								partId: { type: "string" },
								pin: { type: "string" },
							},
						},
					},
				},
			},
		},
		constraints: {
			type: "array",
			items: {
				type: "object",
				required: ["id", "kind", "target", "value", "unit"],
				additionalProperties: false,
				properties: {
					id: { type: "string" },
					kind: {
						type: "string",
						enum: ["rail", "current", "impedance", "keepout", "size", "layers"],
					},
					target: { type: "string" },
					value: {},
					unit: { type: "string" },
				},
			},
		},
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

function checkId(id, idPath, expectedKind, ctx) {
	if (typeof id !== "string") {
		return;
	}
	if (expectedKind && !isId(id, expectedKind)) {
		ctx.errors.push(`${idPath}: must be a ${expectedKind} id`);
	}
	if (ctx.seenIds.has(id)) {
		ctx.errors.push(`${idPath}: duplicate id '${id}'`);
		return;
	}
	ctx.seenIds.add(id);
}

function checkRef(ref, refPath, ctx) {
	if (typeof ref !== "string") {
		return;
	}
	if (ctx.seenRefs.has(ref)) {
		ctx.errors.push(`${refPath}: duplicate ref '${ref}'`);
		return;
	}
	ctx.seenRefs.add(ref);
}

function checkPart(part, index, path, ctx) {
	if (!part || typeof part !== "object") {
		return;
	}
	const partPath = joinPath(joinPath(path, "parts"), index);
	checkId(part.id, joinPath(partPath, "id"), "part", ctx);
	if (typeof part.id === "string") {
		ctx.partIds.add(part.id);
	}
	checkRef(part.ref, joinPath(partPath, "ref"), ctx);
}

function checkNetPin(pin, pinPath, partIds, errors) {
	if (!pin || typeof pin !== "object") {
		return;
	}
	if (typeof pin.partId !== "string") {
		return;
	}
	if (!partIds.has(pin.partId)) {
		errors.push(`${pinPath}.partId: partId '${pin.partId}' not found`);
	}
}

function checkNetPins(pins, netPath, partIds, errors) {
	if (!Array.isArray(pins)) {
		return;
	}
	for (let i = 0; i < pins.length; i++) {
		checkNetPin(
			pins[i],
			joinPath(joinPath(netPath, "pins"), i),
			partIds,
			errors,
		);
	}
}

function checkNet(net, index, path, ctx) {
	if (!net || typeof net !== "object") {
		return;
	}
	const netPath = joinPath(joinPath(path, "nets"), index);
	checkId(net.id, joinPath(netPath, "id"), "net", ctx);
	checkNetPins(net.pins, netPath, ctx.partIds, ctx.errors);
}

function checkConstraint(constraint, index, path, ctx) {
	if (!constraint || typeof constraint !== "object") {
		return;
	}
	const constraintPath = joinPath(joinPath(path, "constraints"), index);
	checkId(constraint.id, joinPath(constraintPath, "id"), null, ctx);
}

function checkParts(parts, path, ctx) {
	if (!Array.isArray(parts)) {
		return;
	}
	for (let i = 0; i < parts.length; i++) {
		checkPart(parts[i], i, path, ctx);
	}
}

function checkNets(nets, path, ctx) {
	if (!Array.isArray(nets)) {
		return;
	}
	for (let i = 0; i < nets.length; i++) {
		checkNet(nets[i], i, path, ctx);
	}
}

function checkConstraints(constraints, path, ctx) {
	if (!Array.isArray(constraints)) {
		return;
	}
	for (let i = 0; i < constraints.length; i++) {
		checkConstraint(constraints[i], i, path, ctx);
	}
}

function checkCircuitIRSemantics(ir, path, errors) {
	if (!ir || typeof ir !== "object") {
		return;
	}
	const ctx = {
		errors,
		seenIds: new Set(),
		seenRefs: new Set(),
		partIds: new Set(),
	};
	checkParts(ir.parts, path, ctx);
	checkNets(ir.nets, path, ctx);
	checkConstraints(ir.constraints, path, ctx);
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
