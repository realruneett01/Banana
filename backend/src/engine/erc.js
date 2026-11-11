import { newId } from "./ids.js";

const POWER_RAIL_REGEX = /^(VCC|VDD|3V3|5V|\+?\d+V\d*|VBUS|VIN)$/i;

const SEVERITY_ORDER = {
	error: 0,
	warning: 1,
	info: 2,
};

function collectRailTargets(constraints) {
	const targets = new Set();
	for (const c of constraints ?? []) {
		if (c?.kind === "rail" && typeof c.target === "string") {
			targets.add(c.target);
		}
	}
	return targets;
}

function checkNetPinCount(net, commit) {
	const count = Array.isArray(net.pins) ? net.pins.length : 0;
	if (count >= 2) {
		return null;
	}
	return {
		id: newId("issue"),
		source: "erc",
		severity: "error",
		itemIds: [net.id],
		message: `net ${net.name} has only ${count} pin(s)`,
		suggestion: "connect it or delete the net",
		commit,
		status: "open",
	};
}

function checkPowerRailNet(net, railTargets, commit) {
	if (!POWER_RAIL_REGEX.test(net.name)) {
		return null;
	}
	if (railTargets.has(net.id) || railTargets.has(net.name)) {
		return null;
	}
	return {
		id: newId("issue"),
		source: "erc",
		severity: "info",
		itemIds: [net.id],
		message: `power net ${net.name} has no rail constraint`,
		suggestion: "add a rail constraint so the simulator can check IR drop",
		commit,
		status: "open",
	};
}

function collectNetIssues(nets, railTargets, commit, issues) {
	for (const net of nets) {
		const pinIssue = checkNetPinCount(net, commit);
		if (pinIssue) {
			issues.push(pinIssue);
		}
		const railIssue = checkPowerRailNet(net, railTargets, commit);
		if (railIssue) {
			issues.push(railIssue);
		}
	}
}

function addNetPinPartIds(pins, set) {
	for (const pin of pins ?? []) {
		if (typeof pin?.partId === "string") {
			set.add(pin.partId);
		}
	}
}

function collectConnectedPartIds(nets) {
	const connected = new Set();
	for (const net of nets ?? []) {
		addNetPinPartIds(net.pins, connected);
	}
	return connected;
}

function checkPartConnected(part, connectedPartIds, commit) {
	if (connectedPartIds.has(part.id)) {
		return null;
	}
	return {
		id: newId("issue"),
		source: "erc",
		severity: "warning",
		itemIds: [part.id],
		message: `${part.ref} is not connected to any net`,
		commit,
		status: "open",
	};
}

function checkPartFootprint(part, commit) {
	const hasFootprint =
		typeof part.footprint === "string" && part.footprint.trim().length > 0;
	if (hasFootprint) {
		return null;
	}
	return {
		id: newId("issue"),
		source: "erc",
		severity: "error",
		itemIds: [part.id],
		message: `${part.ref} has no footprint`,
		commit,
		status: "open",
	};
}

function collectPartIssues(parts, connectedPartIds, commit, issues) {
	for (const part of parts) {
		const connIssue = checkPartConnected(part, connectedPartIds, commit);
		if (connIssue) {
			issues.push(connIssue);
		}
		const fpIssue = checkPartFootprint(part, commit);
		if (fpIssue) {
			issues.push(fpIssue);
		}
	}
}

function recordPinNet(pinMap, partId, pin, net) {
	const key = `${partId}:::${pin}`;
	let entry = pinMap.get(key);
	if (!entry) {
		entry = { partId, pin, nets: [] };
		pinMap.set(key, entry);
	}
	const inNet = entry.nets.some((n) => n.id === net.id);
	if (!inNet) {
		entry.nets.push(net);
	}
}

function indexNetPins(net, pinMap) {
	for (const p of net.pins ?? []) {
		if (typeof p?.partId === "string" && p?.pin !== undefined) {
			recordPinNet(pinMap, p.partId, String(p.pin), net);
		}
	}
}

function buildPinNetMap(nets) {
	const pinMap = new Map();
	for (const net of nets ?? []) {
		indexNetPins(net, pinMap);
	}
	return pinMap;
}

function createPinShortIssue(item, commit) {
	const { partId, pin, ref, netA, netB } = item;
	return {
		id: newId("issue"),
		source: "erc",
		severity: "error",
		itemIds: [partId, netA.id, netB.id],
		message: `${ref} pin ${pin} is on nets ${netA.name} and ${netB.name}`,
		commit,
		status: "open",
	};
}

function checkPinPairs(entry, ref, commit, issues) {
	const { nets, partId, pin } = entry;
	for (let i = 0; i < nets.length; i++) {
		for (let j = i + 1; j < nets.length; j++) {
			issues.push(
				createPinShortIssue(
					{ partId, pin, ref, netA: nets[i], netB: nets[j] },
					commit,
				),
			);
		}
	}
}

function collectPinShorts(pinMap, partsById, commit) {
	const issues = [];
	for (const entry of pinMap.values()) {
		if (entry.nets.length >= 2) {
			const ref = partsById.get(entry.partId)?.ref ?? entry.partId;
			checkPinPairs(entry, ref, commit, issues);
		}
	}
	return issues;
}

function compareIssues(a, b) {
	const rankA = SEVERITY_ORDER[a.severity] ?? 99;
	const rankB = SEVERITY_ORDER[b.severity] ?? 99;
	if (rankA !== rankB) {
		return rankA - rankB;
	}
	if (a.message < b.message) {
		return -1;
	}
	if (a.message > b.message) {
		return 1;
	}
	return 0;
}

export function runErc(ir, { commit = "" } = {}) {
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	const nets = Array.isArray(ir?.nets) ? ir.nets : [];
	const constraints = Array.isArray(ir?.constraints) ? ir.constraints : [];

	const railTargets = collectRailTargets(constraints);
	const connectedPartIds = collectConnectedPartIds(nets);
	const partsById = new Map(parts.map((p) => [p.id, p]));
	const pinMap = buildPinNetMap(nets);

	const issues = [];
	collectNetIssues(nets, railTargets, commit, issues);
	collectPartIssues(parts, connectedPartIds, commit, issues);
	issues.push(...collectPinShorts(pinMap, partsById, commit));

	return issues.sort(compareIssues);
}
