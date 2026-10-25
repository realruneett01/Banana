# Banana — visual Git diff for KiCad designs

Banana compares two Git versions of a KiCad schematic (`.kicad_sch`) or board (`.kicad_pcb`) and shows **what physically changed** — not a text diff of S-expressions. It renders both versions with `kicad-cli`, diffs the rendered geometry, then maps each difference back to the part, pad or net it belongs to.

> **Free, proprietary software.** Free to download and use, including commercially; source code, redistribution and reverse-engineering rights are reserved — see [`LICENSE`](LICENSE). Third-party notices are in [`NOTICE.md`](NOTICE.md).

## What it does

- Side-by-side and overlay views of the two versions, with synchronised pan/zoom.
- Colour-coded changes: added, deleted, changed; unchanged geometry is greyed out.
- An audit list of changes ("R1 relocated by 2.00 mm on F.Cu", "added GND trace on B.Cu") with click-to-focus.
- A multi-pass matching engine (`backend/src/svg-diff-processor.js`): copper track-chain assembly, reference-designator matching, exact and proximity primitive matching, and a residual pass. Footprint moves/rotations/value changes are detected from the parsed board (`backend/src/kicad-pcb-parser.js`) and used to avoid reporting the same move many times.
- Commit evolution timeline between two commits for one file.
- Sources: a **local Git repository** on the same machine, or **GitHub** (OAuth or personal access token).
- Optional AI copilot (Google Gemini). Needs your own `GEMINI_API_KEY`; without one the rest of the app works normally.

## What it does **not** do

- It does not talk to hardware, sensors or devices. "Calibration" below means a software self-check of the computer it runs on.
- It does not render KiCad files itself; it needs KiCad's `kicad-cli` (KiCad **7 or newer**).
- It has no user accounts or authentication. Run it on your own machine or a trusted network, not on the open internet (see [Security](#security)).
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
npm test                     # ~4,000 automated cases; KiCad-dependent ones are skipped if KiCad is absent
```

Includes a headless-browser smoke test of the built UI (needs Playwright; skipped otherwise), generated-input tests for the parser and diff engine, argument-injection and traversal cases for every route, concurrency tests, and end-to-end diffs against a real `kicad-cli`.

## Verification status (what has and has not been run)

- Linux x64, Node 22, KiCad 7.0.11: full test suite, preflight, portable bundle, server — run.
- Windows, ARM, macOS, Docker image build, systemd runtime, KiCad 8/9/10 output: **not run in the development sandbox.** The code paths exist (KiCad 8+ multi-layer export, Windows launcher, ARM-independent bundle) and the CI workflow in `.github/workflows/ci.yml` is set up to exercise them; treat them as unverified until that workflow is green.

## Repository layout

```
backend/src      Express API, KiCad rendering, parsing, diff engine
frontend/src     React + Ant Design UI
scripts          preflight/calibration, launcher, portable-bundle + release builder, user management
website          static download site
samples          generator for the ground-truth calibration boards
deploy           systemd unit/installer, docker compose
tests            automated tests (node:test)
```
