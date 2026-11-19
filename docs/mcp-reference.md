# Banana Model Context Protocol (MCP) Reference

The Banana Model Context Protocol (MCP) server exposes circuit design, simulation, KiCad rule-checking, and diffing tools to external AI agent environments (such as Claude Desktop, Cursor, or custom MCP clients) over standard input/output (`stdio`).

Related references:
- [User Guide](user-guide.md) — Comprehensive guide to designing, diffing, and editing boards.
- [API Reference](api-reference.md) — HTTP API endpoints, request validation, and response structures.

---

## Starting the MCP Server

The Banana MCP server runs as a Node.js process using `@modelcontextprotocol/sdk` and `StdioServerTransport`.

To start the server from your terminal:
```bash
node backend/src/mcp/stdio.js
```

During startup:
- Standard output (`stdout`) is strictly reserved for JSON-RPC MCP messages.
- Standard error (`stderr`) is used for informational logging and diagnostics (`console.log`, `console.info`, and `console.debug` are redirected to `stderr`).
- The server identifies itself as `name: "banana"`, `version: "0.1.0"`.

---

## Client Configuration Example

To configure the Banana MCP server in Claude Desktop or any compatible MCP client, add the following entry to your MCP configuration file (for example, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "banana": {
      "command": "node",
      "args": ["backend/src/mcp/stdio.js"],
      "cwd": "/path/to/Banana"
    }
  }
}
```

Replace `/path/to/Banana` with the absolute path to your local Banana repository root.

---

## Tool Permissions and Approval Model

Every tool in Banana declares a permission level:
- **`read`**: Safe inspection, calculation, file rendering, or validation that does not modify persistent user data. Does not require approval (`needsApproval: false`).
- **`write`**: Modifies files or state in non-destructive ways.
- **`destructive`**: Modifies persistent version control history or disk assets (such as committing files to a Git repository). Requires explicit user approval (`needsApproval: true`).

---

## Registered Tools Summary

| Tool Name | Permission Level | Needs Approval | Description |
| :--- | :--- | :--- | :--- |
| `diff.compare_files` | `read` | No | Compares two KiCad files (.kicad_pcb or .kicad_sch) and returns visual/structural diff |
| `kicad.erc` | `read` | No | Runs KiCad electrical rules check on a schematic |
| `kicad.drc` | `read` | No | Runs KiCad design rules check on a PCB layout |
| `kicad.export_netlist` | `read` | No | Exports a netlist from a KiCad schematic |
| `ir.validate` | `read` | No | Validates a Circuit IR document against schema and semantics |
| `erc.run` | `read` | No | Runs electrical rules check on a Circuit IR |
| `ir.auto_place` | `read` | No | Automatically places unplaced components on a PCB grid |
| `ir.to_kicad_sch` | `read` | No | Generates KiCad schematic S-expression text from Circuit IR |
| `ir.to_kicad_pcb` | `read` | No | Generates KiCad PCB layout S-expression text from Circuit IR |
| `sim.run` | `read` | No | Runs thermal, trace current, or IR drop simulation |
| `ir.route` | `read` | No | Routes PCB tracks using Freerouting |
| `design.commit` | `destructive` | **Yes** | Saves design to local git repo as KiCad files and creates a commit |

---

## Registered Tools Reference

### diff.compare_files
- **What it does**: Compares two KiCad CAD files (`.kicad_pcb` or `.kicad_sch`) on disk and returns structured vector modifications, PCB metadata, and rendering telemetry.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `basePath` (string, required): Absolute file path to the baseline file. Must match pattern `^([a-zA-Z]:[\\/]|[\\/]).+\.(kicad_pcb|kicad_sch)$`.
  - `targetPath` (string, required): Absolute file path to the target file. Must match pattern `^([a-zA-Z]:[\\/]|[\\/]).+\.(kicad_pcb|kicad_sch)$`.
  - `isPcb` (boolean, optional): Explicit PCB indicator. Defaults to `true` if `basePath` ends with `.kicad_pcb`.
- **Output Schema**:
  - `modifications` (array, required): Consolidated structural and visual modifications.
  - `pcbMetadata` (object or null, optional): Extracted nets, pad counts, and component changes.
  - `telemetry` (object, optional): Execution timings (`tGit`, `tCli`, `tDiff`, `tTotal`).

---

### kicad.erc
- **What it does**: Executes native KiCad CLI Electrical Rules Check (`kicad-cli sch erc`) against a schematic file and returns parsed violation issues and summary error/warning counts.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `schPath` (string, required): Absolute file path to `.kicad_sch`. Must match pattern `^([a-zA-Z]:[\\/]|[\\/]).+\.kicad_sch$`.
- **Output Schema**:
  - `issues` (array, required): Standardized issue objects with severity, item IDs, and messages.
  - `summary` (object, required):
    - `errors` (number)
    - `warnings` (number)

---

### kicad.drc
- **What it does**: Executes native KiCad CLI Design Rules Check (`kicad-cli pcb drc`) against a PCB layout file and returns clearance, track width, and connectivity violations.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `pcbPath` (string, required): Absolute file path to `.kicad_pcb`. Must match pattern `^([a-zA-Z]:[\\/]|[\\/]).+\.kicad_pcb$`.
- **Output Schema**:
  - `issues` (array, required): Standardized issue objects with severity, item IDs, and messages.
  - `summary` (object, required):
    - `errors` (number)
    - `warnings` (number)

---

### kicad.export_netlist
- **What it does**: Exports an electrical netlist file from a KiCad schematic using `kicad-cli sch export netlist`.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `schPath` (string, required): Absolute file path to `.kicad_sch`. Must match pattern `^([a-zA-Z]:[\\/]|[\\/]).+\.kicad_sch$`.
  - `format` (string, optional): Target format (e.g., `"spice"` or `"kicadsexpr"`, default `"kicadsexpr"`).
- **Output Schema**:
  - `netlistPath` (string, required): Path to the generated temporary netlist file.

---

### ir.validate
- **What it does**: Validates a Circuit Intermediate Representation (Circuit IR) JSON document against schema rules, part reference uniqueness, and net connectivity semantics.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `ir` (object, required): Circuit IR document to validate.
- **Output Schema**:
  - `valid` (boolean, required): Whether the document conforms to schema and semantic rules.
  - `errors` (array of strings, required): List of validation error messages.

---

### erc.run
- **What it does**: Runs internal electrical rule checks on a Circuit IR document without requiring external CAD tools. Catches single-pin nets, missing footprints, unconnected components, and pin shorts.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `ir` (object, required): Circuit IR document.
  - `commit` (string, required): Commit hash for issue attribution.
- **Output Schema**:
  - `issues` (array, required): Array of detected electrical issue objects.

---

### ir.auto_place
- **What it does**: Automatically computes 2D coordinates (`placement.x`, `placement.y`, `placement.rot`) for unplaced components on a PCB grid.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `ir` (object, required): Circuit IR document containing parts to position.
  - `boardW` (number, required): Board width in mm.
  - `boardH` (number, required): Board height in mm.
  - `gridMm` (number, optional): Placement grid pitch in mm.
  - `marginMm` (number, optional): Perimeter margin in mm.
- **Output Schema**:
  - `ir` (object, required): Circuit IR document with updated part coordinates.
  - `placed` (array of strings, required): List of part reference designators positioned.

---

### ir.to_kicad_sch
- **What it does**: Converts a Circuit IR document into valid KiCad 8.0 schematic S-expression (`.kicad_sch`) text.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `ir` (object, required): Circuit IR document.
  - `title` (string, optional): Title for the schematic title block.
- **Output Schema**:
  - `text` (string, required): S-expression schematic file content.
  - `warnings` (array of strings, required): Warnings generated during translation.

---

### ir.to_kicad_pcb
- **What it does**: Converts a Circuit IR document and board dimensions into valid KiCad PCB layout S-expression (`.kicad_pcb`) text.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `ir` (object, required): Circuit IR document.
  - `boardW` (number, required): Board width in mm.
  - `boardH` (number, required): Board height in mm.
- **Output Schema**:
  - `text` (string, required): S-expression board layout file content.
  - `warnings` (array of strings, required): Warnings generated during translation.

---

### sim.run
- **What it does**: Executes an analytical physical simulation (temperature rise, current capacity, or voltage drop) against an operating environment.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `kind` (string, required): Simulation kind; must be one of `"thermal"`, `"trace-current"`, or `"ir-drop"`.
  - `env` (object, required): Operating environment object (`ambientC`, `humidityPct`, `altitudeM`).
  - `commit` (string, required): Git commit hash.
  - `inputs` (object, required): Simulation input data.
- **Output Schema**:
  - `run` (object, required): Simulation run record with status, timestamps, and results.
  - `issues` (array, required): Detected out-of-spec issues.
  - `error` (string, optional): Error message if simulation failed.

---

### ir.route
- **What it does**: Automatically routes PCB net tracks and places vias using the Freerouting routing engine.
- **Permission Level**: `read`
- **Needs Approval**: No
- **Input Schema Fields**:
  - `ir` (object, required): Circuit IR document.
  - `boardW` (number, required): Board width in mm (`boardW > 0`).
  - `boardH` (number, required): Board height in mm (`boardH > 0`).
  - `rules` (object, optional):
    - `traceWidthMm` (number, optional): Target track width in mm.
    - `clearanceMm` (number, optional): Minimum copper clearance in mm.
- **Output Schema**:
  - `placedIr` (object, required): Circuit IR with placed components.
  - `routes` (object, required):
    - `wires` (array, required): Routed track segments.
    - `vias` (array, required): Placed layer-transition vias.

---

### design.commit
- **What it does**: Writes generated KiCad schematic and PCB files to a local Git repository and commits them with a user-specified commit message.
- **Permission Level**: `destructive`
- **Needs Approval**: **Yes**
- **Input Schema Fields**:
  - `repoPath` (string, required): Absolute path to the local Git repository work tree.
  - `dir` (string, optional): Directory relative to repo root where files are placed (default `"hardware"`). Must not contain `..` or be absolute.
  - `baseName` (string, required): Base filename matching pattern `^[A-Za-z0-9_-]{1,64}$`.
  - `ir` (object, required): Valid Circuit IR document.
  - `boardW` (number, required): Board width in mm (`boardW > 0`).
  - `boardH` (number, required): Board height in mm (`boardH > 0`).
  - `message` (string, required): Commit message between 1 and 200 characters matching pattern `^[\s\S]{1,200}$`.
- **Output Schema**:
  - `commit` (string, required): Full Git commit SHA hash created.
  - `files` (array of strings, required): Relative file paths committed.
