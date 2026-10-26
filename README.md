# Banana — visual Git diff and design studio for KiCad

Banana has two modes, switched in the header: **Diff** compares two Git versions of a KiCad design and shows what physically changed; **Studio** is a design environment where you describe a board to an AI assistant (or edit it by hand) and watch KiCad draw it, with every change saved as a build you can compare, undo or open in the Diff view. Both run on KiCad's own engine (`kicad-cli`); see [Banana Studio](#banana-studio) and the honest feature scorecard in [`docs/PARITY.md`](docs/PARITY.md).

The Diff mode compares two Git versions of a KiCad schematic (`.kicad_sch`) or board (`.kicad_pcb`) and shows **what physically changed** — not a text diff of S-expressions. It renders both versions with `kicad-cli`, diffs the rendered geometry, then maps each difference back to the part, pad or net it belongs to.

> **Free, proprietary software.** Free to download and use, including commercially; source code, redistribution and reverse-engineering rights are reserved — see [`LICENSE`](LICENSE). Third-party notices are in [`NOTICE.md`](NOTICE.md).

## What it does

- Side-by-side and overlay views of the two versions, with synchronised pan/zoom.
- Colour-coded changes: added, deleted, changed; unchanged geometry is greyed out.
- An audit list of changes ("R1 relocated by 2.00 mm on F.Cu", "added GND trace on B.Cu") with click-to-focus.
- A multi-pass matching engine (`backend/src/svg-diff-processor.js`): copper track-chain assembly, reference-designator matching, exact and proximity primitive matching, and a residual pass. Footprint moves/rotations/value changes are detected from the parsed board (`backend/src/kicad-pcb-parser.js`) and used to avoid reporting the same move many times.
- Commit evolution timeline between two commits for one file.
- Sources: a **local Git repository** on the same machine, or **GitHub** (OAuth or personal access token).
- Optional AI copilot (Google Gemini). Needs your own `GEMINI_API_KEY`; without one the rest of the app works normally.
- **Studio** (new): design and edit boards inside Banana, rendered by KiCad, with the same change colours in its Changes view. See below.

## What it does **not** do

- It does not talk to hardware, sensors or devices. "Calibration" below means a software self-check of the computer it runs on.
- It does not render KiCad files itself; it needs KiCad's `kicad-cli` (KiCad **7 or newer**).
- Sign-in is off by default (single-user desktop use). Turn it on for shared or server use (see [Sign-in](#sign-in-accounts) and [Security](#security)); do not put an un-protected instance on the open internet.
- It is a review aid. Do not use it as the only check before releasing hardware to manufacture.

## Requirements

| Needed | Notes |
|---|---|
| Node.js **20.11+** | Already included in the per-platform downloads; only needed for the universal zip or a source checkout. |
| KiCad **7+** (`kicad-cli`) | On `PATH`, in a standard install dir, in `KICAD_CLI_PATH`, or in `runtime/kicad*/`. |
| Git | To read commits from local repositories. |

## Quick start (development)

```bash
npm ci
npm run build        # builds the UI into frontend/dist
npm start            # preflight + calibration, then starts on http://127.0.0.1:5000
```

Hot-reload development: `npm run dev` (backend on :5000 via nodemon, Vite on :5173).

## Banana Studio

Switch to **Studio** in the header. Pick or create a project (each one is a Git repository under `BANANA_PROJECTS_DIR`).

- **Board / Schematic** show KiCad's own drawing (front, back or both). Parts have a handle on top of the picture: click to select, drag to move on a 0.5 mm grid, `R` rotates, `Delete` removes. A move on a routed board re-routes it.
- **Assistant** (needs your Gemini key, same setting as the Diff copilot): describe what you want. It searches KiCad's real libraries, edits the design, routes, runs the checks and simulations, and says what it checked. Everything from one message is saved as **one build**; **Undo** and **Redo** move over builds and never rewrite history. It can only work on the open project and has no shell or file access.
- **Changes** compares any two builds with Banana's diff engine and the same renderers as the Diff view: yellow changed, green added, red deleted, grey unchanged. **Open in Diff view** hands the pair to the full viewer.
- **History** lets you view any earlier build read-only (time travel) or compare it with its predecessor.
- **Inspector** edits value, footprint, position, rotation and pin-to-net connections. **Parts** adds library parts and a whole-board **copper pour** (filled by KiCad; needs KiCad's Python module).
- **Checks** runs electrical rules, netlist parity with KiCad, placement, clearance, routing and DRC in one report, plus a **manufacturing check** against typical low-cost fab limits. **Simulate** runs ngspice tests.
- **Export**: Gerbers and drill files (zip), BOM, pick-and-place, netlist, PDF, board STEP (outline only, no component models yet).

Honest limits: two copper layers, rectangular outline, front-side parts, a basic autorouter (dense boards may not complete: it says so), no hand-drawn wires, no symbol or footprint editor. The assistant has been tested against a scripted model only; it has **not** been run against live Gemini in development. See [`docs/PARITY.md`](docs/PARITY.md) for the full list and the test that backs each row.

## Board design tools (MCP)

Banana can also **build, edit, check and simulate KiCad boards**, driven by an AI assistant or by scripts, and then show the result in the diff viewer. The tools are exposed three ways: an **MCP server** (stdio), the same MCP over HTTP at `POST /api/design/mcp`, and plain REST at `/api/design/tools/<name>`.

```bash
node scripts/banana-mcp.mjs --print-config    # prints the JSON to paste into your assistant's MCP settings
```

| Tool | What it does |
|---|---|
| `create_project`, `list_projects`, `get_design` | Boards live in `BANANA_PROJECTS_DIR` (default `<data dir>/projects`), one git repository each |
| `search_symbols`, `get_symbol`, `search_footprints`, `get_footprint` | Look up real parts and their real pins in KiCad's libraries, so pinouts are never invented |
| `edit` | Batch of operations (add/remove parts, connect pins by `REF.PIN`, flags, placement, tracks, tests); atomic: if one fails nothing changes |
| `autoroute` | Two-layer router with vias and 45° corners; far-side pads of a copper pour get a via to it; reports nets it could not route |
| `build` | Writes `.kicad_sch`, `.kicad_pcb`, `.kicad_pro` and commits, so every version is diffable |
| `run_checks` | Electrical rule checks, KiCad netlist parity, placement, copper clearance, routing completeness, KiCad DRC |
| `add_test`, `run_simulation` | ngspice tests (op / transient / AC) with pass/fail expectations |
| `export`, `dfm_check` | Gerbers/drill/BOM/positions/netlist/PDF/STEP via KiCad; manufacturability check against typical fab limits |
| `diff`, `render`, `history` | Banana's diff engine between builds; layer SVGs; the build log. Open the project folder in Banana's *Local repository* mode to browse it visually |

A typical session: `create_project` → `search_symbols`/`get_symbol` → `edit` (with `build`) → `run_checks` → `autoroute` → `add_test` + `run_simulation` → `diff`/`render`. Open `<project>/<name>.kicad_pro` in KiCad at any time; the files are ordinary KiCad files.

What it can and cannot do (be aware before relying on it):

- **Verified here (KiCad 7.0.11, ngspice 42):** the schematic's connectivity matches KiCad's own netlist export (and an independent geometric check) on 270 random circuits; boards load in KiCad with the right nets on the right pads; 40 random autorouted boards pass KiCad's DRC with zero rule violations (the router fully routed 37 of them; the rest are reported as unrouted, never hidden); simulation results match textbook analytic answers (dividers, RC time constant, RC corner frequency).
- **Routing is basic:** grid-based, two layers, one whole-board pour per layer at most, no differential pairs or length matching. Dense boards may not complete; finish them in KiCad.
- **Simulation covers analog behaviour only, for parts with a SPICE model.** Resistors, capacitors, inductors, diodes, LEDs, zeners and simple BJTs are automatic; regulators use a behavioural macro (`sim.ldo`); anything else needs a `sim.subckt` model or `sim.exclude`. Microcontrollers and firmware are not simulated. A passing simulation does not prove the physical board works (layout, EMI, heat, tolerances).
- **Electrical rules are heuristics plus KiCad's checks.** They catch unconnected pins, missing power sources, output conflicts, wrong footprint pad counts and so on, but they cannot tell that a part is the wrong one for the job or rated too low. Review AI-generated designs before manufacturing.
- **KiCad versions:** what the installed `kicad-cli` can do is read from its own help output (`backend/src/kicad-compat.js`). On KiCad 7 DRC uses KiCad's Python `pcbnew` and ERC uses Banana's built-in rules; where the CLI has `drc`/`erc` (8+) it is used. Only KiCad 7.0.11 was available in the development sandbox; the CI workflow runs the suite in `kicad/kicad:<version>` containers for 7.0, 8.0, 9.0, 10.0 and nightly, and that workflow's results, not this paragraph, are the evidence for the newer versions.
- Placement is automatic unless you place parts yourself; rotation is 0/90/180/270; parts go on the front side only.
- The MCP server exposes file-writing tools. It only touches `BANANA_PROJECTS_DIR`, validates every name and path, and runs ngspice only on sanitised netlists, but treat it as a local trusted tool; over HTTP it is protected by Banana's login or access token.

## Sign-in (accounts)

Off by default so the single-user desktop launcher needs no setup. Turn it on for any shared or server deployment:

```bash
export BANANA_AUTH=required
npm run user -- add alice --admin       # prompts for a password (min. 10 characters)
npm run user -- add bob
npm run user -- list | passwd <name> | disable <name> | enable <name> | remove <name>
npm start
```

Or bootstrap the first admin from the environment (only used when no accounts exist): `BANANA_ADMIN_USER` + `BANANA_ADMIN_PASSWORD`.

- Anonymous visitors only ever receive the login page; the app code and every `/api` route require a session (the health check stays open for container probes).
- Passwords are stored as salted scrypt hashes in `<data dir>/users.json` (mode 0600). Sessions are signed, `HttpOnly`, `SameSite=Strict` cookies that expire after `BANANA_SESSION_HOURS` (default 12). Changing a password, disabling or removing an account ends that user's sessions immediately.
- Failed sign-ins are rate-limited (5 per account per 15 minutes, plus a per-IP cap). State-changing requests from another origin are refused.
- Accounts are created by an administrator on the server; there is no self-signup, password reset by e-mail, MFA or SSO. Put it behind HTTPS (and set `BANANA_TRUST_PROXY=1` behind a reverse proxy so the cookie is marked `Secure`).
- `BANANA_DATA_DIR` (default `<app>/.banana`, `/data` in Docker) holds the users file and session secret; back it up and keep it private.

## Download page and releases

`website/` is a static download site (no build step, no dependencies, strict CSP). It reads `releases.json`, detects the visitor's OS and offers the matching download, asks the visitor to accept the free-use licence before the links become active, and shows the SHA-256 of the file.

```bash
npm run make-release                 # universal zip only (needs Node.js installed by the user)
node scripts/make-release.mjs --with-node   # + one zip per OS/arch that already contains Node.js (release workflow does this)
npx serve website           # or any static host: Cloudflare Pages, Netlify, S3, nginx ...
```

Pushing a tag such as `v1.0.0` runs `.github/workflows/release.yml`, which tests, builds the release, verifies the zip as a user would receive it, attaches it to a GitHub release and uploads the ready-to-host `website` folder as a workflow artifact.

Publishing for free: the source repository stays private, but private-repo release assets cannot be downloaded by the public, so host the `website` folder (with `downloads/`) on a static host such as Cloudflare Pages, Netlify or your own server. The licence does not allow others to mirror the files, so point people at your official page. GitHub Pages from a private repository needs a paid plan.

## Desktop use

Banana is a **local web app**, not a native installer: the download is a portable folder; the launcher starts the server on your computer and opens it in your browser. There is no `.exe`/`.dmg`/`.deb` yet (an Electron/installer wrapper is possible but is not built or tested).

## Run from a USB stick (no install on the target computer)

On a build machine:

```bash
npm ci
npm run make-portable          # creates dist-portable/banana
```

Copy the `banana` folder to the stick. On any computer:

| OS | Start |
|---|---|
| Windows | double-click `start.bat` |
| Linux / macOS | `sh start.sh` (use `sh` if the stick is FAT/exFAT and loses the executable bit) |

Operating systems no longer auto-run programs from USB drives, so someone has to start the launcher; there is no "plug in and it runs" mode.

Every start does the following before the server opens:

1. **Integrity check** — every shipped file is compared with `MANIFEST.sha256` (catches corrupted copies or edited files).
2. **Environment check** — Node version, Git, KiCad (path + version), writable scratch space, free port (picks the next free port if 5000 is taken).
3. **Ground-truth self-test** — diffs a built-in pair of boards where the correct answer is known (R1 moved exactly 2.00 mm; a GND trace added) through the real pipeline. If the answer is wrong, Banana refuses to start.
4. **Calibration** — writes `.banana/autoconfig.json` (KiCad path, port, render timeout scaled to the measured speed). It is stamped with the computer's platform/arch/hostname, so a stick moved to another computer re-detects instead of trusting stale paths.

Scratch files go to the OS temp directory (not the stick). Run the checks alone with `npm run preflight` (`--json` for machine-readable output). The bundle is pure JavaScript (no native add-ons), so the same folder works on Windows, Linux and macOS, x64 and ARM — Node.js and KiCad are the only platform-specific parts.

To make the stick fully self-contained, add (optional, each under its own licence — see `NOTICE.md`):

- `runtime/node-win32-x64/node.exe`, `runtime/node-linux-arm64/bin/node`, … (Node.js 20.11+ for that OS/arch)
- `runtime/kicad-<version>/bin/kicad-cli[.exe]` (a portable/extracted KiCad install)

## Docker

```bash
docker build -t banana .
docker run --rm -p 127.0.0.1:5000:5000 -v /path/to/repos:/repos:ro banana
# or: docker compose -f deploy/docker-compose.yml up --build
docker run --rm banana node scripts/preflight.mjs      # run the checks inside the image
```

The image is based on `kicad/kicad` (`--build-arg KICAD_VERSION=<tag>`; default `nightly`, so pin a release tag for reproducible builds). In the container, point the app at a repository with the path as seen inside it (e.g. `/repos/myboard`).

## Linux service (systemd)

```bash
npm ci && npm run make-portable
sudo sh dist-portable/banana/deploy/install-systemd.sh dist-portable/banana
systemctl status banana
```

The unit runs as an unprivileged `banana` user with a hardened sandbox, listens on `127.0.0.1:5000`, and runs the preflight before every start. Settings go in `/etc/banana/banana.env`.

## Configuration

Environment variables (or a `.env` file in the app folder); they override `.banana/autoconfig.json`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only in a container or on a trusted network. |
| `KICAD_CLI_PATH` | auto-detected | Path to `kicad-cli` |
| `BANANA_PROJECTS_DIR` | `<data dir>/projects` | Where board projects are stored |
| `NGSPICE_PATH`, `KICAD_SYMBOL_DIR`, `KICAD_FOOTPRINT_DIR`, `KICAD_PYTHON` | auto | Override tool/library locations for the design tools |
| `BANANA_AUTH` | off | `required` turns on account sign-in (see above). |
| `BANANA_DATA_DIR` | `<app>/.banana` | Users file + session secret |
| `BANANA_SESSION_HOURS`, `BANANA_TRUST_PROXY` | `12`, off | Session lifetime; set `1` behind an HTTPS reverse proxy |
| `BANANA_ACCESS_TOKEN` | unset | If set, /api requires this token; open `/login?token=<token>` once per browser. Set it whenever `HOST` is not loopback. |
| `BANANA_TEMP_DIR` | `<os tmp>/banana-<uid>` | Scratch + render cache |
| `RENDER_TIMEOUT_MS` | `120000` (or calibrated) | Kill a hung `kicad-cli` after this long |
| `CACHE_MAX_ENTRIES` | `200` | Render cache size (entries) |
| `STATIC_DIR` | auto | Folder with the built UI |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | — | Optional AI copilot |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `FRONTEND_URL` | — | Optional GitHub OAuth (personal access tokens work without these) |

## Security

- Binds to loopback by default. If you bind elsewhere, set `BANANA_ACCESS_TOKEN`; the server warns at startup otherwise. CORS allows only the page's own origin, loopback, and `FRONTEND_URL`.
- The Gemini key is sent to Google in a request header, never in a URL.
- The local-repository feature can read any Git repository the server process can read, and there is no login — do not expose it to untrusted networks.
- User-supplied Git refs and file paths are validated before use (no option injection, no path traversal); GitHub owner/repo names are validated before any request.
- GitHub OAuth uses a random per-login `state` cookie; the token is returned in the URL fragment, not the query string.
- Tokens entered in the UI are stored in the browser's `localStorage`.

## Tests

```bash
npm test                     # ~6,800 automated cases; KiCad-dependent ones are skipped if KiCad is absent
```

Includes a headless-browser smoke test of the built UI (needs Playwright; skipped otherwise), generated-input tests for the parser and diff engine, argument-injection and traversal cases for every route, concurrency tests, and end-to-end diffs against a real `kicad-cli`.

## Verification status (what has and has not been run)

- Linux x64, Node 22, KiCad 7.0.11: full test suite (including the Studio in a real browser against a real `kicad-cli`, with a scripted Gemini), preflight, portable bundle, server — run in the development sandbox.
- GitHub Actions (`.github/workflows/ci.yml`) runs the whole suite on every push. Results on branch `claude/magical-rubin-8ia3h1` (the workflow runs are the evidence; check the latest run for the current state):

  | Job | Result |
  |---|---|
  | Ubuntu x64 (distro KiCad) | green on runs 24, 25 and 26 (on run 25 the job first hung for half an hour installing KiCad, a runner issue, and then finished green) |
  | Ubuntu ARM64 (distro KiCad) | green on runs 24, 25 and 26 |
  | Windows (KiCad from Chocolatey, version not recorded) | green on runs 24 and 25, including preflight and portable bundle |
  | macOS (KiCad 10.0.x from Homebrew) | green on runs 25 and 26 (it failed on run 23) |
  | KiCad 7.0 / 8.0 / 9.0 / 10.0 (`kicad/kicad:<version>` containers) | green on runs 25 and 26 (8.0.9, 9.0.9, 10.0.7 as reported by the images); 10.0 failed on run 24 and was fixed |
  | KiCad nightly container | green on runs 25 and 26 (the image reported 10.0.0) |
  | Docker image build + container preflight + API check | green on run 25 |
  | systemd unit check (`systemd-analyze verify`) | green on run 25 |

- What this does **not** show: the Studio's AI assistant against live Gemini (only a scripted model is tested), real hardware or sensors, Linux distributions other than the CI runners, and KiCad versions or patch releases outside the table. Getting here took fixes for real differences between KiCad versions (tab-indented libraries, multi-line netlists, `extends` chains, footprint text, a tighter SVG crop on KiCad 10); more will probably turn up on other versions.

## Repository layout

```
backend/src      Express API, KiCad rendering, parsing, diff engine
backend/src/design  design engine: model, layout, router, writers, checks, exports, agent
frontend/src     React + Ant Design UI (frontend/src/studio is the Studio)
docs             PARITY.md: the KiCad feature scorecard
scripts          preflight/calibration, launcher, portable-bundle + release builder, user management
website          static download site
samples          generator for the ground-truth calibration boards
deploy           systemd unit/installer, docker compose
tests            automated tests (node:test)
```
