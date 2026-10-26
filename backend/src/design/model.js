import { getFootprint, getSymbol } from "./kicad-lib.js";

export const NET_NAME = /^[A-Za-z0-9_+.][A-Za-z0-9_+.\-/]{0,39}$/;
export const REF_RE = /^[A-Z]{1,3}[0-9]{1,4}$/;
const POWER_NAME =
	/^(GND|AGND|DGND|PGND|VSS|VCC|VDD|VEE|VBUS|VBAT|VIN|VOUT|[+-]?\d+V\d*|[+-]\d+(\.\d+)?V)$/i;
const GROUND_NAME = /^(GND|AGND|DGND|PGND|VSS)$/i;

export class DesignError extends Error {
	constructor(message, details) {
		super(message);
		this.name = "DesignError";
		this.statusCode = 400;
		this.details = details;
	}
}

const fail = (msg, details) => {
	throw new DesignError(msg, details);
};

export function isGroundName(name) {
	return GROUND_NAME.test(name);
}

export function emptyDesign(name, title = "") {
	return {
		schemaVersion: 1,
		name,
		title,
		board: null,
		parts: [],
		nets: {},
		noConnect: [],
		tracks: [],
		vias: [],
		tests: [],
	};
}

/** Deep-validated, mutable design. All edits go through methods so the file on disk is always consistent. */
export class Design {
	constructor(data) {
		this.data = data;
	}

	static from(data) {
		if (!data || typeof data !== "object" || data.schemaVersion !== 1)
			fail("Unsupported or corrupt design file");
		for (const k of ["parts", "tracks", "vias", "tests", "noConnect"])
			if (!Array.isArray(data[k])) data[k] = [];
		if (!data.nets || typeof data.nets !== "object") data.nets = {};
		return new Design(data);
	}

	get parts() {
		return this.data.parts;
	}

	part(ref) {
		const p = this.data.parts.find((x) => x.ref === ref);
		if (!p)
			fail(`No part with reference "${ref}"`, {
				known: this.data.parts.map((x) => x.ref),
			});
		return p;
	}

	symbolOf(part) {
		const sym = getSymbol(part.symbol);
		if (!sym) fail(`Symbol "${part.symbol}" not found in the KiCad library`);
		return sym;
	}

	nextRef(prefix) {
		const used = new Set(this.data.parts.map((p) => p.ref));
		for (let i = 1; i < 10000; i++)
			if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
		return fail("Too many parts");
	}

	addPart({ symbol, ref, value, footprint, at, fields }) {
		const sym = getSymbol(symbol);
		if (!sym)
			fail(
				`Symbol "${symbol}" not found. Use search_symbols to find a valid "Library:Name".`,
			);
		if (sym.isPower)
			fail(
				`"${symbol}" is a power symbol; declare power rails with connect(net, pins) instead`,
			);
		const prefix = (sym.referencePrefix || "U").toUpperCase();
		const finalRef = ref ?? this.nextRef(prefix);
		if (!REF_RE.test(finalRef))
			fail(`Invalid reference "${finalRef}" (letters then digits, e.g. R12)`);
		if (this.data.parts.some((p) => p.ref === finalRef))
			fail(`Reference "${finalRef}" already exists`);
		const part = {
			ref: finalRef,
			symbol: sym.id,
			value: String(value ?? sym.name).slice(0, 80),
			footprint: "",
			at: null,
		};
		if (fields && typeof fields === "object")
			part.fields = Object.fromEntries(
				Object.entries(fields)
					.slice(0, 20)
					.map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 200)]),
			);
		this.data.parts.push(part);
		const fp =
			footprint ??
			(sym.defaultFootprint && getFootprint(sym.defaultFootprint)
				? sym.defaultFootprint
				: "");
		if (fp) this.setFootprint(finalRef, fp);
		if (at) this.place(finalRef, at.x, at.y, at.rot ?? 0);
		return part;
	}

	removePart(ref) {
		this.part(ref);
		this.data.parts = this.data.parts.filter((p) => p.ref !== ref);
		for (const [name, net] of Object.entries(this.data.nets)) {
			net.pins = net.pins.filter((p) => !p.startsWith(`${ref}.`));
			if (net.pins.length === 0 && !net.power && !net.external)
				delete this.data.nets[name];
		}
		this.data.noConnect = this.data.noConnect.filter(
			(p) => !p.startsWith(`${ref}.`),
		);
	}

	setValue(ref, value) {
		this.part(ref).value = String(value).slice(0, 80);
	}

	setFootprint(ref, footprintId) {
		const part = this.part(ref);
		const fp = getFootprint(footprintId);
		if (!fp)
			fail(
				`Footprint "${footprintId}" not found. Use search_footprints to find a valid "Library:Name".`,
			);
		const sym = this.symbolOf(part);
		const padNumbers = new Set(fp.pads.map((p) => p.number));
		const needed = [
			...new Set(
				sym.pins.filter((p) => p.unit <= 1 || true).map((p) => p.number),
			),
		];
		const missing = needed.filter((n) => !padNumbers.has(n));
		// Footprints may legitimately have extra pads (mounting, shield); symbol pins without a pad are a real mismatch.
		if (missing.length)
			fail(
				`Footprint "${footprintId}" has no pad(s) ${missing.join(", ")} required by symbol "${part.symbol}"`,
				{ footprintPads: [...padNumbers], symbolPins: needed },
			);
		part.footprint = footprintId;
	}

	/** Resolves "R1.2" / "U1.VCC" to canonical "U1.<pin number>"; ambiguous or unknown names are errors. */
	resolvePin(spec) {
		const m = /^([A-Z]{1,3}[0-9]{1,4})\.(.+)$/.exec(String(spec));
		if (!m) fail(`Pin "${spec}" must look like "R1.2" or "U1.VCC"`);
		const part = this.part(m[1]);
		const sym = this.symbolOf(part);
		const byNumber = sym.pins.filter((p) => p.number === m[2]);
		if (byNumber.length) return `${part.ref}.${byNumber[0].number}`;
		const byName = sym.pins.filter(
			(p) => p.name.toLowerCase() === m[2].toLowerCase(),
		);
		if (byName.length === 1) return `${part.ref}.${byName[0].number}`;
		if (byName.length > 1)
			fail(`Pin name "${m[2]}" on ${part.ref} is ambiguous; use a pin number`, {
				candidates: byName.map((p) => `${p.number} (${p.name})`),
			});
		return fail(`${part.ref} (${sym.id}) has no pin "${m[2]}"`, {
			pins: sym.pins.map((p) => `${p.number}:${p.name}`),
		});
	}

	netOfPin(pin) {
		for (const [name, net] of Object.entries(this.data.nets))
			if (net.pins.includes(pin)) return name;
		return null;
	}

	connect(netName, pinSpecs, { move = false } = {}) {
		if (!NET_NAME.test(netName)) fail(`Invalid net name "${netName}"`);
		if (!Array.isArray(pinSpecs) || pinSpecs.length === 0)
			fail("connect needs at least one pin");
		const pins = [...new Set(pinSpecs.map((s) => this.resolvePin(s)))];
		const net = (this.data.nets[netName] ??= { pins: [] });
		if (net.power === undefined && POWER_NAME.test(netName)) net.power = true;
		for (const pin of pins) {
			const current = this.netOfPin(pin);
			if (current && current !== netName) {
				if (!move)
					fail(
						`${pin} is already on net "${current}"; pass move:true to move it`,
						{ pin, current },
					);
				this.data.nets[current].pins = this.data.nets[current].pins.filter(
					(p) => p !== pin,
				);
				if (
					this.data.nets[current].pins.length === 0 &&
					!this.data.nets[current].external
				)
					delete this.data.nets[current];
			}
			if (!net.pins.includes(pin)) net.pins.push(pin);
			this.data.noConnect = this.data.noConnect.filter((p) => p !== pin);
		}
		net.pins.sort(comparePins);
		return { net: netName, pins: net.pins };
	}

	disconnect(pinSpecs) {
		for (const spec of pinSpecs) {
			const pin = this.resolvePin(spec);
			const name = this.netOfPin(pin);
			if (!name) continue;
			const net = this.data.nets[name];
			net.pins = net.pins.filter((p) => p !== pin);
			if (net.pins.length === 0 && !net.external) delete this.data.nets[name];
		}
	}

	renameNet(from, to) {
		if (!this.data.nets[from]) fail(`No net "${from}"`);
		if (!NET_NAME.test(to)) fail(`Invalid net name "${to}"`);
		if (this.data.nets[to]) fail(`Net "${to}" already exists`);
		this.data.nets[to] = this.data.nets[from];
		delete this.data.nets[from];
	}

	setNetFlags(name, { power, external }) {
		const net = this.data.nets[name] ?? fail(`No net "${name}"`);
		if (power !== undefined) net.power = Boolean(power);
		if (external !== undefined) net.external = Boolean(external);
	}

	markNoConnect(pinSpec) {
		const pin = this.resolvePin(pinSpec);
		if (this.netOfPin(pin))
			fail(`${pin} is connected to net "${this.netOfPin(pin)}"`);
		if (!this.data.noConnect.includes(pin)) this.data.noConnect.push(pin);
	}

	place(ref, x, y, rot = 0) {
		const part = this.part(ref);
		const num = (v, n) =>
			Number.isFinite(v) && Math.abs(v) < 5000
				? v
				: fail(`${n} must be a finite number within ±5000 mm`);
		if (![0, 90, 180, 270].includes(rot)) fail("rot must be 0, 90, 180 or 270");
		part.at = { x: round(num(x, "x")), y: round(num(y, "y")), rot };
	}

	setBoard(width, height) {
		if (width == null) {
			this.data.board = null;
			return;
		}
		if (!(width >= 5 && width <= 1000 && height >= 5 && height <= 1000))
			fail("Board size must be between 5 and 1000 mm");
		this.data.board = { width: round(width), height: round(height) };
	}

	addTrack({ net, layer = "F.Cu", width = 0.25, points }) {
		if (!this.data.nets[net]) fail(`No net "${net}"`);
		if (!["F.Cu", "B.Cu"].includes(layer))
			fail('layer must be "F.Cu" or "B.Cu"');
		if (!(width >= 0.1 && width <= 5)) fail("width must be 0.1-5 mm");
		if (
			!Array.isArray(points) ||
			points.length < 2 ||
			points.some(
				(p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite),
			)
		)
			fail("points must be [[x,y],[x,y],...] with at least 2 points");
		this.data.tracks.push({
			net,
			layer,
			width,
			points: points.map(([x, y]) => [round(x), round(y)]),
		});
		return this.data.tracks.length - 1;
	}

	addVia({ net, x, y, size = 0.8, drill = 0.4 }) {
		if (!this.data.nets[net]) fail(`No net "${net}"`);
		if (!(drill > 0 && size > drill)) fail("via size must exceed drill");
		this.data.vias.push({ net, x: round(x), y: round(y), size, drill });
	}

	clearRouting() {
		this.data.tracks = [];
		this.data.vias = [];
	}

	removeTrack(index) {
		if (
			!Number.isInteger(index) ||
			index < 0 ||
			index >= this.data.tracks.length
		)
			fail("No such track index");
		this.data.tracks.splice(index, 1);
	}

	addTest(test) {
		if (
			!test ||
			typeof test.name !== "string" ||
			!/^[\w .-]{1,60}$/.test(test.name)
		)
			fail("test.name is required (letters, digits, space, dot, dash)");
		this.data.tests = this.data.tests.filter((t) => t.name !== test.name);
		this.data.tests.push(test);
	}

	summary() {
		const d = this.data;
		return {
			name: d.name,
			title: d.title,
			board: d.board,
			parts: d.parts.map((p) => ({
				ref: p.ref,
				symbol: p.symbol,
				value: p.value,
				footprint: p.footprint,
				at: p.at,
			})),
			nets: Object.fromEntries(
				Object.entries(d.nets).map(([k, n]) => [
					k,
					{
						pins: n.pins,
						power: Boolean(n.power),
						external: Boolean(n.external),
					},
				]),
			),
			noConnect: d.noConnect,
			trackCount: d.tracks.length,
			viaCount: d.vias.length,
			tests: d.tests.map((t) => t.name),
		};
	}
}

export function comparePins(a, b) {
	const [ra, pa] = a.split(".");
	const [rb, pb] = b.split(".");
	return ra === rb
		? pa.localeCompare(pb, undefined, { numeric: true })
		: ra.localeCompare(rb, undefined, { numeric: true });
}

export const round = (v) => Math.round(v * 1000) / 1000;
