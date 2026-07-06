# Cadlab / Banana — Codebase Context

## 1. Architecture

- **Is there a backend server?**
  No backend server exists. The project runs a development server initiated by [serve.js](file:///c:/Users/realr/OneDrive/Desktop/Banana/scripts/serve.js) which calls `esbuild`'s `context.serve({ servedir: "./debug", port: 8001 })`. This is a pure static file server serving the `./debug` directory on port 8001. There are no API endpoints, database connections, or server-side computations.
- **Is this a pure static/client-side app, or client+server?**
  It is a pure static, client-side application.
- **Directory structure overview**:
    - [src](file:///c:/Users/realr/OneDrive/Desktop/Banana/src): Core TypeScript source files.
        - [index.ts](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/index.ts): Application entry point.
        - [base](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/base): Lower-level utilities, math, async helper classes, custom web component base modules.
        - [graphics](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/graphics): Base rendering/drawing abstractions and GPU/Canvas APIs.
        - [kc-ui](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kc-ui): Shared UI components (sidebars, resizers, custom buttons).
        - [kicad](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicad): Parser, tokenizer, and document classes for KiCad board/schematic files.
        - [kicanvas](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas):
            - [elements](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/elements): Shell UI elements, board/schematic web components.
            - [services](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services): VFS abstractions, GitHub/Codeberg API handlers, diff engine.
        - [viewers](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/viewers): Board/schematic canvas painter and viewer implementation logic.
    - [debug](file:///c:/Users/realr/OneDrive/Desktop/Banana/debug): Test HTML pages, example `.kicad_pcb`/`.kicad_sch` files, and CSS.
    - [scripts](file:///c:/Users/realr/OneDrive/Desktop/Banana/scripts): esbuild build configuration and runner scripts.
- **Frontend framework/rendering approach**:
  It uses a custom, lightweight web component wrapper (defined in [custom-element.ts](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/base/web-components/custom-element.ts) and [html.ts](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/base/web-components/html.ts)) that supports decorators (like `@attribute` and `@query`) and tagged template literals (`html`). It is vanilla TypeScript (does not use standard Lit or other popular web component libraries). Build tool is `esbuild`.

## 2. Current GitHub Integration

- **How does the app currently talk to the GitHub API?**:
    - [github.ts](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github.ts): Implements class [GitHub](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github.ts#L31) to make requests to the REST API (`https://api.github.com/`), and class [GitHubUserContent](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github.ts#L157) to fetch raw files from `https://raw.githubusercontent.com/` using `fetch()`.
    - [github-vfs.ts](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github-vfs.ts): Implements [GitHubFileSystem](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github-vfs.ts#L23) that wraps the `GitHub` class to enumerate directories and download files.
- **Is any authentication used today?**:
  No authentication (PAT, none, OAuth) is implemented. The [GitHub](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github.ts#L31) class header configuration contains only standard headers:
    ```typescript
    this.headers = {
        Accept: GitHub.accept_header,
        "X-GitHub-Api-Version": GitHub.api_version,
    };
    ```
    No credentials or tokens are read, stored, or passed.
- **What GitHub API endpoints are called**:
    - `repos/${owner}/${repo}/contents/${path}` (in [repos_contents](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github.ts#L136)): Used to enumerate files and directories within a repository.
    - `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}` (in [GitHubUserContent.get](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github.ts#L162)): Fetches raw text contents of board and schematic files.
- **Confirm: can the app currently access private repos at all, in any form?**:
  No, it cannot. All requests to private repositories will fail with a 404 (or 403 Forbidden) since no authentication headers are present.
- **Any existing rate-limit handling or errors from the 60 req/hr unauthenticated cap?**:
  The [request](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github.ts#L96) function parses the `x-ratelimit-remaining` response header and updates `rate_limit_remaining`. However, there is no UI mitigation or retry flow. If a 403 Forbidden is returned, [request_error_handler](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/api-error.ts#L35) throws a `ForbiddenError`, which is logged to the console via a catch block in [KiCanvasShellElement.setup_project](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/elements/kicanvas-shell.ts#L176), leaving the shell in an unloaded/loading state.

## 3. Compare Studio — Current Implementation

- **File(s) that implement the two-pane diff viewer**:
    - [app.ts](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/elements/common/app.ts): Renders the two-pane split layout, synchronizes viewports via viewport change listeners, and triggers comparison.
    - [diff-engine.ts](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/diff-engine.ts): Provides the logic to compare two document instances and produce highlight maps.
- **Full data path**:
    1. **Trigger**: User clicks the "Compare Boards" button (`name="compare"`), which calls [startComparison](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/elements/common/app.ts#L208).
    2. **Fetch**: The user is prompted to pick a file/folder locally. The callback handler receives a virtual filesystem instance (`vfs`). It calls `this.#right_project.load(vfs)` to load the files. It also keeps `leftDoc` (document from the original project) in memory.
    3. **Parse**: `Project.load(vfs)` fetches files and instantiates `new KicadPCB(filename, text)`. S-expressions are tokenized via [listify](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicad/tokenizer.ts#L266) and parsed via [parse_expr](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicad/parser.ts#L326).
    4. **Render**: The app renders two panes: left showing original viewer (`this.#viewer_elm`), right showing comparison viewer (`this.#right_viewer_elm`). The camera states are synchronized via viewport listeners.
    5. **Diff highlights**: The documents from both viewers are extracted (`leftDoc`, `rightDoc`) and compared using [diff_documents](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/diff-engine.ts#L81). Highlight maps are built with [build_highlight_map](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/diff-engine.ts#L104) and set on viewers via [set_diff_highlights](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/viewers/base/viewer.ts#L221). In [BoardViewer.paint_selected](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/viewers/board/viewer.ts#L145), the highlighted diff items are repainted on the overlay layer using status colors (green for added, red for removed, amber for modified), while non-diffed items are dimmed.
- **Is each pane its own independent viewer/renderer instance, or is renderer state shared?**:
  Each pane is its own independent viewer instance. There is no shared renderer state; coordinate synchronization is done via event handlers updating the camera vectors of the target viewer camera and requesting redraws.
- **How is "which commits to compare" decided?**:
  It is not decided by git commits. Currently, the comparison target is decided solely by the user manually uploading local files or folders using the browser's file picker.

## 4. The Blank "Older Version" Pane Bug

- **Trace what happens when the old-ref file fetch returns null/empty/404**:
    - `GitHubUserContent.get()` does not check if the response status is `ok`. If a file fetch returns a 404, the 404 response text/HTML page body is read as a blob and returned as a valid `File` object.
    - In `Project.#load_doc()`, the 404 response text is read and passed to `new KicadPCB(filename, text)`.
    - The tokenizer ([tokenize](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicad/tokenizer.ts#L88)) attempts to parse the HTML or text. It either throws an unexpected character error (e.g. `Unexpected character at index 0: <` if it is an HTML page) or tokenizes the plain text `"404: Not Found"` into atoms.
    - In the latter case, `parse_expr()` throws `Expression must start with kicad_pcb, but found 404:` because the start element check fails.
    - This rejected promise propagates up to `Project.load(vfs)` and rejects, which causes `startComparison()` catch block to fail, alerting the user and calling `stopComparison()`.
    - If a file is skipped or not loaded, `leftDoc` or `rightDoc` remains `null`/`undefined`. The condition `if (leftDoc && rightDoc)` evaluates to false, skipping diff calculation and highlights. The corresponding viewer remains empty (blank).
- **Is there a code branch for "file has no prior version"?**:
  No. There is no such branch in `Project.load()`, `diff-engine.ts`, or `app.ts`'s comparison logic.
- **Root-cause hypothesis**:
  The application fails to handle missing or non-existent files during loading because `GitHubUserContent.get()` does not validate the response status, allowing invalid error payloads to reach the parser which throws a fatal syntax error. Since there is no fallback or special case in `app.ts` to represent a missing or empty older revision of a document (e.g. for newly added files), the comparison setup halts, causing the older version pane to remain blank.
    - **Most likely break points**:
        - [github.ts:L165](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/services/github.ts#L165) (in `GitHubUserContent.get`): Lacks check for `response.ok` before reading blob.
        - [parser.ts:L357](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicad/parser.ts#L357) (in `parse_expr`): Throws a fatal exception for invalid S-expression headers rather than returning a null document or handled status.
        - [app.ts:L230](file:///c:/Users/realr/OneDrive/Desktop/Banana/src/kicanvas/elements/common/app.ts#L230) (in `startComparison`): Silently skips diff calculation if either document is missing, failing to show the added elements as a simple "added" state.

## 5. Config, Secrets, Environment

- **How are existing secrets/env vars managed?**:
  None exist. The application uses no `.env` files or environment configurations. esbuild `define` config injects `DEBUG` as a global constant, but there are no credentials.
- **Is there any existing user session/login concept?**:
  The app is fully anonymous today; there is no login concept, user profile, or token persistence layer.
- **Hosting/deployment notes relevant to where a GitHub OAuth callback could live**:
  The application is client-side only (served locally from `http://localhost:8001/`). For a production OAuth callback, the application would need to receive it on a page hosted either on `localhost:8001` or a deployed site (like a GitHub Pages or Vercel URL), but since GitHub OAuth does not support client-side-only token exchange securely without a client secret, a backend server or serverless function is normally needed to perform the authorization code flow.

## 6. Open Questions For Implementation

- Since this is a static client-side application, how should we handle the GitHub OAuth flow? GitHub OAuth requires a client secret to exchange the authorization code for an access token. Because we cannot store client secrets on the client side, we must decide between:
    1. A backend proxy/serverless function to perform the token exchange.
    2. Asking the user to supply their own Personal Access Token (PAT) instead of a full OAuth flow.
- What scopes of access should the OAuth token request? Is access to public repositories (`public_repo`) sufficient, or is full `repo` access required?
- Where should the OAuth callback land, and how should it handle callback redirections when the user is running the app on a custom IP/port?
- Where should the retrieved credential/token be stored securely (e.g. `localStorage` or memory)?
- How should the login/logout controls be integrated into the UI? (e.g., as a new activity panel in the sidebar, or in a top/bottom toolbar?)
