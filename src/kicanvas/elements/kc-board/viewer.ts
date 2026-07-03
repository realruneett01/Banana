/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { html } from "../../../base/web-components";
import { BoardViewer } from "../../../viewers/board/viewer";
import { KCViewerElement } from "../common/viewer";
import type { KCContextMenuElement } from "../common/context-menu";
import type { ProjectPage } from "../../project";

import "../common/context-menu";

export class KCBoardViewerElement extends KCViewerElement<BoardViewer> {
    #contextMenu: KCContextMenuElement | null = null;

    protected override update_theme(): void {
        this.viewer.theme = this.themeObject.board;
    }

    override async load(src: ProjectPage) {
        // Pull KiCad's project-level net colors (.kicad_pro net_settings)
        // in alongside the board so pours/tracks match KiCad's own coloring.
        this.viewer.set_net_settings(src.project?.settings?.net_settings ?? null);
        await super.load(src);
    }

    protected override make_viewer(): BoardViewer {
        const viewer = new BoardViewer(
            this.canvas,
            !this.disableinteraction,
            this.themeObject.board,
        );

        viewer.contextMenuCallback = (screenX, screenY, items, onSelect) => {
            if (!this.#contextMenu) {
                return;
            }

            this.#contextMenu.show(screenX, screenY, items, onSelect);
        };

        return viewer;
    }

    override render() {
        this.canvas = html`<canvas></canvas>` as HTMLCanvasElement;
        this.#contextMenu =
            html`<kc-context-menu></kc-context-menu>` as KCContextMenuElement;

        return html`<style>
                :host {
                    display: block;
                    touch-action: none;
                    width: 100%;
                    height: 100%;
                    position: relative;
                }

                canvas {
                    width: 100%;
                    height: 100%;
                }
            </style>
            ${this.canvas} ${this.#contextMenu}`;
    }
}

window.customElements.define("kc-board-viewer", KCBoardViewerElement);
