# Banana Backend Load Test Harness

Aggressive, standalone load test harness for benchmarking the Banana backend HTTP and MCP endpoints under concurrent load.

## Overview

- **Zero External Dependencies**: Built using Node.js standard libraries (`node:fs`, `node:perf_hooks`, `node:process`) and native global `fetch`.
- **Target Mode**: Does not boot an internal server; it targets an already running backend instance.
- **Concurrent Promise Pools**: Manages worker pools to sustain configured concurrency over designated durations.
- **Latency & Error Tracking**: Computes p50, p95, p99, and max latencies, request throughput (RPS), and status code breakdowns.
- **Backend Liveness Monitoring**: Accepts `--pid` to monitor backend process health without heavy memory-sampling dependencies.

## Prerequisites

Before executing the load test, start the Banana backend with `BANANA_ALLOW_LOCAL_REPOS=1` so that local repository and editor operations are permitted without requiring a desktop app security token.

### Starting the Backend

**Bash / Linux / macOS**:
```bash
BANANA_ALLOW_LOCAL_REPOS=1 npm run dev:backend
```

**PowerShell (Windows)**:
```powershell
$env:BANANA_ALLOW_LOCAL_REPOS = "1"
npm run dev:backend
```

The server defaults to listening on `http://127.0.0.1:5000`.

## Running the Load Test

```bash
node test/stress/api-load.mjs [options]
```

### Command Line Options

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--base <url>` | `http://127.0.0.1:5000` | Target base URL of the running backend |
| `--duration <seconds>` | `60` | Duration to run each selected scenario in seconds |
| `--concurrency <count>` | `50` | Number of concurrent requests / workers |
| `--scenario <name\|all>` | `all` | Specific scenario name or `all` to run all available scenarios |
| `--sch <path>` | `C:/Program Files/KiCad/10.0/share/kicad/demos/pic_programmer/pic_programmer.kicad_sch` | Path to sample KiCad schematic file for import and check |
| `--pcb <path>` | `C:/Program Files/KiCad/10.0/share/kicad/demos/pic_programmer/pic_programmer.kicad_pcb` | Path to sample KiCad PCB file for import |
| `--mcp-token <token>` | `""` | Optional authorization token; enables the `mcp` scenario |
| `--pid <number>` | `null` | Optional backend PID to check process liveness during the test |

### Examples

Run all standard scenarios for 30 seconds at concurrency 20:
```bash
node test/stress/api-load.mjs --base http://127.0.0.1:5000 --duration 30 --concurrency 20 --scenario all
```

Run only the schematic import test with custom demo file:
```bash
node test/stress/api-load.mjs --scenario import-sch --duration 10 --concurrency 10 --sch "path/to/demo.kicad_sch"
```

Run simulation load test with process health check:
```bash
node test/stress/api-load.mjs --scenario sim --duration 15 --concurrency 25 --pid 12345
```

Run with MCP scenario enabled:
```bash
node test/stress/api-load.mjs --scenario mcp --mcp-token "my-test-token" --duration 20 --concurrency 10
```

## Scenarios

| Scenario | Target Endpoint & Method | Default p95 Budget | Description |
| :--- | :--- | :--- | :--- |
| `health` | `GET /api/library/status` | 50 ms | Quick health & KiCad library readiness probe |
| `search` | `GET /api/library/symbols?q=<term>&limit=50` | 300 ms | Symbol search querying random terms (`res`, `cap`, `led`, `op`, `usb`, `mcu`, `555`, `lm`) |
| `libtree` | `GET /api/library/symbols/libraries` then items | 500 ms | Fetches symbol library listing followed by querying items from a random library |
| `import-sch` | `POST /api/editor/import?kind=sch` | 3000 ms | Imports full KiCad schematic text and produces Circuit IR |
| `import-pcb` | `POST /api/editor/import?kind=pcb` | 3000 ms | Imports full KiCad board layout text and produces board model |
| `check` | `POST /api/editor/check` | 1000 ms | Runs live DRC / ERC rules checks against imported Circuit IR |
| `sim` | `POST /api/circuit/simulate` | 5000 ms | Runs SPICE circuit simulation using an RC filter circuit IR |
| `mcp` | `POST /mcp` | 500 ms | Executes JSON-RPC `initialize` and `tools/list` sequence (runs when `--mcp-token` is provided) |

## Pass / Fail Criteria

At the conclusion of the test, a summary table is printed with requests, RPS, status breakdown, latency percentiles, and backend status.

The script exits with **code 1** if any scenario meets either condition:
1. **Error Rate**: More than 1.0% of requests return an error (non-2xx HTTP code or network failure).
2. **Latency Budget**: The 95th percentile latency (`p95`) exceeds the per-scenario budget.
