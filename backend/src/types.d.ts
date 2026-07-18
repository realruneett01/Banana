export interface BoardMetadata {
    version: string;
    generator: string;
    generatorVersion: string;
    thickness?: number;
    paperSize?: string;
    titleBlock?: TitleBlock;
}

export interface TitleBlock {
    title?: string;
    date?: string;
    rev?: string;
    company?: string;
    comments: string[];
}

export interface LayerInfo {
    index: number;
    name: string;
    type: string;
    userName?: string;
}

export interface NetClass {
    name: string;
    description?: string;
    clearance: number;
    traceWidth: number;
    viaDia: number;
    viaDrill: number;
    uviaDia?: number;
    uviaDrill?: number;
    nets: string[];
}

export interface Vector2D {
    x: number;
    y: number;
}

export interface Footprint {
    libId: string;
    layer: string;
    at: { x: number; y: number; rotation: number };
    reference: {
        text: string;
        at: { x: number; y: number; rotation: number };
        layer: string;
        hide: boolean;
    };
    value: {
        text: string;
        at: { x: number; y: number; rotation: number };
        layer: string;
        hide: boolean;
    };
    uuid?: string;
    descr?: string;
    tags?: string[];
    attr?: string[];
    pads: Pad[];
    graphics: FootprintGraphic[];
    model?: {
        path: string;
        offset: { x: number; y: number; z: number };
        scale: { x: number; y: number; z: number };
        rotate: { x: number; y: number; z: number };
    };
}

export interface Pad {
    number: string;
    type: 'smd' | 'thru_hole' | 'np_thru_hole' | 'connect' | string;
    shape: 'rect' | 'circle' | 'oval' | 'roundrect' | 'trapezoid' | 'custom' | string;
    localAt: { x: number; y: number; rotation: number };
    absAt: { x: number; y: number; rotation: number };
    size: { w: number; h: number };
    drill?: {
        size?: { w: number; h: number };
        offset?: { x: number; y: number };
    };
    layers: string[];
    net?: string;
    pinfunction?: string;
    pintype?: string;
    roundrectRratio?: number;
    uuid?: string;
    primitives?: PadPrimitive[];
}

export interface PadPrimitive {
    type: 'circle' | 'rect' | 'line' | 'arc' | 'poly' | string;
    center?: Vector2D;
    end?: Vector2D;
    start?: Vector2D;
    pts?: Vector2D[];
    width?: number;
    radius?: number;
}

export interface FootprintGraphic {
    type: 'line' | 'rect' | 'circle' | 'arc' | 'poly' | 'text' | string;
    layer: string;
    localPts: Vector2D[];
    absPts: Vector2D[];
    width?: number;
    text?: string;
    uuid?: string;
}

export interface TrackSegment {
    start: Vector2D;
    end: Vector2D;
    width: number;
    layer: string;
    net: string;
    uuid?: string;
}

export interface Via {
    type?: 'blind' | 'buried' | 'micro' | string;
    at: Vector2D;
    size: number;
    drill: number;
    layers: string[];
    net: string;
    uuid?: string;
}

export interface Zone {
    net: string;
    layers: string[];
    hatchMode?: string;
    hatchSize?: number;
    connectPads?: string;
    minThickness?: number;
    filledAreasThickness?: boolean | string;
    polygonPts: Vector2D[];
    filledPolygons: {
        layer: string;
        pts: Vector2D[];
    }[];
    uuid?: string;
}

export interface BoardGraphic {
    type: 'line' | 'rect' | 'circle' | 'arc' | 'poly' | 'text' | string;
    layer: string;
    pts: Vector2D[];
    width?: number;
    strokeWidth?: number;
    text?: string;
    uuid?: string;
}

export interface Dimension {
    type: 'aligned' | 'leader' | 'center' | 'orthogonal' | string;
    pts: Vector2D[];
    text?: string;
    layer: string;
    uuid?: string;
}

export interface Group {
    name: string;
    uuid?: string;
    members: string[]; // UUID list
}

export interface ParsedBoard {
    metadata: BoardMetadata;
    layers: Map<string, LayerInfo>; // Canonical name -> info
    nets: Map<number, string>; // ID -> Name
    netClasses: NetClass[];
    footprints: Footprint[];
    tracks: TrackSegment[];
    vias: Via[];
    zones: Zone[];
    graphics: BoardGraphic[];
    dimensions: Dimension[];
    groups: Group[];
}
