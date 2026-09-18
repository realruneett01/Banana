# Banana 2.0 — System Architecture & Technical Context

_Last updated: 2026-08-19_

---

## 1. Project Identity & Objective

- **Project Name / Domain**: Banana 2.0 — Hardware Git Visual & Semantic Diff Engine (EDA / KiCad Electronics Design Automation).
- **Core Problem Solved**: Git and traditional diff tools treat hardware design files (`.kicad_sch` schematics and `.kicad_pcb` board layouts) as opaque text or raw S-expressions, resulting in unreadable merge conflicts and zero spatial/visual insight. Banana 2.0 provides an automated visual and topological diff engine that extracts revision pairs directly from Git history, converts them to vector layers via `kicad-cli`, performs a multi-pass semantic/geometric diff (categorizing additions, deletions, modifications, and component relocations while suppressing font/rendering noise), and presents them in synchronized side-by-side / overlay viewports with an automated audit log.
- **Current Stage**: Functional prototype / MVP with audited core diffing engine, currently transitioning toward web-hosted server-side deployment (BullMQ, Redis, PostgreSQL/Drizzle, Docker) and cross-platform desktop capabilities.

---

## 2. Architecture & Tech Stack

- **Primary Languages & Frameworks**:
  - **Frontend**: React 18, Vite, Ant Design (`antd`), Lucide Icons (`lucide-react`), Vanilla CSS / custom SVG viewport transforms (`@panzoom/panzoom` / custom matrix transforms).
  - **Backend**: Node.js, Express.js (`cors`, `express`), child process execution (`child_process.execFile`).
  - **Web Deployment Stack**: BullMQ + Redis (asynchronous worker queue), PostgreSQL with Drizzle ORM, Dockerized `kicad-cli` runtime.
- **Key Models / Algorithms / Databases**:
  - **5-Pass Topological Matching Engine (`backend/src/svg-diff-processor.js`)**:
    - *Pass 1*: Exact Element Matching (hash/path identity).
    - *Pass 2*: Substring / Attribute & Spatial Vicinity Matching.
    - *Pass 3*: Component & Reference Designator Association (bounding box & center proximity).
    - *Pass 4*: Track / Net Chain Assembly & Segment Routing Diff (graph traversal of interconnected copper segments).
    - *Pass 5*: Bounding-box cluster matching, displacement calculation (e.g. $2.0\text{ mm}$ movement threshold), and residual classification (`diff-changed`, `diff-added`, `diff-deleted`, `diff-unchanged`).
  - **S-Expression PCB Parser (`backend/src/kicad-pcb-parser.js`)**: Parses native `.kicad_pcb` tokens for pad centers, footprints, and net assignments to generate interactive overlay labels.
  - **Database (Web Phase)**: PostgreSQL for diff job tracking, repository metadata, and caching.
- **Compute & Hosting Environment**:
  - **Local/Desktop**: Node.js runtime with local `kicad-cli` system installation (Windows / macOS / Linux).
  - **Cloud/Container**: Docker container running headless Ubuntu with `kicad-cli` (KiCad 8.0+), Express REST API, and Redis/BullMQ worker instances.

---

## 3. Data Flow & Processing Pipeline

- **Input Modality / Format**:
  - Git repository path or remote GitHub App connection.
  - Git commit SHAs (`baseCommit`, `targetCommit`).
  - Hardware design files: KiCad Schematics (`.kicad_sch`) and PCB Layouts (`.kicad_pcb`).
- **Step-by-Step Pipeline**:
  1. **Ingestion & Git Extraction**:
     - Frontend requests commit history or submits diff job via `POST /api/diff/process` with `{ repoPath, baseCommit, targetCommit, filePath }`.
     - `git-extractor.js` uses `git show <commit>:<filePath>` to extract base and target file revisions into isolated subdirectories in `temp_storage/`.
  2. **Vector Rendering (`kicad-cli`)**:
     - `kicad-renderer.js` executes `kicad-cli sch export svg` or `kicad-cli pcb export svg` (with layer flags) to render high-precision vector SVG files for both revisions.
  3. **Semantic Diff & Topological Matching**:
     - `svg-diff-processor.js` parses the SVGs, extracts vector paths, texts, component symbols, and copper tracks into structured AST/DOM representations.
     - Runs the 5-pass matching algorithm: associates matching elements, detects geometric shifts (> 2.0 mm), identifies newly added or deleted wires/components, and annotates SVG nodes with diff classes (`diff-changed`, `diff-added`, `diff-deleted`, `diff-unchanged`).
     - Simultaneously extracts S-expression metadata (pad/net assignments) via `kicad-pcb-parser.js`.
  4. **Post-Processing & Output Generation**:
     - Injects CSS color variables and styling into SVG definitions.
     - Generates structured `modifications` audit list (changes, moves, additions, deletions with exact coordinates and net names).
  5. **Client Presentation**:
     - Frontend mounts annotated SVGs into synchronized dual viewports (`SideBySideDiff.jsx` / `DiffCanvas.jsx`) with pan/zoom locks, layer toggles, visual highlight filters, and real-time audit sidebar updates.
- **Final Output / Deliverable**: Interactive synchronized visual diff canvas with element-level highlights (Yellow = Changed, Green = Added, Red = Deleted, Grayscale = Unchanged) paired with an automated modification audit log.

---

## 4. Constraints & Boundaries

- **Hardware / Memory Budgets**:
  - `kicad-cli` subprocess memory footprint during large multi-sheet schematics or complex 8+ layer PCB SVG exports.
  - Ephemeral disk usage in `temp_storage/` requiring strict lifecycle cleanup per job.
  - Browser DOM memory limits when rendering complex vector SVGs with thousands of copper trace paths and pad shapes.
- **Performance Targets**:
  - Fast end-to-end diff turnaround (< 2–5 seconds for typical schematic sheets; asynchronous BullMQ polling for massive multi-layer PCBs).
  - 60 FPS smooth synchronized pan/zoom in the client viewport.
- **Known Non-Negotiables & Strict Invariants**:
  - **Tool Dependency**: Strict requirement on `kicad-cli` binary availability (v8.0+ recommended) with cross-platform PATH resolution.
  - **Cross-Platform Compatibility**: No shell-quoted string execution; strict use of `execFile` with array arguments; explicit Windows/Unix path normalization (`/` vs `\`) and CRLF/LF line-ending handling.
  - **Zero Trust Security (Web Mode)**: No collecting raw GitHub Personal Access Tokens (PATs); use granular GitHub App installation tokens; sanitized input paths preventing directory traversal outside `temp_storage`.
  - **Noise Suppression**: Font rendering variations, metadata timestamp changes, and minor vector antialiasing artifacts must not trigger false-positive diff classifications.

---

## 5. Cross-Platform Audit Findings (Windows / macOS / Linux)

| # | File Path | Line Number(s) | Hardcoded Value / OS Assumption | Soft-Coding Recommendation |
|---|---|---|---|---|
| 1 | [`backend/src/config.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/config.js#L18-L57) | L18–L57 | Hardcoded paths & startup verification. | Strict fail-fast `execFileSync(KICAD_CLI_PATH, ['--version'])` without `try/catch` ensures the backend halts immediately at boot if `kicad-cli` is unexecutable. |
| 2 | [`backend/src/config.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/config.js#L16) | L16 | Binary search without PATH resolution. | Uses `where` (win32) / `which` (Unix) via `execFileSync` to locate `kicad-cli` dynamically on `PATH` before trying OS install locations. |
| 3 | [`backend/src/server.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/server.js#L106-L113) | L106–L113 | Hardcoded Windows paths `C:\Users\realr\...`. | Replaced with `os.homedir()`: `const defaultRepoBrowseDir = path.join(os.homedir(), 'Desktop'); const startDir = fs.existsSync(defaultRepoBrowseDir) ? defaultRepoBrowseDir : os.homedir();`. |
| 4 | [`frontend/src/App.jsx`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/App.jsx#L50-L58) | L50–L58 | Hardcoded initial state `c:\Users\realr\...`. | Replaced with `useState(localStorage.getItem('banana:lastRepoPath') || '')` and `useEffect` persistence on `repoPath` change. |
| 5 | [`frontend/src/App.jsx`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/App.jsx) | Multiple | Hardcoded API URL `http://localhost:5000`. | Replaced with `${API_BASE_URL}` imported from `frontend/src/config.js` (`import.meta.env.VITE_API_URL || 'http://localhost:5000'`). |
| 6 | [`frontend/src/PadLabelOverlay.jsx`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/PadLabelOverlay.jsx#L264) | L264, L281 | Hardcoded API URL `http://localhost:5000`. | Replaced with `${API_BASE_URL}` imported from `./config.js`. |
| 7 | [`backend/src/kicad-renderer.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/kicad-renderer.js#L20-L24) | L20–L24 | Manual slash conversion `replace(/\\/g, '/') + '/'`. | Converted `exec()` string commands to `execFile()` with array arguments and `path.resolve()`, eliminating shell string escaping issues. |
| 8 | [`backend/src/git-extractor.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/git-extractor.js#L30) | L30 | Redundant global regex replacement. | Cleaned up to `relativeFilePath.split(/[/\\]/).join('/')` for explicit cross-platform Git path normalization. |
| 9 | [`backend/src/server.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/server.js) | Multiple | Shell-quoted string commands via `exec()`. | Replaced all `exec()` calls (`git branch`, `git log`, `git ls-files`, `git diff`) with `execFile('git', args, { cwd })` array argument passing. |
| 10 | [`backend/src/server.js`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/backend/src/server.js) | Multiple | Line-ending assumptions using `.split('\n')`. | Replaced with `.split(/\r?\n/).filter(line => line.length > 0)` to handle Windows CRLF line endings. |

---

## 6. R38 Diff Classification Trace (34b1983 → 100de4c, ETHERNET.kicad_sch)

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
