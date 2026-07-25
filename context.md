# Banana 2.0 — Hardware Git Diff Engine & Technical Context

_Last updated: 2026-07-25 (Comprehensive Master Record)_

---

## 1. System Architecture Map & Component Responsibilities

### Top-Level Directories
- **`backend/`**: Express.js server providing REST endpoints for repository discovery (`/api/git/*`), executing KiCad CLI operations (`kicad-cli`), handling SVG file extraction from Git commits, running the multi-pass diff engine, and parsing `.kicad_pcb` S-expressions for pad/net overlay metadata.
  - **`backend/src/`**: Primary server source code (SVG diffing, PCB parsing, process management, API routes).
  - **`backend/temp_storage/`**: Ephemeral workspace for checked-out commit files, rendered SVG layers, and diagnostic scripts.
- **`frontend/`**: Vite + React single-page web application providing interactive visual diff viewports, synchronized pan/zoom controls, slider overlays, layer selection toggles, and an automated audit trail log sidebar.
  - **`frontend/src/`**: UI components (`App.jsx`, `SideBySideDiff.jsx`, `DiffCanvas.jsx`, `PadLabelOverlay.jsx`) and global styles (`App.css`, `index.css`).

### Main Data Flow Architecture
1. **User Input & API Dispatch**: The user selects a local repository path, `baseCommit`, `targetCommit`, and a design file (`.kicad_sch` or `.kicad_pcb`) in `frontend/src/App.jsx`. The frontend issues a `POST /api/diff/process` request to the Express backend.
2. **File Extraction**: `backend/src/server.js` calls `extractFileFromCommit()` in `backend/src/git-extractor.js`, which spawns `git show <commit>:<filepath>` to extract the Base and Target design files into `backend/temp_storage/`.
3. **SVG Vector Rendering**: `backend/src/server.js` passes extracted files to `renderKicadFile()` in `backend/src/kicad-renderer.js`, shelling out to `kicad-cli pcb export svg` or `kicad-cli sch export svg` to export vector layers.
4. **Semantic Diff Processing**: `backend/src/server.js` passes the exported SVGs to `processSvgDiff()` in `backend/src/svg-diff-processor.js`. The 5-pass matching engine annotates SVG nodes with diff classes (`diff-changed`, `diff-added`, `diff-deleted`, `diff-unchanged`) and constructs a structured `modifications` log array.
5. **Frontend Viewport & Highlights**: `backend/src/server.js` responds with annotated SVGs and modification metadata. `frontend/src/SideBySideDiff.jsx` mounts SVGs in dual `<svg>` viewports, applies `DIFF_CSS` styling, synchronizes pan/zoom transforms, and updates the Audit Modifications sidebar.

### Key File Inventory
1. **Diff Classification Logic**: [`backend/src/svg-diff-processor.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/svg-diff-processor.js) (element extraction `extractElements()`, track chain assembly `assembleTrackChains()`, 5-pass classification `processSvgDiff()`, and style injection `injectDiffStyle()`).
2. **External Tool Execution & I/O**:
   - [`backend/src/kicad-renderer.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/kicad-renderer.js) (shells out to `kicad-cli`).
   - [`backend/src/git-extractor.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/git-extractor.js) (spawns `git show`).
   - [`backend/src/config.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/config.js) (resolves `kicad-cli` binary location).
   - [`backend/src/server.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/server.js) (REST route handlers, `git log`/`git diff` execution, temp directory cleanup).
   - [`backend/src/kicad-pcb-parser.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/kicad-pcb-parser.js) (parses `.kicad_pcb` S-expressions for pad/net overlays).
3. **Frontend Viewport Component**: [`frontend/src/SideBySideDiff.jsx`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/SideBySideDiff.jsx) (dual SVG viewport, `DIFF_CSS` injection, linked pan/zoom, and grayscale filter scoping).

---

## 2. Cross-Platform Audit Findings (Windows / macOS / Linux)

| # | File Path | Line Number(s) | Hardcoded Value / OS Assumption | Soft-Coding Recommendation |
|---|---|---|---|---|
| 1 | [`backend/src/config.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/config.js#L18-L34) | L18–L34, L53–L56 | Hardcoded paths: `C:\Program Files\KiCad\...`, `/Applications/KiCad...`, `/usr/bin/kicad-cli`. | Use `which`/`where` check to dynamically locate `kicad-cli` on `PATH` before falling back to OS-specific arrays or `process.env.KICAD_CLI_PATH`. |
| 2 | [`backend/src/config.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/config.js#L19-L22) | L19–L22 | Assumes `.exe` extension on Windows without fallback to PATH resolution. | Normalize binary resolution using `os.type()` and `path.join()`, verifying binary execution with `--version`. |
| 3 | [`backend/src/server.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/server.js#L118-L119) | L118–L119 | Hardcoded Windows paths: `path.join('C:', 'Users', 'realr', 'OneDrive', 'Desktop')` and `path.join('C:', 'Users', 'realr')`. | Replace hardcoded drive letters and user names with `os.homedir()` (e.g., `path.join(os.homedir(), 'Desktop')`). |
| 4 | [`frontend/src/App.jsx`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/App.jsx#L52) | L52 | Hardcoded initial state: `const [repoPath, setRepoPath] = useState('c:\\Users\\realr\\OneDrive\\Desktop\\Banana');`. | Set default state to `''` or a dynamic user preference stored in `localStorage`. |
| 5 | [`frontend/src/App.jsx`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/App.jsx#L90) | L90, L136, L174, L259, L281 | Hardcoded backend URL `http://localhost:5000` across all `fetch()` calls. | Extract API base URL into an environment variable (`import.meta.env.VITE_API_URL \|\| 'http://localhost:5000'`). |
| 6 | [`frontend/src/PadLabelOverlay.jsx`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/PadLabelOverlay.jsx#L266) | L266, L283 | Hardcoded API URL `http://localhost:5000/api/board/pads`. | Use shared API configuration helper or relative path / env variable. |
| 7 | [`backend/src/kicad-renderer.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/kicad-renderer.js#L26-L27) | L26–L27 | Manual string slash conversion `outputDir.replace(/\\/g, '/') + '/'`. | Use `path.normalize()` or `path.resolve()` with quoted arguments. |
| 8 | [`backend/src/git-extractor.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/git-extractor.js#L30) | L30 | Manual string replacement `relativeFilePath.replace(/\\/g, '/')`. | Use `path.posix.normalize()` for Git internal path formatting. |
| 9 | [`backend/src/server.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/server.js#L55) | L55, L70, L178, L235 | Shell command building with double quotes via `exec()` (e.g. `git log --format="%H|%an|%ad|%s"`). | Replace string `exec()` with `execFile()` or `spawn()` using array arguments to avoid shell-specific quoting issues between Windows `cmd.exe` and Unix `/bin/sh`. |
| 10 | [`backend/src/server.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/server.js#L60) | L60, L75, L99, L184, L253 | Line-ending assumptions using `.split('\n')` on stdout from `exec()`. | Use `.split(/\r?\n/)` to safely handle Windows `\r\n` CRLF line endings without leaving trailing `\r` carriage returns. |

---

## 3. R38 Diff Classification Trace (34b1983 → 100de4c, ETHERNET.kicad_sch)

### Coordinates & Distance
- **Base R38 Center**: $(x = 99.0732\text{ mm},\, y = 92.3740\text{ mm})$
- **Target R38 Center**: $(x = 98.8192\text{ mm},\, y = 95.1680\text{ mm})$
- **Computed Distance**: **$2.8055\text{ mm}$**

### Threshold & Code Reference
- **Geometric Threshold**: **$2.0\text{ mm}$** (Distances $> 2.0\text{ mm}$ classify component moves as `diff-changed`).
- **Exact Code Setting Threshold**: [`backend/src/svg-diff-processor.js:742-744`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/svg-diff-processor.js#L742-L744)
  - `const geoChanged = dist > 2.0;`
  - `const stateClass = geoChanged ? 'diff-changed' : 'diff-unchanged';`

### Wire / Path Elements in R38 Target Vicinity
1. **Newly Added Wire Segments (`diff-added` / Green)**:
   - `diffIdx: 8` — Target Center: $(104.0130, 92.4560)$, `d="M102.8700 92.4560 L105.1560 92.4560"` $\rightarrow$ **`diff-added`**
   - `diffIdx: 9` — Target Center: $(92.7100, 95.2500)$, `d="M93.9800 95.2500 L91.4400 95.2500"` $\rightarrow$ **`diff-added`**
   - `diffIdx: 10` — Target Center: $(94.6150, 95.2500)$, `d="M95.2500 95.2500 L93.9800 95.2500"` $\rightarrow$ **`diff-added`**
   - `diffIdx: 11` — Target Center: $(100.9650, 95.2500)$, `d="M100.3300 95.2500 L101.6000 95.2500"` $\rightarrow$ **`diff-added`**
2. **Shifted / Modified Wire Segments (`diff-changed` / Yellow)**:
   - `diffIdx: 2` — Base $(94.8690, 92.4560) \rightarrow$ Target $(94.6150, 95.2500)$ ($\Delta = 2.805\text{ mm}$) $\rightarrow$ **`diff-changed`**
   - `diffIdx: 3` — Base $(101.2190, 92.4560) \rightarrow$ Target $(100.9650, 95.2500)$ ($\Delta = 2.805\text{ mm}$) $\rightarrow$ **`diff-changed`**
   - `diffIdx: 4` — Base $(91.8210, 92.4560) \rightarrow$ Target $(91.4400, 93.8530)$ ($\Delta = 1.446\text{ mm}$) $\rightarrow$ **`diff-changed`**
   - `diffIdx: 5` — Base $(94.8690, 92.4560) \rightarrow$ Target $(90.4240, 92.4560)$ ($\Delta = 4.445\text{ mm}$) $\rightarrow$ **`diff-changed`**
   - `diffIdx: 6` — Base $(101.2190, 92.4560) \rightarrow$ Target $(102.2350, 95.2500)$ ($\Delta = 2.973\text{ mm}$) $\rightarrow$ **`diff-changed`**
   - `diffIdx: 7` — Base $(103.5050, 92.4560) \rightarrow$ Target $(102.8700, 93.8530)$ ($\Delta = 1.533\text{ mm}$) $\rightarrow$ **`diff-changed`**

---

## 4. Summary of Major Applied Fixes

### A. Dark Background & Grayscale Normalization
- **Schematic Dark Background**: Added `rewriteSchematicBackground()` in `svg-diff-processor.js` to dynamically replace KiCad's exported paper-color rect (`#F5F4EF`) with `#12131e` dark theme canvas.
- **Grayscale Filter Scoping**: Applied `grayscale(1) brightness(1.15) opacity(0.5)` to `.diff-unchanged` elements in schematic mode, matching PCB mode behavior.

### B. Stroke-Only Highlight & Text Legibility Fix
- **Stroke-Only Injections**: Updated `injectDiffStyle()` and `DIFF_CSS` in `SideBySideDiff.jsx` to enforce `fill: none !important` across all descendants of `.diff-changed`, `.diff-added`, and `.diff-deleted` groups.
- **Glyph Stroke Width**: Kept stroke-width at native scale for `<g class="stroked-text">` glyph containers, preventing resistor body rectangles and text labels from rendering as solid yellow filled blocks.

### C. PCB Track Chain Pass 0 & Slicing Fixes
- **`isCopperLayerFilename()`**: Threaded layer filename through `processSvgDiff()` and added filename-based copper layer detection (`/\b(F_Cu\|B_Cu\|In\d+_Cu)\b/i`).
- **Pass 0 Geometry Check**: Added geometry comparison before emitting `diff-changed` for track chains, preventing identical traces from generating false positive modification cards.
- **Back-to-Front Character Index Slicing**: Replaced string replacement in `extractElements()` with descending character index slicing to cleanly remove matched component `<g>` blocks from `remainingSvg`.
- **Title Block Exclude**: Added `isWorksheetFrameElement()` to exclude title block metadata region ($X > 180\text{ mm}, Y > 140\text{ mm}$) from emitting audit modification cards.
