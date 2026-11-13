import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { applyPcbEdits } from "../../backend/src/engine/kicad-pcb-edit.js";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { createKicadValidator } from "../../backend/src/engine/kicad-validate.js";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

// Real KiCad 10 demos: pic_programmer is saved in the KiCad 10 format (nets
// named inline, no net table); ecc83 is KiCad 9 format (numbered net table).
const DEMOS = "C:/Program Files/KiCad/10.0/share/kicad/demos";
const PIC = `${DEMOS}/pic_programmer/pic_programmer.kicad_pcb`;
const ECC = `${DEMOS}/ecc83/ecc83-pp.kicad_pcb`;
const HAVE_DEMOS = fs.existsSync(PIC) && fs.existsSync(ECC);

function parseBoard(text) {
	const res = kicadPcbToIr(text);
	assert.equal(res.ok, true);
	return { text, ir: res.ir, board: res.board };
}

function netNamed(ir, name) {
	const net = ir.nets.find((n) => n.name === name);
	assert.ok(net, `net ${name} exists`);
	return net;
}

function editedBoard(board, netId) {
	const [deleted, ...kept] = board.tracks;
	const added = {
		netId,
		layer: "B.Cu",
		start: [10, 10],
		end: [12.5, 10],
		widthMm: 0.4,
	};
	const via = { netId, at: [12.5, 10], drillMm: 0.3, sizeMm: 0.6 };
	return {
		deleted,
		after: { ...board, tracks: [...kept, added], vias: [...board.vias, via] },
	};
}

function blockWith(text, needle) {
	const at = text.indexOf(needle);
	assert.notEqual(at, -1, `missing ${needle}`);
	return text.slice(at, text.indexOf("(uuid", at));
}

async function assertKicadOpens(text) {
	const res = await createKicadValidator({ logger: { warn() {} } })(
		"pcb",
		text,
	);
	assert.equal(res.ok, true, res.detail);
}

function connectPin(ir, netName, pin) {
	const nets = ir.nets.map((n) =>
		n.name === netName ? { ...n, pins: [...n.pins, pin] } : n,
	);
	return { ...ir, nets };
}

function partByRef(ir, ref) {
	const part = ir.parts.find((p) => p.ref === ref);
	assert.ok(part, `part ${ref} exists`);
	return part;
}

function roundTrip(file, netName, afterIrOf = (ir) => ir) {
	const { text, ir, board } = parseBoard(fs.readFileSync(file, "utf8"));
	const { deleted, after } = editedBoard(board, netNamed(ir, netName).id);
	assert.ok(deleted.uuid, "imported tracks carry their uuid");
	const edits = editsFromIrChange(ir, afterIrOf(ir), { before: board, after });
	assert.deepEqual(edits.unsupported, []);
	const res = applyPcbEdits(text, edits.pcb);
	assert.equal(res.ok, true, res.error);
	assert.ok(!res.text.includes(deleted.uuid), "deleted track is gone");
	return { edits, text: res.text };
}

function reimported(text, netName) {
	const { ir, board } = parseBoard(text);
	const netId = netNamed(ir, netName).id;
	const seg = board.tracks.find((t) => t.start[0] === 10 && t.end[0] === 12.5);
	const via = board.vias.find((v) => v.at[0] === 12.5 && v.at[1] === 10);
	return { ir, netId, seg, via };
}

describe("PCB track edits round-trip through a real KiCad board", {
	skip: HAVE_DEMOS ? false : "KiCad 10 demos are not installed",
}, () => {
	test("KiCad 10 board: track, via and pad net use inline net names", async () => {
		const addShield = (ir) =>
			connectPin(ir, "GND", { partId: partByRef(ir, "J1").id, pin: "SH" });
		const { edits, text } = roundTrip(PIC, "GND", addShield);
		const ops = edits.pcb.map((e) => e.op).sort();
		assert.deepEqual(ops, ["addTrack", "addVia", "deleteTrack", "setPadNet"]);
		assert.match(blockWith(text, "(start 10 10)"), /\(net "GND"\)/);
		assert.match(blockWith(text, "(at 12.5 10)"), /\(drill 0\.3\)/);
		assert.match(blockWith(text, "(at 12.5 10)"), /\(net "GND"\)/);
		assert.doesNotMatch(text, /\(net \d+/, "no numbered nets in a v10 file");
		const back = reimported(text, "GND");
		assert.equal(back.seg?.netId, back.netId);
		assert.equal(back.seg?.layer, "B.Cu");
		assert.equal(back.seg?.widthMm, 0.4);
		assert.equal(back.via?.netId, back.netId);
		const j1 = partByRef(back.ir, "J1").id;
		const gnd = back.ir.nets.find((n) => n.id === back.netId);
		assert.ok(gnd.pins.some((p) => p.partId === j1 && p.pin === "SH"));
		await assertKicadOpens(text);
	});

	test("KiCad 9 board: track and via use the numbered net table", async () => {
		const { edits, text } = roundTrip(ECC, "GND");
		const ops = edits.pcb.map((e) => e.op).sort();
		assert.deepEqual(ops, ["addTrack", "addVia", "deleteTrack"]);
		const gndNum = /\(net (\d+) "GND"\)/.exec(text)?.[1];
		assert.ok(gndNum, "GND keeps its net table entry");
		const netRe = new RegExp(`\\(net ${gndNum}\\)`);
		assert.match(blockWith(text, "(start 10 10)"), netRe);
		assert.match(blockWith(text, "(at 12.5 10)"), netRe);
		const back = reimported(text, "GND");
		assert.equal(back.seg?.netId, back.netId);
		assert.equal(back.via?.netId, back.netId);
		await assertKicadOpens(text);
	});
});

describe("via removal mapping", () => {
	const via = { netId: "", at: [1, 2], drillMm: 0.3, sizeMm: 0.6 };
	const boards = (removed) => ({
		before: { vias: [removed] },
		after: { vias: [] },
	});
	const ir = { parts: [], nets: [] };

	test("a removed via with a uuid maps to deleteTrack", () => {
		const res = editsFromIrChange(ir, ir, boards({ ...via, uuid: "v-1" }));
		assert.deepEqual(res.pcb, [{ op: "deleteTrack", uuid: "v-1" }]);
		assert.equal(res.summary, "1 via will be saved");
	});

	test("a removed via without a uuid cannot be saved", () => {
		const res = editsFromIrChange(ir, ir, boards(via));
		assert.deepEqual(res.unsupported, ["a via was removed"]);
		assert.equal(res.canSaveInPlace, false);
	});
});

describe("unconnected track in a KiCad 10 board", {
	skip: HAVE_DEMOS ? false : "KiCad 10 demos are not installed",
}, () => {
	test("omits the net instead of writing a net number", async () => {
		const edit = {
			op: "addTrack",
			layer: "F.Cu",
			width: 0.25,
			points: [
				{ x: 5, y: 5 },
				{ x: 6, y: 5 },
			],
			net: 0,
		};
		const res = applyPcbEdits(fs.readFileSync(PIC, "utf8"), [edit]);
		assert.equal(res.ok, true, res.error);
		assert.doesNotMatch(blockWith(res.text, "(start 5 5)"), /\(net/);
		await assertKicadOpens(res.text);
	});
});
