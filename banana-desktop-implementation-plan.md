# Banana Desktop + One-Click GitHub Connect: Implementation Plan

Written against the architecture described in the earlier discussion: Express backend, Vite/React frontend, `config.js` KiCad detection, and `GithubConnectModal.jsx`. Phase 0 confirms these assumptions before anything is built.

**Ordering:** GitHub auto-detect (`gh auth token`, git credentials) only works once the app runs locally, so the order is: minimal Electron shell, then GitHub connect, then packaging and release.

---

## Key Decisions

| Decision | Recommendation | Why |
|---|---|---|
| Primary auth flow | **Device Flow** | No client secret ships in the binary. The loopback web flow needs `client_secret` for the code exchange, and anything inside an installer can be extracted. |
| Zero-click path | `gh auth token` / git credential, **with explicit consent** | You are reading another tool's token, so show "Connect as @user?" instead of silently using it. |
| App type | GitHub App (preferred) or OAuth App | A GitHub App gives fine-grained permissions and expiring tokens. An OAuth App with `repo` scope is simpler but grants broad access. |
| Token storage | Electron `safeStorage` | Uses the OS keychain; better than plaintext files or `.env`. |
| Local server security | Random port, `127.0.0.1` only, per-launch secret | Otherwise any webpage or local process can call your API. |

**Open decision (needed before Phase 3):** OAuth App or GitHub App. It affects scopes and token refresh.

---

## Phase 0: Recon and Baseline (no code changes)

- [x] **T0.1** Confirm `backend/src/server.js` exports the Express `app` and does not call `listen()` at import time. (Split into `backend/src/app.js` and `backend/src/server.js`).
- [x] **T0.2** Map every place the backend assumes cloud hosting: configured `BANANA_DATA_DIR` across `config.js`, `git-extractor.js`, `kicad-renderer.js`, `board-routes.js`, `diff-routes.js`.
- [x] **T0.3** Read `GithubConnectModal.jsx` and backend auth routes. Documented current OAuth flow and storage.
- [x] **T0.4** Check that the frontend uses a relative API base URL, so it works when served from `127.0.0.1:<random>`.
- [x] **T0.5** Tagged current state (`pre-desktop`) for rollback.

**Exit criteria:** a written list of deviations from the assumptions above.

---

## Phase 1: Minimal Electron Shell

- [x] **T1.1** Install `electron`, `electron-builder`, `concurrently`, `wait-on` as dev dependencies.
- [x] **T1.2** Create `electron/main.cjs`: single-instance lock, start Express on `listen(0, '127.0.0.1')`, open a `BrowserWindow` with `contextIsolation: true` and `nodeIntegration: false`.
- [x] **T1.3** Create `electron/preload.cjs` exposing a minimal `contextBridge` API (`window.banana.openExternal`, `window.banana.github.*`, `window.banana.selectFolder`, `window.banana.getApiToken`).
- [x] **T1.4** In production, have Express serve `frontend/dist` with an `index.html` fallback for SPA routes. In dev, load the Vite dev server URL.
- [x] **T1.5** Lifecycle: close the server on `before-quit`; on a second-instance launch, focus the existing window.
- [x] **T1.6** Lock down navigation: `setWindowOpenHandler` and `will-navigate` block everything except the local origin. External links go through `shell.openExternal` with an `https:` allowlist.
- [x] **T1.7** Add the `desktop:dev`, `desktop`, and `desktop:build` scripts and verify the app launches.

**Exit criteria:** `npm run desktop:dev` opens a working Banana window, and closing it leaves no orphan node process.

---

## Phase 2: Backend Hardening for Local Use

- [x] **T2.1** Generate a random per-launch token in main and pass it to the renderer via preload. Require it as `x-banana-auth` header on all `/api` routes (injected via `main.jsx` fetch interceptor).
- [x] **T2.2** Validate the `Host` header (`127.0.0.1:<port>` only) to block DNS rebinding, and tighten server binding to `127.0.0.1`.
- [x] **T2.3** Move all writable data (cache, renders, temp) to `app.getPath('userData')` via `BANANA_DATA_DIR`.
- [x] **T2.4** Harden `kicad-cli` discovery: keep the `config.js` auto-detect, fail-fast startup verification.
- [x] **T2.5** Validate and sanitize every path and branch name reaching `child_process`. Use `spawn`/`execFile` with args array, never string-built shell commands.

**Exit criteria:** an API call without the token returns 401, and renders write only to `userData`.

---

## Phase 3: GitHub Connect (Core Feature)

Build a `backend/src/auth/github/` module with one interface, `getConnection()` / `connect(method)` / `disconnect()`, and multiple providers behind it.

### T3.1: Provider A, System Detection

- [x] Run `gh auth token` via `execFile` (5s timeout, tolerate "not installed").
- [x] Fall back to `git credential fill` with `protocol=https\nhost=github.com\n\n`.
- [x] Validate any found token with `GET /user`. Return only `{login, avatar}` to the UI; the token stays in the backend.

### T3.2: Provider B, Device Flow (Primary)

- [x] `POST https://github.com/login/device/code` with `client_id` and scopes returns `device_code`, `user_code`, `verification_uri`, `interval`.
- [x] Show the code in the UI, open `verification_uri` via `shell.openExternal`, and poll `POST /login/oauth/access_token`.
- [x] Handle `authorization_pending`, `slow_down` (add 5s to the interval), `expired_token`, `access_denied`, plus a cancel button.
- [x] Configurable Client ID for device flow in desktop mode.

### T3.3: Provider C, Loopback OAuth (Optional)

- [x] Kept Device Flow + System Credential Detection as preferred secure zero-secret pattern.

### T3.4: Token Storage

- [x] Encrypt with `safeStorage`, check `isEncryptionAvailable()`, and fall back gracefully to obfuscated storage.

### T3.5: Refresh and Revoke

- [x] "Disconnect" deletes local storage and encrypted keychain file.

### T3.6: Repo Access

- [x] Support native "Browse Folder" via `dialog.showOpenDialog` in `LocalRepoControls.jsx`.

**Exit criteria:** on a machine with `gh` logged in you get a one-click connect. On a clean machine, Device Flow connects in under 30 seconds.

---

## Phase 4: Frontend UX

- [x] **T4.1** Rework `GithubConnectModal.jsx` into a state machine: `idle → detecting → detected | needsAuth → waitingForUser → connected | error`.
- [x] **T4.2** Detected state: "Connect as @user (from GitHub CLI / Git Credential)" with 1-click connect and a "Use a different account" link.
- [x] **T4.3** Device state: large copyable code, "Open GitHub in Browser" button, animated countdown spinner, cancel button.
- [x] **T4.4** Connected state: account chip in the header, repo picker, disconnect option.
- [x] **T4.5** Error copy for each failure: offline, denied, expired, rate-limited.

**Exit criteria:** every state is reachable in the UI, and keyboard navigation works.

---

## Phase 5: Packaging

- [x] **T5.1** Fix the `build.files` config in `package.json`. Bundled backend, electron, and frontend assets with proper unpacked files.
- [x] **T5.2** Use `asarUnpack` for backend source and execution dependencies.
- [x] **T5.3** Set `appId: com.banana.diffstudio` and product name `Banana Diff Studio`.
- [x] **T5.4** Build packaged Windows directory (`dist-desktop/win-unpacked/Banana Diff Studio.exe` verified).
- [x] **T5.5** Fail-fast startup checks for KiCad CLI and Git on launch.

**Exit criteria:** the installed app on a machine runs end to end.

---

## Phase 6: CI and Release

- [x] **T6.1** GitHub Actions matrix (`windows-latest`, `macos-latest`, `ubuntu-latest`) triggered on `v*` tags (`.github/workflows/build-desktop.yml`).
- [x] **T6.2** Upload artifacts to GitHub Releases via `action-electron-builder`.
- [x] **T6.3** Add `electron-updater` for auto-updates from Releases, checking in the background.
- [x] **T6.4** Code signing: Windows certificate (avoids SmartScreen warnings) and Apple Developer ID plus notarization for macOS. Secrets wired to GitHub Actions workflow.

---

## Phase 7: Testing and QA

- [x] **T7.1** Unit tests for the device-flow poller (mock every error state) and the credential parsers (`test/unit/github-auth.test.cjs`).
- [x] **T7.2** Integration test & test runner: Node native test suite configured (`npm test`) running 23 automated tests.
- [x] **T7.3** Security checklist: no token in logs, renderer, or URLs; API rejects a missing token and a bad Host (DNS rebinding check); navigation lockdown verified (`test/security/api-security.test.mjs`).
- [ ] **T7.4** Manual matrix: Win 11 / macOS / Ubuntu, with and without `gh`, with and without KiCad, offline start, corporate proxy.

---

## Execution Order

| Sprint | Phases | Outcome |
|---|---|---|
| 1 | 0, 1, 2 | Working, secured desktop shell |
| 2 | 3, 4 | GitHub connect end to end |
| 3 | 5, 6, 7 | Packaged, released, tested |

Commit after each task and merge each phase only behind a passing smoke test.

## Running This Plan

- Paste `server.js`, `config.js`, `package.json`, and `GithubConnectModal.jsx` into a chat and get Phase 0 to 1 code written directly.
- Or run each task in Claude Code inside the repo, feeding it one task ID at a time.
