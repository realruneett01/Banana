# Banana — Hardware Git Diff Tool

Banana  is an advanced visual Git diff tool engineered for KiCad hardware designs, supporting both schematic (`.kicad_sch`) and PCB layout (`.kicad_pcb`) files.

## Features

- **Side-by-Side & Overlay Diff Viewports**: Synchronized side-by-side comparison with pan and zoom link capabilities.
- **Schematic & PCB Visual Differentiation**:
  - **Unchanged elements**: Grayscale desaturation (`#7a828a` / `#12131e` dark theme canvas).
  - **Changed elements**: Highlighted in Yellow stroke outlines (`#ffff00`).
  - **Added elements**: Highlighted in Green (`#00ff66`).
  - **Deleted elements**: Highlighted in Red (`#ff3366`).
- **Multi-Pass Topological Matching Engine**: Accurately classifies component shifts vs trace re-routes, suppressing font metric rendering noise.
- **Audit Modifications Sidebar**: Automated real-time change log listing changed, added, and deleted components and net traces.

## Tech Stack

- **Frontend**: React, Vite, Ant Design, Lucide Icons.
- **Backend**: Express.js, Node.js, KiCad CLI export integration.

## Getting Started

### Prerequisites

- Node.js (v18+)
- KiCad (v8.0+ recommended) with `kicad-cli` installed on system PATH.

### Installation & Running

1. **Start the Backend**:
   ```bash
   cd backend
   npm install
   npm run dev
   ```

2. **Start the Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. Open your browser at `http://localhost:5173`.

## Connecting AI assistants (MCP)

Banana exposes its diff, KiCad check, design and simulation tools over the Model Context Protocol:

- **Local (stdio):** Claude Desktop, Claude Code, Cursor run `node backend/src/mcp/stdio.js`.
- **Network (Streamable HTTP):** `/mcp` on the backend, off until `BANANA_MCP_TOKEN` (32+ chars) is set; reach it from cloud clients through an HTTPS tunnel.

Setup, the tool list and security notes: [docs/MCP.md](docs/MCP.md). Schemas: [docs/mcp-reference.md](docs/mcp-reference.md).

## Large boards and ERC

**KiCad import** (`POST /api/editor/import`) converts the file in a worker thread with a capped heap and a deadline (`backend/src/engine/import-worker.js`). The desktop app (started with an API secret) uses the desktop limits; every other deployment uses the web limits:

| Limit | Desktop | Web |
|-------|---------|-----|
| Request body | `150mb` | `20mb` |
| Worker heap | 2048 MB | 256 MB |
| Timeout | 120000 ms | 30000 ms |
| Concurrent imports | 2 | 1 |

Error responses:

- `413 {"error": "design too large to import"}`: body over the limit, or the worker ran out of heap.
- `422 {"error": "import timed out"}`: the conversion passed the timeout.
- `422 {"error": "Could not import file", "errors": [...]}`: the file did not parse (first 5 errors).
- `503 {"error": "import busy, retry shortly"}` with `Retry-After: 5`: all import slots are in use.

**Design routes** (`/api/editor/check`, `export`, `bom`, `netlist`, `commit`, `/api/erc/run`, `/api/circuit/simulate`, `/api/circuit/suggest-faults`, `/api/git/commit-files`) accept JSON bodies up to `DESIGN_BODY_LIMIT = "32mb"` (`backend/src/app.js`). All other routes keep the 100 kB default.

**Whole-project ERC** runs ERC across a full schematic hierarchy from a root `.kicad_sch`:

- `POST /api/erc/project` with `{"path": "<root>.kicad_sch", "commit": "..."}`. Desktop app only; elsewhere it answers `403 Project ERC is only available in the desktop app`.
- MCP tool `erc.project` (`backend/src/engine/tools/kicad-tools.js`), input `{"path": ...}`.
- Both resolve the real path and reject it unless it lies inside the projects root (the home directory when none is configured). The report is capped at 500 issues per severity and 100 warnings, with `truncated: true` when cut.

**Boards with missing `(`** (for example KiCad 10's RoyalBlue54L-Feather demo, with fragments like `(curved_edges no)filter_ratio 0.9)`): the board importer retries a strictly rejected file, reads `)` + bare keyword as `)(` like KiCad does, and adds the warning `recovered N lists missing '(' before a bare keyword, as KiCad does`. The KiCad edit/patch path keeps the strict parser, so such a file cannot be edited in place; re-save it in KiCad (or `kicad-cli pcb upgrade --force`) first.
