function defaultIdFn(kind) {
	return `${kind}_${crypto.randomUUID()}`;
}

function normalizeDeg(deg) {
	const rem = ((deg % 360) + 360) % 360;
	return rem === 0 ? 0 : rem;
}

function findPart(ir, partId) {
	return ir.parts.find((p) => p.id === partId);
}

function findNet(ir, netId) {
	return ir.nets.find((n) => n.id === netId);
}

function withIr(doc, newIr) {
	return { ir: newIr, selection: doc.selection, history: doc.history };
}

function withNets(doc, nets) {
	return withIr(doc, { ...doc.ir, nets });
}

function findNetWithPin(nets, partId, pin) {
	return nets.find((n) =>
		n.pins.some((p) => p.partId === partId && p.pin === pin),
	);
}

function mergeNetPins(netA, netB) {
	const existing = new Set(netA.pins.map((p) => `${p.partId}:${p.pin}`));
	const added = netB.pins.filter((p) => !existing.has(`${p.partId}:${p.pin}`));
	return [...netA.pins, ...added];
}

function updateDocPart(doc, partId, transform) {
	const parts = doc.ir.parts.map((p) => (p.id === partId ? transform(p) : p));
	return withIr(doc, { ...doc.ir, parts });
}

function removePlacement(doc, partId) {
	return updateDocPart(doc, partId, (p) => {
		const copy = { ...p };
		delete copy.placement;
		return copy;
	});
}

function handleAddPart(doc, command, options) {
	const part = command.part;
	if (!part || typeof part !== "object") {
		return { ...doc, error: "addPart: missing part object" };
	}
	const idFn = options.idFn ?? defaultIdFn;
	const id = part.id || idFn("part");
	if (findPart(doc.ir, id) && !command._parts) {
		return { ...doc, error: `addPart: duplicate part id ${id}` };
	}
	const newPart = { ...part, id, props: { ...(part.props ?? {}) } };
	const parts = command._parts ?? [...doc.ir.parts, newPart];
	const nets = command._nets ?? doc.ir.nets;
	return withIr(doc, { ...doc.ir, parts, nets });
}

function handleDeletePart(doc, command) {
	const partId = command.partId;
	if (!partId || !findPart(doc.ir, partId)) {
		return { ...doc, error: `deletePart: part not found ${partId}` };
	}
	const newParts = doc.ir.parts.filter((p) => p.id !== partId);
	const newNets = doc.ir.nets.map((net) => ({
		...net,
		pins: net.pins.filter((p) => p.partId !== partId),
	}));
	const newSel = doc.selection.filter((id) => id !== partId);
	return {
		ir: { ...doc.ir, parts: newParts, nets: newNets },
		selection: newSel,
		history: doc.history,
	};
}

function computeMovePlacement(cur, command) {
	const { x, y } = command;
	if (typeof x !== "number" || typeof y !== "number") {
		return { error: "movePart: x and y must be numbers" };
	}
	return {
		placement: {
			...cur,
			x,
			y,
			rot: cur.rot ?? 0,
			side: cur.side ?? "F",
		},
	};
}

function computeRotatePlacement(cur, command) {
	const { deltaDeg } = command;
	if (typeof deltaDeg !== "number") {
		return { error: "rotatePart: deltaDeg must be a number" };
	}
	return {
		placement: {
			...cur,
			x: cur.x ?? 0,
			y: cur.y ?? 0,
			rot: normalizeDeg((cur.rot ?? 0) + deltaDeg),
			side: cur.side ?? "F",
		},
	};
}

function computeFlipPlacement(cur) {
	const side = (cur.side ?? "F") === "B" ? "F" : "B";
	return {
		placement: {
			...cur,
			x: cur.x ?? 0,
			y: cur.y ?? 0,
			rot: cur.rot ?? 0,
			side,
		},
	};
}

function mutatePartPlacement(doc, command, computeFn) {
	const { partId, type } = command;
	const part = findPart(doc.ir, partId);
	if (!part) {
		return { ...doc, error: `${type}: part not found ${partId}` };
	}
	if ("placement" in command && command.placement === undefined) {
		return removePlacement(doc, partId);
	}
	const res = computeFn(part.placement ?? {}, command);
	if (res.error) {
		return { ...doc, error: res.error };
	}
	return updateDocPart(doc, partId, (p) => ({
		...p,
		placement: res.placement,
	}));
}

function handleMovePart(doc, command) {
	return mutatePartPlacement(doc, command, computeMovePlacement);
}

function handleRotatePart(doc, command) {
	return mutatePartPlacement(doc, command, computeRotatePlacement);
}

function handleFlipPart(doc, command) {
	return mutatePartPlacement(doc, command, computeFlipPlacement);
}

const VALID_FIELDS = new Set(["ref", "value", "footprint", "symbol"]);

function handleSetPartField(doc, command) {
	const { partId, field, value } = command;
	if (!VALID_FIELDS.has(field)) {
		return { ...doc, error: `setPartField: invalid field ${field}` };
	}
	if (typeof value !== "string") {
		return { ...doc, error: "setPartField: value must be a string" };
	}
	const part = findPart(doc.ir, partId);
	if (!part) {
		return { ...doc, error: `setPartField: part not found ${partId}` };
	}
	return updateDocPart(doc, partId, (p) => ({ ...p, [field]: value }));
}

function handleSetPartProp(doc, command) {
	const { partId, key, value } = command;
	if (typeof key !== "string" || !key) {
		return { ...doc, error: "setPartProp: key must be a non-empty string" };
	}
	const part = findPart(doc.ir, partId);
	if (!part) {
		return { ...doc, error: `setPartProp: part not found ${partId}` };
	}
	const nextProps = { ...(part.props ?? {}) };
	if (value === undefined) {
		delete nextProps[key];
	} else {
		nextProps[key] = value;
	}
	return updateDocPart(doc, partId, (p) => ({ ...p, props: nextProps }));
}

function appendPinToNet(nets, targetId, pinRef) {
	return nets.map((n) =>
		n.id === targetId ? { ...n, pins: [...n.pins, pinRef] } : n,
	);
}

function mergeTwoNets(nets, netA, netB) {
	if (netA.id === netB.id) return nets;
	const pins = mergeNetPins(netA, netB);
	return nets
		.filter((n) => n.id !== netB.id)
		.map((n) => (n.id === netA.id ? { ...n, pins } : n));
}

function applyConnectNets(nets, cmd, idFn) {
	const pinA = { partId: cmd.partIdA, pin: cmd.pinA };
	const pinB = { partId: cmd.partIdB, pin: cmd.pinB };
	const netA = findNetWithPin(nets, pinA.partId, pinA.pin);
	const netB = findNetWithPin(nets, pinB.partId, pinB.pin);

	if (!netA && !netB) {
		const id = idFn("net");
		return [...nets, { id, name: id, pins: [pinA, pinB] }];
	}
	if (!netA) {
		return appendPinToNet(nets, netB.id, pinA);
	}
	if (!netB) {
		return appendPinToNet(nets, netA.id, pinB);
	}
	return mergeTwoNets(nets, netA, netB);
}

function handleConnect(doc, command, options) {
	if (command._prevNets) {
		return withNets(doc, command._prevNets);
	}
	const { partIdA, pinA, partIdB, pinB } = command;
	if (!findPart(doc.ir, partIdA) || !findPart(doc.ir, partIdB)) {
		return { ...doc, error: "connect: one or both parts not found" };
	}
	if (partIdA === partIdB && pinA === pinB) {
		return { ...doc, error: "connect: cannot connect pin to itself" };
	}
	const idFn = options.idFn ?? defaultIdFn;
	const newNets = applyConnectNets(doc.ir.nets, command, idFn);
	return withNets(doc, newNets);
}

function removePinFromNet(net, partId, pin) {
	return {
		...net,
		pins: net.pins.filter((p) => !(p.partId === partId && p.pin === pin)),
	};
}

function handleDisconnect(doc, command) {
	if (command._prevNets) {
		return withNets(doc, command._prevNets);
	}
	const { partId, pin } = command;
	const net = findNetWithPin(doc.ir.nets, partId, pin);
	if (!net) {
		return { ...doc, error: `disconnect: pin ${partId}:${pin} not in any net` };
	}
	const newNets = doc.ir.nets.map((n) =>
		n.id === net.id ? removePinFromNet(n, partId, pin) : n,
	);
	return withNets(doc, newNets);
}

function handleRenameNet(doc, command) {
	const { netId, name } = command;
	if (typeof name !== "string" || !name) {
		return { ...doc, error: "renameNet: name must be a non-empty string" };
	}
	const net = findNet(doc.ir, netId);
	if (!net) {
		return { ...doc, error: `renameNet: net not found ${netId}` };
	}
	const newNets = doc.ir.nets.map((n) => (n.id === netId ? { ...n, name } : n));
	return withNets(doc, newNets);
}

function handleSelect(doc, command) {
	const { ids } = command;
	if (!Array.isArray(ids)) {
		return { ...doc, error: "select: ids must be an array" };
	}
	return { ir: doc.ir, selection: [...ids], history: doc.history };
}

function handleBatch(doc, command, options) {
	const { commands } = command;
	if (!Array.isArray(commands)) {
		return { ...doc, error: "batch: commands must be an array" };
	}
	let current = doc;
	for (const subCmd of commands) {
		current = applyCommand(current, subCmd, options);
		if (current.error) {
			return { ...doc, error: current.error };
		}
	}
	return current;
}

const HANDLERS = {
	addPart: handleAddPart,
	deletePart: handleDeletePart,
	movePart: handleMovePart,
	rotatePart: handleRotatePart,
	flipPart: handleFlipPart,
	setPartField: handleSetPartField,
	setPartProp: handleSetPartProp,
	connect: handleConnect,
	disconnect: handleDisconnect,
	renameNet: handleRenameNet,
	select: handleSelect,
	batch: handleBatch,
};

export function applyCommand(doc, command, options = {}) {
	if (!doc?.ir) {
		return { ...doc, error: "invalid document" };
	}
	if (!command || typeof command !== "object") {
		return { ...doc, error: "invalid command: missing type" };
	}
	if (!command.type) {
		return { ...doc, error: "invalid command: missing type" };
	}
	const handler = HANDLERS[command.type];
	if (!handler) {
		return { ...doc, error: `unknown command type: ${command.type}` };
	}
	return handler(doc, command, options);
}

function invertAddPart(_doc, command) {
	return { type: "deletePart", partId: command.part.id };
}

function invertDeletePart(doc, command) {
	const part = findPart(doc.ir, command.partId);
	return {
		type: "addPart",
		part,
		_parts: doc.ir.parts,
		_nets: doc.ir.nets,
	};
}

function invertPlacementCommand(doc, command, buildInverse) {
	const part = findPart(doc.ir, command.partId);
	if (!part?.placement) {
		return { type: command.type, partId: command.partId, placement: undefined };
	}
	return {
		type: command.type,
		partId: command.partId,
		...buildInverse(part.placement, command),
	};
}

function invertMovePart(doc, command) {
	return invertPlacementCommand(doc, command, (placement, cmd) => ({
		x: cmd.prevX ?? placement.x,
		y: cmd.prevY ?? placement.y,
	}));
}

function invertRotatePart(doc, command) {
	return invertPlacementCommand(doc, command, (_, cmd) => ({
		deltaDeg: normalizeDeg(-cmd.deltaDeg),
	}));
}

function invertFlipPart(doc, command) {
	return invertPlacementCommand(doc, command, () => ({}));
}

function invertPropertyCommand(doc, command, attrKey, getCurrentValue) {
	const part = findPart(doc.ir, command.partId);
	const prevValue =
		command.prevValue !== undefined ? command.prevValue : getCurrentValue(part);
	return {
		type: command.type,
		partId: command.partId,
		[attrKey]: command[attrKey],
		value: prevValue,
	};
}

function invertSetPartField(doc, command) {
	return invertPropertyCommand(
		doc,
		command,
		"field",
		(part) => part?.[command.field],
	);
}

function invertSetPartProp(doc, command) {
	return invertPropertyCommand(
		doc,
		command,
		"key",
		(part) => part?.props?.[command.key],
	);
}

function invertConnect(doc, command) {
	return {
		type: "disconnect",
		partId: command.partIdA,
		pin: command.pinA,
		partIdB: command.partIdB,
		pinB: command.pinB,
		_prevNets: doc.ir.nets,
	};
}

function invertDisconnect(doc, command) {
	return {
		type: "connect",
		partIdA: command.partId,
		pinA: command.pin,
		_prevNets: doc.ir.nets,
	};
}

function invertRenameNet(doc, command) {
	const net = findNet(doc.ir, command.netId);
	const prevName =
		command.prevName !== undefined ? command.prevName : net?.name;
	return {
		type: "renameNet",
		netId: command.netId,
		name: prevName,
	};
}

function invertBatch(doc, command) {
	let current = doc;
	const inverted = [];
	for (const subCmd of command.commands) {
		inverted.unshift(invertCommand(current, subCmd));
		current = applyCommand(current, subCmd);
	}
	return { type: "batch", commands: inverted };
}

const INVERTERS = {
	addPart: invertAddPart,
	deletePart: invertDeletePart,
	movePart: invertMovePart,
	rotatePart: invertRotatePart,
	flipPart: invertFlipPart,
	setPartField: invertSetPartField,
	setPartProp: invertSetPartProp,
	connect: invertConnect,
	disconnect: invertDisconnect,
	renameNet: invertRenameNet,
	batch: invertBatch,
};

export function invertCommand(doc, command) {
	if (!command || typeof command !== "object") {
		return null;
	}
	if (!command.type) {
		return null;
	}
	const inverter = INVERTERS[command.type];
	if (!inverter) {
		return null;
	}
	return inverter(doc, command);
}

function prepareBatch(doc, command, idFn) {
	let current = doc;
	const prepared = [];
	for (const sub of command.commands) {
		const p = prepareCommand(current, sub, idFn);
		prepared.push(p);
		current = applyCommand(current, p, { idFn });
	}
	return { ...command, commands: prepared };
}

function prepareCommand(doc, command, idFn) {
	if (command.type === "addPart" && !command.part?.id) {
		return { ...command, part: { ...command.part, id: idFn("part") } };
	}
	if (command.type === "batch" && Array.isArray(command.commands)) {
		return prepareBatch(doc, command, idFn);
	}
	return command;
}

function dispatchStep(doc, command, idFn) {
	if (!command || typeof command !== "object") {
		return { ...doc, error: "dispatch: command must be an object" };
	}
	if (command.type === "select") {
		const next = applyCommand(doc, command, { idFn });
		return next.error ? { ...doc, error: next.error } : next;
	}
	const prepared = prepareCommand(doc, command, idFn);
	const inverse = invertCommand(doc, prepared);
	const next = applyCommand(doc, prepared, { idFn });
	if (next.error) {
		return { ...doc, error: next.error };
	}
	const entry = { ...prepared, _inverse: inverse };
	const past = [...doc.history.past, entry].slice(-200);
	return {
		ir: next.ir,
		selection: next.selection,
		history: { past, future: [] },
	};
}

function stepHistory(doc, idFn, fromKey, resolveCmd) {
	const source = [...doc.history[fromKey]];
	if (source.length === 0) return doc;
	const item = source.pop();
	const next = applyCommand(doc, resolveCmd(item, doc), { idFn });
	const toKey = fromKey === "past" ? "future" : "past";
	const target = [...doc.history[toKey], item].slice(-200);
	return {
		ir: next.ir,
		selection: next.selection,
		history: {
			past: fromKey === "past" ? source : target,
			future: fromKey === "future" ? source : target,
		},
	};
}

function undoStep(doc, idFn) {
	return stepHistory(
		doc,
		idFn,
		"past",
		(item, d) => item._inverse ?? invertCommand(d, item),
	);
}

function redoStep(doc, idFn) {
	return stepHistory(doc, idFn, "future", (item) => item);
}

function buildEditorApi(getDoc, setDoc, idFn) {
	return {
		get state() {
			return getDoc();
		},
		get selection() {
			return getDoc().selection;
		},
		get canUndo() {
			return getDoc().history.past.length > 0;
		},
		get canRedo() {
			return getDoc().history.future.length > 0;
		},
		dispatch(cmd) {
			return setDoc(dispatchStep(getDoc(), cmd, idFn));
		},
		undo() {
			return setDoc(undoStep(getDoc(), idFn));
		},
		redo() {
			return setDoc(redoStep(getDoc(), idFn));
		},
	};
}

export function createEditor(initialIr, { idFn } = {}) {
	const resolvedIdFn = idFn ?? defaultIdFn;
	let doc = {
		ir: structuredClone(initialIr),
		selection: [],
		history: { past: [], future: [] },
	};
	return buildEditorApi(
		() => doc,
		(next) => {
			doc = next;
			return doc;
		},
		resolvedIdFn,
	);
}
