# Phase 1 contract: engine core (frozen for wave A)

All modules live in `backend/src/engine/`, are ES modules, use **no new dependencies**, and export plain functions.
Every validator returns `{ ok: boolean, errors: string[] }` and never throws on bad input.
Error strings are `"<path>: <problem>"`, for example `"parts[2].id: missing"`.

## ids.js
- `newId(kind)` returns `"<kind>_<uuid>"`, using `crypto.randomUUID()`. `kind` is one of `part net pin trace via zone sheet issue sim env tool`.
- `isId(value, kind?)` checks the shape and, if `kind` is given, the kind.
- `kindOf(id)` returns the kind, or `null`.
- IDs are permanent. Nothing may ever reuse or renumber them, because diff, simulation and issues all link through them.

## schema-lite.js
- `validate(schema, value)` takes a tiny JSON-Schema subset: `type` (`object`, `array`, `string`, `number`, `integer`, `boolean`, `null`), `required`, `properties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `pattern`, `additionalProperties: false`.
- It returns `{ ok, errors }`, with errors written as `"<path>: <problem>"`.
- Every other module builds its validator on top of this.

## circuit-ir.js
The Circuit IR is the agent's design description, with KiCad files as the stored form.
- `CIRCUIT_IR_SCHEMA` and `validateCircuitIR(ir)`.
- Shape:
  - `{ schemaVersion: 1, name, parts[], nets[], constraints[] }`
  - Each part: `{ id: part_*, ref: "U1", value, symbol: "Lib:Name", footprint: "Lib:Name", props: {}, placement?: { x, y, rot, side: "F"|"B" } }`
  - Each net: `{ id: net_*, name, pins: [{ partId, pin }] }`
  - Each constraint: `{ id, kind: "rail"|"current"|"impedance"|"keepout"|"size"|"layers", target, value, unit }`
- Semantic checks on top of the schema, each reported as its own error:
  - duplicate `ref` values
  - a net pin that points at a `partId` that doesn't exist
  - duplicate IDs anywhere

## environment-sim.js
- `ENVIRONMENT_SCHEMA` and `validateEnvironment(env)`.
  - Shape: `{ id: env_*, name, ambientC: {min, max}, humidityPct: {min, max}, altitudeM, vibration?: { psdG2Hz, fromHz, toHz }, shockG?, airflowMs? }`
  - Rule: min ≤ max.
- `SIM_RUN_SCHEMA` and `validateSimRun(run)`.
  - Shape: `{ id: sim_*, commit: 40-hex or short 7+ hex, envId: env_*, kind: "trace-current"|"ir-drop"|"impedance"|"spice"|"thermal", status: "queued"|"running"|"done"|"failed", startedAt, finishedAt?, results: [{ itemId, metric, value, unit }] }`

## issue.js
- `ISSUE_SCHEMA` and `validateIssue(issue)`.
  - Shape: `{ id: issue_*, source: "drc"|"erc"|"sim", severity: "error"|"warning"|"info", itemIds: [ids, min 1], metric?, measured?, limit?, unit?, message, suggestion?, simRunId?: sim_*, commit, status: "open"|"fixed"|"wontfix" }`
- `issuesForItem(issues, itemId)` returns the issues that touch that item.
- `compareRuns(before, after)` takes two arrays of issues for the same environment. It matches them by `source + metric + itemIds` and returns `{ fixed[], stillOpen[], new[] }`. The diff view uses this to show results before and after a fix.

## tool-registry.js
- `createRegistry()` returns `{ register, list, call }`.
- `register({ name, description, inputSchema, outputSchema, permission: "read"|"write"|"destructive", handler })`.
  - It throws if the name is a duplicate or the definition is invalid.
- `list()` returns `[{ name, description, inputSchema, permission }]`. The MCP server and the agent read tools through this.
- `call(name, input, ctx)` validates the input against `inputSchema`, runs `handler(input, ctx)` and validates the output.
  - It returns `{ ok: true, output }` or `{ ok: false, error }`.
  - A `destructive` tool requires `ctx.approved === true`. Without it, `call` returns `{ ok: false, error: "approval required" }`.

## Tests
Each module gets `test/unit/engine-<module>.test.mjs`, using `node:test` and `node:assert/strict`. The tests cover valid input, every rule, and the edge cases. The suite must pass under `npm test`.
