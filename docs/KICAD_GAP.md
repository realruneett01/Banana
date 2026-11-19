Audited 2026-11-17

- Library browser: 2 done, 2 partial, 2 missing
- Schematic editor: 9 done, 8 partial, 5 missing
- PCB editor: 6 done, 10 partial, 4 missing
- Canvas look and feel: 5 done, 3 partial, 2 missing
- Total: 22 done, 23 partial, 13 missing

## Library browser

GAP | Library browser | library tree by library name | done | frontend/src/editor/LibraryTree.jsx:34 | frontend/src/editor/LibraryBrowser.jsx, frontend/src/editor/LibraryTree.jsx | M
GAP | Library browser | lazy expand | done | frontend/src/editor/LibraryTree.jsx:121 | frontend/src/editor/LibraryBrowser.jsx, frontend/src/editor/LibraryTree.jsx, backend/src/engine/kicad-library.js | M
GAP | Library browser | fuzzy search | partial | backend/src/engine/kicad-library.js:556 | backend/src/engine/kicad-library.js | S
GAP | Library browser | symbol unit and de Morgan preview | missing | backend/src/engine/kicad-library.js:438 | frontend/src/editor/LibraryBrowser.jsx, backend/src/engine/kicad-library.js | M
GAP | Library browser | footprint preview with pads and courtyard | partial | frontend/src/editor/LibraryBrowser.jsx:218 | frontend/src/editor/LibraryBrowser.jsx, frontend/src/editor/footprintRender.js | S
GAP | Library browser | 3D model preview | missing | frontend/src/editor/LibraryBrowser.jsx:5 | frontend/src/editor/LibraryBrowser.jsx, backend/src/engine/kicad-library.js | L

## Schematic editor

GAP | Schematic editor | wire | done | frontend/src/editor/SchematicCanvas.jsx:735 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/schematicGeometry.js, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | bus | partial | backend/src/engine/kicad-sch-to-ir.js:425 | frontend/src/editor/SchematicCanvas.jsx, backend/src/engine/circuit-ir.js, backend/src/engine/kicad-sch-to-ir.js | L
GAP | Schematic editor | bus entry | missing | frontend/src/editor/SchematicCanvas.jsx:13 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/schematicGeometry.js | M
GAP | Schematic editor | junction | partial | frontend/src/editor/junctions.js:62 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/junctions.js | M
GAP | Schematic editor | no-connect | partial | backend/src/engine/kicad-sch-to-ir.js:428 | frontend/src/editor/SchematicCanvas.jsx, backend/src/engine/circuit-ir.js, backend/src/engine/erc.js | S
GAP | Schematic editor | local/global/hierarchical labels | partial | backend/src/engine/kicad-sch-to-ir.js:6 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js, backend/src/engine/circuit-ir.js | M
GAP | Schematic editor | power symbols | partial | backend/src/engine/kicad-sch-to-ir.js:667 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/SchematicCanvas.jsx, backend/src/engine/kicad-sch-to-ir.js | S
GAP | Schematic editor | sheets and hierarchy | partial | backend/src/engine/erc-project.js:1 | backend/src/engine/circuit-ir.js, backend/src/engine/erc-project.js, backend/src/engine/kicad-sch-to-ir.js | L
GAP | Schematic editor | text | missing | frontend/src/editor/SchematicCanvas.jsx:583 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js, backend/src/engine/circuit-ir.js | M
GAP | Schematic editor | graphic lines | missing | frontend/src/editor/SchematicCanvas.jsx:13 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js, backend/src/engine/circuit-ir.js | M
GAP | Schematic editor | rotate | done | frontend/src/editor/SchematicCanvas.jsx:630 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | mirror X/Y | done | frontend/src/editor/SchematicCanvas.jsx:639 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/symbolRender.js, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | move | done | frontend/src/editor/SchematicCanvas.jsx:683 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | drag | partial | frontend/src/editor/SchematicCanvas.jsx:683 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/schematicGeometry.js | M
GAP | Schematic editor | duplicate | missing | frontend/src/editor/hotkeys.js:20 | frontend/src/editor/editorModel.js, frontend/src/editor/SchematicCanvas.jsx | S
GAP | Schematic editor | align | missing | frontend/src/editor/SchematicCanvas.jsx:711 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | field editing | done | frontend/src/editor/PropertiesPanel.jsx:129 | frontend/src/editor/PropertiesPanel.jsx, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | annotation | done | frontend/src/editor/annotate.js:80 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/annotate.js, frontend/src/editor/editorModel.js | M
GAP | Schematic editor | ERC | done | backend/src/engine/erc.js:21 | backend/src/engine/erc.js, frontend/src/editor/useLiveChecks.js, frontend/src/editor/SchematicCanvas.jsx | M
GAP | Schematic editor | netlist | done | backend/src/engine/ir-exports.js:165 | frontend/src/editor/EditorScreen.jsx, backend/src/engine/ir-exports.js, backend/src/routes/editor-routes.js | S
GAP | Schematic editor | BOM | done | backend/src/engine/ir-exports.js:73 | frontend/src/editor/EditorScreen.jsx, backend/src/engine/ir-exports.js, backend/src/routes/editor-routes.js | S
GAP | Schematic editor | hotkeys W B L H P Q R X Y M G E D Del Ctrl+Z | partial | frontend/src/editor/SchematicCanvas.jsx:711 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/hotkeys.js | M

## PCB editor

GAP | PCB editor | tracks | done | frontend/src/editor/PcbCanvas.jsx:493 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js, frontend/src/editor/routingModel.js | S
GAP | PCB editor | interactive router push and shove | missing | frontend/src/editor/routingModel.js:285 | frontend/src/editor/routingModel.js, frontend/src/editor/PcbCanvas.jsx | L
GAP | PCB editor | differential pairs | missing | frontend/src/editor/hotkeys.js:37 | frontend/src/editor/routingModel.js, frontend/src/editor/PcbCanvas.jsx, backend/src/engine/circuit-ir.js | L
GAP | PCB editor | length tuning | missing | frontend/src/editor/pcbGeometry.js:115 | frontend/src/editor/routingModel.js, frontend/src/editor/PcbCanvas.jsx | M
GAP | PCB editor | vias | done | frontend/src/editor/PcbCanvas.jsx:521 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/routingModel.js | S
GAP | PCB editor | layer switching | done | frontend/src/editor/PcbCanvas.jsx:1165 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js | S
GAP | PCB editor | layer manager | partial | frontend/src/editor/PcbCanvas.jsx:2084 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/layers.js | M
GAP | PCB editor | zones and fill | partial | frontend/src/editor/zoneModel.js:49 | frontend/src/editor/zoneModel.js, frontend/src/editor/BoardTools.jsx, frontend/src/editor/PcbCanvas.jsx | L
GAP | PCB editor | keepouts | partial | frontend/src/editor/BoardTools.jsx:212 | frontend/src/editor/zoneModel.js, frontend/src/editor/BoardTools.jsx | S
GAP | PCB editor | board outline Edge.Cuts | done | frontend/src/editor/boardOutline.js:1 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/boardOutline.js, frontend/src/editor/pcbGeometry.js | M
GAP | PCB editor | footprint placement | done | frontend/src/editor/PcbCanvas.jsx:936 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/footprintRender.js | S
GAP | PCB editor | ratsnest | done | frontend/src/editor/ratsnest.js:1 | frontend/src/editor/ratsnest.js, frontend/src/editor/pcbGeometry.js, frontend/src/editor/PcbCanvas.jsx | S
GAP | PCB editor | DRC | partial | backend/src/engine/drc-lite.js:4 | backend/src/engine/drc-lite.js, frontend/src/editor/useLiveChecks.js, frontend/src/editor/PcbCanvas.jsx | M
GAP | PCB editor | net classes | partial | backend/src/kicad-pcb-parser.js:716 | backend/src/engine/circuit-ir.js, backend/src/kicad-pcb-parser.js, frontend/src/editor/routingModel.js | M
GAP | PCB editor | design rules editor | missing | backend/src/engine/drc-lite.js:4 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/routingModel.js, backend/src/engine/drc-lite.js | M
GAP | PCB editor | text | partial | backend/src/engine/kicad-pcb-to-ir.js:864 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js, backend/src/engine/kicad-pcb-writer.js | M
GAP | PCB editor | dimensions | partial | backend/src/engine/kicad-pcb-to-ir.js:860 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js | M
GAP | PCB editor | 3D viewer | partial | frontend/src/components/sim3d/Board3DScene.jsx:1 | frontend/src/editor/EditorScreen.jsx, frontend/src/components/sim3d/Board3DScene.jsx | M
GAP | PCB editor | Gerber/drill export | partial | backend/src/engine/kicad-cli.js:190 | backend/src/engine/kicad-cli.js, backend/src/routes/editor-routes.js, frontend/src/editor/EditorScreen.jsx | L
GAP | PCB editor | hotkeys X V D U E F R M | partial | frontend/src/editor/PcbCanvas.jsx:303 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/hotkeys.js | S

## Canvas look and feel

GAP | Canvas look and feel | KiCad default colour theme | done | frontend/src/editor/theme.js:1 | frontend/src/editor/theme.js, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | dot and line grid | partial | frontend/src/editor/SchematicCanvas.jsx:212 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | grid size selector | done | frontend/src/editor/EditorScreen.jsx:188 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | full crosshair cursor | partial | frontend/src/editor/SchematicCanvas.jsx:1312 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | zoom to fit | done | frontend/src/editor/SchematicCanvas.jsx:657 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/EditorScreen.jsx | S
GAP | Canvas look and feel | pan with middle mouse | done | frontend/src/editor/pointerIntent.js:10 | frontend/src/editor/pointerIntent.js, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | left and right toolbars | missing | frontend/src/editor/EditorScreen.jsx:574 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | M
GAP | Canvas look and feel | status bar with X Y dx dy | done | frontend/src/editor/EditorScreen.jsx:222 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | net highlight | partial | frontend/src/editor/SchematicCanvas.jsx:1343 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/netHighlight.js, frontend/src/editor/PcbCanvas.jsx | M
GAP | Canvas look and feel | selection filter | missing | frontend/src/editor/PcbCanvas.jsx:1165 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/EditorScreen.jsx | M
