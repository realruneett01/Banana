/** Pure net-highlight helpers for the schematic editor. No React, no side-effects. */

function findNet(ir, predicate) {
	for (const net of ir?.nets || []) {
		if (predicate(net)) return net;
	}
	return null;
}

function netResult(net) {
	const partIds = new Set(net.pins.map((p) => p.partId));
	return { netId: net.id, netName: net.name, partIds, pins: [...net.pins] };
}

/**
 * Return highlight data for the net containing `hit`, or null when unconnected/unknown.
 * hit: { partId, pin } | { netId }
 */
function netForHit(ir, hit) {
	if (hit.netId !== undefined) return findNet(ir, (n) => n.id === hit.netId);
	const { partId, pin } = hit;
	if (!(ir.parts || []).some((p) => p.id === partId)) return null;
	return findNet(ir, (n) =>
		n.pins.some((p) => p.partId === partId && p.pin === pin),
	);
}

export function netItemsAt(ir, hit) {
	if (!ir || !hit) return null;
	const net = netForHit(ir, hit);
	return net ? netResult(net) : null;
}

/** Return array of netIds that touch partId (may be empty). */
export function netsOfPart(ir, partId) {
	const result = [];
	for (const net of ir?.nets || []) {
		if (net.pins.some((p) => p.partId === partId)) {
			result.push(net.id);
		}
	}
	return result;
}
