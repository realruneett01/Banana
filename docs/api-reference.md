# Banana API Reference

This reference documents every HTTP endpoint implemented in the Banana backend service (`backend/src/routes`).

Related references:
- [User Guide](user-guide.md) — Comprehensive guide to designing, diffing, and editing boards.
- [MCP Reference](mcp-reference.md) — Model Context Protocol tools and configuration.

---

## Table of Contents

- [Health Routes](#health-routes)
  - [GET /api/health-check](#get-apihealth-check)
- [Git Routes](#git-routes)
  - [POST /api/git/init](#post-apigitinit)
  - [POST /api/git/diff-files](#post-apigitdiff-files)
  - [GET /api/git/commits](#get-apigitcommits)
  - [GET /api/git/evolution](#get-apigitevolution)
- [Diff Routes](#diff-routes)
  - [POST /api/diff/process](#post-apidiffprocess)
  - [POST /api/github/diff/process](#post-apigithubdiffprocess)
- [Board Routes](#board-routes)
  - [POST /api/board/pads](#post-apiboardpads)
  - [POST /api/board/glb](#post-apiboardglb)
- [GitHub Integration Routes](#github-integration-routes)
  - [GET /api/auth/github/url](#get-apiauthgithuburl)
  - [GET /api/auth/github/callback](#get-apiauthgithubcallback)
  - [GET /api/auth/github/verify](#get-apiauthgithubverify)
  - [GET /api/github/repos](#get-apigithubrepos)
  - [GET /api/github/repos/:owner/:repo/branches](#get-apigithubreposownerrepobranches)
  - [GET /api/github/repos/:owner/:repo/commits](#get-apigithubreposownerrepocommits)
  - [GET /api/github/repos/:owner/:repo/pulls](#get-apigithubreposownerrepopulls)
  - [GET /api/github/repos/:owner/:repo/files](#get-apigithubreposownerrepofiles)
- [AI Copilot Routes](#ai-copilot-routes)
  - [GET /api/ai/status](#get-apiaistatus)
  - [POST /api/ai/chat](#post-apiaichat)
- [Agent Design Routes](#agent-design-routes)
  - [POST /api/agent/run](#post-apiagentrun)
- [Circuit Simulation Routes](#circuit-simulation-routes)
  - [POST /api/circuit/simulate](#post-apicircuitsimulate)
  - [POST /api/circuit/suggest-faults](#post-apicircuitsuggest-faults)
- [Editor Routes](#editor-routes)
  - [POST /api/editor/check](#post-apieditorcheck)
  - [POST /api/editor/export](#post-apieditorexport)
- [Library Browser Routes](#library-browser-routes)
  - [GET /api/library/status](#get-apilibrarystatus)
  - [GET /api/library/symbols](#get-apilibrarysymbols)
  - [GET /api/library/symbols/:libId](#get-apilibrarysymbolslibid)
  - [GET /api/library/footprints](#get-apilibraryfootprints)
  - [GET /api/library/footprints/:libId](#get-apilibraryfootprintslibid)
- [Simulation Store Routes](#simulation-store-routes)
  - [GET /api/sim/kinds](#get-apisimkinds)
  - [GET /api/sim/runs](#get-apisimruns)
  - [GET /api/sim/runs/:id](#get-apisimrunsid)
  - [POST /api/sim/run](#post-apisimrun)
  - [POST /api/sim/compare](#post-apisimcompare)
  - [PATCH /api/issues/:id](#patch-apiissuesid)
  - [POST /api/erc/run](#post-apiercrun)

---

## Health Routes

### GET /api/health-check
- **Purpose**: Verifies that the backend server is reachable, verifies `kicad-cli` execution, and reports availability of sub-capabilities (`ngspice`, `kicadLibraries`, `freerouting`).
- **Request Fields**: None.
- **Response Shape**:
  ```json
  {
    "status": "healthy",
    "kicadVersion": "8.0.0",
    "capabilities": {
      "ngspice": true,
      "kicadLibraries": true,
      "freerouting": true
    }
  }
  ```
- **Error Statuses**:
  - `500`: `kicad-cli` failed to execute, executable was not found, or returned empty version information.
- **Rate Limited**: No.
- **Desktop-Only**: No.

---

## Git Routes

### POST /api/git/init
- **Purpose**: Initializes repository metadata for a local directory. Resolves directory paths, verifies `.git` presence, and returns active branches, recent commits, and hardware files.
- **Request Fields** (`application/json`):
  - `repoPath` (string, required): Absolute directory path, or folder name located in a standard user folder (e.g., Documents, Desktop, Projects).
- **Response Shape**:
  ```json
  {
    "resolvedPath": "/path/to/repo",
    "branches": ["main", "feature/power-stage"],
    "commits": [
      {
        "hash": "c0ffee1234567890abcdef1234567890abcdef12",
        "author": "Developer",
        "date": "2026-11-12",
        "subject": "Initial commit"
      }
    ],
    "kicadFiles": ["hardware/board.kicad_pcb", "hardware/board.kicad_sch"]
  }
  ```
- **Error Statuses**:
  - `400`: Missing `repoPath`, or folder is not a valid Git repository.
  - `404`: Could not automatically resolve repository directory for the specified folder name.
  - `500`: Failed to query Git branch or commit logs.
- **Rate Limited**: No.
- **Desktop-Only**: Yes.

### POST /api/git/diff-files
- **Purpose**: Compares two Git references in a local repository and returns all modified KiCad hardware design files.
- **Request Fields** (`application/json`):
  - `repoPath` (string, required): Path to the local repository.
  - `baseRef` (string, required): Baseline commit hash, tag, or branch name.
  - `targetRef` (string, required): Target commit hash, tag, or branch name.
- **Response Shape**:
  ```json
  {
    "files": ["hardware/board.kicad_pcb"]
  }
  ```
- **Error Statuses**:
  - `400`: Missing `repoPath`, `baseRef`, or `targetRef`.
  - `500`: Git execution failure.
- **Rate Limited**: No.
- **Desktop-Only**: Yes.

### GET /api/git/commits
- **Purpose**: Returns recent commit log entries (up to 20 commits), optionally filtered by a specific file.
- **Request Fields** (Query Parameters):
  - `repoPath` (string, required): Path to local git repository on disk. Must not be empty.
  - `filePath` (string, optional): Specific file path to filter log history.
- **Response Shape**:
  ```json
  {
    "commits": [
      {
        "hash": "c0ffee1",
        "message": "Add decoupling capacitors",
        "subject": "Add decoupling capacitors",
        "author": "Git History"
      }
    ]
  }
  ```
- **Error Statuses**:
  - `400`: Missing or invalid `repoPath`, path does not exist on disk, or not a Git repository.
- **Rate Limited**: No.
- **Desktop-Only**: Yes.

### GET /api/git/evolution
- **Purpose**: Calculates the ordered sequence of commits between `baseCommit` and `targetCommit` to drive the History Evolution step-through timeline.
- **Request Fields** (Query Parameters):
  - `repoPath` (string, required): Path to repository.
  - `baseCommit` (string, required): Starting commit hash.
  - `targetCommit` (string, required): Ending commit hash.
  - `filePath` (string, optional): Specific file path to trace.
- **Response Shape**:
  ```json
  {
    "baseCommit": "a1b2c3d",
    "targetCommit": "e5f6g7h",
    "isReversed": false,
    "commits": [
      {
        "hash": "a1b2c3d...",
        "shortHash": "a1b2c3d",
        "author": "Developer",
        "date": "2026-11-10",
        "message": "Initial layout",
        "index": 0
      }
    ],
    "totalSteps": 1,
    "hasIntermediate": false
  }
  ```
- **Error Statuses**:
  - `400`: Missing required query parameters or repository path does not exist.
  - `500`: Git merge-base or rev-list failure.
- **Rate Limited**: No.
- **Desktop-Only**: Yes.

---

## Diff Routes

### POST /api/diff/process
- **Purpose**: Executes the vector diff pipeline on local Git files. Extracts files from two commits, renders SVG layers using `kicad-cli`, and correlates geometric changes.
- **Request Fields** (`application/json`):
  - `repoPath` (string, required): Path to local repository.
  - `baseCommit` (string, required): Commit ref matching pattern `^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$`.
  - `targetCommit` (string, required): Commit ref matching pattern `^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$`.
  - `relativeFilePath` (string, required): Relative file path without `..` traversal, ending in `.kicad_pcb` or `.kicad_sch`.
  - `isPcb` (boolean, optional): Explicit flag indicating PCB mode (defaults to checking extension).
- **Response Shape**:
  ```json
  {
    "base": { "commit": "string", "svgs": [{ "filename": "string", "content": "string" }] },
    "target": { "commit": "string", "svgs": [{ "filename": "string", "content": "string" }] },
    "sideBySide": { "base": [], "target": [] },
    "modifications": [
      {
        "type": "move",
        "tag": "component",
        "id": "U1",
        "label": "U1 (LM555)",
        "layer": "F.Cu",
        "text": "Component U1 shifted position"
      }
    ],
    "pcbMetadata": {
      "nets": ["GND", "VCC"],
      "footprintCount": 12,
      "padCount": 48,
      "segmentCount": 85,
      "footprintChanges": []
    },
    "telemetry": {
      "tGit": 12.5,
      "tCli": 450.2,
      "tDiff": 35.1,
      "tTotal": 497.8,
      "layersProcessed": 4,
      "layerTelemetries": []
    }
  }
  ```
- **Error Statuses**:
  - `400`: Missing or invalid parameters, invalid commit ref, or invalid file path.
  - `403`: Local repositories are disabled on this server instance (`allowLocalRepos` is false).
  - `500`: KiCad rendering failure or extraction error.
- **Rate Limited**: No.
- **Desktop-Only**: Yes.

### POST /api/github/diff/process
- **Purpose**: Executes the diff pipeline directly on files downloaded from a remote GitHub repository without requiring a local clone.
- **Request Fields** (`application/json`):
  - Headers: `Authorization: Bearer <token>` or request body field `token` (string, required).
  - `owner` (string, required): GitHub repository owner.
  - `repo` (string, required): GitHub repository name.
  - `baseCommit` (string, required): Base commit SHA or branch.
  - `targetCommit` (string, required): Target commit SHA or branch.
  - `filePath` (string, required): Path to `.kicad_pcb` or `.kicad_sch` file in repository.
  - `isPcb` (boolean, optional): Override flag indicating PCB mode.
- **Response Shape**: Identical to `POST /api/diff/process`.
- **Error Statuses**:
  - `400`: Missing required parameters.
  - `401`: Missing or invalid GitHub authentication token.
  - `500`: GitHub download error or rendering failure.
- **Rate Limited**: No.
- **Desktop-Only**: No.

---

## Board Routes

### POST /api/board/pads
- **Purpose**: Parses a `.kicad_pcb` file at a specific commit (local Git or remote GitHub) and returns component pad locations, sizes, net assignments, and layer masks.
- **Request Fields** (`application/json`):
  - `commit` (string, required): Commit ref (pattern `^[0-9a-fA-F]{4,40}$` or `^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$`).
  - `relativeFilePath` or `filePath` (string, required): Relative path ending in `.kicad_pcb` or `.kicad_sch`.
  - Local mode:
    - `repoPath` (string, required if local): Path to local git repository.
  - Remote GitHub mode:
    - `owner` (string, required if remote): GitHub repository owner.
    - `repo` (string, required if remote): GitHub repository name.
    - `token` (string or header `Authorization: Bearer <token>`): GitHub personal access token.
- **Response Shape**:
  ```json
  {
    "footprints": [
      {
        "reference": "R1",
        "layer": "F.Cu",
        "pads": [
          {
            "number": "1",
            "net": "VCC",
            "absAt": { "x": 10.5, "y": 20.0 },
            "size": { "w": 0.8, "h": 1.2 },
            "layers": ["F.Cu", "F.Mask"]
          }
        ]
      }
    ]
  }
  ```
- **Error Statuses**:
  - `400`: Missing commit or target file, invalid commit ref, or invalid file path.
  - `401`: GitHub authentication token missing for remote repository request.
  - `403`: Local repositories disabled on this server.
  - `500`: PCB S-expression parsing error.
- **Rate Limited**: No.
- **Desktop-Only**: Partial (requires local repository mode when targeting local paths; supports remote GitHub on web).

### POST /api/board/glb
- **Purpose**: Extracts a `.kicad_pcb` file at a commit and renders a 3D binary glTF model (`.glb`) containing copper, mask, silkscreen, and 3D component models.
- **Request Fields** (`application/json`):
  - Identical request structure to `POST /api/board/pads`.
- **Response Shape**:
  - Binary stream with Content-Type `model/gltf-binary`.
  - Response headers include `X-Banana-Glb-Cached: 1|0` and `X-Banana-Glb-Ms: <duration>`.
- **Error Statuses**:
  - `400`: Validation error.
  - `401`: Unauthorized (missing GitHub token for remote target).
  - `403`: Local repositories disabled.
  - `500`: KiCad 3D export failure.
- **Rate Limited**: No.
- **Desktop-Only**: Partial (same as `/pads`).

---

## GitHub Integration Routes

### GET /api/auth/github/url
- **Purpose**: Generates the OAuth authorization URL with a unique CSRF state parameter.
- **Request Fields**: None.
- **Response Shape**:
  ```json
  {
    "url": "https://github.com/login/oauth/authorize?client_id=...&state=...",
    "configured": true
  }
  ```
- **Error Statuses**: Returns `{ "configured": false, "error": "..." }` if GitHub OAuth client ID is not configured.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/auth/github/callback
- **Purpose**: GitHub OAuth redirect destination. Validates state, exchanges authorization code for an access token, and redirects back to the frontend with the token fragment.
- **Request Fields** (Query Parameters):
  - `code` (string, required): Temporary OAuth code.
  - `state` (string, required): CSRF state token issued by `/api/auth/github/url`.
- **Response Shape**:
  - HTTP 302 Redirect to `${frontendUrl}/#github_token=<token>` on success, or `#github_error=<error>` on failure.
- **Error Statuses**:
  - `400`: Invalid OAuth state or missing code.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/auth/github/verify
- **Purpose**: Validates a GitHub token and retrieves authenticated user information.
- **Request Fields**:
  - Headers: `Authorization: Bearer <token>` or query parameter `token`.
- **Response Shape**:
  ```json
  {
    "authenticated": true,
    "user": {
      "login": "octocat",
      "avatarUrl": "https://avatars.githubusercontent.com/u/583231"
    }
  }
  ```
- **Error Statuses**:
  - `401`: Missing token or token rejected by GitHub API.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/github/repos
- **Purpose**: Lists repositories owned or accessible by the authenticated user.
- **Request Fields**:
  - Headers: `Authorization: Bearer <token>` or query `token`.
  - Query parameter `page` (number/string, optional): Pagination index, default 1.
- **Response Shape**:
  ```json
  {
    "repos": [
      {
        "id": 123456,
        "name": "my-hardware-project",
        "full_name": "user/my-hardware-project",
        "default_branch": "main"
      }
    ]
  }
  ```
- **Error Statuses**:
  - `401`: Token missing.
  - `500`: GitHub API error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/github/repos/:owner/:repo/branches
- **Purpose**: Lists branches in a GitHub repository.
- **Request Fields**:
  - Path parameters: `owner` (string, required), `repo` (string, required).
  - Headers: `Authorization: Bearer <token>` or query `token`.
- **Response Shape**:
  ```json
  {
    "branches": ["main", "v1.0-release"]
  }
  ```
- **Error Statuses**:
  - `401`: Token missing.
  - `500`: GitHub API error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/github/repos/:owner/:repo/commits
- **Purpose**: Lists commits in a GitHub repository, with optional ref and file path filters.
- **Request Fields**:
  - Path parameters: `owner` (string, required), `repo` (string, required).
  - Query parameters: `sha` (string, optional branch or commit SHA), `path` (string, optional file path filter).
  - Headers: `Authorization: Bearer <token>` or query `token`.
- **Response Shape**:
  ```json
  {
    "commits": [
      {
        "hash": "d1e2f3a4b5c6",
        "author": "Alice",
        "date": "2026-11-12",
        "subject": "Update regulator package"
      }
    ]
  }
  ```
- **Error Statuses**:
  - `401`: Token missing.
  - `500`: GitHub API error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/github/repos/:owner/:repo/pulls
- **Purpose**: Lists pull requests in a GitHub repository.
- **Request Fields**:
  - Path parameters: `owner` (string, required), `repo` (string, required).
  - Query parameter `state` (string, optional): `"open"`, `"closed"`, or `"all"` (default `"open"`).
  - Headers: `Authorization: Bearer <token>` or query `token`.
- **Response Shape**:
  ```json
  {
    "pulls": [
      {
        "number": 42,
        "title": "Rev B changes",
        "base": { "ref": "main", "sha": "111111..." },
        "head": { "ref": "rev-b", "sha": "222222..." }
      }
    ]
  }
  ```
- **Error Statuses**:
  - `401`: Token missing.
  - `500`: GitHub API error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/github/repos/:owner/:repo/files
- **Purpose**: Lists all `.kicad_pcb` and `.kicad_sch` hardware files in a repository.
- **Request Fields**:
  - Path parameters: `owner` (string, required), `repo` (string, required).
  - Query parameter `ref` (string, optional): Target Git commit or branch (defaults to `"main"`).
  - Headers: `Authorization: Bearer <token>` or query `token`.
- **Response Shape**:
  ```json
  {
    "files": ["hardware/sensor_node.kicad_pcb", "hardware/sensor_node.kicad_sch"]
  }
  ```
- **Error Statuses**:
  - `401`: Token missing.
  - `500`: GitHub API error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

---

## AI Copilot Routes

### GET /api/ai/status
- **Purpose**: Checks the availability and configuration status of the AI Hardware Copilot service.
- **Request Fields**: None.
- **Response Shape**:
  ```json
  {
    "status": "ok",
    "serverKeyConfigured": true,
    "model": "gemini-3-flash-preview",
    "kicadVersion": "8.0.0",
    "kicadCliPath": "kicad-cli"
  }
  ```
- **Error Statuses**: None.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### POST /api/ai/chat
- **Purpose**: Streams AI hardware copilot responses using Server-Sent Events (SSE).
- **Request Fields** (`application/json`):
  - Headers: `X-Gemini-Api-Key` (string, optional client-provided API key).
  - `messages` (array, optional): Array of `{ role: "user" | "assistant", content: string }`.
  - `boardContext` (object, optional): Active schematic or PCB metadata for contextual grounding.
  - `model` (string, optional): Specific Gemini model override.
- **Response Shape**:
  - Content-Type: `text/event-stream`.
  - Events:
    - Chunk: `data: {"text":"..."}\n\n`
    - Done: `data: {"done":true,"modelUsed":"..."}\n\n`
    - Error: `data: {"error":"...","isKeyRequired":false}\n\n`
- **Error Statuses**: Errors are delivered as SSE message events rather than HTTP error codes.
- **Rate Limited**: No.
- **Desktop-Only**: No.

---

## Agent Design Routes

### POST /api/agent/run
- **Purpose**: Runs the autonomous AI circuit design agent. The agent plans, calls design tools, validates Circuit IR, and places components.
- **Request Fields** (`application/json`):
  - `message` (string, required): 1 to 8,000 characters describing the hardware design request.
  - `approved` (boolean, optional): Whether destructive tool calls (e.g., git commits) are pre-approved.
  - `maxSteps` (integer, optional): Maximum reasoning steps, integer from 1 to 16.
- **Response Shape**:
  ```json
  {
    "text": "Created 555 timer flasher circuit with 10k resistor and 10uF capacitor.",
    "steps": 4,
    "events": [
      { "type": "step", "step": 1, "maxSteps": 8 },
      { "type": "tool_call", "name": "ir.validate", "input": { ... } },
      { "type": "tool_result", "name": "ir.validate", "ok": true, "output": { "valid": true } }
    ],
    "pendingApproval": null
  }
  ```
- **Error Statuses**:
  - `400`: Request body not an object, message empty or longer than 8,000 chars, approved not a boolean, or maxSteps outside 1-16.
  - `500`: Agent execution failure.
- **Rate Limited**: No.
- **Desktop-Only**: No (operates with sandboxed design tools on web; activates local Git and KiCad tools when running locally).

---

## Circuit Simulation Routes

### POST /api/circuit/simulate
- **Purpose**: Runs analog circuit simulations via `ngspice` with optional fault injection, calculating node voltages, part currents, and plain-English explanations.
- **Request Fields** (`application/json`):
  - `ir` (object, required): Valid Circuit IR document conforming to schema.
  - `fault` (object, optional): Simulated fault specification:
    - `kind` (string, required): Must be one of `FAULT_KINDS` (`open_net`, `short_net`, `bridge_nets`, `part_open`, `part_short`, `param_drift`, `rail_sag`, `rail_surge`, `esd_strike`, `reverse_polarity`, `cold_joint`).
    - Additional fields such as `netId`, `partId`, `targetNetId`.
  - `analysis` (object, optional):
    - `type` (string): `"op"` (operating point) or `"tran"` (transient).
    - If `type: "tran"`:
      - `stopS` (number): Simulation stop time in seconds (`0 < stopS <= 1`).
      - `stepS` (number): Simulation time step in seconds (`stepS > 0` and `stepS >= stopS / 10000`).
- **Response Shape**:
  ```json
  {
    "nodeVoltages": { "net_vcc": 5.0, "net_out": 2.45 },
    "partCurrents": { "part_r1": 0.0005 },
    "warnings": [],
    "fault": null,
    "series": {
      "time": [0, 0.001, 0.002],
      "nodeVoltages": { "net_out": [0, 1.2, 2.45] },
      "partCurrents": { "part_r1": [0, 0.0002, 0.0005] }
    },
    "explanation": {
      "summary": "Circuit operates normally with stable output.",
      "cards": [
        {
          "id": "card_1",
          "level": "info",
          "title": "Nominal Current",
          "text": "All components draw currents within safe operating limits."
        }
      ]
    },
    "fixes": []
  }
  ```
- **Error Statuses**:
  - `400`: Invalid Circuit IR, unknown fault kind, or invalid transient bounds.
  - `422`: ngspice simulation failed to converge; returns sanitized SPICE log output.
  - `429`: Rate limit exceeded on web server.
  - `503`: `ngspice` simulator executable is not installed on the server.
  - `500`: Unexpected simulation failure.
- **Rate Limited**: Yes (30 requests per minute on web; bypassed when local).
- **Desktop-Only**: No.

### POST /api/circuit/suggest-faults
- **Purpose**: Analyzes a Circuit IR and suggests realistic failure scenarios (opens, shorts, parameter drifts) for automated resilience testing.
- **Request Fields** (`application/json`):
  - `ir` (object, required): Valid Circuit IR document.
- **Response Shape**:
  ```json
  {
    "faults": [
      {
        "kind": "open_net",
        "netId": "net_reset",
        "info": {
          "label": "Open net: RESET",
          "plainEnglish": "Disconnects the reset pin, causing floating logic."
        }
      }
    ]
  }
  ```
- **Error Statuses**:
  - `400`: Invalid Circuit IR.
  - `429`: Rate limit exceeded on web server.
  - `500`: Fault suggestion failure.
- **Rate Limited**: Yes (30 requests per minute on web; bypassed when local).
- **Desktop-Only**: No.

---

## Editor Routes

### POST /api/editor/check
- **Purpose**: Runs live background design checks (electrical rules and layout design rules) on current in-memory schematic and board state.
- **Request Fields** (`application/json`):
  - `ir` (object, required): Valid Circuit IR document.
  - `board` (object, optional): PCB board layout containing tracks, outline, and vias. Maximum 20,000 tracks.
  - `rules` (object, optional): Custom DRC threshold overrides:
    - `clearanceMm` (number, default 0.2): Minimum track-to-track clearance.
    - `minTrackWidthMm` (number, default 0.15): Minimum allowed track width.
    - `edgeClearanceMm` (number, default 0.3): Minimum distance from board perimeter.
- **Response Shape**:
  ```json
  {
    "issues": [
      {
        "id": "issue_123",
        "source": "drc",
        "severity": "error",
        "itemIds": ["track_1", "track_2"],
        "metric": "clearance",
        "measured": 0.12,
        "limit": 0.2,
        "unit": "mm",
        "message": "These two copper tracks are too close (0.12 mm, need 0.2 mm) - they could short.",
        "suggestion": "increase spacing between tracks or reroute",
        "status": "open"
      }
    ],
    "markers": [
      {
        "issueId": "issue_123",
        "at": [12.4, 25.1],
        "layer": "F.Cu"
      }
    ]
  }
  ```
- **Error Statuses**:
  - `400`: Invalid Circuit IR document.
  - `413`: Board exceeds track limit (max 20,000 tracks).
  - `429`: Rate limit exceeded.
  - `500`: Internal check error.
- **Rate Limited**: Yes (120 requests per minute on web; bypassed when local).
- **Desktop-Only**: No.

### POST /api/editor/export
- **Purpose**: Compiles in-memory Circuit IR and PCB layout into KiCad schematic (`.kicad_sch`) and board (`.kicad_pcb`) S-expression files.
- **Request Fields** (`application/json`):
  - `ir` (object, required): Valid Circuit IR document.
  - `board` (object, optional): Board layout object with dimensions and footprints. Maximum 20,000 tracks.
  - `title` (string, optional): Schematic document title.
  - `boardW` (number, optional): Board width in mm.
  - `boardH` (number, optional): Board height in mm.
- **Response Shape**:
  ```json
  {
    "files": {
      "circuit.kicad_sch": "(kicad_sch ...)",
      "circuit.kicad_pcb": "(kicad_pcb ...)"
    },
    "warnings": []
  }
  ```
- **Error Statuses**:
  - `400`: Invalid Circuit IR document.
  - `413`: Board exceeds track limit (max 20,000 tracks).
  - `429`: Rate limit exceeded.
  - `500`: Export generation failure.
- **Rate Limited**: Yes (120 requests per minute on web; bypassed when local).
- **Desktop-Only**: No.

---

## Library Browser Routes

### GET /api/library/status
- **Purpose**: Checks whether KiCad system component symbol and footprint libraries are accessible on disk.
- **Request Fields**: None.
- **Response Shape**:
  ```json
  {
    "available": true
  }
  ```
- **Error Statuses**:
  - `500`: Library status check error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/library/symbols
- **Purpose**: Searches installed KiCad schematic symbol libraries by keyword.
- **Request Fields** (Query Parameters):
  - `q` (string, required): Non-empty search term, maximum 100 characters.
  - `limit` (number/string, optional): Integer between 1 and 100 (default 50).
- **Response Shape**:
  ```json
  {
    "symbols": [
      {
        "id": "Device:R",
        "name": "R",
        "library": "Device",
        "description": "Resistor"
      }
    ]
  }
  ```
- **Error Statuses**:
  - `400`: Query parameter `q` missing/invalid or `limit` out of bounds.
  - `503`: KiCad libraries are not installed on this server.
  - `500`: Search failed.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/library/symbols/:libId
- **Purpose**: Retrieves full graphical drawing primitives, pins, and properties for a single schematic symbol.
- **Request Fields**:
  - Path parameter `libId` (string, required): Symbol identifier formatted as `<library>:<symbol>` (e.g. `Device:R`).
- **Response Shape**:
  ```json
  {
    "symbol": {
      "id": "Device:R",
      "pins": [],
      "graphics": []
    }
  }
  ```
- **Error Statuses**:
  - `400`: Invalid library identifier format.
  - `404`: Symbol not found.
  - `503`: KiCad libraries not installed.
  - `500`: Retrieval error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/library/footprints
- **Purpose**: Searches installed KiCad PCB footprint libraries.
- **Request Fields** (Query Parameters):
  - `q` (string, required): Non-empty query string, maximum 100 characters.
  - `limit` (number/string, optional): Integer between 1 and 100 (default 50).
- **Response Shape**:
  ```json
  {
    "footprints": [
      {
        "id": "Resistor_SMD:R_0805_2012Metric",
        "name": "R_0805_2012Metric",
        "library": "Resistor_SMD",
        "description": "Resistor SMD 0805 (2012 Metric)"
      }
    ]
  }
  ```
- **Error Statuses**:
  - `400`: Invalid search query or limit.
  - `503`: KiCad libraries not installed.
  - `500`: Search failed.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/library/footprints/:libId
- **Purpose**: Retrieves physical footprint geometry (pads, outlines, silkscreen, and drills) for a single footprint.
- **Request Fields**:
  - Path parameter `libId` (string, required): Footprint identifier formatted as `<library>:<footprint>`.
- **Response Shape**:
  ```json
  {
    "footprint": {
      "id": "Resistor_SMD:R_0805_2012Metric",
      "pads": [],
      "graphics": []
    }
  }
  ```
- **Error Statuses**:
  - `400`: Invalid library identifier format.
  - `404`: Footprint not found.
  - `503`: KiCad libraries not installed.
  - `500`: Retrieval error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

---

## Simulation Store Routes

### GET /api/sim/kinds
- **Purpose**: Returns the list of physical simulation kinds supported by the backend engine.
- **Request Fields**: None.
- **Response Shape**:
  ```json
  {
    "kinds": ["thermal", "trace-current", "ir-drop"]
  }
  ```
- **Error Statuses**: None.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/sim/runs
- **Purpose**: Queries persisted simulation run records matching optional filters.
- **Request Fields** (Query Parameters):
  - `commit` (string, optional): 7-40 character hexadecimal Git commit hash.
  - `envId` (string, optional): Valid environment ID prefix `env_...`.
  - `kind` (string, optional): One of `"thermal"`, `"trace-current"`, `"ir-drop"`.
- **Response Shape**:
  ```json
  {
    "runs": [
      {
        "id": "sim_12345678",
        "commit": "a1b2c3d...",
        "envId": "env_automotive",
        "kind": "thermal",
        "status": "done",
        "startedAt": "2026-11-12T03:00:00.000Z",
        "finishedAt": "2026-11-12T03:00:01.200Z",
        "results": []
      }
    ]
  }
  ```
- **Error Statuses**:
  - `400`: Invalid query filter parameters.
  - `500`: Storage query failure.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### GET /api/sim/runs/:id
- **Purpose**: Retrieves a single simulation run record and its associated issues.
- **Request Fields**:
  - Path parameter `id` (string, required): Simulation run ID prefix `sim_...`.
- **Response Shape**:
  ```json
  {
    "run": {
      "id": "sim_12345678",
      "commit": "a1b2c3d...",
      "envId": "env_automotive",
      "kind": "thermal",
      "status": "done",
      "results": []
    },
    "issues": []
  }
  ```
- **Error Statuses**:
  - `400`: Invalid simulation run ID format.
  - `404`: Run not found.
  - `500`: Storage query failure.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### POST /api/sim/run
- **Purpose**: Executes an analytical physical simulation (`thermal`, `trace-current`, or `ir-drop`) against an operating environment and records results in the simulation store.
- **Request Fields** (`application/json`):
  - `kind` (string, required): One of `"thermal"`, `"trace-current"`, or `"ir-drop"`.
  - `commit` (string, required): 7-40 character hexadecimal Git commit hash.
  - `env` (object, required): Environment specification containing `id`, `name`, `ambientC`, `humidityPct`, `altitudeM`.
  - `inputs` (object, required): Simulation inputs (e.g., component power dissipations, trace widths, rail voltages).
- **Response Shape**:
  ```json
  {
    "run": {
      "id": "sim_abcdef12",
      "commit": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "envId": "env_industrial",
      "kind": "thermal",
      "status": "done",
      "startedAt": "2026-11-12T03:15:00.000Z",
      "finishedAt": "2026-11-12T03:15:00.800Z",
      "results": []
    },
    "issues": []
  }
  ```
- **Error Statuses**:
  - `400`: Invalid kind, invalid commit hash, or non-object environment/inputs.
  - `422`: Simulation execution failed.
  - `500`: Server processing failure.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### POST /api/sim/compare
- **Purpose**: Compares simulation outcomes and issue status between two Git commits for a specific operating environment and simulation kind.
- **Request Fields** (`application/json`):
  - `before` (string, required): 7-40 character hex hash for earlier commit.
  - `after` (string, required): 7-40 character hex hash for later commit.
  - `envId` (string, optional): Environment ID prefix `env_...`.
  - `kind` (string, optional): One of `"thermal"`, `"trace-current"`, `"ir-drop"`.
- **Response Shape**:
  ```json
  {
    "before": { "run": {}, "issues": [] },
    "after": { "run": {}, "issues": [] },
    "diff": {
      "fixed": [],
      "introduced": [],
      "persisting": []
    }
  }
  ```
- **Error Statuses**:
  - `400`: Invalid commit hash format or filter parameters.
  - `404`: No recorded simulation run found for one of the commits.
  - `500`: Comparison execution error.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### PATCH /api/issues/:id
- **Purpose**: Updates the triage status of an issue created during simulation or design rule checking.
- **Request Fields**:
  - Path parameter `id` (string, required): Valid issue ID prefix `issue_...`.
  - Body (`application/json`):
    - `status` (string, required): Must be one of `"open"`, `"fixed"`, or `"wontfix"`.
- **Response Shape**:
  ```json
  {
    "ok": true
  }
  ```
- **Error Statuses**:
  - `400`: Invalid issue ID or invalid status value.
  - `404`: Issue ID not found in database.
  - `500`: Database update failure.
- **Rate Limited**: No.
- **Desktop-Only**: No.

### POST /api/erc/run
- **Purpose**: Runs electrical rules check on a Circuit IR document, checking net pin counts, power rail constraints, unconnected parts, missing footprints, and pin short circuits.
- **Request Fields** (`application/json`):
  - `ir` (object, required): Valid Circuit IR document.
  - `commit` (string, optional): Commit hash for issue attribution.
- **Response Shape**:
  ```json
  {
    "issues": [
      {
        "id": "issue_erc1",
        "source": "erc",
        "severity": "error",
        "itemIds": ["net_clk"],
        "message": "net CLK has only 1 pin(s)",
        "suggestion": "connect it or delete the net",
        "commit": "a1b2c3d...",
        "status": "open"
      }
    ]
  }
  ```
- **Error Statuses**:
  - `400`: Invalid Circuit IR document.
  - `500`: ERC execution error.
- **Rate Limited**: No.
- **Desktop-Only**: No.
