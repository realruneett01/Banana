const REGULATOR_KEYWORDS = ["ldo", "7805", "lm317", "ams1117", "regulator"];
const OPAMP_KEYWORDS = [
	"opamp",
	"op-amp",
	"lm358",
	"tl072",
	"lm741",
	"mcp6002",
];
const MCU_KEYWORDS = ["mcu", "atmega", "stm32", "esp32", "rp2040", "pic"];

function hasKeyword(text, keywords) {
	return keywords.some((kw) => text.includes(kw));
}

function getSearchableText(part) {
	const texts = [part.value, part.footprint];
	if (part.props && typeof part.props === "object") {
		for (const val of Object.values(part.props)) {
			if (typeof val === "string") {
				texts.push(val);
			}
		}
	}
	return texts.filter(Boolean).join(" ").toLowerCase();
}

function isRegulator(text, props) {
	if (props?.vout !== undefined) {
		return true;
	}
	if (/78\d{2}|78xx/i.test(text)) {
		return true;
	}
	return hasKeyword(text, REGULATOR_KEYWORDS);
}

function isOpamp(text) {
	return hasKeyword(text, OPAMP_KEYWORDS);
}

function isMcu(text, props) {
	if (props?.supplyCurrent !== undefined) {
		return true;
	}
	return hasKeyword(text, MCU_KEYWORDS);
}

function parseVoutFromText(text) {
	const m78 = text.match(/\b78(\d{2})\b/i);
	if (m78) {
		return Number.parseFloat(m78[1]);
	}
	const m1117 = text.match(/1117[-_](\d+(?:\.\d+)?)/i);
	if (m1117) {
		return Number.parseFloat(m1117[1]);
	}
	const mV = text.match(/(\d+)[vV](\d+)/);
	if (mV) {
		return Number.parseFloat(`${mV[1]}.${mV[2]}`);
	}
	const mVolt = text.match(/(\d+(?:\.\d+)?)\s*v\b/i);
	if (mVolt) {
		return Number.parseFloat(mVolt[1]);
	}
	return Number.NaN;
}

function extractVout(part) {
	if (part.props?.vout !== undefined) {
		const raw = part.props.vout;
		const num = typeof raw === "number" ? raw : parseVoutFromText(String(raw));
		if (Number.isFinite(num) && num > 0) {
			return num;
		}
	}
	const fromText = parseVoutFromText(String(part.value || ""));
	if (Number.isFinite(fromText) && fromText > 0) {
		return fromText;
	}
	return 3.3;
}

function extractDropout(props) {
	if (props?.dropout !== undefined) {
		const d = Number(props.dropout);
		if (Number.isFinite(d) && d >= 0) {
			return d;
		}
	}
	return 1.1;
}

function extractSupplyCurrent(props) {
	if (props?.supplyCurrent !== undefined) {
		const sc = Number(props.supplyCurrent);
		if (Number.isFinite(sc) && sc > 0) {
			return sc;
		}
	}
	return 0.02;
}

function getRegulatorPinRoles(props) {
	const pr = props?.pinRoles || {};
	return {
		in: String(pr.in ?? pr.vin ?? "1"),
		gnd: String(pr.gnd ?? pr.ground ?? "2"),
		out: String(pr.out ?? pr.vout ?? "3"),
	};
}

function getOpampPinRoles(props) {
	const pr = props?.pinRoles || {};
	return {
		inp: String(pr.inp ?? pr.in_pos ?? "3"),
		inn: String(pr.inn ?? pr.in_neg ?? "2"),
		out: String(pr.out ?? "1"),
		vcc: String(pr.vcc ?? pr.vpos ?? "8"),
		vee: String(pr.vee ?? pr.vneg ?? pr.gnd ?? "4"),
	};
}

function getMcuPinRoles(props) {
	const pr = props?.pinRoles || {};
	return {
		supply: String(pr.supply ?? pr.vcc ?? "VCC"),
		gnd: String(pr.gnd ?? pr.ground ?? "GND"),
	};
}

function buildRegulator(nodes, name, params) {
	const vout = Number(params?.vout ?? 3.3).toString();
	const dropout = Number(params?.dropout ?? 1.1).toString();
	const nIn = nodes.in ?? nodes.vin;
	const nGnd = nodes.gnd ?? nodes.ground;
	const nOut = nodes.out ?? nodes.vout;
	const intNode = `n_${name}_int`;
	return [
		`B_${name} ${intNode} ${nGnd} V=min(${vout}, V(${nIn}, ${nGnd}) - ${dropout})`,
		`R_${name}_out ${intNode} ${nOut} 0.1`,
		`I_${name}_q ${nIn} ${nGnd} 0.005`,
	];
}

function buildOpamp(nodes, name) {
	const nInp = nodes.inp ?? nodes.in_pos;
	const nInn = nodes.inn ?? nodes.in_neg;
	const nVcc = nodes.vcc ?? nodes.vpos;
	const nVee = nodes.vee ?? nodes.vneg;
	const nOut = nodes.out;
	return [
		`R_${name}_in ${nInp} ${nInn} 1000000`,
		`B_${name} ${nOut} 0 V=min(V(${nVcc}), max(V(${nVee}), 100000 * (V(${nInp}, ${nInn}))))`,
	];
}

function buildMcu(nodes, name, params) {
	const i = Number(params?.supplyCurrent ?? 0.02).toString();
	const nSupply = nodes.supply ?? nodes.vcc;
	const nGnd = nodes.gnd ?? nodes.ground;
	return [`I_${name} ${nSupply} ${nGnd} ${i}`];
}

function createRegulatorModel(part, props) {
	const params = { vout: extractVout(part), dropout: extractDropout(props) };
	return {
		kind: "regulator",
		pinRoles: getRegulatorPinRoles(props),
		params,
		build: (nodes, name, p) => buildRegulator(nodes, name, p ?? params),
	};
}

function createOpampModel(props) {
	return {
		kind: "opamp",
		pinRoles: getOpampPinRoles(props),
		params: { gain: 100000, rin: 1000000 },
		build: (nodes, name) => buildOpamp(nodes, name),
	};
}

function createMcuModel(props) {
	const params = { supplyCurrent: extractSupplyCurrent(props) };
	return {
		kind: "mcu",
		pinRoles: getMcuPinRoles(props),
		params,
		build: (nodes, name, p) => buildMcu(nodes, name, p ?? params),
	};
}

export function modelForPart(part) {
	if (!part || typeof part !== "object") {
		return null;
	}
	const text = getSearchableText(part);
	const props = part.props || {};
	if (isRegulator(text, props)) {
		return createRegulatorModel(part, props);
	}
	if (isOpamp(text)) {
		return createOpampModel(props);
	}
	if (isMcu(text, props)) {
		return createMcuModel(props);
	}
	return null;
}
