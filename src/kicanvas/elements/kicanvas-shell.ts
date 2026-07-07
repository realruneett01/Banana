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
import { FetchFileSystem, LocalFileSystem, type IFileSystem } from "../services/vfs";
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

             this.addEventListener("drop", async (e: DragEvent) => {
                const items = e.dataTransfer?.items;
                if (!items) return;

                for (const item of items) {
                    if (item.kind !== 'file') continue;
                    try {
                        const handle = await (item as any).getAsFileSystemHandle?.();
                        if (handle && handle.kind === 'directory') {
                            let hasGit = false;
                            try {
                                await handle.getDirectoryHandle('.git');
                                hasGit = true;
                            } catch {}

                            if (hasGit) {
                                e.preventDefault();
                                e.stopPropagation();

                                const repoPath = prompt(
                                    'Git repo detected. Enter the absolute path on disk so the backend can read it:'
                                );
                                if (repoPath) {
                                    const res = await fetch('/api/git/init', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ repoPath }),
                                    });
                                    const data = await res.json();
                                    if (data.hasGit) {
                                        window.dispatchEvent(new CustomEvent('git-repo-detected', {
                                            detail: { repoPath, commits: data.commits },
                                        }));

                                        window.dispatchEvent(new CustomEvent('open-compare-panel'));
                                    }
                                }
                                return;
                            }
                        }
                    } catch (err) {
                        console.error("Drop handle check failed:", err);
                    }
                }
            }, { capture: true });

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
            if (vfs instanceof LocalFileSystem && (vfs as any).path) {
                await this.initGitRepo((vfs as any).path);
            }
        });
    }

    private async initGitRepo(repoPath: string) {
        try {
            const res = await fetch("/api/git/init", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repoPath }),
            });
            
            const data = await res.json();
            if (data.hasGit) {
                window.dispatchEvent(new CustomEvent("git-repo-detected", {
                    detail: { repoPath, commits: data.commits },
                }));
            }
        } catch (e) {
            console.error("Git init failed:", e);
        }
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

        // Find the active app and trigger comparison through the new state system
        const isSchematic = this.gitHubSelectedFile.endsWith(".kicad_sch");
        const activeApp = isSchematic ? this.#schematic_app : this.#board_app;

        // Set state in compare store
        const { compareStore } = await import("./common/compare-state.js");
        compareStore.setSelection({
            repoPath: "",
            filePath: this.gitHubSelectedFile,
            commitA: this.gitHubBaseCommit,
            commitB: this.gitHubHeadCommit,
        });

        // Activate compare mode on the app
        activeApp.compareActive = true;
        activeApp.update();
        await activeApp.startComparisonWithVFS(leftVfs, rightVfs, this.gitHubSelectedFile);
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
                                              <strong
                                                  >${GitHub.auth.username ||
                                                  ""}</strong
                                              >
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
