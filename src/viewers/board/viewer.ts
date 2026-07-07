/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { BBox, Vec2 } from "../../base/math";
import { is_string } from "../../base/types";
import { Renderer } from "../../graphics";
import { WebGL2Renderer } from "../../graphics/webgl";
import type { BoardTheme } from "../../kicad";
import * as kicad_common from "../../kicad/common";
import * as board_items from "../../kicad/board";
import { DocumentViewer } from "../base/document-viewer";
import { LayerNames, LayerSet, ViewLayer } from "./layers";
import { BoardPainter } from "./painter";

export type ContextMenuCallback = (
    screenX: number,
    screenY: number,
    items: Map<string, unknown>,
    onSelect: (item: unknown) => void,
) => void;

export class BoardViewer extends DocumentViewer<
    board_items.KicadPCB,
    BoardPainter,
    LayerSet,
    BoardTheme
> {
    #contextMenuCallback: ContextMenuCallback | null = null;
    #net_settings: import("../../kicad").NetSettings | null = null;

    get board(): board_items.KicadPCB {
        return this.document;
    }

    /**
     * Apply project-level net colors (from .kicad_pro net_settings) so
     * pours/tracks render with the same per-net overrides KiCad itself uses,
     * instead of only the flat per-layer theme color.
     *
     * We store the value here and push it into the painter inside paint(),
     * because the painter is recreated on every load() call and does not
     * exist before the first paint.
     */
    set_net_settings(net_settings: import("../../kicad").NetSettings | null) {
        this.#net_settings = net_settings;
        // If the painter already exists (e.g. re-loading into the same viewer)
        // propagate immediately so callers don't need a separate repaint.
        if (this.painter) {
            this.painter.set_net_settings(net_settings);
        }
    }

    set contextMenuCallback(callback: ContextMenuCallback | null) {
        this.#contextMenuCallback = callback;
    }

    protected override create_renderer(canvas: HTMLCanvasElement): Renderer {
        const renderer = new WebGL2Renderer(canvas);
        return renderer;
    }

    protected override create_painter() {
        return new BoardPainter(this.renderer, this.layers, this.theme);
    }

    public override paint() {
        super.paint();
        // Propagate stored net settings into the freshly-created painter.
        if (this.painter && this.#net_settings !== null) {
            this.painter.set_net_settings(this.#net_settings);
        }
    }

    protected override create_layer_set() {
        return new LayerSet(this.board, this.theme);
    }

    protected override get grid_origin() {
        return this.board.setup?.grid_origin ?? new Vec2(0, 0);
    }

    protected override on_pick(
        mouse: Vec2,
        items: Generator<{ layer: ViewLayer; bbox: BBox }, void, unknown>,
    ): void {
        const selectableItems = new Map<string, unknown>();
        for (const { bbox } of items) {
            const item = bbox.context;
            if (item instanceof board_items.Footprint) {
                selectableItems.set(`Footprint: ${item.reference}`, item);
            } else if (kicad_common.isNetInfo(item)) {
                selectableItems.set(`Net: ${item.netname}`, item);
            } else {
                console.log(item);
            }
        }

        if (selectableItems.size === 0) {
            this.select(null);
        } else if (selectableItems.size === 1 || !this.#contextMenuCallback) {
            this.handleItemClick(selectableItems.values().next().value);
        } else {
            const { x, y } = this.viewport.camera.world_to_screen(mouse);
            this.#contextMenuCallback(x, y, selectableItems, (selected) => {
                this.handleItemClick(selected);
            });
        }
    }

    handleItemClick(item: unknown) {
        if (item instanceof board_items.Footprint) {
            this.select(item);
        } else if (kicad_common.isNetInfo(item)) {
            this.highlight_net(kicad_common.getNetNumber(item));
        }
    }

    override select(item: board_items.Footprint | string | BBox | null) {
        // If item is a string, find the footprint by uuid or reference.
        if (is_string(item)) {
            item = this.board.find_footprint(item);
        }

        if (item instanceof board_items.Footprint) {
            super.select(item.bbox);
            return;
        }

        super.select(item);
    }

    highlight_net(net: number) {
        this.painter.paint_net(this.board, net);
        this.draw();
    }

    highlight_footprint(footprint: board_items.Footprint) {
        this.painter.paint_footprint(this.board, footprint);
        this.draw();
    }

    protected override paint_selected() {
        const layer = this.layers.overlay;
        layer.clear();
        this.renderer.start_layer(layer.name);

        const original_layer_color = layer.color;

        // Draw selection highlight for footprint's own elements in white (excluding courtyard)
        if (this.selected && this.selected.context instanceof board_items.Footprint) {
            const footprint = this.selected.context;
            
            this.painter.filter_footprint = footprint;
            layer.color = this.selection_color;

            for (const item of this.board.items()) {
                const painter = this.painter.painter_for(item);
                if (!painter) continue;
                this.painter.paint_item(layer, item);
            }

            this.painter.filter_footprint = null;
        }

        // Diff items — render geometry with swapped color on the overlay
        for (const [item, color] of this.highlighted_diff_items) {
            for (const layer_name of this.painter.layers_for(item)) {
                const target_layer = this.layers.by_name(layer_name);
                if (!target_layer) continue;
                const original_color = target_layer.color;
                target_layer.color = color;
                this.painter.paint_item(target_layer, item);
                target_layer.color = original_color;
            }
        }

        layer.color = original_layer_color;

        layer.graphics = this.renderer.end_layer();
        layer.graphics.composite_operation = "source-over";
        this.draw();
    }

    private set_layers_opacity(layers: Generator<ViewLayer>, opacity: number) {
        for (const layer of layers) {
            layer.opacity = opacity;
        }
        this.draw();
    }

    set track_opacity(value: number) {
        this.set_layers_opacity(
            (this.layers as LayerSet).copper_layers(),
            value,
        );
    }

    set via_opacity(value: number) {
        this.set_layers_opacity((this.layers as LayerSet).via_layers(), value);
    }

    set zone_opacity(value: number) {
        this.set_layers_opacity((this.layers as LayerSet).zone_layers(), value);
    }

    set pad_opacity(value: number) {
        this.set_layers_opacity((this.layers as LayerSet).pad_layers(), value);
    }

    set pad_hole_opacity(value: number) {
        this.set_layers_opacity(
            (this.layers as LayerSet).pad_hole_layers(),
            value,
        );
    }

    set grid_opacity(value: number) {
        this.set_layers_opacity((this.layers as LayerSet).grid_layers(), value);
    }

    set page_opacity(value: number) {
        this.layers.by_name(LayerNames.drawing_sheet)!.opacity = value;
        this.draw();
    }

    zoom_to_board() {
        const edge_cuts = this.layers.by_name(LayerNames.edge_cuts)!;
        const board_bbox = edge_cuts.bbox;
        this.viewport.camera.bbox = board_bbox.grow(board_bbox.w * 0.1);
    }
}
