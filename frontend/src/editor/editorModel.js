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

function withAnnotations(doc, annotations) {
	return withIr(doc, { ...doc.ir, annotations });
}

function withSheets(doc, sheets) {
	return withIr(doc, { ...doc.ir, sheets });
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

const VALID_FIELDS = new Set([
	"ref",
	"value",
	"footprint",
	"symbol",
	"datasheet",
]);

function applyPartFieldValue(part, field, value) {
	if (value === undefined) {
		const copy = { ...part };
		delete copy[field];
		return copy;
	}
	return { ...part, [field]: value };
}

function handleSetPartField(doc, command) {
	const { partId, field, value } = command;
	if (!VALID_FIELDS.has(field)) {
		return { ...doc, error: `setPartField: invalid field ${field}` };
	}
	if (typeof value !== "string" && value !== undefined) {
		return { ...doc, error: "setPartField: value must be a string" };
	}
	const part = findPart(doc.ir, partId);
	if (!part) {
		return { ...doc, error: `setPartField: part not found ${partId}` };
	}
	return updateDocPart(doc, partId, (p) =>
		applyPartFieldValue(p, field, value),
	);
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

function findAnnotation(ir, id) {
	return (ir?.annotations ?? []).find((a) => a.id === id);
}

function autoPrefixedId(items, prefix) {
	const re = new RegExp(`^${prefix}[-_](\\d+)$`);
	let max = 0;
	for (const item of items ?? []) {
		const m = typeof item?.id === "string" ? re.exec(item.id) : null;
		if (m) {
			const n = Number.parseInt(m[1], 10);
			if (n > max) max = n;
		}
	}
	return `${prefix}-${max + 1}`;
}

function autoAnnotationId(annotations) {
	return autoPrefixedId(annotations, "ann");
}

function handleAddAnnotation(doc, command) {
	if (command._annotations) {
		return withAnnotations(doc, command._annotations);
	}
	const annotation = command.annotation;
	if (!annotation || typeof annotation !== "object") {
		return { ...doc, error: "addAnnotation: missing annotation object" };
	}
	const id = annotation.id || autoAnnotationId(doc.ir.annotations);
	if (findAnnotation(doc.ir, id)) {
		return { ...doc, error: `addAnnotation: duplicate annotation id ${id}` };
	}
	const newAnnotation = { ...annotation, id };
	const annotations = [...(doc.ir.annotations ?? []), newAnnotation];
	return withAnnotations(doc, annotations);
}

function restoreSection(doc, section, prev) {
	const ir = { ...doc.ir };
	if (prev === undefined) {
		delete ir[section];
	} else {
		ir[section] = prev;
	}
	return withIr(doc, ir);
}

function deleteDocItem(doc, section, targetId) {
	const items = (doc.ir[section] ?? []).filter((x) => x.id !== targetId);
	const selection = doc.selection.filter((id) => id !== targetId);
	return {
		ir: { ...doc.ir, [section]: items },
		selection,
		history: doc.history,
	};
}

function handleDeleteAnnotation(doc, command) {
	if ("_prevAnnotations" in command) {
		return restoreSection(doc, "annotations", command._prevAnnotations);
	}
	if (!command.id || !findAnnotation(doc.ir, command.id)) {
		return doc;
	}
	return deleteDocItem(doc, "annotations", command.id);
}

function moveAnnotationItem(ann, dx, dy) {
	const next = { ...ann, x: ann.x + dx, y: ann.y + dy };
	if (typeof ann.x2 === "number") {
		next.x2 = ann.x2 + dx;
	}
	if (typeof ann.y2 === "number") {
		next.y2 = ann.y2 + dy;
	}
	return next;
}

function handleMoveAnnotation(doc, command) {
	const ann = findAnnotation(doc.ir, command.id);
	if (!ann) return doc;
	const { dx, dy } = command;
	if (typeof dx !== "number" || typeof dy !== "number") {
		return { ...doc, error: "moveAnnotation: dx and dy must be numbers" };
	}
	const next = moveAnnotationItem(ann, dx, dy);
	const annotations = (doc.ir.annotations ?? []).map((a) =>
		a.id === command.id ? next : a,
	);
	return withAnnotations(doc, annotations);
}

function findSheet(ir, sheetId) {
	return (ir?.sheets ?? []).find((s) => s.id === sheetId);
}

function autoSheetId(sheets) {
	return autoPrefixedId(sheets, "sheet");
}

function autoSheetPinId(pins) {
	return autoPrefixedId(pins, "pin");
}

function nextUnusedName(items, prefix) {
	const names = new Set((items ?? []).map((x) => x.name));
	let i = 1;
	while (names.has(`${prefix}${i}`)) i++;
	return `${prefix}${i}`;
}

function nextSheetName(sheets) {
	return nextUnusedName(sheets, "Sheet");
}

function sheetFileName(name) {
	const clean = (name ?? "").replace(/[^A-Za-z0-9_-]/g, "");
	return `${clean || "sheet"}.kicad_sch`;
}

function clampDim(val) {
	return typeof val === "number" ? Math.max(10, val) : 10;
}

function normalizeSheet(sheet, sheets) {
	const id = sheet.id || autoSheetId(sheets);
	const name = sheet.name || nextSheetName(sheets);
	const isExplicit = Boolean(
		sheet.explicitFile || ("file" in sheet && sheet.file !== undefined),
	);
	const file = sheet.file || sheetFileName(name);
	return {
		...sheet,
		id,
		name,
		file,
		explicitFile: isExplicit,
		x: sheet.x ?? 0,
		y: sheet.y ?? 0,
		w: clampDim(sheet.w),
		h: clampDim(sheet.h),
		pins: sheet.pins ? [...sheet.pins] : [],
	};
}

function updateSheet(doc, sheetId, transform) {
	const sheets = (doc.ir.sheets ?? []).map((s) =>
		s.id === sheetId ? transform(s) : s,
	);
	return withSheets(doc, sheets);
}

function handleAddSheet(doc, command) {
	if (command._sheets) {
		return withSheets(doc, command._sheets);
	}
	const sheet = command.sheet;
	if (!sheet || typeof sheet !== "object") {
		return { ...doc, error: "addSheet: missing sheet object" };
	}
	const id = sheet.id || autoSheetId(doc.ir.sheets);
	if (findSheet(doc.ir, id)) {
		return { ...doc, error: `addSheet: duplicate sheet id ${id}` };
	}
	const newSheet = normalizeSheet({ ...sheet, id }, doc.ir.sheets);
	return withSheets(doc, [...(doc.ir.sheets ?? []), newSheet]);
}

function handleDeleteSheet(doc, command) {
	if ("_prevSheets" in command) {
		return restoreSection(doc, "sheets", command._prevSheets);
	}
	if (!command.sheetId || !findSheet(doc.ir, command.sheetId)) {
		return doc;
	}
	return deleteDocItem(doc, "sheets", command.sheetId);
}

function handleMoveSheet(doc, command) {
	const { dx, dy, sheetId } = command;
	if (typeof dx !== "number" || typeof dy !== "number") {
		return { ...doc, error: "moveSheet: dx and dy must be numbers" };
	}
	if (!findSheet(doc.ir, sheetId)) return doc;
	return updateSheet(doc, sheetId, (s) => ({
		...s,
		x: (s.x ?? 0) + dx,
		y: (s.y ?? 0) + dy,
	}));
}

function handleResizeSheet(doc, command) {
	const { w, h, sheetId } = command;
	if (typeof w !== "number" || typeof h !== "number") {
		return { ...doc, error: "resizeSheet: w and h must be numbers" };
	}
	if (!findSheet(doc.ir, sheetId)) return doc;
	return updateSheet(doc, sheetId, (s) => ({
		...s,
		w: clampDim(w),
		h: clampDim(h),
	}));
}

function isSheetFileExplicit(sheet) {
	if (sheet.explicitFile === true) return true;
	if (sheet.explicitFile === false) return false;
	return Boolean(sheet.file && sheet.file !== sheetFileName(sheet.name));
}

function handleRenameSheet(doc, command) {
	const { sheetId, name } = command;
	if (typeof name !== "string" || !name) {
		return { ...doc, error: "renameSheet: name must be a non-empty string" };
	}
	const sheet = findSheet(doc.ir, sheetId);
	if (!sheet) return doc;
	const explicit = isSheetFileExplicit(sheet);
	const nextFile =
		command._prevFile !== undefined
			? command._prevFile
			: explicit
				? sheet.file
				: sheetFileName(name);
	return updateSheet(doc, sheetId, (s) => ({ ...s, name, file: nextFile }));
}

function resolvePinName(pins, pin, command) {
	const candidate =
		pin?.name ||
		pin?.hierLabel ||
		pin?.label ||
		command?.hierLabel ||
		command?.label;
	if (typeof candidate === "string" && candidate.trim()) {
		return candidate.trim();
	}
	return nextUnusedName(pins, "Pin");
}

function normalizePin(pin, pins, command) {
	const id = pin.id || autoSheetPinId(pins);
	const name = resolvePinName(pins, pin, command);
	return {
		id,
		name,
		type: pin.type || "input",
		side: pin.side || "left",
		offset: typeof pin.offset === "number" ? pin.offset : 0,
	};
}

function validatePinInput(pin) {
	if (!pin || typeof pin !== "object") {
		return "addSheetPin: missing pin object";
	}
	return null;
}

function checkDuplicatePin(pins, id) {
	if ((pins ?? []).some((p) => p.id === id)) {
		return `addSheetPin: duplicate pin id ${id}`;
	}
	return null;
}

function handleAddSheetPin(doc, command) {
	const sheet = findSheet(doc.ir, command.sheetId);
	if (!sheet) {
		return { ...doc, error: `addSheetPin: sheet not found ${command.sheetId}` };
	}
	if (command._pins) {
		return updateSheet(doc, command.sheetId, (s) => ({
			...s,
			pins: command._pins,
		}));
	}
	const err = validatePinInput(command.pin);
	if (err) return { ...doc, error: err };
	const id = command.pin.id || autoSheetPinId(sheet.pins);
	const dupErr = checkDuplicatePin(sheet.pins, id);
	if (dupErr) return { ...doc, error: dupErr };
	const newPin = normalizePin({ ...command.pin, id }, sheet.pins, command);
	return updateSheet(doc, command.sheetId, (s) => ({
		...s,
		pins: [...(s.pins ?? []), newPin],
	}));
}

function handleDeleteSheetPin(doc, command) {
	const sheet = findSheet(doc.ir, command.sheetId);
	if (!sheet) return doc;
	if (command._prevPins) {
		return updateSheet(doc, command.sheetId, (s) => ({
			...s,
			pins: command._prevPins,
		}));
	}
	if (!command.pinId || !sheet.pins?.some((p) => p.id === command.pinId)) {
		return doc;
	}
	const pins = (sheet.pins ?? []).filter((p) => p.id !== command.pinId);
	return updateSheet(doc, command.sheetId, (s) => ({ ...s, pins }));
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
	addAnnotation: handleAddAnnotation,
	deleteAnnotation: handleDeleteAnnotation,
	moveAnnotation: handleMoveAnnotation,
	addSheet: handleAddSheet,
	deleteSheet: handleDeleteSheet,
	moveSheet: handleMoveSheet,
	resizeSheet: handleResizeSheet,
	renameSheet: handleRenameSheet,
	addSheetPin: handleAddSheetPin,
	deleteSheetPin: handleDeleteSheetPin,
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

function invertAddAnnotation(doc, command) {
	return {
		type: "deleteAnnotation",
		id: command.annotation.id,
		_prevAnnotations: doc.ir.annotations,
	};
}

function invertDeleteAnnotation(doc, command) {
	const annotation = findAnnotation(doc.ir, command.id);
	if (!annotation) return null;
	return {
		type: "addAnnotation",
		annotation,
		_annotations: doc.ir.annotations,
	};
}

function invertDeltaMove(exists, type, idKey, command) {
	if (
		!exists ||
		typeof command.dx !== "number" ||
		typeof command.dy !== "number"
	) {
		return null;
	}
	return {
		type,
		[idKey]: command[idKey],
		dx: -command.dx,
		dy: -command.dy,
	};
}

function invertMoveAnnotation(doc, command) {
	return invertDeltaMove(
		Boolean(findAnnotation(doc.ir, command.id)),
		"moveAnnotation",
		"id",
		command,
	);
}

function invertAddSheet(doc, command) {
	return {
		type: "deleteSheet",
		sheetId: command.sheet?.id,
		_prevSheets: doc.ir.sheets,
	};
}

function invertDeleteSheet(doc, command) {
	const sheet = findSheet(doc.ir, command.sheetId);
	if (!sheet) return null;
	return {
		type: "addSheet",
		sheet,
		_sheets: doc.ir.sheets,
	};
}

function invertMoveSheet(doc, command) {
	return invertDeltaMove(
		Boolean(findSheet(doc.ir, command.sheetId)),
		"moveSheet",
		"sheetId",
		command,
	);
}

function invertResizeSheet(doc, command) {
	const sheet = findSheet(doc.ir, command.sheetId);
	if (
		!sheet ||
		typeof command.w !== "number" ||
		typeof command.h !== "number"
	) {
		return null;
	}
	return {
		type: "resizeSheet",
		sheetId: command.sheetId,
		w: sheet.w,
		h: sheet.h,
	};
}

function invertRenameSheet(doc, command) {
	const sheet = findSheet(doc.ir, command.sheetId);
	if (!sheet) return null;
	return {
		type: "renameSheet",
		sheetId: command.sheetId,
		name: sheet.name,
		_prevFile: sheet.file,
	};
}

function invertAddSheetPin(doc, command) {
	const sheet = findSheet(doc.ir, command.sheetId);
	return {
		type: "deleteSheetPin",
		sheetId: command.sheetId,
		pinId: command.pin?.id,
		_prevPins: sheet?.pins,
	};
}

function invertDeleteSheetPin(doc, command) {
	const sheet = findSheet(doc.ir, command.sheetId);
	if (!sheet) return null;
	const pin = (sheet.pins ?? []).find((p) => p.id === command.pinId);
	if (!pin) return null;
	return {
		type: "addSheetPin",
		sheetId: command.sheetId,
		pin,
		_pins: sheet.pins,
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
	addAnnotation: invertAddAnnotation,
	deleteAnnotation: invertDeleteAnnotation,
	moveAnnotation: invertMoveAnnotation,
	addSheet: invertAddSheet,
	deleteSheet: invertDeleteSheet,
	moveSheet: invertMoveSheet,
	resizeSheet: invertResizeSheet,
	renameSheet: invertRenameSheet,
	addSheetPin: invertAddSheetPin,
	deleteSheetPin: invertDeleteSheetPin,
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

function prepareAddSheetPin(doc, cmd) {
	if (cmd.pin?.id) return cmd;
	const sheet = findSheet(doc.ir, cmd.sheetId);
	return {
		...cmd,
		pin: { ...cmd.pin, id: autoSheetPinId(sheet?.pins) },
	};
}

const ENTITY_PREPARERS = {
	addPart: (_d, cmd, idFn) =>
		cmd.part?.id ? cmd : { ...cmd, part: { ...cmd.part, id: idFn("part") } },
	addAnnotation: (doc, cmd) =>
		cmd.annotation?.id
			? cmd
			: {
					...cmd,
					annotation: {
						...cmd.annotation,
						id: autoAnnotationId(doc.ir?.annotations),
					},
				},
	addSheet: (doc, cmd) =>
		cmd.sheet?.id
			? cmd
			: {
					...cmd,
					sheet: { ...cmd.sheet, id: autoSheetId(doc.ir?.sheets) },
				},
	addSheetPin: prepareAddSheetPin,
};

function prepareEntityCommand(doc, command, idFn) {
	const preparer = ENTITY_PREPARERS[command.type];
	return preparer ? preparer(doc, command, idFn) : command;
}

function prepareCommand(doc, command, idFn) {
	if (command.type === "batch" && Array.isArray(command.commands)) {
		return prepareBatch(doc, command, idFn);
	}
	return prepareEntityCommand(doc, command, idFn);
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
	if (next === doc) {
		return doc;
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
