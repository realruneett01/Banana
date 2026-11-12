## Library browser

GAP | Library browser | library tree by library name | partial | frontend/src/editor/LibraryBrowser.jsx:255 | frontend/src/editor/LibraryBrowser.jsx | M
GAP | Library browser | lazy expand | missing | none | frontend/src/editor/LibraryBrowser.jsx, backend/src/engine/kicad-library.js | M
GAP | Library browser | fuzzy search | partial | backend/src/engine/kicad-library.js:517 | backend/src/engine/kicad-library.js | S
GAP | Library browser | symbol unit and de Morgan preview | missing | backend/src/engine/kicad-library.js:549 | frontend/src/editor/LibraryBrowser.jsx, backend/src/engine/kicad-library.js | M
GAP | Library browser | footprint preview with pads and courtyard | partial | frontend/src/editor/LibraryBrowser.jsx:217 | frontend/src/editor/LibraryBrowser.jsx, frontend/src/editor/footprintRender.js | S
GAP | Library browser | 3D model preview | missing | none | frontend/src/editor/LibraryBrowser.jsx, backend/src/engine/kicad-library.js | L

## Schematic editor

GAP | Schematic editor | wire | done | frontend/src/editor/SchematicCanvas.jsx:498 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/schematicGeometry.js, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | bus | missing | none | frontend/src/editor/SchematicCanvas.jsx, backend/src/engine/circuit-ir.js, backend/src/engine/kicad-sch-writer.js | L
GAP | Schematic editor | bus entry | missing | none | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/schematicGeometry.js | M
GAP | Schematic editor | junction | missing | none | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/schematicGeometry.js | M
GAP | Schematic editor | no-connect | missing | none | frontend/src/editor/SchematicCanvas.jsx, backend/src/engine/circuit-ir.js, backend/src/engine/erc.js | S
GAP | Schematic editor | local/global/hierarchical labels | partial | backend/src/engine/kicad-sch-writer.js:103 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js, backend/src/engine/circuit-ir.js | M
GAP | Schematic editor | power symbols | partial | frontend/src/editor/EditorScreen.jsx:542 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/SchematicCanvas.jsx | S
GAP | Schematic editor | sheets and hierarchy | missing | none | backend/src/engine/circuit-ir.js, frontend/src/editor/SchematicCanvas.jsx, backend/src/engine/kicad-sch-writer.js | L
GAP | Schematic editor | text | missing | none | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js, backend/src/engine/circuit-ir.js | M
GAP | Schematic editor | graphic lines | missing | none | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js, backend/src/engine/circuit-ir.js | M
GAP | Schematic editor | rotate | done | frontend/src/editor/SchematicCanvas.jsx:566 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | mirror X/Y | missing | frontend/src/editor/editorModel.js:117 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/symbolRender.js, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | move | done | frontend/src/editor/SchematicCanvas.jsx:710 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | drag | partial | frontend/src/editor/SchematicCanvas.jsx:499 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/schematicGeometry.js | M
GAP | Schematic editor | duplicate | missing | none | frontend/src/editor/editorModel.js, frontend/src/editor/SchematicCanvas.jsx | S
GAP | Schematic editor | align | missing | none | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | field editing | done | frontend/src/editor/PropertiesPanel.jsx:131 | frontend/src/editor/PropertiesPanel.jsx, frontend/src/editor/editorModel.js | S
GAP | Schematic editor | annotation | partial | frontend/src/editor/EditorScreen.jsx:512 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/editorModel.js | M
GAP | Schematic editor | ERC | partial | backend/src/engine/erc.js:21 | backend/src/engine/erc.js, frontend/src/editor/useLiveChecks.js, frontend/src/editor/SchematicCanvas.jsx | M
GAP | Schematic editor | netlist | partial | backend/src/engine/kicad-cli.js:215 | frontend/src/editor/EditorScreen.jsx, backend/src/routes/editor-routes.js | S
GAP | Schematic editor | BOM | missing | none | frontend/src/editor/EditorScreen.jsx, backend/src/routes/editor-routes.js, backend/src/engine/circuit-ir.js | S
GAP | Schematic editor | hotkeys W B L H P Q R X Y M G E D Del Ctrl+Z | partial | frontend/src/editor/SchematicCanvas.jsx:583 | frontend/src/editor/SchematicCanvas.jsx | M

## PCB editor

GAP | PCB editor | tracks | done | frontend/src/editor/PcbCanvas.jsx:348 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js, frontend/src/editor/routingModel.js | S
GAP | PCB editor | interactive router push and shove | missing | frontend/src/editor/routingModel.js:303 | frontend/src/editor/routingModel.js, frontend/src/editor/PcbCanvas.jsx | L
GAP | PCB editor | differential pairs | missing | none | frontend/src/editor/routingModel.js, frontend/src/editor/PcbCanvas.jsx, backend/src/engine/circuit-ir.js | L
GAP | PCB editor | length tuning | missing | frontend/src/editor/pcbGeometry.js:105 | frontend/src/editor/routingModel.js, frontend/src/editor/PcbCanvas.jsx | M
GAP | PCB editor | vias | done | frontend/src/editor/PcbCanvas.jsx:379 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/routingModel.js | S
GAP | PCB editor | layer switching | partial | frontend/src/editor/PcbCanvas.jsx:1530 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js | S
GAP | PCB editor | layer manager | partial | frontend/src/editor/PcbCanvas.jsx:884 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/LayerSelector.jsx | M
GAP | PCB editor | zones and fill | partial | frontend/src/editor/BoardTools.jsx:231 | frontend/src/editor/zoneModel.js, frontend/src/editor/BoardTools.jsx, frontend/src/editor/PcbCanvas.jsx | L
GAP | PCB editor | keepouts | partial | frontend/src/editor/BoardTools.jsx:209 | frontend/src/editor/zoneModel.js, frontend/src/editor/BoardTools.jsx | S
GAP | PCB editor | board outline Edge.Cuts | partial | frontend/src/editor/PcbCanvas.jsx:297 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js | M
GAP | PCB editor | footprint placement | done | frontend/src/editor/PcbCanvas.jsx:632 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/footprintRender.js | S
GAP | PCB editor | ratsnest | done | frontend/src/editor/PcbCanvas.jsx:741 | frontend/src/editor/pcbGeometry.js, frontend/src/editor/PcbCanvas.jsx | S
GAP | PCB editor | DRC | partial | backend/src/engine/drc-lite.js:4 | backend/src/engine/drc-lite.js, frontend/src/editor/useLiveChecks.js, frontend/src/editor/PcbCanvas.jsx | M
GAP | PCB editor | net classes | missing | backend/src/kicad-pcb-parser.js:20 | backend/src/engine/circuit-ir.js, frontend/src/editor/PropertiesPanel.jsx, frontend/src/editor/routingModel.js | M
GAP | PCB editor | design rules editor | missing | none | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/routingModel.js, backend/src/engine/drc-lite.js | M
GAP | PCB editor | text | missing | frontend/src/editor/PcbCanvas.jsx:406 | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js, backend/src/engine/kicad-pcb-writer.js | M
GAP | PCB editor | dimensions | missing | none | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/pcbGeometry.js | M
GAP | PCB editor | 3D viewer | partial | frontend/src/components/sim3d/Board3DScene.jsx:1 | frontend/src/editor/EditorScreen.jsx, frontend/src/components/sim3d/Board3DScene.jsx | M
GAP | PCB editor | Gerber/drill export | missing | none | backend/src/engine/kicad-cli.js, backend/src/routes/editor-routes.js, frontend/src/editor/EditorScreen.jsx | L
GAP | PCB editor | hotkeys X V D U E F R M | partial | frontend/src/editor/PcbCanvas.jsx:236 | frontend/src/editor/PcbCanvas.jsx | S

## Canvas look and feel

GAP | Canvas look and feel | KiCad default colour theme | partial | frontend/src/editor/pcbGeometry.js:1 | frontend/src/editor/pcbGeometry.js, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | dot and line grid | partial | frontend/src/editor/SchematicCanvas.jsx:201 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | grid size selector | missing | frontend/src/editor/EditorScreen.jsx:131 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | full crosshair cursor | missing | frontend/src/editor/PcbCanvas.jsx:76 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | zoom to fit | missing | none | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/EditorScreen.jsx | S
GAP | Canvas look and feel | pan with middle mouse | partial | frontend/src/editor/SchematicCanvas.jsx:722 | frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | left and right toolbars | missing | frontend/src/editor/EditorScreen.jsx:339 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | M
GAP | Canvas look and feel | status bar with X Y dx dy | missing | frontend/src/editor/EditorScreen.jsx:130 | frontend/src/editor/EditorScreen.jsx, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx | S
GAP | Canvas look and feel | net highlight | partial | frontend/src/editor/SchematicCanvas.jsx:500 | frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/editorModel.js | M
GAP | Canvas look and feel | selection filter | missing | none | frontend/src/editor/PcbCanvas.jsx, frontend/src/editor/SchematicCanvas.jsx, frontend/src/editor/EditorScreen.jsx | M
