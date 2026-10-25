// Generates the calibration boards used by preflight and the tests.
// Usage: node gen-sample.mjs <outDir>
import fs from "node:fs";
import path from "node:path";

export function sampleBoard({
	r1x = 110,
	trackEndX = 120,
	extraTrack = false,
} = {}) {
	return `(kicad_pcb (version 20221018) (generator banana_sample)
  (general (thickness 1.6))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (44 "Edge.Cuts" user)
    (46 "B.CrtYd" user "B.Courtyard")
    (47 "F.CrtYd" user "F.Courtyard")
  )
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "VCC")
  (net 2 "GND")
  (gr_rect (start 100 100) (end 140 130) (layer "Edge.Cuts") (width 0.1) (fill none))
  (footprint "Resistor_SMD:R_0805" (layer "F.Cu") (at ${r1x} 110)
    (fp_text reference "R1" (at 0 -1.7) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (fp_text value "10k" (at 0 1.7) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
    (fp_rect (start -1.7 -1) (end 1.7 1) (layer "F.CrtYd") (width 0.05) (fill none))
    (pad "1" smd roundrect (at -0.95 0) (size 1 1.45) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "VCC"))
    (pad "2" smd roundrect (at 0.95 0) (size 1 1.45) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "GND"))
  )
  (footprint "Resistor_SMD:R_0805" (layer "F.Cu") (at 125 110)
    (fp_text reference "R2" (at 0 -1.7) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (fp_text value "1k" (at 0 1.7) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
    (fp_rect (start -1.7 -1) (end 1.7 1) (layer "F.CrtYd") (width 0.05) (fill none))
    (pad "1" smd roundrect (at -0.95 0) (size 1 1.45) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "VCC"))
    (pad "2" smd roundrect (at 0.95 0) (size 1 1.45) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "GND"))
  )
  (segment (start ${r1x + 0.95} 110) (end ${trackEndX} 110) (width 0.25) (layer "F.Cu") (net 2))
  (segment (start 124.05 110) (end 124.05 118) (width 0.25) (layer "F.Cu") (net 1))${
		extraTrack
			? `
  (segment (start 105 120) (end 135 120) (width 0.4) (layer "B.Cu") (net 2))`
			: ""
	}
)
`;
}

export function sampleSchematic({ value = "10k" } = {}) {
	return `(kicad_sch (version 20230121) (generator banana_sample)
  (uuid 11111111-2222-3333-4444-555555555555)
  (paper "A4")
  (lib_symbols
    (symbol "Device:R" (pin_numbers hide) (pin_names (offset 0)) (in_bom yes) (on_board yes)
      (property "Reference" "R" (at 2.032 0 90) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 0 90) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1"
        (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default)) (fill (type none))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27))))))
    )
  )
  (symbol (lib_id "Device:R") (at 100 100 0) (unit 1) (in_bom yes) (on_board yes) (dnp no)
    (uuid 66666666-7777-8888-9999-000000000000)
    (property "Reference" "R1" (at 102 100 90) (effects (font (size 1.27 1.27))))
    (property "Value" "${value}" (at 98 100 90) (effects (font (size 1.27 1.27))))
    (pin "1" (uuid aaaaaaaa-bbbb-cccc-dddd-000000000001))
    (pin "2" (uuid aaaaaaaa-bbbb-cccc-dddd-000000000002))
  )
  (wire (pts (xy 100 103.81) (xy 100 110)) (stroke (width 0) (type default)) (uuid 12121212-3434-5656-7878-909090909090))
)
`;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) ===
		path.resolve(new URL(import.meta.url).pathname)
) {
	const out = path.resolve(process.argv[2] || ".");
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, "base.kicad_pcb"), sampleBoard());
	fs.writeFileSync(
		path.join(out, "target.kicad_pcb"),
		sampleBoard({ r1x: 112, trackEndX: 122, extraTrack: true }),
	);
	fs.writeFileSync(path.join(out, "base.kicad_sch"), sampleSchematic());
	fs.writeFileSync(
		path.join(out, "target.kicad_sch"),
		sampleSchematic({ value: "22k" }),
	);
}
