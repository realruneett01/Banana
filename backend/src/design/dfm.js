import { absolutePads, copperLite } from "./checks.js";

/**
 * Typical capabilities of low-cost two-layer board services. They are starting points, not promises: every fab
 * publishes its own current limits and those win. All lengths in mm.
 */
export const DFM_PROFILES = Object.freeze({
	standard: {
		label: "Standard 2-layer",
		minTrack: 0.2,
		minClearance: 0.2,
		minDrill: 0.3,
		minAnnular: 0.15,
		maxBoard: [100, 100],
	},
	budget: {
		label: "Budget prototype 2-layer",
		minTrack: 0.15,
		minClearance: 0.15,
		minDrill: 0.3,
		minAnnular: 0.13,
		maxBoard: [100, 100],
	},
	fine: {
		label: "Fine-pitch 2-layer",
		minTrack: 0.1,
		minClearance: 0.1,
		minDrill: 0.2,
		minAnnular: 0.1,
		maxBoard: [200, 200],
	},
});

const issue = (severity, code, message) => ({ severity, code, message });

const rectGap = (a, b) => {
	const dx = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
	const dy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
	return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
};

/** Checks the built design against a fabrication profile. Pure: no files, no KiCad. */
export function dfmReport(design, positions, board, profileName = "standard") {
	const profile = DFM_PROFILES[profileName];
	if (!profile) throw new Error(`Unknown DFM profile "${profileName}"`);
	const d = design.data;
	const issues = [];

	if (board.width > profile.maxBoard[0] || board.height > profile.maxBoard[1])
		issues.push(
			issue(
				"warning",
				"board_size",
				`The board is ${board.width} x ${board.height} mm; low-cost pricing usually stops at ${profile.maxBoard[0]} x ${profile.maxBoard[1]} mm.`,
			),
		);

	const narrow = new Map();
	for (const t of d.tracks)
		if (t.width < profile.minTrack - 1e-9)
			narrow.set(t.net, Math.min(narrow.get(t.net) ?? Infinity, t.width));
	for (const [net, w] of narrow)
		issues.push(
			issue(
				"error",
				"track_width",
				`Net ${net} has tracks ${w} mm wide; this profile's minimum is ${profile.minTrack} mm.`,
			),
		);

	d.vias.forEach((v, i) => {
		if (v.drill < profile.minDrill - 1e-9)
			issues.push(
				issue(
					"error",
					"via_drill",
					`Via ${i} (${v.net}) has a ${v.drill} mm drill; minimum ${profile.minDrill} mm.`,
				),
			);
		const ring = (v.size - v.drill) / 2;
		if (ring < profile.minAnnular - 1e-9)
			issues.push(
				issue(
					"error",
					"via_annular",
					`Via ${i} (${v.net}) has a ${ring.toFixed(3)} mm annular ring; minimum ${profile.minAnnular} mm.`,
				),
			);
	});

	const pads = absolutePads(design, positions);
	for (const [pin, p] of pads) {
		if (!p.thru) continue;
		if (p.drill && p.drill < profile.minDrill - 1e-9)
			issues.push(
				issue(
					"error",
					"hole_drill",
					`${pin} has a ${p.drill} mm hole; minimum ${profile.minDrill} mm.`,
				),
			);
		const ring = (Math.min(p.w, p.h) - (p.drill || 0)) / 2;
		if (p.drill && ring < profile.minAnnular - 1e-9)
			issues.push(
				issue(
					"error",
					"hole_annular",
					`${pin} has a ${ring.toFixed(3)} mm annular ring; minimum ${profile.minAnnular} mm.`,
				),
			);
	}

	// copper to copper between different nets, at this profile's limit (tracks, vias and pads)
	for (const c of copperLite(design, positions, profile.minClearance))
		issues.push(issue("error", "clearance", c.message));

	// pad to pad, different nets, same layer (footprints decide this, not the router)
	const netOfPin = new Map();
	for (const [net, def] of Object.entries(d.nets))
		for (const pin of def.pins) netOfPin.set(pin, net);
	const list = [...pads];
	for (let i = 0; i < list.length; i++)
		for (let j = i + 1; j < list.length; j++) {
			const [pa, a] = list[i];
			const [pb, b] = list[j];
			const na = netOfPin.get(pa);
			if (na && na === netOfPin.get(pb)) continue; // same net: allowed to touch
			if (!a.thru && !b.thru && a.layers[0] !== b.layers[0]) continue;
			const gap = rectGap(a, b);
			if (gap < profile.minClearance - 1e-9)
				issues.push(
					issue(
						"error",
						"pad_spacing",
						gap <= 0
							? `${pa} and ${pb} overlap (different nets).`
							: `${pa} and ${pb} are ${gap.toFixed(3)} mm apart; this profile's minimum is ${profile.minClearance} mm.`,
					),
				);
		}

	return {
		profile: profileName,
		label: profile.label,
		limits: { ...profile },
		ok: issues.every((i) => i.severity !== "error"),
		errors: issues.filter((i) => i.severity === "error").length,
		warnings: issues.filter((i) => i.severity === "warning").length,
		issues,
		note: "Typical limits for low-cost two-layer services. Check your manufacturer's current capabilities before ordering.",
	};
}
