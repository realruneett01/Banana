/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { Barrier, later } from "../../base/async";
import { Disposables, type IDisposable } from "../../base/disposable";
import { listen } from "../../base/events";
import { no_self_recursion } from "../../base/functions";
import { BBox, Vec2 } from "../../base/math";
import { Color, Renderer } from "../../graphics";
import {
    KiCanvasLoadEvent,
    KiCanvasMouseMoveEvent,
    KiCanvasSelectEvent,
    type KiCanvasEventMap,
} from "./events";
import { ViewLayer, ViewLayerSet } from "./view-layers";
import { Viewport } from "./viewport";

export abstract class Viewer extends EventTarget {
    /** Click hit-test tolerance, in screen pixels. */
    static hit_tolerance_px = 4;

    public renderer: Renderer;
    public viewport: Viewport;
    public layers: ViewLayerSet;
    public mouse_position: Vec2 = new Vec2(0, 0);
    public loaded = new Barrier();

    protected disposables = new Disposables();
    protected setup_finished = new Barrier();

    #selected: BBox | null = null;
    protected highlighted_diff_items: Map<any, Color> = new Map();

    constructor(
        public canvas: HTMLCanvasElement,
        protected interactive = true,
    ) {
        super();
    }

    dispose() {
        this.disposables.dispose();
    }

    override addEventListener<K extends keyof KiCanvasEventMap>(
        type: K,
        listener:
            | ((this: Viewer, ev: KiCanvasEventMap[K]) => void)
            | { handleEvent: (ev: KiCanvasEventMap[K]) => void }
            | null,
        options?: boolean | AddEventListenerOptions,
    ): IDisposable;
    override addEventListener(
        type: string,
        listener: EventListener | null,
        options?: boolean | AddEventListenerOptions,
    ): IDisposable {
        super.addEventListener(type, listener, options);
        return {
            dispose: () => {
                this.removeEventListener(type, listener, options);
            },
        };
    }

    protected abstract create_renderer(canvas: HTMLCanvasElement): Renderer;

    async setup() {
        this.renderer = this.disposables.add(this.create_renderer(this.canvas));

        await this.renderer.setup();

        this.viewport = this.disposables.add(
            new Viewport(this.renderer, () => {
                this.on_viewport_change();
            }),
        );

        if (this.interactive) {
            this.viewport.enable_pan_and_zoom(0.5, 190);

            this.disposables.add(
                listen(this.canvas, "mousemove", (e) => {
                    this.on_mouse_change(e);
                }),
            );

            this.disposables.add(
                listen(this.canvas, "panzoom", (e) => {
                    this.on_mouse_change(e as MouseEvent);
                }),
            );

            this.disposables.add(
                listen(this.canvas, "click", (e) => {
                    this.on_click(e);
                }),
            );
        }

        this.setup_finished.open();
    }

    protected on_viewport_change() {
        if (this.interactive) {
            this.draw();
        }
        this.dispatchEvent(new CustomEvent("viewportchange"));
    }

    protected on_mouse_change(e: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const new_position = this.viewport.camera.screen_to_world(
            new Vec2(e.clientX - rect.left, e.clientY - rect.top),
        );

        if (
            this.mouse_position.x != new_position.x ||
            this.mouse_position.y != new_position.y
        ) {
            this.mouse_position.set(new_position);
            this.dispatchEvent(new KiCanvasMouseMoveEvent(this.mouse_position));
        }
    }

    public abstract load(src: any): Promise<void>;

    protected resolve_loaded(value: boolean) {
        if (value) {
            this.loaded.open();
            this.dispatchEvent(new KiCanvasLoadEvent());
        }
    }

    public abstract paint(): void;

    protected on_draw() {
        this.renderer.clear_canvas();

        if (!this.layers) {
            return;
        }

        // Render all layers in display order (back to front)
        let depth = 0.01;
        const camera = this.viewport.camera.matrix;
        const should_dim =
            this.layers.is_any_layer_highlighted() ||
            this.highlighted_diff_items.size > 0 ||
            this.#selected !== null;

        // TODO: donot flip drawing sheet and grid

        for (const layer of this.layers.in_display_order()) {
            if (layer.visible && layer.graphics) {
                let alpha = layer.opacity;

                const is_overlay = layer === this.layers.overlay;
                if (should_dim && !layer.highlighted && !is_overlay) {
                    alpha = 0.25;
                }

                layer.graphics.render(camera, depth, alpha);
                depth += 0.01;
            }
        }
    }

    public draw() {
        if (!this.viewport) {
            return;
        }

        window.requestAnimationFrame(() => {
            this.on_draw();
        });
    }

    protected on_click(e: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const mouse_pos = this.viewport.camera.screen_to_world(
            new Vec2(e.clientX - rect.left, e.clientY - rect.top)
        );
        const tolerance =
            Viewer.hit_tolerance_px / this.viewport.camera.zoom;

        const items = this.layers.query_point(mouse_pos, tolerance);
        this.on_pick(mouse_pos, items);
    }

    protected on_pick(
        _mouse: Vec2,
        items: Iterable<{ layer: ViewLayer; bbox: BBox }>,
    ) {
        let best: BBox | null = null;
        let best_area = Infinity;

        for (const { bbox } of items) {
            const area = bbox.w * bbox.h;
            if (area < best_area) {
                best_area = area;
                best = bbox;
            }
        }

        this.select(best);
    }

    public select(item: BBox | null) {
        this.selected = item;
    }

    public get selected(): BBox | null {
        return this.#selected;
    }

    public set_diff_highlights(items: Map<any, Color>) {
        this.highlighted_diff_items = items;
        later(() => this.paint_selected());
    }

    public set selected(bb: BBox | null) {
        this._set_selected(bb);
    }

    @no_self_recursion
    private _set_selected(bb: BBox | null) {
        const previous = this.#selected;
        this.#selected = bb?.copy() || null;

        // Notify event listeners
        this.dispatchEvent(
            new KiCanvasSelectEvent({
                item: this.#selected?.context,
                previous: previous?.context,
            }),
        );

        later(() => this.paint_selected());
    }

    public get selection_color() {
        return Color.white;
    }

    /**
     * Paints whatever visual indicates the current selection.
     *
     * The base implementation draws no outline or box of any kind — it just
     * clears the overlay layer. Dimming of every other layer is handled
     * automatically in on_draw() based on whether anything is selected.
     * Subclasses (BoardViewer, SchematicViewer) override this to repaint the
     * selected item's own graphics onto the overlay layer at full opacity,
     * which is what actually reads as "highlighted" once the rest of the
     * drawing is dimmed.
     */
    protected paint_selected() {
        const layer = this.layers.overlay;
        layer.clear();
        this.draw();
    }

    abstract zoom_to_page(): void;

    zoom_to_selection() {
        if (!this.selected) {
            return;
        }
        this.viewport.camera.bbox = this.selected.grow(10);
        this.draw();
    }

    flip_view() {
        const flip = !this.viewport.camera.flipped;

        this.viewport.camera.flipped = flip;

        for (const layer of this.layers.in_order()) {
            if (layer.graphics) {
                layer.graphics.renderer.state.flipped = flip;
            }
        }

        // We need redraw some items because some items are not flippable
        // TODO: it re-paint all items and is inefficient
        this.paint();
        this.draw();
    }
}
