import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { irToSpice } from "../../backend/src/engine/spice/ir-to-spice.js";
import { createNgspice } from "../../backend/src/engine/spice/ngspice-runner.js";

const runner = createNgspice();
const hasNgspice = await runner.available();
const skipOption = hasNgspice ? false : "ngspice not installed";

function makePart(ref, value, overrides = {}) {
	return {
		id: newId("part"),
		ref,
		value,
		symbol: `Device:${ref.replace(/\d+$/, "")}`,
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		...overrides,
	};
}

function makeNet(name, pins = []) {
	return {
		id: newId("net"),
		name,
		pins,
	};
}

function pin(partId, p) {
	return { partId, pin: p };
}

function makeIR(parts, nets, name = "TestCircuit") {
	return {
		schemaVersion: 1,
		name,
		parts,
		nets,
		constraints: [],
	};
}

function getPlotVariable(plot, varName) {
	const lower = varName.toLowerCase();
	const variable = plot?.variables?.find((v) => v.name.toLowerCase() === lower);
	if (!variable) return null;
	return plot.points?.[0]?.[variable.index] ?? null;
}

function extractCurrent(plot, candidates) {
	for (const candidate of candidates) {
		const val = getPlotVariable(plot, candidate);
		if (val !== null) return Math.abs(val);
	}
	return null;
}

async function simulateIR(parts, nets, name) {
	const spiceRes = irToSpice(makeIR(parts, nets, name));
	assert.equal(spiceRes.ok, true);
	const simRes = await runner.run(spiceRes.netlist);
	assert.equal(simRes.ok, true);
	return { spiceRes, simRes };
}

/** Simulates source V1 -> resistor R1 -> load -> GND; pins are the load's [in, out]. */
async function simulateSeries({
	volts,
	ohms,
	load,
	pins: [loadIn, loadOut],
	name,
}) {
	const v1 = makePart("V1", volts, { props: { voltage: volts } });
	const r1 = makePart("R1", ohms);
	const netIn = makeNet("in", [pin(v1.id, "1"), pin(r1.id, "1")]);
	const netMid = makeNet("mid", [pin(r1.id, "2"), pin(load.id, loadIn)]);
	const netGnd = makeNet("GND", [pin(v1.id, "2"), pin(load.id, loadOut)]);
	const sim = await simulateIR([v1, r1, load], [netIn, netMid, netGnd], name);
	return { ...sim, netMid, v1, r1 };
}

const realOpts = { skip: skipOption, timeout: 20000 };

describe("ngspice real integration", () => {
	test(
		"solves resistor divider midpoint within 1 percent of 5 V",
		realOpts,
		async () => {
			const { spiceRes, simRes, netMid } = await simulateSeries({
				volts: "10V",
				ohms: "1k",
				load: makePart("R2", "1k"),
				pins: ["1", "2"],
				name: "ResistorDivider",
			});

			const midNode = spiceRes.nodeMap[netMid.id];
			const vMid = getPlotVariable(simRes.plots[0], `v(${midNode})`);
			assert.notEqual(vMid, null);
			const percentDiff = (Math.abs(vMid - 5.0) / 5.0) * 100;
			assert.ok(
				percentDiff <= 1.0,
				`Midpoint voltage ${vMid} V is not within 1% of 5 V`,
			);
		},
	);

	test(
		"LED with series resistor draws current between 1 mA and 30 mA",
		realOpts,
		async () => {
			const led = makePart("LED1", "Red", {
				symbol: "Device:LED",
				footprint: "LED_SMD:LED_0805_2012Metric",
			});
			const { spiceRes, simRes, v1, r1 } = await simulateSeries({
				volts: "5V",
				ohms: "220",
				load: led,
				pins: ["A", "K"],
				name: "LedCircuit",
			});

			const ledElem = spiceRes.elementMap[led.id] || "DLED1";
			const rElem = spiceRes.elementMap[r1.id] || "R1";
			const vElem = spiceRes.elementMap[v1.id] || "V1";
			const current = extractCurrent(simRes.plots[0], [
				`@${ledElem.toLowerCase()}[id]`,
				`@${rElem.toLowerCase()}[i]`,
				`i(${vElem.toLowerCase()})`,
				`${vElem.toLowerCase()}#branch`,
			]);
			assert.notEqual(
				current,
				null,
				"Current variable not found in simulation output",
			);
			assert.ok(current >= 0.001, `Current ${current} A is below 1 mA`);
			assert.ok(current <= 0.03, `Current ${current} A is above 30 mA`);
		},
	);

	test(
		"netlist containing .control or shell line is rejected by safety guard before ngspice starts",
		realOpts,
		async () => {
			const maliciousNetlists = [
				"* Malicious control directive\n.control\necho bad\n.endc\n.end",
				"* Malicious shell directive\nshell echo bad\n.end",
			];
			for (const netlist of maliciousNetlists) {
				const res = await runner.run(netlist);
				assert.equal(res.ok, false);
				assert.equal(res.log, "");
				assert.match(res.error, /forbidden/i);
			}
		},
	);
});
