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

    async startComparison() {
        const compareFolder = confirm("Compare with folder? (Click Cancel to select a single file)");
        const handler = async (vfs: any) => {
            try {
                this.#right_project = new Project();
                await this.#right_project.load(vfs);

                this.#right_viewer_elm = this.make_viewer_element();
                this.#right_viewer_elm.disableinteraction = false;

                this.compareActive = true;
                this.update();

                // Wait for DOM to render the panes
                await new Promise((resolve) => window.requestAnimationFrame(resolve));

                await this.#right_viewer_elm.load(this.#right_project.first_page);

                // Run AST diff
                const leftDoc = (this.#viewer_elm.viewer as any).document;
                const rightDoc = (this.#right_viewer_elm as any).viewer.document;

                if (leftDoc && rightDoc) {
                    const { diff_documents, build_highlight_map } = await import("../../services/diff-engine.js");
                    const diffEntries = diff_documents(leftDoc, rightDoc);

                    this.#viewer_elm.viewer.set_diff_highlights(build_highlight_map(diffEntries, "old"));
                    (this.#right_viewer_elm as any).viewer.set_diff_highlights(build_highlight_map(diffEntries, "new"));

                    // Synchronize viewports
                    let isSyncing = false;
                    const leftViewer = this.#viewer_elm.viewer;
                    const rightViewer = (this.#right_viewer_elm as any).viewer;

                    this._leftViewportListener = () => {
                        if (!this.syncEnabled || isSyncing) return;
                        isSyncing = true;
                        rightViewer.viewport.camera.center.set(leftViewer.viewport.camera.center);
                        rightViewer.viewport.camera.zoom = leftViewer.viewport.camera.zoom;
                        rightViewer.viewport.camera.rotation = leftViewer.viewport.camera.rotation;
                        rightViewer.viewport.camera.flipped = leftViewer.viewport.camera.flipped;
                        rightViewer.draw();
                        isSyncing = false;
                    };

                    this._rightViewportListener = () => {
                        if (!this.syncEnabled || isSyncing) return;
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
                (leftViewer as any).removeEventListener("viewportchange", this._leftViewportListener);
            }
            leftViewer.set_diff_highlights(new Map());
        }

        if (this.#right_viewer_elm && (this.#right_viewer_elm as any).viewer) {
            const rightViewer = (this.#right_viewer_elm as any).viewer;
            if (this._rightViewportListener) {
                (rightViewer as any).removeEventListener("viewportchange", this._rightViewportListener);
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
                    name="${this.compareActive ? 'exit_compare' : 'compare'}"
                    title="${this.compareActive ? 'Exit Compare' : 'Compare Boards'}"
                    icon="difference"
                    class="${this.compareActive ? 'active' : ''}"
                    variant="toolbar-alt">
                </kc-ui-button>`,
            );
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
                    </style>
                    <div class="pane left-pane">
                        ${this.#viewer_elm}
                    </div>
                    <div class="pane right-pane">
                        ${this.#right_viewer_elm}
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
