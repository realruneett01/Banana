# Banana User Guide

Banana is an application for designing, comparing, and testing printed circuit boards (PCBs) without requiring expert electronics knowledge. It helps you design hardware with AI guidance, review visual changes between revisions, simulate how circuits behave under real-world stress, and edit schematics and layouts directly in your browser or desktop environment.

Related references:
- [API Reference](api-reference.md) — HTTP API endpoints, request validation, and response structures.
- [MCP Reference](mcp-reference.md) — Model Context Protocol server tools, permissions, and setup.

---

## 1. What Banana Is

A printed circuit board (PCB) is a rigid board that physically holds and electrically connects electronic components using copper tracks. Designing a PCB usually requires complex computer-aided design (CAD) software.

Banana simplifies PCB engineering into an accessible visual workflow. It provides:
- **Visual Git Diffs**: Color-coded comparisons showing what components or copper traces changed between Git commits or revisions.
- **AI-Assisted Design**: Natural language hardware design that converts plain-text requirements into complete circuit schematics and board layouts.
- **Circuit Simulation & Stress Testing**: Electrical and thermal checks that simulate voltage, current, heat, and component failures under realistic operating conditions.
- **Integrated 2D/3D Editor**: A schematic and layout workspace where you can place parts, draw wires, route traces, and export ready-to-manufacture KiCad files.

---

## 2. Starting the App

Banana can run as a web application or as an Electron desktop application.

### Prerequisites
- **Node.js**: Version 18 or newer installed on your computer.
- **Git**: Installed and available in your terminal path.
- **KiCad CLI** (optional): Recommended for rendering SVG diffs and native CAD export.
- **ngspice** (optional): Recommended for analog circuit simulations.
- **Freerouting** (optional): Recommended for automated PCB autorouting.

### Installation

1. Open your terminal in the Banana project root directory.
2. Install dependencies for all workspace packages:
   ```bash
   npm install
   ```

### Running the Development Server

Start both the backend API server and the frontend development server simultaneously:
```bash
npm run dev
```

By default:
- The frontend runs at `http://localhost:5173`.
- The backend API runs at `http://localhost:3000`.

Open your web browser and navigate to `http://localhost:5173` to start using Banana.

To run the desktop Electron app instead:
```bash
npm run desktop:dev
```

---

## 3. The Core Loop

The core workflow in Banana follows five simple steps:

1. **Describe**: Tell the AI what circuit you need using plain English (for example, "create an LED flasher using a 555 timer").
2. **See the Diff**: Inspect the visual change between your previous design and the new version. Additions, modifications, and deletions are highlighted clearly.
3. **Simulate**: Test the circuit against simulated operational conditions such as room temperature, vehicle vibration, or power supply fluctuations.
4. **Fix**: Review automated issue warnings and click suggested fixes to resolve design flaws.
5. **Repeat**: Re-run simulations or refine the layout in the Editor until all checks pass.

---

## 4. Design with AI

To open the AI design assistant, click the **Design with AI** button in the top navigation bar.

1. **Enter Your Prompt**: In the text area, describe what you want to build. You can press `Ctrl+Enter` (`Cmd+Enter` on macOS) or click **Send**.
2. **Review Execution Steps**: Banana displays an execution timeline showing each tool call, parameter, and intermediate result step-by-step.
3. **Confirm Destructive Actions**: If a tool makes changes to your local Git repository (such as creating commits), an approval banner appears. Click **Approve** to proceed or **Reject** to stop.
4. **Preview the Board**: Once generated, a 2D preview of your components appears alongside a summary of detected design issues.
5. **Open in Simulation**: Click **Simulate this design** to load the newly generated design into the simulation drawer.

---

## 5. Reading the Diff

When comparing revisions of a `.kicad_sch` (schematic) or `.kicad_pcb` (board layout) file, Banana provides side-by-side viewports and visual highlights on the canvas:

- **Gray Canvas (`#7a828a` / `#12131e`)**: Unchanged components, wires, and board outlines.
- **Green (`#00ff66`)**: Added elements that exist only in the newer revision.
- **Red (`#ff3366`)**: Deleted elements that were removed in the newer revision.
- **Yellow (`#ffff00`)**: Changed elements, such as components moved to new coordinates or nets rerouted along different paths.

The right-hand **Audit Modifications** sidebar catalogs every detected addition, removal, and shift so you do not have to hunt for small trace alterations manually.

---

## 6. Simulate

Click the **Simulate** button in the top navigation bar to open the simulation drawer. This drawer tests electrical and environmental integrity before fabrication.

### Operating Environments
Circuits perform differently depending on where they are deployed. Banana lets you select pre-configured environment stress profiles or define custom parameters:

- **Benchtop (Lab Default)**: Room temperature of 25 °C and normal indoor atmospheric conditions.
- **Office**: Standard consumer indoor conditions (0 °C to 40 °C, 10% to 80% relative humidity, sea level).
- **Automotive**: AEC-Q100 grade 1 vehicle conditions (-40 °C to 125 °C, high humidity, 50 g mechanical shock, vibration up to 2000 Hz).
- **Industrial**: Factory conditions (-40 °C to 85 °C, vibration up to 500 Hz).
- **Outdoor**: Weather-exposed conditions (-30 °C to 70 °C, 0% to 100% humidity, up to 2000 m altitude).
- **Aerospace**: Extreme high-altitude conditions (-55 °C to 125 °C, up to 12000 m altitude, 100 g shock).
- **Data Center**: Controlled facility conditions (18 °C to 35 °C, forced airflow of 2 m/s).

### Simulation Checks Explained in Plain Words
- **Thermal Simulation**: Calculates component and board temperatures based on ambient heat and power dissipation. Warns if a part gets hot enough to degrade or fail.
- **Trace Current Simulation**: Calculates how many amperes of electrical current flow through each copper track. Warns if a track is too narrow for the current it carries.
- **IR Drop Simulation**: Calculates voltage loss caused by the natural electrical resistance of copper tracks. Warns if too much voltage is lost before power reaches a component.
- **Electrical Rules Check (ERC)**:
  - *Net pin count*: A net (electrical circuit connection) must connect at least two pins. Single-pin nets leave components unconnected.
  - *Power rail constraint*: Checks whether power nets (like VCC, 5V, or 3.3V) have defined voltage limits so power delivery can be verified.
  - *Unconnected parts*: Identifies components placed on the board that are not hooked up to any electrical signals.
  - *Missing footprint*: Identifies schematic symbols that lack a matching physical mounting pattern on the PCB.
  - *Pin short circuits*: Catches accidental wiring errors where one component pin is connected to two conflicting nets at the same time.

### Comparing Commits
Switch to the **Compare commits** tab to see simulation results across two Git commits side by side. This shows whether recent design modifications resolved previous issues or introduced new thermal or electrical problems.

---

## 7. 3D Studio

Click the **3D Studio** button in the top header to enter an interactive 3D visual studio of your circuit board.

### Key Features
- **Current Flow and Heat Visualization**: Watch current travel through tracks and view temperature gradients directly on 3D components.
- **2D / 3D Mode Toggle**: Switch between a top-down 2D diagram and an interactive 3D camera view with zoom, pan, and rotation.
- **What Happens Tab**:
  - Run the baseline circuit simulation to calculate voltages on every net and currents through every component.
  - Open the **Numbers** drawer to inspect exact numeric voltage and current readouts.
- **Fault Scenarios ("What if...?")**:
  - Inject simulated faults, such as disconnected nets or shorted components, without modifying your saved file.
  - Read plain-English explanation cards marked with severity badges (**Danger**, **Warning**, **Info**).
- **Apply Fix and Undo Last Fix**:
  - Many explanation cards include an **Apply fix** button that automatically repairs the design flaw (for example, adjusting resistor values).
  - To revert a change, click the **Undo last fix** button in the top right drawer header.
- **Over Time Tab**:
  - Switch between **Snapshot [steady]** (DC operating point) and **Over time [transient]** (oscillating or dynamic signals).
  - Use the **Play / Pause** buttons, adjust the timeline playback speed (`0.25x` to `4x`), or drag the timeline slider to scrub through transient events.
- **What Could Go Wrong? (The Guided Tour)**:
  - An automated stress testing walkthrough.
  - The tour runs each potential failure scenario in sequence and assigns a clear verdict:
    - **Survives** (green): The circuit continues to operate safely.
    - **Stops Working** (yellow): The circuit loses function but avoids permanent physical damage.
    - **Gets Damaged** (red): The circuit overloads or burns out components.
  - Highlights affected parts in the 3D scene and displays a summary score card with hardening advice.

---

## 8. The Editor

Click the **Editor** button in the top header to open the manual schematic and PCB editor.

### Schematic and PCB Tabs
- **Schematic Tab**: Work on logical connections. Symbols represent parts (such as resistors, capacitors, and microcontrollers), and wires represent electrical nets.
- **PCB Tab**: Work on physical board manufacturing. Place footprints (component physical outlines) onto the board canvas, manage copper layers, and route conductive tracks.

### Adding Parts
1. Click the **Add part** button on the toolbar (or press `A` on your keyboard).
2. Browse or search for symbols and footprints in the library dialog.
3. Select an item and click **Add to schematic**. Banana places the part on the canvas and assigns the next reference designator (for example, `R1`, `R2`, `U1`).

### Wiring in the Schematic
1. Press `W` to activate Wire mode.
2. Click on any component pin (highlighted in cyan) to start a connection.
3. Click on another pin to complete the wire connection. A yellow rubberband line previews your path while moving.
4. Press `Escape` at any time to exit Wire mode without creating a connection.

### Routing on the PCB
1. Switch to the **PCB** tab.
2. Click **Route Track** on the toolbar (or press `X`).
3. Click a component pad to start routing copper.
4. Move your cursor to preview the track path.
5. Press `V` to insert a via (a drilled hole connecting top and bottom copper layers) and automatically switch the active layer between `F.Cu` (Front Copper) and `B.Cu` (Back Copper).
6. Press `W` to cycle track width presets (`0.25 mm`, `0.40 mm`, `0.80 mm`, etc.).
7. Press `/` to toggle between 45-degree and 90-degree corner angles.
8. Hold `Shift` while clicking if you need to bypass automatic clearance collision checks.
9. Double-click to complete and finalize the track.

### Live Checks
Banana runs continuous background design rule checks (DRC-lite) as you edit:
- The bottom status bar shows an indicator with the number of detected problems.
- Click the problem counter to toggle the **Problems** drawer.
- Live checks monitor:
  - Physical component collisions (overlapping parts on the same board side).
  - Tracks that violate minimum spacing rules (`clearanceMm`, default 0.2 mm).
  - Tracks that are narrower than the allowable minimum (`minTrackWidthMm`, default 0.15 mm).
  - Components or tracks placed outside the board outline or too close to board edges (`edgeClearanceMm`, default 0.3 mm).
  - Unrouted connections (missing tracks for defined schematic nets).
  - Electrical rules check (ERC) violations.

### Exporting Files
Click **Export KiCad files** on the toolbar. Banana generates native KiCad S-expression files:
- `<name>.kicad_sch` (schematic)
- `<name>.kicad_pcb` (printed circuit board layout)

Both files download directly through your browser, ready to open in KiCad 8.0+.

### Keyboard Shortcuts Reference
The following table lists every keyboard shortcut available in the Editor:

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| `Ctrl+S` / `Cmd+S` | Editor | Save the current circuit schematic and board layout |
| `A` / `a` | Editor | Open the Add Part library browser dialog |
| `Ctrl+Z` / `Cmd+Z` | Editor / Schematic / PCB | Undo the last action |
| `Ctrl+Y` / `Cmd+Y` | Editor / Schematic / PCB | Redo the previously undone action |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Editor / Schematic / PCB | Redo alternative shortcut |
| `R` / `r` | Editor / Schematic / PCB | Rotate selected component by 90 degrees |
| `F` / `f` | Editor / Schematic / PCB | Flip selected component between Front and Back board layers |
| `Delete` / `Backspace` | Editor / Schematic / PCB | Delete selected component, wire, or PCB track |
| `W` / `w` | Schematic Canvas | Enter interactive Wire drawing mode |
| `Escape` | Schematic Canvas | Exit Wire drawing mode and clear active wire |
| `Space` (held) | Schematic Canvas | Pan canvas view by dragging with the left mouse button |
| Middle Mouse Drag | Schematic Canvas | Pan canvas view |
| Mouse Wheel | Schematic Canvas | Zoom canvas in and out |
| `X` / `x` | PCB Canvas / Editor | Toggle interactive PCB Track Routing mode |
| `V` / `v` (routing) | PCB Canvas | Place a via at cursor location and toggle active copper layer |
| `V` / `v` (not routing) | PCB Canvas | Toggle active copper layer between `F.Cu` and `B.Cu` |
| `W` / `w` | PCB Canvas | Cycle trace width preset (e.g., 0.25 mm, 0.40 mm, 0.80 mm) |
| `/` | PCB Canvas | Toggle route corner angle mode between 45° and 90° |
| `Shift` (held + click) | PCB Canvas | Bypass design rule check (DRC) collision check when placing a track |
| Double-Click | PCB Canvas | Commit and finish the active routed copper track |
| `Ctrl+Enter` / `Cmd+Enter` | Design with AI Panel | Submit design prompt in the AI chat text box |

---

## 9. Troubleshooting

Banana is built to remain functional even when third-party tools are not installed on your system.

### KiCad CLI (`kicad-cli`) Not Installed
- **What is limited**: The backend cannot generate rendered SVG visual diffs from `.kicad_sch` or `.kicad_pcb` files, and cannot run native CLI-based DRC or netlist export.
- **What still works**:
  - The complete 2D Schematic and PCB Editor runs entirely in JavaScript.
  - You can add parts, wire circuits, route tracks, and perform live design rule checks.
  - You can export valid `.kicad_sch` and `.kicad_pcb` CAD files using the internal writers.
  - AI circuit generation, Git commit inspection, and cloud GitHub browsing remain fully operational.

### ngspice Not Installed
- **What is limited**: Raw SPICE netlist simulations (`/api/circuit/simulate`) return a service unavailable status (HTTP 503).
- **What still works**:
  - High-level simulations (thermal dissipation, trace current capacity, IR drop, and electrical rule checks) rely on built-in analytical calculation engines and work normally.
  - Full schematic editing, PCB routing, visual diffing, and KiCad file exports remain available.

### Freerouting Not Installed
- **What is limited**: Automated one-click autorouting (`ir.route`) cannot be executed because the Freerouting JAR package is not configured.
- **What still works**:
  - Interactive manual routing on the PCB canvas (with via placement, angle locking, and clearance checks) functions without restrictions.
  - Automatic grid-based component placement (`autoPlace`) continues to work.
  - All schematic capture, live DRC checking, and export tools work normally.
