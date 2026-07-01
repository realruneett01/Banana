/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { html } from "../../../base/web-components";
import { KCViewerAppElement } from "../common/app";
import { KCSchematicViewerElement } from "./viewer";

// Import dependent elements so they're registered before use.
import "./info-panel";
import "./properties-panel";
import "./symbols-panel";
import "./viewer";
import type { ProjectPage } from "../../project";
import { KicadSch } from "../../../kicad";
import { SchematicSheet } from "../../../kicad/schematic";

/**
 * Internal "parent" element for KiCanvas's schematic viewer. Handles
 * setting up the schematic viewer as well as interface controls. It's
 * basically KiCanvas's version of EESchema.
 */
export class KCSchematicAppElement extends KCViewerAppElement<KCSchematicViewerElement> {
    override on_viewer_select(item?: unknown, previous?: unknown) {
        // Only handle double-selecting/double-clicking on items.
        if (!item || item != previous) {
            return;
        }

        // If it's a sheet instance, switch over to the new sheet.
        if (item instanceof SchematicSheet) {
            const target = this.#find_sheet_page(item);
            if (target) {
                this.project.set_active_page(target.project_path);
            } else {
                console.warn(
                    `Couldn't find a project page for sheet "${item.sheetfile}"`,
                );
            }
            return;
        }

        // Otherwise, selecting the same item twice will show the
        // properties panel.
        this.change_activity("properties");
    }

    /**
     * Find the project page for a clicked-on sheet.
     *
     * We'd like to match on the sheet's full hierarchical path
     * (`${item.path}/${item.uuid}`), but that requires the sheet's
     * `(instances ...)` metadata to be fully populated in the file, which
     * isn't always true - hand-authored or lightly-edited .kicad_sch files
     * commonly leave it blank. Fall back progressively: match by uuid
     * alone, then (if there's only one page for that file) by filename
     * alone, so navigation still works even with incomplete metadata.
     */
    #find_sheet_page(item: SchematicSheet): ProjectPage | undefined {
        let exact: ProjectPage | undefined;
        let by_uuid: ProjectPage | undefined;
        const by_filename: ProjectPage[] = [];

        for (const page of this.project.pages()) {
            if (page.filename !== item.sheetfile) {
                continue;
            }

            by_filename.push(page);

            if (page.sheet_path === `${item.path}/${item.uuid}`) {
                exact = page;
            } else if (page.sheet_path.endsWith(`/${item.uuid}`)) {
                by_uuid = page;
            }
        }

        return (
            exact ??
            by_uuid ??
            (by_filename.length === 1 ? by_filename[0] : undefined)
        );
    }

    override can_load(src: ProjectPage): boolean {
        return src.document instanceof KicadSch;
    }

    override make_viewer_element(): KCSchematicViewerElement {
        return html`<kc-schematic-viewer></kc-schematic-viewer>` as KCSchematicViewerElement;
    }

    override make_activities() {
        return [
            // Symbols
            html`<kc-ui-activity
                slot="activities"
                name="Symbols"
                icon="interests">
                <kc-schematic-symbols-panel></kc-schematic-symbols-panel>
            </kc-ui-activity>`,

            // Schematic item properties
            html`<kc-ui-activity
                slot="activities"
                name="Properties"
                icon="list">
                <kc-schematic-properties-panel></kc-schematic-properties-panel>
            </kc-ui-activity>`,

            // Schematic info
            html`<kc-ui-activity slot="activities" name="Info" icon="info">
                <kc-schematic-info-panel></kc-schematic-info-panel>
            </kc-ui-activity>`,
        ];
    }
}

window.customElements.define("kc-schematic-app", KCSchematicAppElement);
