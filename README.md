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
