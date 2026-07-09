/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { merge } from "../base/object";

/**
 * Holds configuration and settings from a .kicad_pro file.
 *
 * See KiCad's PROJECT_FILE class
 */
export class ProjectSettings {
    public board: BoardSettings = new BoardSettings();
    public boards: [string, string][] = [];
    public cvpcb?: unknown;
    public erc?: unknown;
    public libraries: {
        pinned_footprint_libs: string[];
        pinned_symbol_libs: string[];
    } = { pinned_footprint_libs: [], pinned_symbol_libs: [] };
    public meta: {
        filename: string;
        version: number;
    } = { filename: "unknown.kicad_pro", version: 1 };
    public net_settings: NetSettings = new NetSettings();
    public pcbnew: {
        page_layout_descr_file: string;
    } = { page_layout_descr_file: "" };
    public schematic: SchematicSettings = new SchematicSettings();
    public sheets: [string, string][] = [];
    public text_variables?: Record<string, string> = {};

    [s: string]: unknown;

    static load(src: any) {
        const project = new ProjectSettings();
        merge(project, src);

        // KiCad serializes net_settings netclasses as an array called `classes`
        // (each entry has a `name` + `pcb_color`), not as the `netclasses`
        // object-map this runtime class uses — merge() copies `classes` in as an
        // unused stray property since NetSettings has no field by that name, so
        // convert it explicitly here.
        project.net_settings.normalize_classes(
            (src?.net_settings?.classes as unknown[] | undefined) ??
                (project.net_settings as Record<string, unknown>)["classes"],
        );

        return project;
    }
}

// NET_SETTINGS - net_settings.h/net_settings.cpp
// Holds KiCad's "Board Setup > Nets" data: direct per-net color overrides
// (net_colors), per-netclass colors (netclasses[name].pcb_color), and the
// pattern rules that assign nets to netclasses (netclass_patterns).
export class NetClassSettings {
    // Serialized as a CSS-style color string, e.g. "rgba(255, 0, 0, 1.000)"
    // or a hex string. Absent/empty means "use the layer's default color".
    pcb_color?: string;

    [s: string]: unknown;
}

export class NetClassPatternAssignment {
    netclass: string;
    pattern: string;
}

export class NetSettings {
    // Fully-qualified net name -> color string. Highest priority override.
    net_colors: Record<string, string> = {};

    // Netclass name -> netclass definition (includes pcb_color).
    // NOTE: populated by normalize_classes(), NOT by the generic merge()
    // pass, because KiCad actually serializes this as an array (see below).
    netclasses: Record<string, NetClassSettings> = {};

    // Wildcard pattern -> netclass assignment, e.g. {netclass: "Power", pattern: "+24V"}
    netclass_patterns: NetClassPatternAssignment[] = [];

    // Net name -> netclass name. This is KiCad's real "Board Setup > Nets"
    // per-net class assignment map. Can be null in the raw JSON when no nets
    // have been manually assigned to a class yet.
    netclass_assignments: Record<string, string> | null = null;

    [s: string]: unknown;

    /**
     * Populates `netclasses` from the raw `classes` array that KiCad's
     * .kicad_pro actually serializes net_settings as — an array of
     * {name, pcb_color, ...} objects — rather than the object-keyed-by-name
     * shape (`netclasses`) this class uses at runtime for fast lookup.
     * The generic merge() in ProjectSettings.load() copies `classes` in as a
     * raw stray array (since NetSettings has no `classes` field), so this
     * must be called explicitly afterward to convert it.
     */
    normalize_classes(raw_classes?: unknown) {
        if (!Array.isArray(raw_classes)) {
            return;
        }
        for (const entry of raw_classes) {
            if (!entry || typeof entry !== "object" || !("name" in entry)) {
                continue;
            }
            const nc = new NetClassSettings();
            Object.assign(nc, entry);
            this.netclasses[(entry as { name: string }).name] = nc;
        }
    }

    /**
     * Resolve the color to use for a given net name, following KiCad's own
     * priority: direct per-net override, then a direct netclass assignment,
     * then pattern-matched netclass color, then undefined (meaning "use the
     * layer's default color").
     */
    color_for(net_name: string | undefined): string | undefined {
        if (!net_name) {
            return undefined;
        }

        const direct = this.net_colors[net_name];
        if (direct) {
            return direct;
        }

        // Direct net -> netclass assignment (KiCad's netclass_assignments map).
        const assigned_class = this.netclass_assignments?.[net_name];
        if (assigned_class) {
            const netclass = this.netclasses[assigned_class];
            if (has_color(netclass?.pcb_color)) {
                return netclass!.pcb_color;
            }
        }

        for (const assignment of this.netclass_patterns) {
            if (!wildcard_match(net_name, assignment.pattern)) {
                continue;
            }
            const netclass = this.netclasses[assignment.netclass];
            if (has_color(netclass?.pcb_color)) {
                return netclass!.pcb_color;
            }
        }

        return undefined;
    }
}

/** Simple glob match supporting KiCad's `*` and `?` wildcards. */
function wildcard_match(text: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex_src =
        "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
    return new RegExp(regex_src, "i").test(text);
}

/**
 * KiCad uses alpha=0 rgba colors (e.g. "rgba(0, 0, 0, 0.000)") on the
 * "Default" netclass to mean "no override, use the layer's default color" —
 * it's not actually black. Treat those as absent so they fall through
 * instead of painting nets invisible.
 */
function has_color(color: string | undefined): color is string {
    if (!color) {
        return false;
    }
    const m = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i);
    if (m && parseFloat(m[1]!) === 0) {
        return false;
    }
    return true;
}

export class BoardSettings {
    // board_design_settings.cpp
    design_settings: BoardDesignSettings = new BoardDesignSettings();

    // board_project_settings.cpp PARAM_LAYER_PRESET
    layer_presets?: unknown;

    // board_project_settings.cpp PARAM_VIEWPORT
    viewports?: unknown;

    [s: string]: unknown;
}

export class BoardDesignSettings {
    public defaults: BoardDesignSettingsDefaults =
        new BoardDesignSettingsDefaults();

    [s: string]: unknown;
}

export class BoardDesignSettingsDefaults {
    public board_outline_line_width = 0.1;
    public copper_line_width = 0.2;
    public copper_text_size_h = 1.5;
    public copper_text_size_v = 1.5;
    public copper_text_thickness = 0.3;
    public other_line_width = 0.15;
    public silk_line_width = 0.15;
    public silk_text_size_h = 1.0;
    public silk_text_size_v = 1.0;
    public silk_text_thickness = 0.15;

    [s: string]: unknown;
}

// SCHEMATIC_SETTINGS schematic_settings.cpp
export class SchematicSettings {
    drawing: SchematicDrawingSettings = new SchematicDrawingSettings();
    meta: {
        version: number;
    } = { version: 1 };

    [s: string]: unknown;
}

// EESCHEMA_SETTINGS
export class SchematicDrawingSettings {
    dashed_lines_dash_length_ratio: number = 12;
    dashed_lines_gap_length_ratio: number = 3;
    default_line_thickness: number = 6;
    default_text_size: number = 50;
    field_names: unknown[];
    intersheets_ref_own_page: boolean = false;
    intersheets_ref_prefix: string = "";
    intersheets_ref_short: boolean = false;
    intersheets_ref_show: boolean = false;
    intersheets_ref_suffix: string = "";
    junction_size_choice: number = 3;
    label_size_ratio: number = 0.375;
    pin_symbol_size: number = 25.0;
    text_offset_ratio: number = 0.15;

    [s: string]: unknown;
}
