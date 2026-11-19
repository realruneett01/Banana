import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { footprintToModelPath } from "../../frontend/src/components/sim3d/stepModels.js";

function extractModuleChunk(filePath, startMarker, endMarker, preamble = "") {
	const src = readFileSync(new URL(filePath, import.meta.url), "utf8");
	const start = src.indexOf(startMarker);
	const end = src.indexOf(endMarker);
	const chunk = `${preamble}\n${src.slice(start, end)}`;
	const base64 = Buffer.from(chunk, "utf8").toString("base64");
	return import(`data:text/javascript;base64,${base64}`);
}

const studioMod = await extractModuleChunk(
	"../../frontend/src/components/sim3d/SimulationStudio.jsx",
	"// --- SIMULATION STUDIO PURE HELPERS START ---",
	"// --- SIMULATION STUDIO PURE HELPERS END ---",
	'const API_BASE_URL = "http://localhost:5000";',
);

const designLoopMod = await extractModuleChunk(
	"../../frontend/src/useDesignLoop.js",
	"export function isCircuitIr",
	"function useStudioState",
);

const { enrichPcbTextWithModels, fetchCurrentPcbText } = studioMod;
const { isCircuitIr, triggerEditorSave } = designLoopMod;

describe("enrichPcbTextWithModels", () => {
	test("injects 3d model path into footprints lacking models", () => {
		const rawPcb = `(kicad_pcb
	(footprint "Resistor_SMD:R_0805_2012Metric"
		(layer "F.Cu")
		(at 10 20)
	)
)`;
		const enriched = enrichPcbTextWithModels(rawPcb, footprintToModelPath);
		assert.match(
			enriched,
			/\(model "\$\{KICAD10_3DMODEL_DIR\}\/Resistor_SMD\.3dshapes\/R_0805_2012Metric\.step"/,
		);
		assert.match(enriched, /\(offset \(xyz 0 0 0\)\)/);
		assert.match(enriched, /\(scale \(xyz 1 1 1\)\)/);
		assert.match(enriched, /\(rotate \(xyz 0 0 0\)\)/);
	});

	test("preserves footprints that already define a 3d model", () => {
		const existingModel = `(kicad_pcb
	(footprint "Resistor_SMD:R_0805_2012Metric"
		(layer "F.Cu")
		(model "custom/resistor.step"
			(offset (xyz 1 2 3))
		)
	)
)`;
		const enriched = enrichPcbTextWithModels(
			existingModel,
			footprintToModelPath,
		);
		assert.equal(enriched, existingModel);
	});

	test("leaves unknown or unresolvable footprints unchanged", () => {
		const unknownPcb = `(kicad_pcb
	(footprint "Custom_Lib_No_Model"
		(layer "F.Cu")
	)
)`;
		const enriched = enrichPcbTextWithModels(unknownPcb, footprintToModelPath);
		assert.equal(enriched, unknownPcb);
	});

	test("handles null, empty or non-string inputs safely", () => {
		assert.equal(enrichPcbTextWithModels(null, footprintToModelPath), null);
		assert.equal(
			enrichPcbTextWithModels(undefined, footprintToModelPath),
			undefined,
		);
		assert.equal(enrichPcbTextWithModels("", footprintToModelPath), "");
	});

	test("enriches multiple footprints in the same board text", () => {
		const multiPcb = `(kicad_pcb
	(footprint "Resistor_SMD:R_0805_2012Metric"
		(at 10 10)
	)
	(footprint "LED_SMD:LED_0805_2012Metric"
		(at 20 20)
	)
	(footprint "Capacitor_SMD:C_0805_2012Metric"
		(at 30 30)
	)
)`;
		const enriched = enrichPcbTextWithModels(multiPcb, footprintToModelPath);
		assert.match(enriched, /Resistor_SMD\.3dshapes\/R_0805_2012Metric\.step/);
		assert.match(enriched, /LED_SMD\.3dshapes\/LED_0805_2012Metric\.step/);
		assert.match(enriched, /Capacitor_SMD\.3dshapes\/C_0805_2012Metric\.step/);
	});
});

describe("fetchCurrentPcbText model enrichment integration", () => {
	test("exports and enriches board text when modelResolver is supplied", async () => {
		const rawPcb = `(kicad_pcb
	(footprint "Resistor_SMD:R_0805_2012Metric"
		(at 5 5)
	)
)`;
		const mockApi = {
			editorExport: async () => ({
				ok: true,
				data: {
					files: { "demo.kicad_pcb": rawPcb },
				},
			}),
		};
		const result = await fetchCurrentPcbText({
			api: mockApi,
			ir: { name: "demo" },
			board: {},
			modelResolver: footprintToModelPath,
		});
		assert.match(result, /Resistor_SMD\.3dshapes\/R_0805_2012Metric\.step/);
	});
});

describe("useDesignLoop helpers", () => {
	test("triggerEditorSave runs safely without DOM", () => {
		assert.doesNotThrow(() => triggerEditorSave());
	});

	test("isCircuitIr validates IR structures correctly", () => {
		assert.equal(isCircuitIr({ parts: [] }), true);
		assert.equal(isCircuitIr({ parts: [{ id: "R1" }] }), true);
		assert.equal(isCircuitIr(null), false);
		assert.equal(isCircuitIr([]), false);
		assert.equal(isCircuitIr({}), false);
	});
});
