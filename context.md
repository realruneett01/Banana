# Project Overview

**Banana Compare Studio** is a fork of KiCanvas (an interactive, browser-based viewer for KiCad schematics and boards) specifically designed to serve as a visual diff and comparison tool for KiCad files (`.kicad_pcb` and `.kicad_sch`).

- **Goal**: Refactor the UI and state management to support universal file and folder comparisons via a new Left Sidebar control center.
- **Repository**: [https://github.com/realruneett/Banana](https://github.com/realruneett/Banana)

---

# Current Architecture

Banana runs as a client-side web application with a lightweight backend proxy (defined in `server/`) that assists with GitHub OAuth and proxying GitHub API calls to avoid rate limits and handle private repositories.

### Key Architectural Concepts
1. **Custom Web Components**: The app utilizes a custom elements framework built in vanilla TypeScript (`src/base/web-components`) utilizing tagged template literals (`html`) and custom decorators (`@attribute`, `@query`).
2. **Virtual File System (VFS)**: File access is fully abstracted using `IFileSystem` implementations (`FetchFileSystem`, `DragAndDropFileSystem`, `LocalFileSystem`, `GitHubFileSystem`, `AuthenticatedGitHubFileSystem`). This allows the core parsing and viewing layers to remain agnostic to where files are hosted (local disk vs. GitHub).
3. **AST Diff Engine**: The `diff-engine.ts` performs comparison by indexing components of schematic or board files by their unique UUIDs, matching them, comparing serialized fingerprints, and building highlight maps.
4. **Independent Viewers**: In split view (compare mode), two separate viewer instances are mounted side-by-side. Camera pan, zoom, rotation, and flip actions are synchronized via viewport change event listeners.

### Directory Tree of `src/`
```
src/
├── index.ts
├── base/
│   ├── array.ts
│   ├── async.ts
│   ├── base64.ts
│   ├── color.ts
│   ├── disposable.ts
│   ├── events.ts
│   ├── functions.ts
│   ├── iterator.ts
│   ├── livereload.js
│   ├── local-storage.ts
│   ├── log.ts
│   ├── object.ts
│   ├── paths.ts
│   ├── types.ts
│   ├── dom/
│   │   ├── download.ts
│   │   ├── drag-drop.ts
│   │   ├── file-picker.ts
│   │   ├── pan-and-zoom.ts
│   │   └── size-observer.ts
│   ├── math/
│   │   ├── angle.ts
│   │   ├── arc.ts
│   │   ├── bbox.ts
│   │   ├── camera2.ts
│   │   ├── index.ts
│   │   ├── matrix3.ts
│   │   └── vec2.ts
│   └── web-components/
│       ├── context.ts
│       ├── css.ts
│       ├── custom-element.ts
│       ├── decorators.ts
│       ├── flag-attribute.ts
│       ├── html.ts
│       └── index.ts
├── graphics/
│   ├── canvas2d.ts
│   ├── index.ts
│   ├── null-renderer.ts
│   ├── renderer.ts
│   ├── shapes.ts
│   └── webgl/
│       ├── glsl.d.ts
│       ├── helpers.ts
│       ├── index.ts
│       ├── polygon.frag.glsl
│       ├── polygon.vert.glsl
│       ├── polyline.frag.glsl
│       ├── polyline.vert.glsl
│       ├── renderer.ts
│       └── vector.ts
├── kc-ui/
│   ├── activity-side-bar.ts
│   ├── app.ts
│   ├── button.ts
│   ├── control-list.ts
│   ├── dropdown.ts
│   ├── element.ts
│   ├── filtered-list.ts
│   ├── floating-toolbar.ts
│   ├── focus-overlay.ts
│   ├── icon.ts
│   ├── index.ts
│   ├── kc-ui.css
│   ├── menu.ts
│   ├── panel.ts
│   ├── property-list.ts
│   ├── range.ts
│   ├── resizer.ts
│   ├── split-view.ts
│   ├── text-filter-input.ts
│   └── toggle-menu.ts
├── kicad/
│   ├── board.ts
│   ├── common.ts
│   ├── default_drawing_sheet.kicad_wks
│   ├── drawing-sheet.ts
│   ├── index.ts
│   ├── kicad_wks.d.ts
│   ├── parser.ts
│   ├── project-settings.ts
│   ├── schematic.ts
│   ├── theme.ts
│   ├── tokenizer.ts
│   └── text/
│       ├── eda-text.ts
│       ├── font.ts
│       ├── glyph.ts
│       ├── index.ts
│       ├── lib-text.ts
│       ├── markup.ts
│       ├── newstroke-glyphs.ts
│       ├── sch-field.ts
│       ├── sch-text.ts
│       └── stroke-font.ts
├── kicanvas/
│   ├── preferences.ts
│   ├── project.ts
│   ├── elements/
│   │   ├── css.d.ts
│   │   ├── kicanvas-embed.ts
│   │   ├── kicanvas-shell.css
│   │   ├── kicanvas-shell.ts
│   │   ├── common/
│   │   │   ├── app.ts
│   │   │   ├── context-menu.ts
│   │   │   ├── help-panel.ts
│   │   │   ├── preferences-panel.ts
│   │   │   ├── project-panel.ts
│   │   │   └── viewer-bottom-toolbar.ts
│   │   │   └── viewer.ts
│   │   ├── kc-board/
│   │   │   ├── app.ts
│   │   │   ├── footprints-panel.ts
│   │   │   ├── info-panel.ts
│   │   │   ├── layers-panel.ts
│   │   │   ├── nets-panel.ts
│   │   │   ├── objects-panel.ts
│   │   │   ├── properties-panel.ts
│   │   │   └── viewer.ts
│   │   └── kc-schematic/
│   │       ├── app.ts
│   │       ├── info-panel.ts
│   │       ├── properties-panel.ts
│   │       ├── symbols-panel.ts
│   │       └── viewer.ts
│   ├── icons/
│   │   ├── pcb_file.svg
│   │   ├── schematic_file.svg
│   │   ├── sprites.svg
│   │   ├── sprites.ts
│   │   ├── svg.d.ts
│   │   ├── zoom_footprint.svg
│   │   └── zoom_page.svg
│   ├── services/
│   │   ├── api-error.ts
│   │   ├── codeberg-vfs.ts
│   │   ├── codeberg.ts
│   │   ├── diff-engine.ts
│   │   ├── github-vfs.ts
│   │   ├── github.ts
│   │   └── vfs.ts
│   └── themes/
│       ├── custom-kicad.ts
│       ├── index.ts
│       ├── kicad-default.ts
│       └── witch-hazel.ts
└── viewers/
    ├── base/
    │   ├── document-viewer.ts
    │   ├── events.ts
    │   ├── grid.ts
    │   ├── painter.ts
    │   ├── view-layers.ts
    │   ├── viewer.ts
    │   └── viewport.ts
    ├── board/
    │   ├── layers.ts
    │   ├── painter.ts
    │   └── viewer.ts
    ├── drawing-sheet/
    │   └── painter.ts
    └── schematic/
        ├── layers.ts
        ├── painter.ts
        ├── viewer.ts
        └── painters/
            ├── base.ts
            ├── label.ts
            ├── pin.ts
            └── symbol.ts
```

---

# File Contents

## src/kicanvas/elements/kicanvas-shell.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { later } from "../../base/async";
import { DropTarget } from "../../base/dom/drag-drop";
import { FilePicker } from "../../base/dom/file-picker";
import { CSS, attribute, html } from "../../base/web-components";
import { KCUIElement, KCUIIconElement } from "../../kc-ui";
import { sprites_url } from "../icons/sprites";
import { Project } from "../project";
import { GitHub } from "../services/github";
import {
    AuthenticatedGitHubFileSystem,
    GitHubFileSystem,
} from "../services/github-vfs";
import { CodebergFileSystem } from "../services/codeberg-vfs";
import { FetchFileSystem, type IFileSystem } from "../services/vfs";
import { KCBoardAppElement } from "./kc-board/app";
import { KCSchematicAppElement } from "./kc-schematic/app";

import kc_ui_styles from "../../kc-ui/kc-ui.css";
import shell_styles from "./kicanvas-shell.css";

import "../icons/sprites";
import "./common/project-panel";

// Setup KCUIIconElement to use icon sprites.
KCUIIconElement.sprites_url = sprites_url;

/**
 * <kc-kicanvas-shell> is the main entrypoint for the standalone KiCanvas
 * application: It's the thing you see when you go to kicanvas.org.
 *
 * The shell is responsible for managing the currently loaded Project and
 * switching between the different viewer apps (<kc-schematic-app>,
 * <kc-board-app>).
 *
 * This is a simplified version of the subtree:
 *
 * <kc-kicanvas-shell>
 *   <kc-ui-app>
 *     <kc-project-panel>
 *     <kc-schematic-app>
 *       <kc-schematic-viewer>
 *       <kc-ui-activity-side-bar>
 *     <kc-board-app>
 *       <kc-board-viewer>
 *       <kc-ui-activity-side-bar>
 *
 */
class KiCanvasShellElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        // TODO: Find a better way to handle these two styles.
        new CSS(kc_ui_styles),
        new CSS(shell_styles),
    ];

    project: Project = new Project();

    #schematic_app: KCSchematicAppElement;
    #board_app: KCBoardAppElement;

    public gitHubPickerOpen: boolean = false;
    public gitHubPickerLoading: boolean = false;
    public gitHubRepos: any[] = [];
    public gitHubCurrentRepo: any = null;
    public gitHubCurrentPath: string = "";
    public gitHubContents: any[] = [];
    public gitHubPickerError: string = "";
    public gitHubPickerView: "repos" | "files" | "commits" = "repos";
    public gitHubCommits: any[] = [];
    public gitHubCommitPage: number = 1;
    public gitHubSelectedFile: string = "";
    public gitHubBaseCommit: string = "";
    public gitHubHeadCommit: string = "";
    public gitHubHasMoreCommits: boolean = true;

    constructor() {
        super();
        this.provideContext("project", this.project);
    }

    @attribute({ type: Boolean })
    public loading: boolean;

    @attribute({ type: Boolean })
    public loaded: boolean;

    @attribute({ type: String })
    public src: string;

    override initialContentCallback() {
        const url_params = new URLSearchParams(document.location.search);

        const urls = [
            ...url_params.getAll("github"),
            ...url_params.getAll("repo"),
        ];

        // Only load the first URL
        const url = urls[0];

        later(async () => {
            await GitHub.check_auth();
            this.update();

            // If redirected back from GitHub OAuth with ?picker=open,
            // automatically open the repo picker and clean up the URL parameters.
            if (url_params.get("picker") === "open") {
                history.replaceState(null, "", "/");
                await this.openGitHubPicker();
                return;
            }

            if (this.src) {
                const vfs = new FetchFileSystem([this.src]);
                await this.setup_project(vfs);
                return;
            }

            if (url) {
                const vfs = await this.load_repo(url);
                if (!vfs) {
                    return;
                }

                await this.setup_project(vfs);
                return;
            }

            new DropTarget(this, async (fs) => {
                await this.setup_project(fs);
            });
        });

        // Event delegation for clicks
        this.renderRoot.addEventListener("click", (e: Event) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            // Open local file
            if (target.closest('[name="open_local"]')) {
                this.openLocalFile();
                return;
            }

            // Open local folder
            if (target.closest('[name="open_local_folder"]')) {
                this.openLocalFolder();
                return;
            }

            // Browse GitHub
            if (target.closest('[name="browse_github"]')) {
                this.openGitHubPicker();
                return;
            }

            // Close picker backdrop/button
            if (target.closest('[data-action="close-picker"]')) {
                this.gitHubPickerOpen = false;
                this.update();
                return;
            }

            // Back button in picker
            if (target.closest('[data-action="back-picker"]')) {
                this.navigateBack();
                return;
            }

            // Load more commits
            if (target.closest('[data-action="load-more-commits"]')) {
                this.loadMoreCommits();
                return;
            }

            // Execute comparison
            if (target.closest('[data-action="execute-compare"]')) {
                this.executeComparison();
                return;
            }

            // Set base commit
            const baseBtn = target.closest(".set-base-btn") as HTMLElement;
            if (baseBtn) {
                this.gitHubBaseCommit = baseBtn.dataset["sha"] || "";
                this.update();
                return;
            }

            // Set head commit
            const headBtn = target.closest(".set-head-btn") as HTMLElement;
            if (headBtn) {
                this.gitHubHeadCommit = headBtn.dataset["sha"] || "";
                this.update();
                return;
            }

            // Compare versions button clicked
            const compareBtn = target.closest(
                ".compare-versions-btn",
            ) as HTMLElement;
            if (compareBtn) {
                this.openCommitPicker(compareBtn.dataset["path"] || "");
                return;
            }

            // Repo item clicked
            const repoItem = target.closest(".repo-item") as HTMLElement;
            if (repoItem) {
                const owner = repoItem.dataset["repoOwner"];
                const name = repoItem.dataset["repoName"];
                const repo = this.gitHubRepos.find(
                    (r) => r.owner.login === owner && r.name === name,
                );
                if (repo) {
                    this.selectRepo(repo);
                }
                return;
            }

            // Folder item clicked
            const folderItem = target.closest(".folder-item") as HTMLElement;
            if (folderItem) {
                const path = folderItem.dataset["path"];
                if (path !== undefined) {
                    this.navigateToFolder(path);
                }
                return;
            }

            // File item clicked (except if comparing versions)
            if (target.closest(".compare-versions-btn")) {
                return;
            }
            const fileItem = target.closest(".file-item") as HTMLElement;
            if (fileItem) {
                const path = fileItem.dataset["path"];
                const file = this.gitHubContents.find((f) => f.path === path);
                if (file) {
                    this.selectFile(file);
                }
                return;
            }

            // User dropdown toggle
            if (target.closest('[data-action="toggle-user-dropdown"]')) {
                this.toggleUserDropdown(e);
                return;
            }

            // Logout
            if (target.closest('[data-action="logout"]')) {
                this.handleLogout();
                return;
            }
        });

        // Event delegation for input
        this.renderRoot.addEventListener("input", (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (target && target.name === "link") {
                this.handleLinkInput(e);
            }
        });
    }

    /**
     * If the loaded filesystem came from a link to one specific file (e.g.
     * a GitHub blob URL), find the project page for that exact file so we
     * open it instead of whatever the hierarchy walk happened to pick as
     * "first". Falls through to the default (first_page) otherwise.
     */
    #preferred_page(vfs: IFileSystem) {
        if (!(vfs instanceof GitHubFileSystem) || !vfs.initial_file) {
            return null;
        }

        for (const page of this.project.pages()) {
            if (page.filename === vfs.initial_file) {
                return page;
            }
        }

        return null;
    }

    private async load_repo(url: string): Promise<IFileSystem | null> {
        return (
            (await GitHubFileSystem.fromURLs(url)) ??
            (await CodebergFileSystem.fromURLs(url))
        );
    }

    private async setup_project(vfs: IFileSystem) {
        this.loaded = false;
        this.loading = true;

        try {
            await vfs.setup();
            await this.project.load(vfs);
            this.project.set_active_page(
                this.#preferred_page(vfs) ?? this.project.first_page,
            );
            this.loaded = true;
        } catch (e) {
            console.error(e);
        } finally {
            this.loading = false;
        }
    }

    handleLinkInput(e: Event) {
        const link = (e.currentTarget as HTMLInputElement).value;
        later(async () => {
            const vfs = await this.load_repo(link);

            if (!vfs) {
                console.error(`Invalid URL: ${link}`);
                return;
            }

            await this.setup_project(vfs);

            const location = new URL(window.location.href);
            location.searchParams.set("repo", link);
            window.history.pushState(null, "", location);
        });
    }

    openLocalFile() {
        FilePicker.pick(async (vfs) => {
            await this.setup_project(vfs);
        });
    }

    openLocalFolder() {
        FilePicker.pick_folder(async (vfs) => {
            await this.setup_project(vfs);
        });
    }

    toggleUserDropdown(e: Event) {
        e.stopPropagation();
        const container = (e.target as HTMLElement).closest(
            ".user-profile-menu",
        );
        if (container) {
            container.classList.toggle("active");
            const close = () => {
                container.classList.remove("active");
                document.removeEventListener("click", close);
            };
            document.addEventListener("click", close);
        }
    }

    async handleLogout() {
        try {
            const res = await fetch("/auth/logout", { method: "POST" });
            if (res.ok) {
                GitHub.auth = { loggedIn: false };
                window.location.reload();
            }
        } catch (e) {
            console.error("Logout failed", e);
        }
    }

    async openGitHubPicker() {
        this.gitHubPickerOpen = true;
        this.gitHubPickerLoading = true;
        this.gitHubPickerView = "repos";
        this.gitHubRepos = [];
        this.gitHubCurrentRepo = null;
        this.gitHubCurrentPath = "";
        this.gitHubContents = [];
        this.gitHubPickerError = "";
        this.update();

        try {
            const response = await fetch("/api/repos");
            if (response.status === 401) {
                this.gitHubPickerError =
                    "Session expired, please sign in again";
            } else if (!response.ok) {
                this.gitHubPickerError = "Failed to fetch repositories";
            } else {
                this.gitHubRepos = await response.json();
            }
        } catch (e) {
            console.error(e);
            this.gitHubPickerError =
                "An error occurred while fetching repositories";
        } finally {
            this.gitHubPickerLoading = false;
            this.update();
        }
    }

    async selectRepo(repo: any) {
        this.gitHubCurrentRepo = repo;
        this.gitHubCurrentPath = "";
        this.gitHubPickerView = "files";
        await this.loadRepoContents();
    }

    async loadRepoContents() {
        this.gitHubPickerLoading = true;
        this.update();

        try {
            const owner = this.gitHubCurrentRepo.owner.login;
            const repo = this.gitHubCurrentRepo.name;
            const params = new URLSearchParams({
                owner,
                repo,
                path: this.gitHubCurrentPath,
            });
            if (this.gitHubCurrentRepo.default_branch) {
                params.set("ref", this.gitHubCurrentRepo.default_branch);
            }

            const response = await fetch(`/api/contents?${params.toString()}`);
            if (response.status === 401) {
                this.gitHubPickerError =
                    "Session expired, please sign in again";
            } else if (!response.ok) {
                this.gitHubPickerError = "Failed to load directory contents";
            } else {
                this.gitHubContents = await response.json();
            }
        } catch (e) {
            console.error(e);
            this.gitHubPickerError =
                "An error occurred while loading folder contents";
        } finally {
            this.gitHubPickerLoading = false;
            this.update();
        }
    }

    async navigateToFolder(path: string) {
        this.gitHubCurrentPath = path;
        await this.loadRepoContents();
    }

    navigateBack() {
        if (this.gitHubPickerView === "commits") {
            this.gitHubPickerView = "files";
            this.update();
        } else if (this.gitHubCurrentPath) {
            const parts = this.gitHubCurrentPath.split("/").filter(Boolean);
            parts.pop();
            this.gitHubCurrentPath = parts.join("/");
            this.loadRepoContents();
        } else {
            this.gitHubPickerView = "repos";
            this.gitHubCurrentRepo = null;
            this.update();
        }
    }

    async selectFile(file: any) {
        const owner = this.gitHubCurrentRepo.owner.login;
        const repo = this.gitHubCurrentRepo.name;
        const ref = this.gitHubCurrentRepo.default_branch || "HEAD";

        this.gitHubPickerOpen = false;
        this.update();

        const vfs = new AuthenticatedGitHubFileSystem(
            owner,
            repo,
            ref,
            file.path,
        );
        await this.setup_project(vfs);
    }

    async openCommitPicker(filePath: string) {
        this.gitHubPickerView = "commits";
        this.gitHubSelectedFile = filePath;
        this.gitHubCommits = [];
        this.gitHubCommitPage = 1;
        this.gitHubBaseCommit = "";
        this.gitHubHeadCommit = "";
        this.gitHubHasMoreCommits = true;
        this.gitHubPickerError = "";
        await this.loadCommits();
    }

    async loadCommits() {
        this.gitHubPickerLoading = true;
        this.update();

        try {
            const owner = this.gitHubCurrentRepo.owner.login;
            const repo = this.gitHubCurrentRepo.name;
            const params = new URLSearchParams({
                owner,
                repo,
                path: this.gitHubSelectedFile,
                page: String(this.gitHubCommitPage),
                per_page: "20",
            });

            const response = await fetch(`/api/commits?${params.toString()}`);
            if (response.status === 401) {
                this.gitHubPickerError =
                    "Session expired, please sign in again";
            } else if (!response.ok) {
                this.gitHubPickerError = "Failed to load commits";
            } else {
                const data = await response.json();
                if (data.length < 20) {
                    this.gitHubHasMoreCommits = false;
                }
                this.gitHubCommits = [...this.gitHubCommits, ...data];
            }
        } catch (e) {
            console.error(e);
            this.gitHubPickerError = "An error occurred while loading commits";
        } finally {
            this.gitHubPickerLoading = false;
            this.update();
        }
    }

    async loadMoreCommits() {
        if (this.gitHubPickerLoading || !this.gitHubHasMoreCommits) return;
        this.gitHubCommitPage++;
        await this.loadCommits();
    }

    async executeComparison() {
        if (!this.gitHubBaseCommit || !this.gitHubHeadCommit) return;
        const owner = this.gitHubCurrentRepo.owner.login;
        const repo = this.gitHubCurrentRepo.name;

        // Close the modal
        this.gitHubPickerOpen = false;
        this.update();

        const leftVfs = new AuthenticatedGitHubFileSystem(
            owner,
            repo,
            this.gitHubBaseCommit,
            this.gitHubSelectedFile,
        );
        const rightVfs = new AuthenticatedGitHubFileSystem(
            owner,
            repo,
            this.gitHubHeadCommit,
            this.gitHubSelectedFile,
        );

        // Mount the correct app and start the comparison
        const isSchematic = this.gitHubSelectedFile.endsWith(".kicad_sch");
        const activeApp = isSchematic ? this.#schematic_app : this.#board_app;
        const inactiveApp = isSchematic ? this.#board_app : this.#schematic_app;

        this.loaded = true;
        this.loading = false;
        this.update();

        // Ensure inactive app is hidden
        inactiveApp.hidden = true;

        await activeApp.startComparisonWithVFS(
            leftVfs,
            rightVfs,
            this.gitHubSelectedFile,
        );
    }

    override render() {
        this.#schematic_app = html`
            <kc-schematic-app controls="full"></kc-schematic-app>
        ` as KCSchematicAppElement;
        this.#board_app = html`
            <kc-board-app controls="full"></kc-board-app>
        ` as KCBoardAppElement;

        return html`
            <kc-ui-app>
                ${this.gitHubPickerOpen
                    ? html`
                          <div
                              class="picker-backdrop"
                              data-action="close-picker"></div>
                          <div class="github-picker-modal">
                              <div class="picker-header">
                                  <h3>Browse GitHub Repositories</h3>
                                  <button
                                      class="close-btn"
                                      data-action="close-picker">
                                      &times;
                                  </button>
                              </div>
                              <div class="picker-body">
                                  ${this.gitHubPickerError
                                      ? html`
                                            <div class="picker-error">
                                                <p>${this.gitHubPickerError}</p>
                                                <a
                                                    href="/auth/github/login"
                                                    class="github-login-btn"
                                                    >Sign in again</a
                                                >
                                            </div>
                                        `
                                      : this.gitHubPickerLoading &&
                                          this.gitHubRepos.length === 0 &&
                                          this.gitHubContents.length === 0 &&
                                          this.gitHubCommits.length === 0
                                        ? html`
                                              <div class="picker-loading">
                                                  Loading...
                                              </div>
                                          `
                                        : this.gitHubPickerView === "repos"
                                          ? html`
                                                <div class="picker-list">
                                                    ${this.gitHubRepos.map(
                                                        (repo) => html`
                                                            <div
                                                                class="picker-item repo-item"
                                                                data-repo-name="${repo.name}"
                                                                data-repo-owner="${repo
                                                                    .owner
                                                                    .login}">
                                                                <span
                                                                    class="repo-name-text">
                                                                    ${repo.owner
                                                                        .login}/${repo.name}
                                                                </span>
                                                                ${repo.private
                                                                    ? html`
                                                                          <span
                                                                              class="private-badge">
                                                                              <kc-ui-icon
                                                                                  >lock</kc-ui-icon
                                                                              >
                                                                          </span>
                                                                      `
                                                                    : ""}
                                                            </div>
                                                        `,
                                                    )}
                                                </div>
                                            `
                                          : this.gitHubPickerView === "files"
                                            ? html`
                                                  <div
                                                      class="picker-breadcrumbs">
                                                      <button
                                                          class="back-btn"
                                                          data-action="back-picker">
                                                          &larr; Back
                                                      </button>
                                                      <span
                                                          class="path-display">
                                                          ${this
                                                              .gitHubCurrentRepo
                                                              .owner
                                                              .login}/${this
                                                              .gitHubCurrentRepo
                                                              .name}/${this
                                                              .gitHubCurrentPath}
                                                      </span>
                                                  </div>
                                                  <div class="picker-list">
                                                      ${this.gitHubContents
                                                          .filter(
                                                              (it) =>
                                                                  it.type ===
                                                                      "dir" ||
                                                                  it.name.endsWith(
                                                                      ".kicad_pcb",
                                                                  ) ||
                                                                  it.name.endsWith(
                                                                      ".kicad_sch",
                                                                  ),
                                                          )
                                                          .map(
                                                              (it) => html`
                                                                  <div
                                                                      class="picker-item ${it.type ===
                                                                      "dir"
                                                                          ? "folder-item"
                                                                          : "file-item"}"
                                                                      data-path="${it.path}"
                                                                      data-type="${it.type}">
                                                                      <kc-ui-icon
                                                                          >${it.type ===
                                                                          "dir"
                                                                              ? "folder"
                                                                              : "article"}</kc-ui-icon
                                                                      >
                                                                      <span
                                                                          class="item-name select-file-action"
                                                                          >${it.name}</span
                                                                      >
                                                                      ${it.type ===
                                                                      "file"
                                                                          ? html`<button
                                                                                class="compare-versions-btn"
                                                                                data-path="${it.path}">
                                                                                Compare
                                                                            </button>`
                                                                          : ""}
                                                                  </div>
                                                              `,
                                                          )}
                                                  </div>
                                              `
                                            : html`
                                                  <div
                                                      class="picker-breadcrumbs">
                                                      <button
                                                          class="back-btn"
                                                          data-action="back-picker">
                                                          &larr; Back
                                                      </button>
                                                      <span
                                                          class="path-display">
                                                          Compare:
                                                          ${this
                                                              .gitHubCurrentRepo
                                                              .owner
                                                              .login}/${this
                                                              .gitHubCurrentRepo
                                                              .name}/${this
                                                              .gitHubSelectedFile}
                                                      </span>
                                                  </div>
                                                  <div
                                                      class="picker-list commits-list">
                                                      ${this.gitHubCommits.map(
                                                          (commit) => html`
                                                              <div
                                                                  class="picker-item commit-item"
                                                                  data-sha="${commit.sha}">
                                                                  <div
                                                                      class="commit-details">
                                                                      <div
                                                                          class="commit-msg">
                                                                          ${commit.message.split(
                                                                              "\n",
                                                                          )[0]}
                                                                      </div>
                                                                      <div
                                                                          class="commit-meta">
                                                                          ${commit.author}
                                                                          on
                                                                          ${new Date(
                                                                              commit.date,
                                                                          ).toLocaleDateString()}
                                                                          (${commit.sha.substring(
                                                                              0,
                                                                              7,
                                                                          )})
                                                                      </div>
                                                                  </div>
                                                                  <div
                                                                      class="commit-select-actions">
                                                                      <button
                                                                          class="set-base-btn ${this
                                                                              .gitHubBaseCommit ===
                                                                          commit.sha
                                                                              ? "active-base"
                                                                              : ""}"
                                                                          data-sha="${commit.sha}">
                                                                          Base
                                                                      </button>
                                                                      <button
                                                                          class="set-head-btn ${this
                                                                              .gitHubHeadCommit ===
                                                                          commit.sha
                                                                              ? "active-head"
                                                                              : ""}"
                                                                          data-sha="${commit.sha}">
                                                                          Head
                                                                      </button>
                                                                  </div>
                                                              </div>
                                                          `,
                                                      )}
                                                      ${this
                                                          .gitHubHasMoreCommits
                                                          ? html`<button
                                                                class="load-more-btn"
                                                                data-action="load-more-commits">
                                                                ${this
                                                                    .gitHubPickerLoading
                                                                    ? "Loading..."
                                                                    : "Load More"}
                                                            </button>`
                                                          : ""}
                                                  </div>
                                                  <div class="picker-footer">
                                                      <button
                                                          class="execute-compare-btn"
                                                          data-action="execute-compare"
                                                          ?disabled="${!this
                                                              .gitHubBaseCommit ||
                                                          !this
                                                              .gitHubHeadCommit}">
                                                          Compare Selected
                                                          Versions
                                                      </button>
                                                  </div>
                                              `}
                              </div>
                          </div>
                      `
                    : ""}
                <section class="overlay">
                    <div class="auth-container-overlay">
                        ${GitHub.auth.loggedIn
                            ? html`
                                  <div class="user-profile-menu">
                                      <img
                                          src="${GitHub.auth.avatar_url || ""}"
                                          alt="${GitHub.auth.username || ""}"
                                          class="user-avatar"
                                          data-action="toggle-user-dropdown" />
                                      <div class="user-dropdown-content">
                                          <div class="user-info">
                                              Signed in as
                                              <strong>${GitHub.auth.username ||
                                              ""}</strong>
                                          </div>
                                          <button
                                              class="logout-btn"
                                              data-action="logout">
                                              Sign out
                                          </button>
                                      </div>
                                  </div>
                              `
                            : html`
                                  <a
                                      href="/auth/github/login"
                                      class="github-login-btn">
                                      <img
                                          src="images/github-mark-white.svg"
                                          alt="GitHub" />
                                      Sign in with GitHub
                                  </a>
                              `}
                    </div>
                    <h1>
                        <img src="images/kicanvas.png" />
                        KiCanvas
                    </h1>
                    <p>
                        KiCanvas is an
                        <strong>interactive</strong>
                        ,
                        <strong>browser-based</strong>
                        viewer for KiCad schematics and boards. You can learn
                        more from the
                        <a href="https://kicanvas.org/home" target="_blank"
                            >docs</a
                        >. It's in
                        <strong>alpha</strong>
                        so please
                        <a
                            href="https://github.com/theacodes/kicanvas/issues/new/choose"
                            target="_blank">
                            report any bugs</a
                        >!
                    </p>
                    <input
                        name="link"
                        type="text"
                        placeholder="Paste a GitHub/Codeberg link..."
                        autofocus />
                    <p>
                        or drag & drop your KiCad files, or<button
                            name="open_local"
                            class="link_button">
                            open a file
                        </button>
                        or<button name="open_local_folder" class="link_button">
                            open a folder
                        </button>
                        ${GitHub.auth.loggedIn
                            ? html`
                                  or<button
                                      name="browse_github"
                                      class="link_button">
                                      browse GitHub repos
                                  </button>
                              `
                            : ""}
                    </p>
                    <p class="note">
                        KiCanvas is
                        <a
                            href="https://github.com/theacodes/kicanvas"
                            target="_blank"
                            >free & open source</a
                        >
                        and supported by
                        <a
                            href="https://github.com/theacodes/kicanvas#special-thanks"
                            >community donations</a
                        >
                        with significant support from
                        <a href="https://partsbox.com/" target="_blank"
                            >PartsBox</a
                        >,
                        <a href="https://blues.io/" target="_blank">Blues</a>,
                        <a href="https://blog.mithis.net/" target="_blank"
                            >Mithro</a
                        >,
                        <a href="https://github.com/jeremysf">Jeremy Gordon</a>,
                        &
                        <a href="https://github.com/jamesneal" target="_blank"
                            >James Neal</a
                        >. KiCanvas runs entirely within your browser, so your
                        files don't ever leave your machine.
                    </p>
                    <p class="github">
                        <a
                            href="https://github.com/theacodes/kicanvas"
                            target="_blank"
                            title="Visit on GitHub">
                            <img src="images/github-mark-white.svg" />
                        </a>
                    </p>
                </section>
                <main>${this.#schematic_app} ${this.#board_app}</main>
            </kc-ui-app>
        `;
    }
}

window.customElements.define("kc-kicanvas-shell", KiCanvasShellElement);
```

## src/kicanvas/services/diff-engine.ts
```typescript
/*
    Cadlab / Banana — Compare Studio diff engine.
*/

import { Color } from "../../graphics";
import type { KicadPCB } from "../../kicad/board";
import type { KicadSch } from "../../kicad/schematic";

export const DiffColors = {
    added: Color.from_css("#22c55e"),
    removed: Color.from_css("#ef4444"),
    modified: Color.from_css("#f59e0b"),
} as const;

export type DiffStatus = keyof typeof DiffColors;

export interface DiffEntry {
    uuid: string;
    status: DiffStatus;
    old_item?: any;
    new_item?: any;
}

type Diffable = KicadPCB | KicadSch;

interface UniqueIdItem {
    unique_id?: string;
    uuid?: string;
}

function unique_id(item: UniqueIdItem): string | undefined {
    return (item as any).unique_id ?? item.uuid;
}

function index_by_uuid(doc: Diffable): Map<string, any> {
    const map = new Map<string, any>();

    const iterable: Iterable<any> =
        typeof (doc as any).items === "function"
            ? (doc as any).items()
            : (doc as KicadSch).symbols.values();

    for (const item of iterable) {
        const id = unique_id(item as UniqueIdItem);
        if (id) map.set(id, item);
    }

    if ((doc as KicadSch).symbols instanceof Map) {
        for (const [id, sym] of (doc as KicadSch).symbols) {
            if (id) map.set(id, sym);
        }
    }

    return map;
}

function fingerprint(item: any): string {
    const seen = new WeakSet<object>();
    const SKIP_KEYS = new Set(["parent", "project", "board", "sheet"]);

    function walk(value: any): any {
        if (value === null || typeof value !== "object") return value;
        if (value instanceof Color) return value.to_css();
        if (seen.has(value)) return "[circular]";
        seen.add(value);

        if (Array.isArray(value)) return value.map(walk);
        if (value instanceof Map) return [...value.entries()].map(walk);

        const out: Record<string, any> = {};
        for (const key of Object.keys(value).sort()) {
            if (SKIP_KEYS.has(key)) continue;
            out[key] = walk(value[key]);
        }
        return out;
    }

    return JSON.stringify(walk(item));
}

export function diff_documents(
    old_doc: Diffable,
    new_doc: Diffable,
): DiffEntry[] {
    const old_map = index_by_uuid(old_doc);
    const new_map = index_by_uuid(new_doc);
    const entries: DiffEntry[] = [];

    for (const [uuid, new_item] of new_map) {
        const old_item = old_map.get(uuid);
        if (!old_item) {
            entries.push({ uuid, status: "added", new_item });
        } else if (fingerprint(old_item) !== fingerprint(new_item)) {
            entries.push({ uuid, status: "modified", old_item, new_item });
        }
    }

    for (const [uuid, old_item] of old_map) {
        if (!new_map.has(uuid)) {
            entries.push({ uuid, status: "removed", old_item });
        }
    }

    return entries;
}

export function build_highlight_map(
    entries: DiffEntry[],
    side: "old" | "new",
): Map<any, Color> {
    const map = new Map<any, Color>();
    for (const entry of entries) {
        if (side === "old" && entry.status === "added") continue;
        if (side === "new" && entry.status === "removed") continue;
        const item = side === "old" ? entry.old_item : entry.new_item;
        if (item) map.set(item, DiffColors[entry.status]);
    }
    return map;
}
```

## src/kicanvas/elements/common/project-panel.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { delegate, listen } from "../../../base/events";
import { no_self_recursion } from "../../../base/functions";
import { css, html } from "../../../base/web-components";
import {
    KCUIElement,
    KCUIMenuElement,
    type KCUIMenuItemElement,
} from "../../../kc-ui";
import type { Project } from "../../project";

export class KCProjectPanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            .page {
                display: flex;
                align-items: center;
            }

            .page span.name {
                margin-right: 1em;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
            }

            .page span.filename {
                flex: 1;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
                margin-left: 1em;
                text-align: right;
                color: #aaa;
            }

            .page kc-ui-button {
                margin-left: 0.5em;
            }

            .page span.number {
                flex: 0;
                background: var(--dropdown-hover-bg);
                border: 1px solid transparent;
                border-radius: 0.5em;
                font-size: 0.8em;
                padding: 0px 0.3em;
                margin-right: 0.5em;
            }

            kc-ui-menu-item:hover span.number {
                background: var(--dropdown-bg);
            }

            kc-ui-menu-item[selected]:hover span.number {
                background: var(--dropdown-hover-bg);
            }
        `,
    ];

    #menu: KCUIMenuElement;
    project: Project;

    override connectedCallback() {
        (async () => {
            this.project = await this.requestContext("project");
            super.connectedCallback();
        })();
    }

    override initialContentCallback() {
        super.initialContentCallback();

        this.addDisposable(
            listen(this.project, "load", (e) => {
                this.update();
            }),
        );

        this.addDisposable(
            listen(this.project, "change", (e) => {
                this.selected = this.project.active_page?.project_path ?? null;
            }),
        );

        this.addEventListener("kc-ui-menu:select", (e) => {
            const source = (e as CustomEvent).detail as KCUIMenuItemElement;
            this.selected = source?.name ?? null;
            this.change_current_project_page(this.selected);
        });

        this.addDisposable(
            delegate(this.renderRoot, "kc-ui-button", "click", (e, source) => {
                const menu_item = source.closest(
                    "kc-ui-menu-item",
                ) as KCUIMenuItemElement;

                this.project.download(menu_item.name);
            }),
        );
    }

    get selected() {
        return this.#menu.selected?.name ?? null;
    }

    set selected(name: string | null) {
        this.#menu.selected = name;
    }

    @no_self_recursion
    private change_current_project_page(name: string | null) {
        this.project.set_active_page(name);
    }

    override render() {
        const file_btn_elms = [];

        if (!this.project) {
            return html``;
        }

        for (const page of this.project.pages()) {
            const icon =
                page.type == "schematic"
                    ? "svg:schematic_file"
                    : "svg:pcb_file";

            const number = page.page
                ? html`<span class="number">${page.page}</span>`
                : "";

            file_btn_elms.push(
                html`<kc-ui-menu-item
                    icon="${icon}"
                    name="${page.project_path}">
                    <span class="page">
                        ${number}
                        <span class="name">
                            ${page.name ?? page.filename}
                        </span>
                        <span class="filename">
                            ${page.name && page.name !== page.filename
                                ? page.filename
                                : ""}
                        </span>
                        <kc-ui-button
                            variant="menu"
                            icon="download"
                            title="Download"></kc-ui-button>
                    </span>
                </kc-ui-menu-item>`,
            );
        }

        this.#menu = html`<kc-ui-menu>
            ${file_btn_elms}
        </kc-ui-menu>` as KCUIMenuElement;

        return html`<kc-ui-panel>
            <kc-ui-panel-title title="Project"></kc-ui-panel-title>
            <kc-ui-panel-body>${this.#menu}</kc-ui-panel-body>
        </kc-ui-panel>`;
    }
}

window.customElements.define("kc-project-panel", KCProjectPanelElement);
```

## src/kicanvas/elements/common/app.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { DeferredPromise } from "../../../base/async";
import { delegate, listen } from "../../../base/events";
import { length } from "../../../base/iterator";
import {
    attribute,
    html,
    type ElementOrFragment,
} from "../../../base/web-components";
import { parseFlagAttribute } from "../../../base/web-components/flag-attribute";
import {
    KCUIActivitySideBarElement,
    KCUIButtonElement,
    KCUIElement,
} from "../../../kc-ui";
import { KiCanvasSelectEvent } from "../../../viewers/base/events";
import type { Viewer } from "../../../viewers/base/viewer";
import { Project } from "../../project";
import type { ProjectPage } from "../../project";
import { KCBoardViewerElement } from "../kc-board/viewer";
import { FilePicker } from "../../../base/dom/file-picker";
import { GitHub } from "../../services/github";
import type { IFileSystem } from "../../services/vfs";

// import dependent elements so they're registered before use.
import "./help-panel";
import "./preferences-panel";
import "./project-panel";
import "./viewer-bottom-toolbar";

interface ViewerElement extends HTMLElement {
    viewer: Viewer;
    load(src: ProjectPage): Promise<void>;
    disableinteraction: boolean;
}

/**
 * Common base class for the schematic, board, etc. apps.
 */
export abstract class KCViewerAppElement<
    ViewerElementT extends ViewerElement,
> extends KCUIElement {
    #viewer_elm: ViewerElementT;
    #activity_bar: KCUIActivitySideBarElement | null;

    project: Project;
    viewerReady: DeferredPromise<boolean> = new DeferredPromise<boolean>();
    public leftFileMissing: boolean = false;
    public rightFileMissing: boolean = false;

    constructor() {
        super();
        this.provideLazyContext("viewer", () => this.viewer);
    }

    get viewer() {
        return this.#viewer_elm.viewer;
    }

    @attribute({ type: String })
    controls: "none" | "basic" | "full";

    @attribute({ type: String })
    controlslist: string;

    @attribute({ type: Boolean })
    sidebarcollapsed: boolean;

    @attribute({ type: Boolean })
    compareActive: boolean = false;

    syncEnabled: boolean = true;
    #right_viewer_elm: any = null;
    #right_project: Project | null = null;
    _leftViewportListener: any = null;
    _rightViewportListener: any = null;

    override connectedCallback() {
        this.hidden = true;
        (async () => {
            this.project = await this.requestContext("project");
            await this.project.loaded;
            super.connectedCallback();
        })();
    }

    override initialContentCallback() {
        // If the project already has an active page, load it.
        if (this.project.active_page) {
            this.load(this.project.active_page!);
        }

        // Listen for changes to the project's active page and load or hide
        // as needed.
        this.addDisposable(
            listen(this.project, "change", async (e) => {
                const page = this.project.active_page;
                if (page) {
                    await this.load(page);
                } else {
                    this.hidden = true;
                }
            }),
        );

        // Handle item selection in the viewers.
        this.addDisposable(
            this.viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
                this.on_viewer_select(e.detail.item, e.detail.previous);
            }),
        );

        // Handle download button.
        delegate(this.renderRoot, "kc-ui-button", "click", (e) => {
            const target = e.target as KCUIButtonElement;
            switch (target.name) {
                case "download":
                    if (this.project.active_page) {
                        this.project.download(
                            this.project.active_page.filename,
                        );
                    }
                    break;
                case "flip_view":
                    this.#viewer_elm.viewer.flip_view();
                    break;
                case "compare":
                    this.startComparison();
                    break;
                case "exit_compare":
                    this.stopComparison();
                    break;
                default:
                    console.warn("Unknown button", e);
            }
        });

        this.renderRoot.addEventListener("click", (e: Event) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            if (target.closest('[data-action="toggle-user-dropdown"]')) {
                this.toggleUserDropdown(e);
            } else if (target.closest('[data-action="logout"]')) {
                this.handleLogout();
            }
        });
    }

    protected abstract on_viewer_select(
        item?: unknown,
        previous?: unknown,
    ): void;

    protected abstract can_load(src: ProjectPage): boolean;

    async load(src: ProjectPage) {
        await this.viewerReady;
        if (this.can_load(src)) {
            await this.#viewer_elm.load(src);
            this.hidden = false;
        } else {
            this.hidden = true;
        }
    }

    #has_more_than_one_page() {
        return length(this.project.pages()) > 1;
    }

    protected make_pre_activities() {
        const activities = [];

        if (this.#has_more_than_one_page()) {
            activities.push(
                html`<kc-ui-activity
                    slot="activities"
                    name="Project"
                    icon="folder">
                    <kc-project-panel></kc-project-panel>
                </kc-ui-activity>`,
            );
        }

        return activities;
    }

    protected make_post_activities() {
        return [
            // Preferences
            html`<kc-ui-activity
                slot="activities"
                name="Preferences"
                icon="settings"
                button-location="bottom">
                <kc-preferences-panel></kc-preferences-panel>
            </kc-ui-activity>`,

            // Help
            html` <kc-ui-activity
                slot="activities"
                name="Help"
                icon="help"
                button-location="bottom">
                <kc-help-panel></kc-help-panel>
            </kc-ui-activity>`,
        ];
    }

    protected abstract make_activities(): ElementOrFragment[];

    protected change_activity(name?: string) {
        this.#activity_bar?.change_activity(name);
    }

    protected abstract make_viewer_element(): ViewerElementT;

    toggleUserDropdown(e: Event) {
        e.stopPropagation();
        const container = (e.target as HTMLElement).closest(
            ".user-profile-menu",
        );
        if (container) {
            container.classList.toggle("active");
            const close = () => {
                container.classList.remove("active");
                document.removeEventListener("click", close);
            };
            document.addEventListener("click", close);
        }
    }

    async handleLogout() {
        try {
            const res = await fetch("/auth/logout", { method: "POST" });
            if (res.ok) {
                GitHub.auth = { loggedIn: false };
                window.location.reload();
            }
        } catch (e) {
            console.error("Logout failed", e);
        }
    }

    async startComparisonWithVFS(
        leftVfs: IFileSystem,
        rightVfs: IFileSystem,
        filePath: string,
    ) {
        this.leftFileMissing = false;
        this.rightFileMissing = false;
        this.compareActive = true;
        this.hidden = false;

        // 1. Setup and load Left VFS
        try {
            await leftVfs.setup();
            await this.project.load(leftVfs);
        } catch (e) {
            console.error("Left version load failed:", e);
            this.leftFileMissing = true;
        }

        // 2. Setup and load Right VFS
        try {
            this.#right_project = new Project();
            await rightVfs.setup();
            await this.#right_project.load(rightVfs);
        } catch (e) {
            console.error("Right version load failed:", e);
            this.rightFileMissing = true;
        }

        this.#right_viewer_elm = this.make_viewer_element();
        this.#right_viewer_elm.disableinteraction = false;

        this.update();

        // 3. Load pages in viewers if they exist
        await new Promise((resolve) => window.requestAnimationFrame(resolve));

        if (!this.leftFileMissing && this.project.first_page) {
            await this.#viewer_elm.load(this.project.first_page);
        }
        if (
            !this.rightFileMissing &&
            this.#right_project &&
            this.#right_project.first_page &&
            this.#right_viewer_elm
        ) {
            await this.#right_viewer_elm.load(this.#right_project.first_page);
        }

        // 4. Run AST diff if both exist
        if (
            !this.leftFileMissing &&
            !this.rightFileMissing &&
            this.#right_viewer_elm
        ) {
            const leftDoc = (this.#viewer_elm.viewer as any)?.document;
            const rightDoc = (this.#right_viewer_elm as any)?.viewer?.document;

            if (leftDoc && rightDoc) {
                const { diff_documents, build_highlight_map } =
                    await import("../../services/diff-engine.js");
                const diffEntries = diff_documents(leftDoc, rightDoc);

                this.#viewer_elm.viewer.set_diff_highlights(
                    build_highlight_map(diffEntries, "old"),
                );
                (this.#right_viewer_elm as any).viewer.set_diff_highlights(
                    build_highlight_map(diffEntries, "new"),
                );

                // Synchronize viewports
                let isSyncing = false;
                const leftViewer = this.#viewer_elm.viewer;
                const rightViewer = (this.#right_viewer_elm as any).viewer;

                this._leftViewportListener = () => {
                    if (!this.syncEnabled || isSyncing) return;
                    isSyncing = true;
                    rightViewer.viewport.camera.center.set(
                        leftViewer.viewport.camera.center,
                    );
                    rightViewer.viewport.camera.zoom =
                        leftViewer.viewport.camera.zoom;
                    rightViewer.viewport.camera.rotation =
                        leftViewer.viewport.camera.rotation;
                    rightViewer.viewport.camera.flipped =
                        leftViewer.viewport.camera.flipped;
                    rightViewer.draw();
                    isSyncing = false;
                };

                this._rightViewportListener = () => {
                    if (!this.syncEnabled || isSyncing) return;
                    isSyncing = true;
                    leftViewer.viewport.camera.center.set(
                        rightViewer.viewport.camera.center,
                    );
                    leftViewer.viewport.camera.zoom =
                        rightViewer.viewport.camera.zoom;
                    leftViewer.viewport.camera.rotation =
                        rightViewer.viewport.camera.rotation;
                    leftViewer.viewport.camera.flipped =
                        rightViewer.viewport.camera.flipped;
                    leftViewer.draw();
                    isSyncing = false;
                };

                (leftViewer as any).addEventListener(
                    "viewportchange",
                    this._leftViewportListener,
                );
                (rightViewer as any).addEventListener(
                    "viewportchange",
                    this._rightViewportListener,
                );
            }
        }
    }

    async startComparison() {
        const compareFolder = confirm(
            "Compare with folder? (Click Cancel to select a single file)",
        );
        const handler = async (vfs: any) => {
            try {
                this.#right_project = new Project();
                await this.#right_project.load(vfs);

                this.#right_viewer_elm = this.make_viewer_element();
                this.#right_viewer_elm.disableinteraction = false;

                this.compareActive = true;
                this.update();

                // Wait for DOM to render the panes
                await new Promise((resolve) =>
                    window.requestAnimationFrame(resolve),
                );

                await this.#right_viewer_elm.load(
                    this.#right_project.first_page,
                );

                // Run AST diff
                const leftDoc = (this.#viewer_elm.viewer as any).document;
                const rightDoc = (this.#right_viewer_elm as any).viewer
                    .document;

                if (leftDoc && rightDoc) {
                    const { diff_documents, build_highlight_map } =
                        await import("../../services/diff-engine.js");
                    const diffEntries = diff_documents(leftDoc, rightDoc);

                    this.#viewer_elm.viewer.set_diff_highlights(
                        build_highlight_map(diffEntries, "old"),
                    );
                    (this.#right_viewer_elm as any).viewer.set_diff_highlights(
                        build_highlight_map(diffEntries, "new"),
                    );

                    // Synchronize viewports
                    let isSyncing = false;
                    const leftViewer = this.#viewer_elm.viewer;
                    const rightViewer = (this.#right_viewer_elm as any).viewer;

                    this._leftViewportListener = () => {
                        if (!this.syncEnabled || isSyncing) return;
                        isSyncing = true;
                        rightViewer.viewport.camera.center.set(
                            leftViewer.viewport.camera.center,
                        );
                        rightViewer.viewport.camera.zoom =
                            leftViewer.viewport.camera.zoom;
                        rightViewer.viewport.camera.rotation =
                            leftViewer.viewport.camera.rotation;
                        rightViewer.viewport.camera.flipped =
                            leftViewer.viewport.camera.flipped;
                        rightViewer.draw();
                        isSyncing = false;
                    };

                    this._rightViewportListener = () => {
                        if (!this.syncEnabled || isSyncing) return;
                        isSyncing = true;
                        leftViewer.viewport.camera.center.set(
                            rightViewer.viewport.camera.center,
                        );
                        leftViewer.viewport.camera.zoom =
                            rightViewer.viewport.camera.zoom;
                        leftViewer.viewport.camera.rotation =
                            rightViewer.viewport.camera.rotation;
                        leftViewer.viewport.camera.flipped =
                            rightViewer.viewport.camera.flipped;
                        leftViewer.draw();
                        isSyncing = false;
                    };

                    (leftViewer as any).addEventListener(
                        "viewportchange",
                        this._leftViewportListener,
                    );
                    (rightViewer as any).addEventListener(
                        "viewportchange",
                        this._rightViewportListener,
                    );
                }
            } catch (err: any) {
                console.error(err);
                alert("Error loading comparison file: " + err.message);
                this.stopComparison();
            }
        };

        if (compareFolder) {
            await FilePicker.pick_folder(handler);
        } else {
            await FilePicker.pick(handler);
        }
    }

    stopComparison() {
        this.compareActive = false;

        // Clean up listeners
        if (this.#viewer_elm && this.#viewer_elm.viewer) {
            const leftViewer = this.#viewer_elm.viewer;
            if (this._leftViewportListener) {
                (leftViewer as any).removeEventListener(
                    "viewportchange",
                    this._leftViewportListener,
                );
            }
            leftViewer.set_diff_highlights(new Map());
        }

        if (this.#right_viewer_elm && (this.#right_viewer_elm as any).viewer) {
            const rightViewer = (this.#right_viewer_elm as any).viewer;
            if (this._rightViewportListener) {
                (rightViewer as any).removeEventListener(
                    "viewportchange",
                    this._rightViewportListener,
                );
            }
        }

        this.#right_project = null;
        this.#right_viewer_elm = null;
        this.update();
    }

    override render() {
        const controls = this.controls ?? "none";
        const controlslist = parseFlagAttribute(
            this.controlslist ?? "",
            controls == "none"
                ? { fullscreen: false, download: false, flipview: false }
                : { fullscreen: true, download: true, flipview: true },
        );

        this.#viewer_elm = this.make_viewer_element();
        this.#viewer_elm.disableinteraction = controls == "none";

        let resizer = null;

        if (controls == "full") {
            const pre_activities = this.make_pre_activities();
            const post_activities = this.make_post_activities();
            const activities = this.make_activities();
            this.#activity_bar = html`<kc-ui-activity-side-bar
                collapsed="${this.sidebarcollapsed}">
                ${pre_activities} ${activities} ${post_activities}
            </kc-ui-activity-side-bar>` as KCUIActivitySideBarElement;
            resizer = html`<kc-ui-resizer></kc-ui-resizer>`;
        } else {
            // No activity bar
            this.#activity_bar = null;
        }

        const top_toolbar_buttons = [];

        if (controlslist["download"] && !this.#has_more_than_one_page()) {
            top_toolbar_buttons.push(
                html`<kc-ui-button
                    slot="right"
                    name="download"
                    title="download"
                    icon="download"
                    variant="toolbar-alt">
                </kc-ui-button>`,
            );
        }

        if (
            controlslist["flipview"] &&
            this.#viewer_elm instanceof KCBoardViewerElement
        ) {
            top_toolbar_buttons.push(
                html`<kc-ui-button
                    slot="right"
                    name="flip_view"
                    title="flip view"
                    icon="flip"
                    variant="toolbar-alt">
                </kc-ui-button>`,
            );
        }

        if (this.#viewer_elm instanceof KCBoardViewerElement) {
            top_toolbar_buttons.push(
                html`<kc-ui-button
                    slot="right"
                    name="${this.compareActive ? "exit_compare" : "compare"}"
                    title="${this.compareActive
                        ? "Exit Compare"
                        : "Compare Boards"}"
                    icon="difference"
                    class="${this.compareActive ? "active" : ""}"
                    variant="toolbar-alt">
                </kc-ui-button>`,
            );
        }

        // GitHub Profile / Login Button
        if (GitHub.auth.loggedIn) {
            top_toolbar_buttons.push(html`
                <div
                    class="user-profile-menu"
                    slot="right"
                    style="margin-left: 8px; align-self: center;">
                    <img
                        src="${GitHub.auth.avatar_url || ""}"
                        alt="${GitHub.auth.username || ""}"
                        class="user-avatar"
                        data-action="toggle-user-dropdown" />
                    <div class="user-dropdown-content">
                        <div class="user-info">
                            Signed in as
                            <strong>${GitHub.auth.username || ""}</strong>
                        </div>
                        <button class="logout-btn" data-action="logout">
                            Sign out
                        </button>
                    </div>
                </div>
            `);
        } else {
            top_toolbar_buttons.push(html`
                <a
                    href="/auth/github/login"
                    class="github-login-btn"
                    slot="right"
                    style="margin-left: 8px; align-self: center;">
                    <img src="images/github-mark-white.svg" alt="GitHub" />
                    Sign in with GitHub
                </a>
            `);
        }

        const top_toolbar = html`<kc-ui-floating-toolbar location="top">
            ${top_toolbar_buttons}
        </kc-ui-floating-toolbar>`;

        let bottom_toolbar = null;
        if (controls != "none") {
            bottom_toolbar = html`<kc-viewer-bottom-toolbar></kc-viewer-bottom-toolbar>`;
        }

        const viewer_content = this.compareActive
            ? html`
                  <div class="split-view-container">
                      <style>
                          .split-view-container {
                              display: flex;
                              flex-direction: row;
                              width: 100%;
                              height: 100%;
                          }
                          .split-view-container .pane {
                              flex: 1;
                              height: 100%;
                              position: relative;
                          }
                          .split-view-container .left-pane {
                              border-right: 2px solid var(--border);
                          }
                          .pane::before {
                              position: absolute;
                              top: 8px;
                              left: 8px;
                              padding: 4px 8px;
                              background: rgba(22, 19, 33, 0.85);
                              border: 1px solid var(--border);
                              border-radius: 4px;
                              font-size: 11px;
                              font-weight: 600;
                              z-index: 10;
                              pointer-events: none;
                          }
                          .left-pane::before {
                              content: "Older version (deleted/modified)";
                              color: #ef4444;
                          }
                          .right-pane::before {
                              content: "Newer version (added/modified)";
                              color: #22c55e;
                          }
                          .missing-file-placeholder {
                              width: 100%;
                              height: 100%;
                              display: flex;
                              align-items: center;
                              justify-content: center;
                              color: #aaa;
                              font-size: 14px;
                              font-weight: 500;
                              background: rgba(22, 19, 33, 0.4);
                              text-align: center;
                              padding: 20px;
                              box-sizing: border-box;
                          }
                      </style>
                      <div class="pane left-pane">
                          ${this.leftFileMissing
                              ? html`<div class="missing-file-placeholder">
                                    This file did not exist at this commit
                                </div>`
                              : this.#viewer_elm}
                      </div>
                      <div class="pane right-pane">
                          ${this.rightFileMissing
                              ? html`<div class="missing-file-placeholder">
                                    This file did not exist at this commit
                                </div>`
                              : this.#right_viewer_elm}
                      </div>
                  </div>
              `
            : this.#viewer_elm;

        return html`<kc-ui-split-view vertical>
            <kc-ui-view class="grow">
                ${top_toolbar} ${viewer_content} ${bottom_toolbar}
            </kc-ui-view>
            ${resizer} ${this.#activity_bar}
        </kc-ui-split-view>`;
    }

    override renderedCallback(): void | undefined {
        window.requestAnimationFrame(() => {
            this.viewerReady.resolve(true);
        });
    }
}
```

## src/kicanvas/preferences.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { listen } from "../base/events";
import { LocalStorage } from "../base/local-storage";
import type { Constructor } from "../base/types";
import type { KCUIElement } from "../kc-ui";
import type { Theme } from "../kicad";
import themes from "./themes";

export class Preferences extends EventTarget {
    public static readonly INSTANCE = new Preferences();

    private storage = new LocalStorage("kc:prefs");

    public theme: Theme = themes.default;
    public alignControlsWithKiCad: boolean = true;

    public save() {
        this.storage.set("theme", this.theme.name);
        this.storage.set("alignControlsWithKiCad", this.alignControlsWithKiCad);
        this.dispatchEvent(new PreferencesChangeEvent({ preferences: this }));
    }

    public load() {
        this.theme = themes.by_name(
            this.storage.get("theme", themes.default.name),
        );
        this.alignControlsWithKiCad = this.storage.get(
            "alignControlsWithKiCad",
            false,
        );
    }
}

Preferences.INSTANCE.load();

export type PreferencesChangeEventDetails = {
    preferences: Preferences;
};

export class PreferencesChangeEvent extends CustomEvent<PreferencesChangeEventDetails> {
    static readonly type = "kicanvas:preferences:change";

    constructor(detail: PreferencesChangeEventDetails) {
        super(PreferencesChangeEvent.type, {
            detail: detail,
            composed: true,
            bubbles: true,
        });
    }
}

/**
 * Mixin used to add provideContext and requestContext methods.
 */
export function WithPreferences<T extends Constructor<KCUIElement>>(Base: T) {
    return class WithPreferences extends Base {
        constructor(...args: any[]) {
            super(...args);

            this.addDisposable(
                listen(
                    Preferences.INSTANCE,
                    PreferencesChangeEvent.type,
                    () => {
                        this.preferenceChangeCallback(this.preferences);
                    },
                ),
            );
        }

        get preferences() {
            return Preferences.INSTANCE;
        }

        async preferenceChangeCallback(preferences: Preferences) {}
    };
}
```

## src/kicanvas/services/github.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { basename } from "../../base/paths";
import { is_array } from "../../base/types";
import { request_error_handler } from "./api-error";

export class GitHubURLInfo {
    owner: string;
    repo: string;
    type: string;
    ref?: string;
    path?: string;
}

export class GithubContentResponse {
    download_url: string;
    git_url: string;
    html_url: string;
    name: string;
    path: string;
    sha: string;
    size: number;
    type: string;
    url: string;
}

export class GitHub {
    static readonly host_name = "github.com";
    static readonly html_base_url = "https://github.com";
    static readonly base_url = "https://api.github.com/";
    static readonly api_version = "2022-11-28";
    static readonly accept_header = "application/vnd.github+json";

    static auth = { loggedIn: false } as {
        loggedIn: boolean;
        username?: string;
        avatar_url?: string;
    };

    static async check_auth() {
        try {
            const response = await fetch("/auth/me");
            if (response.ok) {
                this.auth = await response.json();
            }
        } catch (e) {
            console.error("Failed to check auth status", e);
        }
        return this.auth;
    }

    headers: Record<string, string>;
    last_response?: Response;
    rate_limit_remaining?: number;

    constructor() {
        this.headers = {
            Accept: GitHub.accept_header,
            "X-GitHub-Api-Version": GitHub.api_version,
        };
    }

    /**
     * Parse an html (user-facing) URL
     */
    static parse_url(url: string | URL): GitHubURLInfo | null {
        url = new URL(url, GitHub.html_base_url);
        if (url.hostname != GitHub.host_name) {
            return null;
        }

        const path_parts = url.pathname.split("/").map((s) => decodeURI(s));

        if (path_parts.length < 3) {
            return null;
        }

        const [, owner, repo, ...parts] = path_parts;
        if (!owner || !repo) {
            return null;
        }

        let type;
        let ref;
        let path;

        if (parts.length) {
            if (parts[0] == "blob" || parts[0] == "tree") {
                type = parts.shift();
                ref = parts.shift();
                path = parts.join("/");
            }
        } else {
            type = "root";
        }

        if (!type) {
            return null;
        }

        return {
            owner: owner,
            repo: repo,
            type: type,
            ref: ref,
            path: path,
        };
    }

    async request(
        path: string,
        params?: Record<string, string>,
        data?: unknown,
    ): Promise<unknown> {
        const static_this = this.constructor as typeof GitHub;

        let request: Request;

        if (GitHub.auth.loggedIn) {
            // Rewrite the request to call our backend API proxy contents endpoint
            const match = path.match(
                /^repos\/([^/]+)\/([^/]+)\/contents\/?(.*)$/,
            );
            if (match) {
                const [, owner, repo, subpath] = match;
                const ref = params?.["ref"] || "";
                const urlParams = new URLSearchParams({
                    owner: owner!,
                    repo: repo!,
                    path: subpath!,
                });
                if (ref) {
                    urlParams.set("ref", ref);
                }

                request = new Request(`/api/contents?${urlParams.toString()}`, {
                    method: "GET",
                });
            } else {
                const url = new URL(path, static_this.base_url);
                if (params) {
                    const url_params = new URLSearchParams(params).toString();
                    url.search = `?${url_params}`;
                }
                request = new Request(url, {
                    method: data ? "POST" : "GET",
                    headers: this.headers,
                    body: data ? JSON.stringify(data) : undefined,
                });
            }
        } else {
            const url = new URL(path, static_this.base_url);
            if (params) {
                const url_params = new URLSearchParams(params).toString();
                url.search = `?${url_params}`;
            }
            request = new Request(url, {
                method: data ? "POST" : "GET",
                headers: this.headers,
                body: data ? JSON.stringify(data) : undefined,
            });
        }

        const response = await fetch(request);
        await request_error_handler(response);

        this.last_response = response;

        this.rate_limit_remaining = parseInt(
            response.headers.get("x-ratelimit-remaining") ?? "100",
            10,
        );

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            return await response.json();
        } else {
            return await response.text();
        }
    }

    async repos_contents(
        owner: string,
        repo: string,
        path: string,
        ref?: string,
    ) {
        // https://docs.github.com/en/rest/repos/contents
        // <api_base>/repos/{owner}/{repo}/contents/{path}
        const result = await this.request(
            `repos/${owner}/${repo}/contents/${path}`,
            {
                ref: ref ?? "",
            },
        );

        return is_array(result)
            ? (result as GithubContentResponse[])
            : [result as GithubContentResponse];
    }
}

export class GitHubUserContent {
    static readonly base_url = "https://raw.githubusercontent.com/";

    constructor() {}

    static parse_raw_url(
        url_or_path: string | URL,
    ): { owner: string; repo: string; ref: string; path: string } | null {
        const u = new URL(url_or_path, GitHubUserContent.base_url);
        if (u.hostname !== "raw.githubusercontent.com") {
            return null;
        }
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length < 3) {
            return null;
        }
        const [owner, repo, ref, ...path_parts] = parts;
        return {
            owner: owner!,
            repo: repo!,
            ref: ref!,
            path: path_parts.join("/"),
        };
    }

    async get(url_or_path: string | URL): Promise<File> {
        if (GitHub.auth.loggedIn) {
            const raw_info = GitHubUserContent.parse_raw_url(url_or_path);
            if (raw_info) {
                const params = new URLSearchParams({
                    owner: raw_info.owner,
                    repo: raw_info.repo,
                    path: raw_info.path,
                });
                if (raw_info.ref) {
                    params.set("ref", raw_info.ref);
                }
                const response = await fetch(
                    `/api/contents?${params.toString()}`,
                );
                if (!response.ok) {
                    throw new Error("not found at this ref");
                }
                const blob = await response.blob();
                const name = basename(raw_info.path) ?? "unknown";
                return new File([blob], name);
            }
        }

        const url = new URL(url_or_path, GitHubUserContent.base_url);
        const request = new Request(url, { method: "GET" });
        const response = await fetch(request);
        if (!response.ok) {
            throw new Error("not found at this ref");
        }
        const blob = await response.blob();
        const name = basename(url) ?? "unknown";

        return new File([blob], name);
    }

    /**
     * Converts GitHub UI paths to valid paths for raw.githubusercontent.com.
     *
     * https://github.com/wntrblm/Helium/blob/main/hardware/board/board.kicad_sch
     * becomes
     * https://raw.githubusercontent.com/wntrblm/Helium/main/hardware/board/board.kicad_sch
     */
    convert_url(url: string | URL): URL {
        const u = new URL(url, "https://github.com/");

        if (u.host == "raw.githubusercontent.com") {
            return u;
        }

        const parts = u.pathname.split("/");

        if (parts.length < 4) {
            throw new Error(
                `URL ${url} can't be converted to a raw.githubusercontent.com URL`,
            );
        }

        const [_, user, repo, blob, ref, ...path_parts] = parts;

        if (blob != "blob") {
            throw new Error(
                `URL ${url} can't be converted to a raw.githubusercontent.com URL`,
            );
        }

        const path = [user, repo, ref, ...path_parts].join("/");

        return new URL(path, GitHubUserContent.base_url);
    }
}
```

## src/kicanvas/services/vfs.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { initiate_download } from "../../base/dom/download";
import {
    based_on,
    basename,
    dirname,
    extension,
    normalize_join,
} from "../../base/paths";

/**
 * Virtual file system interface.
 *
 * This is the interface used by <kc-kicanvas-shell> to find and load files.
 * It's implemented using Drag and Drop and GitHub to provide a common interface
 * for interacting and loading files.
 */
export interface IFileSystem {
    /** List all files */
    list(): Generator<string>;

    /** Initialize it. Call this function befoce using VFS */
    setup(): Promise<void>;

    /** Get a file */
    get(path: string): Promise<File>;

    /** Return true if current file list has `path` */
    has(path: string): Promise<boolean>;

    /** Download a file from the file system */
    download(name: string): Promise<void>;
}

/**
 * File entry, directory or file
 */
export class FileEntry {
    path: string;
    type: "file" | "directory";
}

/**
 * File entry, additional type for mark visited items
 */
class FileEntryCache {
    path: string;
    type: "file" | "directory" | "visited-directory";
}

/**
 * File system base
 */
export abstract class FileSystemBase implements IFileSystem {
    // path -> entry
    // e.g.
    //   + root.kicad_pcb
    //   + subdir/
    //     + qwq1.kicad_sch
    //     + qwq2.kicad_sch
    // stored as
    // root.kicad_pcb -> { name: "root.kicad_pcb", type: "file" }
    // subdir -> { name: "subdir", type: "directory" }
    // subdir/qwq1.kicad_sch -> { name: "subdir/qwq1.kicad_sch", type: "file" }
    // subdir/qwq2.kicad_sch -> { name: "subdir/qwq2.kicad_sch", type: "file" }
    private entries: Map<string, FileEntryCache>;

    constructor(entries: Map<string, FileEntry> = new Map()) {
        this.entries = entries;
    }

    *list() {
        for (const [path, entry] of this.entries) {
            if (entry.type === "file") {
                yield path;
            }
        }
    }

    async setup() {
        // Recursively walk the whole tree starting at the root so every
        // folder (not just the ones a caller happens to ask about) is
        // known before the project starts resolving sheet/board files.
        await this.walk("");
    }

    async get(name: string) {
        if (!(await this.has(name))) {
            throw new Error(`File ${name} not found`);
        }

        return await this.load_file(name);
    }

    async has(name: string) {
        const dir = dirname(name);
        if (!this.entries.has(dir) && !this.entries.has(name)) {
            return false;
        }

        // Entries should already be populated from the recursive walk
        // done in setup(), but walk() is idempotent (it no-ops on an
        // already-visited directory) so this is a safe fallback for
        // directories discovered after the fact.
        await this.walk(dir);

        // check if the file exists and is a file
        const obj = this.entries.get(name);
        return !!obj && obj.type === "file";
    }

    async download(name: string) {
        initiate_download(await this.get(name));
    }

    /**
     * Return true if a file has extension name `.kicad_pcb`, `.kicad_prj` or `.kicad_sch`
     */
    protected static is_kicad_file(name: string): boolean {
        const exts = ["kicad_pcb", "kicad_pro", "kicad_sch"];

        return exts.includes(extension(name));
    }

    /**
     * Walk through a directory, record its entries, and recurse into any
     * subdirectories found so the entire folder tree ends up known -
     * giving the project access to every file in every folder up front,
     * not just the ones it happens to ask for by name.
     */
    private async walk(dir: string): Promise<void> {
        if (this.entries.get(dir)?.type === "visited-directory") {
            // visited directory, skip it.
            return;
        }

        const entries = await this.enumerate(dir);
        this.entries.set(dir, { path: dir, type: "visited-directory" });

        const subdirs: string[] = [];

        for (const it of entries) {
            if (it.type === "file" && !FileSystemBase.is_kicad_file(it.path)) {
                continue;
            }
            this.entries.set(it.path, it);
            if (it.type === "directory") {
                subdirs.push(it.path);
            }
        }

        // Recurse into every subdirectory in parallel so the full tree is
        // available as soon as setup() resolves.
        await Promise.all(subdirs.map((subdir) => this.walk(subdir)));
    }

    /**
     * Load file from implementation-specific source
     */
    protected abstract load_file(path: string): Promise<File>;

    /**
     * Enumerate files at `base_dir`. (default: empty)
     */
    protected abstract enumerate(base_dir: string): Promise<FileEntry[]>;
}

/**
 * Merge two virtual file systems into one
 */
export class MergedFileSystem implements IFileSystem {
    private fs_list: IFileSystem[];

    constructor(fs: (IFileSystem | null)[]) {
        this.fs_list = fs.filter((f) => f !== null);
    }

    *list() {
        for (const fs of this.fs_list) {
            yield* fs.list();
        }
    }

    async setup() {
        for (const fs of this.fs_list) {
            await fs.setup();
        }
    }

    async has(name: string): Promise<boolean> {
        for (const fs of this.fs_list) {
            if (await fs.has(name)) {
                return true;
            }
        }

        return false;
    }

    async get(name: string): Promise<File> {
        for (const fs of this.fs_list) {
            if (await fs.has(name)) {
                return await fs.get(name);
            }
        }

        throw new Error(`File ${name} not found`);
    }

    async download(name: string) {
        for (const fs of this.fs_list) {
            if (await fs.has(name)) {
                return await fs.download(name);
            }
        }

        throw new Error(`File ${name} not found`);
    }
}

/**
 * Local file system base class, with a file list provided by the constructor.
 */
export class LocalFileSystemBase extends FileSystemBase {
    constructor(private file_list: Map<string, File>) {
        super(LocalFileSystemBase.into_entries(file_list));
    }

    async load_file(path: string): Promise<File> {
        const file = this.file_list.get(path);

        if (!file) {
            throw new Error(`File ${path} not found!`);
        }

        return file;
    }

    async enumerate(base_dir: string): Promise<FileEntry[]> {
        // All files are already provided by the constructor.
        return [];
    }

    private static into_entries(files: Map<string, File>) {
        const result = new Map<string, FileEntry>();

        for (const path of files.keys()) {
            result.set(path, { path: path, type: "file" });
        }

        return result;
    }
}

/**
 * Virtual file system for URLs via Fetch
 */
export class FetchFileSystem extends FileSystemBase {
    private urls: Map<string, URL> = new Map();
    private resolver!: (name: string) => URL;

    #default_resolver(name: string): URL {
        const url = new URL(name, window.location.toString());
        return url;
    }

    #resolve(filepath: string | URL): URL {
        if (typeof filepath === "string") {
            const cached_url = this.urls.get(filepath);
            if (cached_url) {
                return cached_url;
            } else {
                const url = this.resolver(filepath);
                const name = basename(url);
                this.urls.set(name, url);
                return url;
            }
        }
        return filepath;
    }

    constructor(
        urls: (string | URL)[],
        resolve_file: ((name: string) => URL) | null = null,
    ) {
        super();

        this.resolver = resolve_file ?? this.#default_resolver;

        for (const item of urls) {
            this.#resolve(item);
        }
    }

    async load_file(path: string): Promise<File> {
        const url = this.#resolve(path);

        if (!url) {
            throw new Error(`File ${path} not found!`);
        }

        const request = new Request(url, { method: "GET" });
        const response = await fetch(request);

        if (!response.ok) {
            throw new Error(
                `Unable to load ${url}: ${response.status} ${response.statusText}`,
            );
        }

        const blob = await response.blob();

        return new File([blob], path);
    }

    async enumerate(base_dir: string): Promise<FileEntry[]> {
        return Array.from(this.urls.keys()).map((path) => ({
            path,
            type: "file",
        }));
    }
}

/**
 * Virtual file system for HTML drag and drop (DataTransfer)
 */
export class DragAndDropFileSystem extends LocalFileSystemBase {
    static async fromDataTransfer(dt: DataTransfer) {
        const items: FileSystemEntry[] = [];

        // Pluck items out as webkit entries (either FileSystemFileEntry or
        // FileSystemDirectoryEntry)
        for (let i = 0; i < dt.items.length; i++) {
            const item = dt.items[i]?.webkitGetAsEntry();
            if (item) {
                items.push(item);
            }
        }

        // walk through directories and collect all file entries
        const files = await DragAndDropFileSystem.walk(items);

        // load kicad files
        const file_map = new Map<string, File>();
        for (const entry of files) {
            if (
                entry.isFile &&
                DragAndDropFileSystem.is_kicad_file(entry.name)
            ) {
                const file = await DragAndDropFileSystem.load(entry);
                file_map.set(normalize_join(entry.fullPath), file);
            }
        }

        // TODO: more than one kicad_pro loaded???

        // deduce the common base directory
        const lcp = DragAndDropFileSystem.lcp(Array.from(file_map.keys()));
        const res = new Map(
            [...file_map].map(([p, f]) => [based_on(lcp, p), f]),
        );

        return new DragAndDropFileSystem(res);
    }

    private static lcp(str: string[]): string {
        if (str.length === 0) {
            return "";
        }

        // split dirname only
        const str_arr = str.map((s) =>
            s.split("/").filter(Boolean).slice(0, -1),
        );

        const fst = str_arr[0]!;
        let p_len = fst.length;
        for (const s of str_arr.slice(1)) {
            let i = 0;
            while (i < p_len && i < s.length && fst[i] === s[i]) {
                i += 1;
            }
            p_len = i;
            if (p_len === 0) {
                break;
            }
        }

        return fst.slice(0, p_len).join("/");
    }

    private static async load(entry: FileSystemFileEntry): Promise<File> {
        return await new Promise((resolve, reject) => {
            entry.file(resolve, reject);
        });
    }

    private static async walk(items: FileSystemEntry[]) {
        const files: FileSystemFileEntry[] = [];

        while (items.length > 0) {
            const item = items.pop()!;
            if (item.isFile) {
                files.push(item as FileSystemFileEntry);
            } else if (item.isDirectory) {
                const reader = (
                    item as FileSystemDirectoryEntry
                ).createReader();

                // readEntries() is paginated by spec (browsers commonly
                // cap a single call around ~100 entries) - it must be
                // called repeatedly until it returns an empty array or
                // larger folders will silently lose files/subfolders.
                let batch: FileSystemEntry[];
                do {
                    batch = await new Promise<FileSystemEntry[]>(
                        (resolve, reject) => {
                            reader.readEntries(resolve, reject);
                        },
                    );

                    for (const entry of batch) {
                        if (entry.isFile) {
                            files.push(entry as FileSystemFileEntry);
                        } else if (entry.isDirectory) {
                            items.push(entry);
                        }
                    }
                } while (batch.length > 0);
            }
        }

        return files;
    }
}

/**
 * Virtual file system for local files
 */
export class LocalFileSystem extends LocalFileSystemBase {
    constructor(files: File[]) {
        super(LocalFileSystem.build_entries(files));
    }

    /**
     * Build the path -> File map used by the base class.
     *
     * Files picked through a plain multi-file `<input type="file">` have
     * no folder information, so they're keyed by their bare name. Files
     * picked through a folder picker (`webkitdirectory`) carry
     * `webkitRelativePath` (e.g. "myproject/hardware/board.kicad_sch") -
     * for those we strip the leading (selected) folder name so the
     * resulting paths are relative to the project root, matching how
     * `sheetfile` references are resolved elsewhere.
     */
    private static build_entries(files: File[]): Map<string, File> {
        const entries = files.map((f) => {
            const rel = (f as File & { webkitRelativePath?: string })
                .webkitRelativePath;

            if (!rel) {
                return [f.name, f] as const;
            }

            const parts = rel.split("/").filter(Boolean);
            const path =
                parts.length > 1 ? parts.slice(1).join("/") : parts.join("/");

            return [path, f] as const;
        });

        return new Map(entries);
    }
}
```

## src/kicanvas/services/github-vfs.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import {
    basename,
    dirname,
    extension,
    normalize_join,
    based_on,
} from "../../base/paths";
import { GitHub, GitHubUserContent, type GitHubURLInfo } from "./github";
import { FileSystemBase, type FileEntry } from "./vfs";

const gh_user_content = new GitHubUserContent();
const gh = new GitHub();

/**
 * Virtual file system for GitHub.
 */
export class GitHubFileSystem extends FileSystemBase {
    private download_urls: Map<string, URL>;

    /**
     * If the user linked directly to a single .kicad_sch/.kicad_pcb file
     * (a "blob" URL), this holds that file's path relative to the repo
     * folder we're browsing. We still enumerate that file's containing
     * directory (and recurse into any sheets it references) through the
     * GitHub API so hierarchical/child sheets can be found - we just also
     * prefetch this one file directly so it's available immediately.
     */
    public readonly initial_file?: string;

    constructor(
        url: string | URL,
        private gh_repo: GitHubURLInfo,
        initial_file?: string,
    ) {
        super();
        this.download_urls = new Map<string, URL>();
        this.initial_file = initial_file;

        // Prefetch the exact linked file directly from
        // raw.githubusercontent.com so it's available without waiting on
        // the Contents API call that enumerate() below will also make.
        if (initial_file) {
            const guc_url = gh_user_content.convert_url(url);
            this.download_urls.set(initial_file, guc_url);
        }
    }

    async load_file(path: string): Promise<File> {
        const download_url = this.download_urls.get(path);
        if (!download_url) {
            throw new Error(`File ${path} not found!`);
        }

        return await gh_user_content.get(download_url);
    }

    async enumerate(cur_dir: string): Promise<FileEntry[]> {
        const base_dir = this.gh_repo.path ?? "";
        const full_path = normalize_join(base_dir, cur_dir);

        const contents = await gh.repos_contents(
            this.gh_repo.owner,
            this.gh_repo.repo,
            full_path,
            this.gh_repo.ref,
        );

        const result: FileEntry[] = [];
        for (const it of contents) {
            if (it.type === "file" && GitHubFileSystem.is_kicad_file(it.name)) {
                const path = decodeURI(it.path);
                const file_path = based_on(base_dir, path);

                if (!this.download_urls.has(file_path)) {
                    const download_url = it.download_url
                        ? new URL(it.download_url)
                        : new URL(
                              `https://raw.githubusercontent.com/${this.gh_repo.owner}/${this.gh_repo.repo}/${this.gh_repo.ref || "HEAD"}/${it.path}`,
                          );
                    this.download_urls.set(file_path, download_url);
                }

                result.push({
                    type: "file",
                    path: file_path,
                });
            } else if (it.type === "dir") {
                const path = decodeURI(it.path);
                const dir_path = based_on(base_dir, path);

                result.push({
                    type: "directory",
                    path: dir_path,
                });
            }
        }

        return result;
    }

    public static async fromURLs(
        url: string | URL,
    ): Promise<GitHubFileSystem | null> {
        const info = GitHub.parse_url(url);

        if (!info) {
            return null;
        }

        // Link to the root of a repo, treat it as tree using HEAD
        if (info.type == "root") {
            info.ref = "HEAD";
            info.type = "tree";
        }

        // If the link points at a single kicad_sch/kicad_pcb file, remember
        // it (so it can be prefetched and later focused as the active
        // page), but still browse its containing directory via the API so
        // that any sibling/child sheets it references can be discovered
        // and loaded too - a single-file link no longer means "ignore the
        // rest of the folder".
        let initial_file: string | undefined;
        if (info.type === "blob") {
            const ext_name = extension(info.path!);
            if (["kicad_sch", "kicad_pcb"].includes(ext_name)) {
                initial_file = basename(info.path!);
                info.path = dirname(info.path!);
            } else {
                // Link to non-kicad file, try using the containing directory.
                info.type = "tree";
                if (ext_name.length !== 0) {
                    info.path = dirname(info.path!);
                }
            }
        }

        return new GitHubFileSystem(url, info, initial_file);
    }
}

/**
 * Authenticated virtual file system for GitHub.
 * Routes directory traversal and file loading securely through `/api/contents`.
 */
export class AuthenticatedGitHubFileSystem extends FileSystemBase {
    public readonly initial_file?: string;

    constructor(
        private owner: string,
        private repo: string,
        private ref: string,
        initial_file?: string,
    ) {
        super();
        this.initial_file = initial_file;
    }

    async load_file(path: string): Promise<File> {
        const params = new URLSearchParams({
            owner: this.owner,
            repo: this.repo,
            path: path,
            raw: "true",
        });
        if (this.ref) {
            params.set("ref", this.ref);
        }

        const response = await fetch(`/api/contents?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${path}`);
        }

        const blob = await response.blob();
        const fileName = basename(path) ?? "unknown";
        return new File([blob], fileName);
    }

    async enumerate(cur_dir: string): Promise<FileEntry[]> {
        const params = new URLSearchParams({
            owner: this.owner,
            repo: this.repo,
            path: cur_dir,
        });
        if (this.ref) {
            params.set("ref", this.ref);
        }

        const response = await fetch(`/api/contents?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to list directory: ${cur_dir}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
            // Expected a directory but got a file
            return [];
        }

        const result: FileEntry[] = [];
        for (const it of data) {
            if (
                it.type === "file" &&
                AuthenticatedGitHubFileSystem.is_kicad_file(it.name)
            ) {
                result.push({
                    type: "file",
                    path: decodeURI(it.path),
                });
            } else if (it.type === "dir") {
                result.push({
                    type: "directory",
                    path: decodeURI(it.path),
                });
            }
        }
        return result;
    }
}
```

## src/kc-ui/activity-side-bar.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { delegate } from "../base/events";
import { attribute, css, html, query, query_all } from "../base/web-components";
import { KCUIButtonElement } from "./button";
import { KCUIElement } from "./element";

/**
 * kc-ui-activity-bar is a vscode-style side bar with an action bar with icons
 * and a panel with various activities.
 */
export class KCUIActivitySideBarElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            :host {
                flex-shrink: 0;
                display: flex;
                flex-direction: row;
                height: 100%;
                overflow: hidden;
                min-width: calc(max(20%, 200px));
                max-width: calc(max(20%, 200px));
            }

            div {
                display: flex;
                overflow: hidden;
                flex-direction: column;
            }

            div.bar {
                flex-grow: 0;
                flex-shrink: 0;
                height: 100%;
                z-index: 1;
                display: flex;
                flex-direction: column;
                background: var(--activity-bar-bg);
                color: var(--activity-bar-fg);
                padding: 0.2em;
                user-select: none;
            }

            div.start {
                flex: 1;
            }

            div.activities {
                flex-grow: 1;
            }

            kc-ui-button {
                --button-bg: transparent;
                --button-fg: var(--activity-bar-fg);
                --button-hover-bg: var(--activity-bar-active-bg);
                --button-hover-fg: var(--activity-bar-active-fg);
                --button-selected-bg: var(--activity-bar-active-bg);
                --button-selected-fg: var(--activity-bar-active-fg);
                --button-focus-outline: none;
                margin-bottom: 0.25em;
            }

            kc-ui-button:last-child {
                margin-bottom: 0;
            }

            ::slotted(kc-ui-activity) {
                display: none;
                height: 100%;
            }

            ::slotted(kc-ui-activity[active]) {
                display: block;
                height: 100%;
            }
        `,
    ];

    #activity: string | null | undefined;

    get #activities() {
        // Slightly hacky: using querySelectorAll on light DOM instead of slots
        // so this can be accessed before initial render.
        return this.querySelectorAll<HTMLElement>("kc-ui-activity");
    }

    get #activity_names() {
        return Array.from(this.#activities).map((x) => {
            return (x.getAttribute("name") ?? "").toLowerCase();
        });
    }

    get #default_activity_name() {
        return (this.#activities[0]?.getAttribute("name") ?? "").toLowerCase();
    }

    @query(".activities", true)
    private activities_container!: HTMLElement;

    @query_all("kc-ui-button")
    private buttons!: KCUIButtonElement[];

    @attribute({ type: Boolean })
    public collapsed: boolean;

    override render() {
        const top_buttons: HTMLElement[] = [];
        const bottom_buttons: HTMLElement[] = [];

        for (const activity of this.#activities) {
            const name = activity.getAttribute("name");
            const icon = activity.getAttribute("icon");
            const button_location = activity.getAttribute("button-location");
            (button_location == "bottom" ? bottom_buttons : top_buttons).push(
                html`
                    <kc-ui-button
                        type="button"
                        tooltip-left="${name}"
                        name="${name?.toLowerCase()}"
                        title="${name}"
                        icon=${icon}>
                    </kc-ui-button>
                ` as HTMLElement,
            );
        }

        return html`<div class="bar">
                <div class="start">${top_buttons}</div>
                <div class="end">${bottom_buttons}</div>
            </div>
            <div class="activities">
                <slot name="activities"></slot>
            </div>`;
    }

    override initialContentCallback() {
        if (!this.collapsed) {
            this.change_activity(this.#default_activity_name);
        } else {
            this.change_activity(null);
        }

        delegate(this.renderRoot, "kc-ui-button", "click", (e, source) => {
            this.change_activity((source as KCUIButtonElement).name, true);
        });

        const observer = new MutationObserver(async (mutations) => {
            await this.update();
            // If the currently active activity just got removed, change to the
            // new default one.
            if (
                this.#activity &&
                !this.#activity_names.includes(this.#activity)
            ) {
                this.change_activity(this.#default_activity_name);
            }
        });

        observer.observe(this, {
            childList: true,
        });
    }

    static get observedAttributes() {
        return ["collapsed"];
    }

    attributeChangedCallback(
        name: string,
        old: string | null,
        value: string | null | undefined,
    ) {
        switch (name) {
            case "collapsed":
                if (value == undefined) {
                    this.show_activities();
                } else {
                    this.hide_activities();
                }
                break;
            default:
                break;
        }
    }

    get activity() {
        return this.#activity;
    }

    set activity(name: string | null | undefined) {
        this.change_activity(name, false);
    }

    hide_activities() {
        if (!this.activities_container) {
            return;
        }

        // unset width and minWidth so the container can shrink.
        this.style.width = "unset";
        this.style.minWidth = "unset";
        // clear maxWidth, since the resizer will changes it.
        this.style.maxWidth = "";
        // set the width to 0px so that css transition works as expected.
        this.activities_container.style.width = "0px";
    }

    show_activities() {
        if (!this.activities_container) {
            return;
        }

        if (!this.#activity) {
            this.change_activity(this.#default_activity_name);
        }

        this.style.minWidth = "";
        this.activities_container.style.width = "";
    }

    change_activity(name: string | null | undefined, toggle = false) {
        name = name?.toLowerCase();

        if (this.#activity == name && toggle) {
            // Clicking on the selected activity will deselect it.
            this.#activity = null;
        } else {
            this.#activity = name;
        }

        // If there's no current activity, collapse the activity item
        // container
        if (!this.#activity) {
            this.collapsed = true;
        } else {
            this.collapsed = false;
        }

        this.update_state();
    }

    private update_state() {
        // Mark the selected activity icon button as selected, clearing
        // the others.
        for (const btn of this.buttons) {
            btn.selected = btn.name == this.#activity;
        }

        // Mark the selected activity element active, clearing the others.
        for (const activity of this.#activities) {
            if (
                activity.getAttribute("name")?.toLowerCase() == this.#activity
            ) {
                activity.setAttribute("active", "");
            } else {
                activity.removeAttribute("active");
            }
        }
    }
}

window.customElements.define(
    "kc-ui-activity-side-bar",
    KCUIActivitySideBarElement,
);
```

## src/kc-ui/panel.ts
```typescript
/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { css, html } from "../base/web-components";
import { KCUIElement } from "./element";

/**
 * kc-ui-panel and kc-ui-panel-body encompass basic
 * scrollable panels
 */

export class KCUIPanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            :host {
                width: 100%;
                height: 100%;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                background: var(--panel-bg);
                color: var(--panel-fg);
                --bg: var(--panel-bg);
            }

            :host(:last-child) {
                flex-grow: 1;
            }
        `,
    ];

    override render() {
        return html`<slot></slot>`;
    }
}

window.customElements.define("kc-ui-panel", KCUIPanelElement);

export class KCUIPanelTitleElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            :host {
                flex: 0;
                width: 100%;
                text-align: left;
                padding: 0.2em 0.8em 0.2em 0.4em;
                display: flex;
                align-items: center;
                background: var(--panel-title-bg);
                color: var(--panel-title-fg);
                border-top: var(--panel-title-border);
                user-select: none;
            }

            div.title {
                flex: 1;
            }

            div.actions {
                flex: 0 1;
                display: flex;
                flex-direction: row;
                /* cheeky hack to work around scrollbar causing placement to be off. */
                padding-right: 6px;
            }
        `,
    ];

    override render() {
        return html`<div class="title">${this.title}</div>
            <div class="actions">
                <slot name="actions"></slot>
            </div>`;
    }
}

window.customElements.define("kc-ui-panel-title", KCUIPanelTitleElement);

export class KCUIPanelBodyElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            :host {
                width: 100%;
                min-height: 0;
                overflow-y: auto;
                overflow-x: hidden;
                flex: 1 0;
                font-weight: 300;
                font-size: 1em;
            }

            :host([padded]) {
                padding: 0.1em 0.8em 0.1em 0.4em;
            }
        `,
    ];

    override render() {
        return html`<slot></slot>`;
    }
}

window.customElements.define("kc-ui-panel-body", KCUIPanelBodyElement);

export class KCUIPanelLabelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            :host {
                width: 100%;
                display: flex;
                flex-wrap: nowrap;
                padding: 0.2em 0.3em;
                background: var(--panel-subtitle-bg);
                color: var(--panel-subtitle-fg);
            }
        `,
    ];

    override render() {
        return html`<slot></slot>`;
    }
}

window.customElements.define("kc-ui-panel-label", KCUIPanelLabelElement);
```

## src/kicanvas/elements/kicanvas-shell.css
```css
*,
*::before,
*::after {
    box-sizing: border-box;
}

:host {
    box-sizing: border-box;
    margin: 0;
    display: flex;
    position: relative;
    width: 100%;
    height: 100%;
    color: var(--fg);
}

:host([loaded]) section.overlay,
:host([loading]) section.overlay {
    display: none;
}

:host main {
    display: contents;
}

section.overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--gradient-purple-blue-dark);
}

section.overlay h1 {
    display: flex;
    margin: 0 auto;
    align-items: center;
    justify-content: center;
    font-size: 5em;
    font-weight: 300;
    text-shadow: 0 0 5px var(--gradient-purple-red);
}

section.overlay h1 img {
    width: 1.5em;
}

section.overlay p {
    text-align: center;
    font-size: 1.5em;
    max-width: 50%;
}

section.overlay strong {
    background: var(--gradient-purple-red-highlight);
    -webkit-background-clip: text;
    -moz-background-clip: text;
    background-clip: text;
    color: transparent;
}

section.overlay a {
    color: #81eeff;
}

section.overlay a:hover {
    color: #a3f3ff;
}

section.overlay input {
    font-size: 1.5em;
    color: var(--fg);
    background: var(--gradient-purple-red);
    max-width: 50%;
}

section.overlay input::placeholder {
    color: var(--fg);
}

section.overlay .link_button {
    color: #81eeff;
    background: transparent;
    font-size: 1em;
    font-weight: normal;
    text-decoration: underline;
    outline: none;
    border: none;
    box-sizing: border-box;
    transition: color var(--transition-time-medium) ease;
}

section.overlay .link_button:focus {
    border: var(--button-focus-outline);
}

section.overlay .link_button:hover {
    color: var(--fg);
}

section.overlay p.note {
    color: var(--input-placeholder);
    font-size: 1em;
}

section.overlay p.github img {
    width: 2em;
}

kc-board-viewer,
kc-schematic-viewer {
    width: 100%;
    height: 100%;
    flex: 1;
}

.split-horizontal {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: 100%;
    overflow: hidden;
}

.split-vertical {
    display: flex;
    flex-direction: row;
    width: 100%;
    max-width: 100%;
    height: 100%;
    overflow: hidden;
}

/*                                         */

kc-board-app,
kc-schematic-app {
    width: 100%;
    height: 100%;
    flex: 1;
}

.auth-container-overlay {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 100;
}

/* GitHub Repo Picker Modal styles */
.picker-backdrop {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.4);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
    z-index: 999;
}

.github-picker-modal {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 500px;
    max-width: 90%;
    height: 400px;
    max-height: 80%;
    background: rgba(22, 19, 33, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
}

.picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.picker-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
    color: #fff;
}

.close-btn {
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
}

.close-btn:hover {
    color: #fff;
}

.picker-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
}

.picker-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #ef4444;
    text-align: center;
    margin: auto;
}

.picker-loading {
    margin: auto;
    font-size: 14px;
    color: #aaa;
}

.picker-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.picker-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 13px;
    color: #ddd;
    text-align: left;
}

.picker-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
}

.picker-item kc-ui-icon {
    margin-right: 8px;
    font-size: 16px;
}

.repo-item {
    justify-content: space-between;
}

.private-badge {
    color: #eab308;
    display: flex;
    align-items: center;
}

.private-badge kc-ui-icon {
    margin-right: 0;
}

.picker-breadcrumbs {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.back-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #fff;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
}

.back-btn:hover {
    background: rgba(255, 255, 255, 0.15);
}

.path-display {
    font-size: 11px;
    color: #aaa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.compare-versions-btn {
    background: rgba(106, 90, 205, 0.2);
    border: 1px solid rgba(106, 90, 205, 0.4);
    color: #b0a8ff;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    margin-left: auto;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.compare-versions-btn:hover {
    background: rgba(106, 90, 205, 0.4);
    border-color: rgba(106, 90, 205, 0.6);
}

.commits-list {
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
}

.commit-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(255, 255, 255, 0.02);
    border-radius: 4px;
    margin-bottom: 4px;
}

.commit-item:hover {
    background: rgba(255, 255, 255, 0.05);
}

.commit-details {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 70%;
}

.commit-msg {
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.commit-meta {
    color: #888;
    font-size: 10px;
}

.commit-select-actions {
    display: flex;
    gap: 6px;
}

.set-base-btn,
.set-head-btn {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #aaa;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
}

.set-base-btn:hover {
    border-color: #22c55e;
    color: #22c55e;
    background: rgba(34, 197, 94, 0.1);
}

.set-head-btn:hover {
    border-color: #ef4444;
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
}

.set-base-btn.active-base {
    background: #22c55e;
    border-color: #22c55e;
    color: #fff;
}

.set-head-btn.active-head {
    background: #ef4444;
    border-color: #ef4444;
    color: #fff;
}

.load-more-btn {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #ccc;
    padding: 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 8px;
    text-align: center;
    transition: background 0.15s;
}

.load-more-btn:hover {
    background: rgba(255, 255, 255, 0.1);
}

.picker-footer {
    padding: 12px 16px;
    background: rgba(22, 19, 33, 0.95);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    justify-content: flex-end;
}

.execute-compare-btn {
    background: #6a5acd;
    border: none;
    color: #fff;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
}

.execute-compare-btn:hover:not(:disabled) {
    background: #5748b5;
}

.execute-compare-btn:disabled {
    background: rgba(255, 255, 255, 0.05);
    color: #666;
    cursor: not-allowed;
    border: 1px solid rgba(255, 255, 255, 0.05);
}
```

---

# Identified Constraints & Gotchas

1. **Implicit Same-Root Assumption**:
   Currently, the comparison assumes identical relative paths between left VFS (base) and right VFS (head). Folder comparisons simply match files based on matching names. It is not possible to compare files with different names or from arbitrary folder layers directly.
   
2. **Coupling to Core Viewer Components**:
   Compare view mounting and viewport-sync logic are built inside `KCViewerAppElement` (extended by board and schematic app views). The toggle controls live in floating top toolbars. They are not centralized.

3. **Restricted Selection Source Wires**:
   When entering compare mode, the system expects a single `AuthenticatedGitHubFileSystem` split or local drag-and-drop, rather than letting the user load a local file on the left and a GitHub file on the right simultaneously.

---

# Proposed Refactor Plan

### 1. Centralized Left Sidebar UI
- Introduce a new side-panel activity (`kc-compare-sidebar`) that functions as the visual Diff Control Center.
- Sidebar contains controls for:
  - Synchronization toggle (locks/unlocks dual pan & zoom)
  - Diff view layout dropdown (Overlay mode vs. Side-by-Side split pane)
  - Difference list with metrics (added/deleted counts)

### 2. Independent Universal File/Folder Pickers
- Provide two separated selection containers within the new Compare Sidebar:
  - **Base State (Left Panel)**: File/Folder picker for older/reference files.
  - **Compare State (Right Panel)**: File/Folder picker for newer/modified files.
- Each picker will support opening arbitrary files or folders locally, via URLs, or from GitHub commits independently.

### 3. State Management Refactor
- Extract the selection logic from individual viewer apps into a shared `CompareStore` or state module.
- Track `leftFileSystem`, `selectedLeftFile`, `rightFileSystem`, and `selectedRightFile` separately.
- On executing folder compare:
  - Read files dynamically from both structures.
  - Match them by filename. If names differ, provide manual mappings.
  - Pass the explicit paths/buffers to the diff engine for comparison instead of using implicit relative paths.
