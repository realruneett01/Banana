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

export function diff_documents(old_doc: Diffable, new_doc: Diffable): DiffEntry[] {
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

export function build_highlight_map(entries: DiffEntry[], side: "old" | "new"): Map<any, Color> {
    const map = new Map<any, Color>();
    for (const entry of entries) {
        if (side === "old" && entry.status === "added") continue;
        if (side === "new" && entry.status === "removed") continue;
        const item = side === "old" ? entry.old_item : entry.new_item;
        if (item) map.set(item, DiffColors[entry.status]);
    }
    return map;
}
