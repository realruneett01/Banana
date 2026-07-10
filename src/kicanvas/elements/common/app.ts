/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

// BUILD VERIFICATION - Remove after confirming fresh code runs
console.log("BUILD-CHECK-" + Date.now());
console.log("APP.TS LOADED - preview-commit handler includes fresh viewer disposal logic");

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
import type { IFileSystem } from "../../services/vfs";
import { GitCommitFileSystem } from "../../services/git-commit-vfs";
import { LocalGitCommitFileSystem } from "../../services/local-git-commit-vfs";
import { KCBoardViewerElement } from "../kc-board/viewer";
import { GitHub } from "../../services/github";
import { compareStore } from "./compare-state.js";

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
        this.provideLazyContext("viewers", () => this.active_viewers);
    }

    get viewer() {
        return this.#viewer_elm.viewer;
    }

    get active_viewers(): Viewer[] {
        if (this.compareActive && this.#right_viewer_elm?.viewer) {
            return [this.#viewer_elm.viewer, (this.#right_viewer_elm as any).viewer];
        }
        return [this.#viewer_elm.viewer];
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
    #left_gen = 0;
    #right_gen = 0;
    _leftViewportListener: any = null;
    _rightViewportListener: any = null;
    #leftLoadedRef: string | null = null;
    #rightLoadedRef: string | null = null;

    override connectedCallback() {
        this.hidden = true;
        (async () => {
            this.project = await this.requestContext("project");
            await this.project.loaded;
            super.connectedCallback();
        })();
    }

    override initialContentCallback() {
        (async () => {
            // Wait for the child viewer element to finish its own initial
            // render pass — this.viewer proxies to #viewer_elm.viewer, which
            // is only assigned inside the child's initialContentCallback().
            // Without this, we race the child's construction and read
            // undefined here.
            await (this.#viewer_elm as any).updateComplete;

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
        })();

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
                    this.change_activity("Compare");
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

        this.renderRoot.addEventListener("compare-git-commits", async (e: any) => {
            // Skip if this app element is hidden — prevents both kc-board-app
            // and kc-schematic-app from both handling the same bubbled event.
            if (this.hidden) return;
            const { commitA, commitB, filePath, repoPath } = e.detail;
            await this.compareGitCommits(repoPath, filePath, commitA, commitB);
        });

        this.renderRoot.addEventListener("preview-commit", async (e: any) => {
            if (this.hidden) return;
            const { side, commit, filePath, repoPath } = e.detail;
            
            console.log(`[preview-commit] Received for ${side}: commit=${commit}, file=${filePath}`);

            // Ensure the split layout + both viewer elements exist before loading either side
            if (!this.compareActive) {
                console.log('[preview-commit] Activating compare mode...');
                this.compareActive = true;
                this.hidden = false;
                
                try {
                    await this.initViewerElement('left');
                    await this.initViewerElement('right');
                } catch (e) {
                    console.warn('[preview-commit] Viewer initialization aborted:', e);
                    return;
                }
            }

            await this.loadPanelFromCommit(side, repoPath, filePath, commit);

            // Set up viewport sync if both panels are loaded
            if (this.#leftLoadedRef && this.#rightLoadedRef) {
                console.log('[preview-commit] Both panels loaded, setting up viewport sync');
                this.setupViewportSync();
            }
        });

        window.addEventListener("open-compare-panel", () => {
            this.change_activity("Compare");
        });
    }

    protected abstract on_viewer_select(
        item?: unknown,
        previous?: unknown,
    ): void;

    protected abstract can_load(src: ProjectPage): boolean;

    async load(src: ProjectPage) {
        const gen = this.#left_gen;
        await this.viewerReady;
        if (gen !== this.#left_gen) return;
        if (this.can_load(src)) {
            if (!this.#viewer_elm) {
                try {
                    await this.initViewerElement('left');
                } catch (e) {
                    return;
                }
            } else {
                await this.waitForViewerReady(this.#viewer_elm);
            }
            if (gen !== this.#left_gen) return;
            await this.#viewer_elm.load(src);
            if (gen !== this.#left_gen) return;
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

    private async initViewerElement(side: 'left' | 'right'): Promise<any> {
        console.log(`[initViewerElement] Initializing ${side} viewer...`);
        if (side === 'left') {
            this.#left_gen++;
            const gen = this.#left_gen;
            
            if (this.#viewer_elm) {
                console.log(`[initViewerElement] Disposing existing LEFT viewer`);
                this.#viewer_elm.remove();
                if ((this.#viewer_elm as any).dispose) {
                    (this.#viewer_elm as any).dispose();
                }
                this.#viewer_elm = null as any;
            }
            
            this.#viewer_elm = this.make_viewer_element();
            this.#viewer_elm.disableinteraction = this.compareActive ? false : (this.controls === "none");
            
            if (this.compareActive) {
                this.injectCompareLayout();
            }
            
            await this.waitForViewerReady(this.#viewer_elm);
            if (gen !== this.#left_gen) {
                throw new Error('Left viewer generation changed during initialization');
            }
            
            if (this.compareActive && this.#viewer_elm.viewer) {
                (this.#viewer_elm.viewer as any).__debug_panel_id = 'left(base)';
            }
            return this.#viewer_elm;
        } else {
            this.#right_gen++;
            const gen = this.#right_gen;
            
            if (this.#right_viewer_elm) {
                console.log(`[initViewerElement] Disposing existing RIGHT viewer`);
                this.#right_viewer_elm.remove();
                if ((this.#right_viewer_elm as any).dispose) {
                    (this.#right_viewer_elm as any).dispose();
                }
                this.#right_viewer_elm = null;
            }
            
            this.#right_viewer_elm = this.make_viewer_element();
            this.#right_viewer_elm.disableinteraction = false;
            
            this.injectCompareLayout();
            
            await this.waitForViewerReady(this.#right_viewer_elm);
            if (gen !== this.#right_gen) {
                throw new Error('Right viewer generation changed during initialization');
            }
            
            if (this.#right_viewer_elm.viewer) {
                (this.#right_viewer_elm.viewer as any).__debug_panel_id = 'right(head)';
            }
            return this.#right_viewer_elm;
        }
    }

    private async waitForViewerReady(viewerEl: any) {
        console.log('[waitForViewerReady] Checking if viewer element exists...');
        if (!viewerEl) {
            throw new Error('Viewer element is null!');
        }
        
        console.log('[waitForViewerReady] Waiting for viewer.viewer to be created...');
        let attempts = 0;
        const maxAttempts = 100; // 100 * 16ms ≈ 1.6 seconds
        
        while (!viewerEl.viewer && attempts < maxAttempts) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            attempts++;
        }
        
        if (!viewerEl.viewer) {
            console.error('[waitForViewerReady] ERROR: viewer.viewer never initialized after', attempts, 'attempts');
            console.error('[waitForViewerReady] ViewerEl:', viewerEl);
            console.error('[waitForViewerReady] Is connected?', viewerEl.isConnected);
            throw new Error('Viewer failed to initialize');
        }
        
        console.log('[waitForViewerReady] viewer.viewer exists, waiting for setup_finished...');
        await (viewerEl.viewer as any).setup_finished;
        console.log('[waitForViewerReady] Viewer fully ready!');
    }

    private async loadPanelFromCommit(
        side: 'left' | 'right',
        repoPath: string,
        filePath: string,
        ref: string,
    ) {
        console.log(`[loadPanelFromCommit] Loading ${side} panel with ref ${ref}`);
        const gen = side === 'left' ? this.#left_gen : this.#right_gen;

        // Build VFS
        const vfs: IFileSystem = compareStore.browserFs
            ? new LocalGitCommitFileSystem({
                  browserFs: compareStore.browserFs,
                  ref,
                  filePath,
              })
            : new GitCommitFileSystem({ repoPath, ref, filePath });

        // Load project
        const project = new Project();
        try {
            await vfs.setup();
            if ((side === 'left' ? this.#left_gen : this.#right_gen) !== gen) return;
            await project.load(vfs);
            if ((side === 'left' ? this.#left_gen : this.#right_gen) !== gen) return;
            console.log(`[loadPanelFromCommit] ${side} project loaded, pages:`, [...project.pages()].length);
        } catch (e) {
            console.error(`Failed to load ${side} panel:`, e);
            if (side === 'left') {
                this.leftFileMissing = true;
            } else {
                this.rightFileMissing = true;
            }
            return;
        }

        // Find the page
        const page = this.findPageByPath(project, filePath) || project.first_page;
        if (!page) {
            console.error(`No page found for ${filePath} in ${side} panel`);
            if (side === 'left') {
                this.leftFileMissing = true;
            } else {
                this.rightFileMissing = true;
            }
            return;
        }

        console.log(`[loadPanelFromCommit] ${side} page found:`, page.filename);

        // Get the viewer element for this side
        const viewerElm = side === 'left' ? this.#viewer_elm : this.#right_viewer_elm;
        if (!viewerElm) {
            console.error(`No viewer element for ${side} panel`);
            return;
        }

        // Wait for viewer to be ready and load
        console.log(`[loadPanelFromCommit] ${side} waiting for viewer ready...`);
        await this.waitForViewerReady(viewerElm);
        if ((side === 'left' ? this.#left_gen : this.#right_gen) !== gen) return;
        console.log(`[loadPanelFromCommit] ${side} viewer ready, loading page...`);
        await viewerElm.load(page);
        if ((side === 'left' ? this.#left_gen : this.#right_gen) !== gen) return;
        console.log(`[loadPanelFromCommit] ${side} page loaded into viewer`);

        // Track what ref is loaded
        if (side === 'left') {
            this.#leftLoadedRef = ref;
            this.leftFileMissing = false;
        } else {
            this.#rightLoadedRef = ref;
            this.rightFileMissing = false;
        }

        console.log(`[loadPanelFromCommit] ${side} panel loaded successfully`);
    }

    async startComparisonWithVFS(
        leftVfs: IFileSystem,
        rightVfs: IFileSystem,
        filePath: string,
    ) {
        this.cleanupViewportSync();

        this.leftFileMissing = false;
        this.rightFileMissing = false;
        this.compareActive = true;
        this.hidden = false;

        // Load both VFS projects in parallel
        const leftProject = new Project();
        const rightProject = new Project();

        await Promise.all([
            (async () => {
                try {
                    await leftVfs.setup();
                    await leftProject.load(leftVfs);
                } catch (e) {
                    console.error("Left version load failed:", e);
                    this.leftFileMissing = true;
                }
            })(),
            (async () => {
                try {
                    await rightVfs.setup();
                    await rightProject.load(rightVfs);
                } catch (e) {
                    console.error("Right version load failed:", e);
                    this.rightFileMissing = true;
                }
            })()
        ]);

        const leftGen = this.#left_gen + 1;
        const rightGen = this.#right_gen + 1;

        try {
            await this.initViewerElement('left');
            await this.initViewerElement('right');
        } catch (e) {
            console.warn('[startComparisonWithVFS] Viewer initialization aborted:', e);
            return;
        }

        if (leftGen !== this.#left_gen || rightGen !== this.#right_gen) return;

        // Load the file into each viewer
        if (!this.leftFileMissing) {
            const leftPage = this.findPageByPath(leftProject, filePath) || leftProject.first_page;
            if (leftPage) {
                await this.#viewer_elm.load(leftPage);
            } else {
                this.leftFileMissing = true;
            }
        }

        if (leftGen !== this.#left_gen || rightGen !== this.#right_gen) return;

        if (!this.rightFileMissing) {
            const rightPage = this.findPageByPath(rightProject, filePath) || rightProject.first_page;
            if (rightPage) {
                await this.#right_viewer_elm.load(rightPage);
            } else {
                this.rightFileMissing = true;
            }
        }

        if (leftGen !== this.#left_gen || rightGen !== this.#right_gen) return;

        // Run AST diff if both loaded
        if (!this.leftFileMissing && !this.rightFileMissing) {
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

                this.setupViewportSync();
            }
        }
    }

    /**
     * Directly injects the compare split-view layout into the existing DOM
     * without calling this.update(), which would tear down all child elements
     * (side panels, toolbar, etc.) and trigger DisposableStack disposal errors.
     *
     * We find the kc-ui-view.grow container and swap its viewer slot content.
     * 
     * This method is idempotent - it can be called multiple times as viewers
     * are created sequentially.
     */
    private injectCompareLayout() {
        console.log('[injectCompareLayout] Starting layout injection');
        
        // Find the viewer content container in the existing rendered DOM.
        // The render() output is: kc-ui-split-view > kc-ui-view.grow > [toolbar, viewer, bottom-toolbar]
        const viewContainer = this.renderRoot.querySelector('kc-ui-view.grow');
        if (!viewContainer) {
            console.warn('[compare] Could not find kc-ui-view.grow — falling back to full update()');
            this.update();
            return;
        }

        // Find or create the split-view container
        let splitContainer = viewContainer.querySelector('.split-view-container') as HTMLElement;
        
        if (!splitContainer) {
            // Remove any existing single viewer
            const existingViewer = viewContainer.querySelector('kc-board-viewer, kc-schematic-viewer');
            if (existingViewer) {
                console.log('[injectCompareLayout] Removing existing single viewer');
                existingViewer.remove();
            }

            // Build the split-view container inline
            splitContainer = document.createElement('div');
            splitContainer.className = 'split-view-container';
            splitContainer.style.cssText = 'display:flex;flex-direction:row;width:100%;height:100%;';

            // Append after the top toolbar (first child is typically the toolbar)
            const topToolbar = viewContainer.querySelector('kc-ui-floating-toolbar');
            if (topToolbar && topToolbar.nextSibling) {
                viewContainer.insertBefore(splitContainer, topToolbar.nextSibling);
            } else {
                viewContainer.appendChild(splitContainer);
            }
        }

        // Find or create left pane
        let leftPane = splitContainer.querySelector('.left-pane') as HTMLElement;
        if (!leftPane) {
            leftPane = document.createElement('div');
            leftPane.className = 'pane left-pane';
            leftPane.style.cssText = 'flex:1;height:100%;position:relative;border-right:2px solid var(--border,#2a2833);';

            const leftLabel = document.createElement('div');
            leftLabel.style.cssText = 'position:absolute;top:8px;left:8px;padding:4px 8px;background:rgba(22,19,33,0.85);border:1px solid #2a2833;border-radius:4px;font-size:11px;font-weight:600;z-index:10;pointer-events:none;color:#ef4444;font-family:inherit;';
            leftLabel.textContent = 'Older version (deleted/modified)';
            leftPane.appendChild(leftLabel);

            splitContainer.appendChild(leftPane);
        }

        // Add left viewer to left pane if it exists and isn't already there
        if (this.#viewer_elm && !leftPane.contains(this.#viewer_elm)) {
            leftPane.appendChild(this.#viewer_elm);
            console.log('[injectCompareLayout] Left viewer added to left pane');
        }

        // Find or create right pane
        let rightPane = splitContainer.querySelector('.right-pane') as HTMLElement;
        if (!rightPane) {
            rightPane = document.createElement('div');
            rightPane.className = 'pane right-pane';
            rightPane.style.cssText = 'flex:1;height:100%;position:relative;';

            const rightLabel = document.createElement('div');
            rightLabel.style.cssText = 'position:absolute;top:8px;left:8px;padding:4px 8px;background:rgba(22,19,33,0.85);border:1px solid #2a2833;border-radius:4px;font-size:11px;font-weight:600;z-index:10;pointer-events:none;color:#22c55e;font-family:inherit;';
            rightLabel.textContent = 'Newer version (added/modified)';
            rightPane.appendChild(rightLabel);

            splitContainer.appendChild(rightPane);
        }

        // Add right viewer to right pane if it exists and isn't already there
        if (this.#right_viewer_elm && !rightPane.contains(this.#right_viewer_elm)) {
            rightPane.appendChild(this.#right_viewer_elm);
            console.log('[injectCompareLayout] Right viewer added to right pane');
        }

        console.log('[injectCompareLayout] Layout injection complete');
        console.log('[injectCompareLayout] Left viewer isConnected:', (this.#viewer_elm as any)?.isConnected);
        console.log('[injectCompareLayout] Right viewer isConnected:', (this.#right_viewer_elm as any)?.isConnected);
        
        // Force a synchronous layout to ensure connectedCallback() fires
        // Reading offsetHeight forces a layout calculation
        void splitContainer.offsetHeight;
        
        console.log('[injectCompareLayout] After layout force - Left viewer isConnected:', (this.#viewer_elm as any)?.isConnected);
        console.log('[injectCompareLayout] After layout force - Right viewer isConnected:', (this.#right_viewer_elm as any)?.isConnected);
    }

    private findPageByPath(project: Project, path: string) {
        for (const page of project.pages()) {
            if (page.filename === path || page.project_path === path) {
                return page;
            }
        }
        return null;
    }



    private setupViewportSync() {
        this.cleanupViewportSync();

        let isSyncing = false;
        const leftViewer = this.#viewer_elm.viewer;
        const rightViewer = (this.#right_viewer_elm as any).viewer;

        this._leftViewportListener = () => {
            if (!compareStore.syncEnabled || isSyncing) return;
            isSyncing = true;
            rightViewer.viewport.camera.center.set(leftViewer.viewport.camera.center);
            rightViewer.viewport.camera.zoom = leftViewer.viewport.camera.zoom;
            rightViewer.viewport.camera.rotation = leftViewer.viewport.camera.rotation;
            rightViewer.viewport.camera.flipped = leftViewer.viewport.camera.flipped;
            rightViewer.draw();
            isSyncing = false;
        };

        this._rightViewportListener = () => {
            if (!compareStore.syncEnabled || isSyncing) return;
            isSyncing = true;
            leftViewer.viewport.camera.center.set(rightViewer.viewport.camera.center);
            leftViewer.viewport.camera.zoom = rightViewer.viewport.camera.zoom;
            leftViewer.viewport.camera.rotation = rightViewer.viewport.camera.rotation;
            leftViewer.viewport.camera.flipped = rightViewer.viewport.camera.flipped;
            leftViewer.draw();
            isSyncing = false;
        };

        (leftViewer as any).addEventListener("viewportchange", this._leftViewportListener);
        (rightViewer as any).addEventListener("viewportchange", this._rightViewportListener);
    }

    private cleanupViewportSync() {
        if (this.#viewer_elm?.viewer && this._leftViewportListener) {
            (this.#viewer_elm.viewer as any).removeEventListener("viewportchange", this._leftViewportListener);
        }
        if (this.#right_viewer_elm && (this.#right_viewer_elm as any).viewer && this._rightViewportListener) {
            ((this.#right_viewer_elm as any).viewer as any).removeEventListener("viewportchange", this._rightViewportListener);
        }
        this._leftViewportListener = null;
        this._rightViewportListener = null;
    }

    stopComparison() {
        this.compareActive = false;
        this.cleanupViewportSync();

        if (this.#viewer_elm?.viewer) {
            this.#viewer_elm.viewer.set_diff_highlights(new Map());
        }

        this.#right_viewer_elm = null;
        this.#leftLoadedRef = null;
        this.#rightLoadedRef = null;

        // CRITICAL: Clear the reference so render() creates a fresh one
        this.#viewer_elm = null as any;

        // If project has an active page, reload it
        if (this.project?.active_page) {
            this.load(this.project.active_page);
        }

        this.update();
    }

   async compareGitCommits(repoPath: string, filePath: string, commitA: string, commitB: string) 
   {
    console.log('[compareGitCommits] Starting full comparison');
    console.log(`  commitA=${commitA}, commitB=${commitB}, file=${filePath}`);

    // Ensure compare mode is active and layout is ready
    if (!this.compareActive) {
        this.compareActive = true;
        this.hidden = false;
        this.#viewer_elm ||= this.make_viewer_element();
        this.#viewer_elm.disableinteraction = false;
        this.#right_viewer_elm ||= this.make_viewer_element();
        this.#right_viewer_elm.disableinteraction = false;
        this.injectCompareLayout();
    }

    // Load left panel only if not already loaded with this ref
    if (this.#leftLoadedRef !== commitA) {
        console.log(`[compareGitCommits] Loading left panel (ref changed from ${this.#leftLoadedRef} to ${commitA})`);
        await this.loadPanelFromCommit('left', repoPath, filePath, commitA);
    } else {
        console.log(`[compareGitCommits] Skipping left panel reload (already showing ${commitA})`);
    }

    // Load right panel only if not already loaded with this ref
    if (this.#rightLoadedRef !== commitB) {
        console.log(`[compareGitCommits] Loading right panel (ref changed from ${this.#rightLoadedRef} to ${commitB})`);
        await this.loadPanelFromCommit('right', repoPath, filePath, commitB);
    } else {
        console.log(`[compareGitCommits] Skipping right panel reload (already showing ${commitB})`);
    }

    // Run diff engine if both panels loaded successfully
    if (!this.leftFileMissing && !this.rightFileMissing) {
        const leftDoc = (this.#viewer_elm.viewer as any)?.document;
        const rightDoc = (this.#right_viewer_elm as any)?.viewer?.document;

        if (leftDoc && rightDoc) {
            console.log('[compareGitCommits] Running diff engine');
            const { diff_documents, build_highlight_map } =
                await import("../../services/diff-engine.js");
            const diffEntries = diff_documents(leftDoc, rightDoc);

            this.#viewer_elm.viewer.set_diff_highlights(
                build_highlight_map(diffEntries, "old"),
            );
            (this.#right_viewer_elm as any).viewer.set_diff_highlights(
                build_highlight_map(diffEntries, "new"),
            );

            this.setupViewportSync();
            console.log('[compareGitCommits] Diff complete');
        }
    }
   }

    override render() {
        const controls = this.controls ?? "none";
        const controlslist = parseFlagAttribute(
            this.controlslist ?? "",
            controls == "none"
                ? { fullscreen: false, download: false, flipview: false }
                : { fullscreen: true, download: true, flipview: true },
        );

        // CRITICAL: Only create viewer if missing, AND not in compare mode
        // In compare mode, viewers are created by startComparisonWithVFS()
        if (!this.compareActive && !this.#viewer_elm) {
            this.#viewer_elm = this.make_viewer_element();
        }
        
        if (!this.compareActive) {
            this.#viewer_elm.disableinteraction = controls == "none";
        }

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
