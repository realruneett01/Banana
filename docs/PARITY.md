# KiCad parity matrix

Banana Studio aims to cover what KiCad does, then go beyond it. This page is the honest scorecard. A row is **done** only when a test in this repository proves it; **partial** says exactly what is missing; **not yet** is not started. Nothing here is a promise of a date.

The approach: where KiCad already has a headless engine (`kicad-cli`, `pcbnew` Python) Banana delegates to it, so results are KiCad's own on every version. Interactive editing that KiCad only offers in its GUI is rebuilt natively, one gated step at a time.

Legend: **Tier A** = delegated to KiCad's engine · **Tier B** = native interactive editing in Banana · **Tier C** = goes beyond KiCad.

## Schematic

| Capability | Status | Tier | Notes and proof |
|---|---|---|---|
| Place library symbols | partial | B | By assistant, tool call or the Parts panel; placement is automatic and tidy, not hand-dragged. `tests/31-schematic.test.js` |
| Wires, junctions, labels, power symbols | done (generated) | B | Orthogonal wires on the 1.27 mm grid, no accidental contact, label fallback per net. 270 generated circuits checked by an independent extractor and by KiCad's netlister (`tests/31-schematic.test.js`). **Drawing wires by hand: not yet.** |
| Hierarchical sheets, multi-sheet | not yet | B | One sheet per design. |
| Buses | not yet | B | |
| Symbol editor | not yet | B | Library symbols are used as they are. |
| Annotation | done | B | References are assigned automatically. `tests/21-design-model.test.js` |
| ERC | partial | A | Banana's own rules on every version; KiCad ERC through the CLI only where the installed `kicad-cli` has it (8 and newer); the suite passed in the 8.0, 9.0, 10.0 and nightly CI containers. |
| Netlist export | done | A | `tests/34-exports.test.js` |
| BOM | done | B | Grouped CSV from the design. `tests/34-exports.test.js` |
| Library tables / custom libraries | not yet | A | KiCad's installed libraries are searched and used; project-local libraries are not. |

## Board

| Capability | Status | Tier | Notes and proof |
|---|---|---|---|
| Footprint placement | done | B | Drag on a 0.5 mm grid, rotate by 90°, edit position numerically; automatic connectivity-aware layout for unplaced parts. `tests/28-layout.test.js`, `tests/33-studio-e2e.test.js` |
| Interactive router (push and shove) | not yet | B | |
| Autorouter | partial | B | Banana's own two-layer grid router with vias and 45° corners, judged by KiCad's DRC on generated boards (`tests/25-routing-drc.test.js`, `tests/29-tidy.test.js`). Dense boards may not complete; failures are reported, never hidden. |
| Copper pours / zones | partial | A | One whole-board pour per layer, filled by KiCad's own zone filler, with vias from far-side pads; KiCad's DRC judges the result (`tests/36-zones.test.js`). **Custom shapes, keepouts, thermal settings, several nets per layer: not yet.** Needs KiCad's Python module to fill. |
| Differential pairs, length tuning | not yet | B | |
| Layers | partial | | Two copper layers. No inner layers. |
| Board outline | partial | | Rectangle only. |
| Back-side parts | not yet | B | All parts go on the front. |
| Vias | partial | B | Through vias only. |
| Silkscreen / graphics | partial | B | Reference, value and a project title; no free-hand drawing or text. |
| DRC | done | A | KiCad's DRC: through `pcbnew` Python on KiCad 7, CLI on versions that have it. `tests/25-routing-drc.test.js` |
| Footprint editor | not yet | B | |
| 3D viewer | not yet | A | `kicad-cli pcb render` exists on KiCad 8+ and is detected, but is not wired up. |

## Fabrication and documentation

| Capability | Status | Tier | Notes and proof |
|---|---|---|---|
| Gerbers + drill files | done | A | Fabrication layer set, zipped. `tests/34-exports.test.js` (headers, outline size, drill hits checked against the design) |
| Pick-and-place | done | A | `tests/34-exports.test.js` |
| Board and schematic PDF | done | A | |
| STEP | partial | A | Board only: library 3D models are not attached to generated footprints yet. |
| SVG plots | done | A | Banana's own views and diff renders. `tests/27-views.test.js` |
| Manufacturing checks (DFM) | done | C | Typical low-cost limits (standard / budget / fine). Not a specific manufacturer's promise. `tests/35-dfm.test.js` |

## Simulation, scripting, version control

| Capability | Status | Tier | Notes and proof |
|---|---|---|---|
| Analog simulation | partial | C | ngspice with Banana's test runner and pass/fail expectations; parts need a SPICE model. `tests/23-simulation.test.js` |
| Scripting | partial | C | MCP server (stdio and HTTP) and REST, 18 tools. `tests/24-mcp.test.js` |
| Version control | done | C | Every build is a git commit; compare any two, time travel, undo/redo that never rewrites history. `tests/32-agent.test.js`, `tests/33-studio-e2e.test.js` |

## Beyond KiCad (Tier C)

| Feature | Status | Notes and proof |
|---|---|---|
| Visual diff of any two builds with KiCad's own rendering (yellow changed, green added, red deleted, grey unchanged) | done | Identical in the Diff view and in Studio's Changes view. `tests/30-baseline-diff-view.test.js`, `tests/33-studio-e2e.test.js` |
| AI assistant that edits the board inside Banana, checks it, and saves one undoable step per prompt | done | Gemini function-calling over Banana's own tools; scripted-model tests only. **Not run against live Gemini here.** `tests/32-agent.test.js` |
| One-click health report | done | ERC, netlist parity, placement, clearance, routing, DRC in one panel. |
| Live board while the assistant works | done | The files are refreshed after every change so the Studio can redraw. |
| Design review mode, supply-chain and cost data, real-time collaboration, constraint manager, variants | not yet | |

## KiCad versions

| Version | Status |
|---|---|
| 7.0.x | Full test suite run (Linux, 7.0.11). |
| 8.0.9, 9.0.9, 10.0.7, nightly (10.0.0) | The code adapts to what the installed `kicad-cli` offers by reading its own help output (`backend/src/kicad-compat.js`; tested against real 7.0.11 help text and parts of the real 8.0.9 help text). The full suite, preflight included, ran green in the matching `kicad/kicad:<version>` containers on CI run 25. Differences found and handled on the way: tab-indented libraries, multi-line netlists, `extends` chains, footprint text dialect, `--mode-multi` only from KiCad 9, a tighter SVG crop on KiCad 10. |
| macOS (KiCad 10.0.x), Windows (Chocolatey KiCad), Linux x64/ARM64 (distro KiCad) | Green on CI runs 25 and 26 (see the README table). |
