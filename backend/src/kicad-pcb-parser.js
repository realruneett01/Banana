import fs from 'fs';

/**
 * Parses a KiCad S-expression string into a generic nested array AST.
 * Handles nested parens, quoted strings with escapes, and preserves number precision.
 */
function parseSExpr(str) {
    let i = 0;
    
    function parseExpr() {
        while (i < str.length) {
            let c = str[i];
            
            if (c === '(') {
                i++;
                let list = [];
                while (i < str.length) {
                    // skip whitespace
                    while (i < str.length && /\s/.test(str[i])) i++;
                    if (str[i] === ')') {
                        i++;
                        break;
                    }
                    let expr = parseExpr();
                    if (expr !== undefined) {
                        list.push(expr);
                    }
                }
                return list;
            } else if (c === ')') {
                i++;
                return null;
            } else if (/\s/.test(c)) {
                i++;
            } else if (c === '"') {
                let val = '';
                i++; // skip open quote
                while (i < str.length) {
                    if (str[i] === '"') {
                        i++;
                        break;
                    }
                    if (str[i] === '\\') {
                        i++;
                        if (i < str.length) val += str[i];
                    } else {
                        val += str[i];
                    }
                    i++;
                }
                return val;
            } else {
                let val = '';
                while (i < str.length && !/\s|\(|\)/.test(str[i])) {
                    val += str[i];
                    i++;
                }
                return val;
            }
        }
    }
    
    while (i < str.length && /\s/.test(str[i])) i++;
    if (str[i] === '(') {
        return parseExpr();
    }
    return null;
}

// AST helper functions
function findSublist(list, name) {
    if (!Array.isArray(list)) return null;
    for (let item of list) {
        if (Array.isArray(item) && item[0] === name) {
            return item;
        }
    }
    return null;
}

function findSublists(list, name) {
    let result = [];
    if (!Array.isArray(list)) return result;
    for (let item of list) {
        if (Array.isArray(item) && item[0] === name) {
            result.push(item);
        }
    }
    return result;
}

/**
 * Transforms footprint-local coordinates to board-absolute coordinates.
 * Handles bottom-layer mirrored coordinates and rotations.
 */
function toBoardAbsolute(footprint, localX, localY, localRot = 0) {
    let fx = footprint.at.x;
    let fy = footprint.at.y;
    let frot = footprint.at.rotation;
    let rad = frot * Math.PI / 180.0;
    
    let absX, absY, absRot;
    if (footprint.layer.startsWith("B.")) {
        // Back-side transform:
        // absX = x_f + localX * cos(theta_f) + localY * sin(theta_f)
        // absY = y_f - localX * sin(theta_f) + localY * cos(theta_f)
        absX = fx + localX * Math.cos(rad) + localY * Math.sin(rad);
        absY = fy - localX * Math.sin(rad) + localY * Math.cos(rad);
        absRot = (-frot - localRot) % 360;
        if (absRot < 0) absRot += 360;
    } else {
        // Front-side transform:
        // absX = x_f + localX * cos(theta_f) - localY * sin(theta_f)
        // absY = y_f + localX * sin(theta_f) + localY * cos(theta_f)
        absX = fx + localX * Math.cos(rad) - localY * Math.sin(rad);
        absY = fy + localX * Math.sin(rad) + localY * Math.cos(rad);
        absRot = (frot + localRot) % 360;
        if (absRot < 0) absRot += 360;
    }
    return { x: absX, y: absY, rotation: absRot };
}

function parseProperty(fpNode, propName) {
    let props = findSublists(fpNode, 'property');
    for (let p of props) {
        if (p[1] === propName) {
            let text = p[2];
            let atNode = findSublist(p, 'at');
            let x = 0, y = 0, rot = 0;
            if (atNode) {
                x = parseFloat(atNode[1]);
                y = parseFloat(atNode[2]);
                if (atNode[3]) rot = parseFloat(atNode[3]);
            }
            let layerNode = findSublist(p, 'layer');
            let layer = layerNode ? layerNode[1] : "";
            let hide = findSublist(p, 'hide') !== null;
            return { text, at: { x, y, rotation: rot }, layer, hide };
        }
    }
    
    let fpTexts = findSublists(fpNode, 'fp_text');
    for (let ft of fpTexts) {
        if (ft[1] === propName.toLowerCase()) {
            let text = ft[2];
            let atNode = findSublist(ft, 'at');
            let x = 0, y = 0, rot = 0;
            if (atNode) {
                x = parseFloat(atNode[1]);
                y = parseFloat(atNode[2]);
                if (atNode[3]) rot = parseFloat(atNode[3]);
            }
            let layerNode = findSublist(ft, 'layer');
            let layer = layerNode ? layerNode[1] : "";
            let hide = findSublist(ft, 'hide') !== null;
            return { text, at: { x, y, rotation: rot }, layer, hide };
        }
    }
    return { text: "", at: { x: 0, y: 0, rotation: 0 }, layer: "", hide: true };
}

function parsePad(padNode, footprint, netTable) {
    let number = padNode[1];
    let type = padNode[2];
    let shape = padNode[3];
    
    let atNode = findSublist(padNode, 'at');
    let lx = 0, ly = 0, lrot = 0;
    if (atNode) {
        lx = parseFloat(atNode[1]);
        ly = parseFloat(atNode[2]);
        if (atNode[3]) lrot = parseFloat(atNode[3]);
    }
    
    let sizeNode = findSublist(padNode, 'size');
    let w = 0, h = 0;
    if (sizeNode) {
        w = parseFloat(sizeNode[1]);
        h = parseFloat(sizeNode[2]);
    }
    
    let drillNode = findSublist(padNode, 'drill');
    let drill = undefined;
    if (drillNode) {
        let sizeW = 0, sizeH = 0;
        let offset = undefined;
        let isOval = drillNode[1] === 'oval';
        let idx = isOval ? 2 : 1;
        
        if (drillNode[idx]) {
            sizeW = parseFloat(drillNode[idx]);
            sizeH = sizeW;
            if (isOval && drillNode[idx+1]) {
                sizeH = parseFloat(drillNode[idx+1]);
                idx++;
            }
            idx++;
        }
        
        let offsetNode = findSublist(drillNode, 'offset');
        if (offsetNode) {
            offset = { x: parseFloat(offsetNode[1]), y: parseFloat(offsetNode[2]) };
        }
        drill = { size: { w: sizeW, h: sizeH }, offset };
    }
    
    let layersNode = findSublist(padNode, 'layers');
    let layers = [];
    if (layersNode) {
        for (let i = 1; i < layersNode.length; i++) {
            layers.push(layersNode[i]);
        }
    }
    
    let netNode = findSublist(padNode, 'net');
    let netName = undefined;
    if (netNode) {
        if (netNode.length >= 3) {
            netName = netNode[2];
        } else {
            let val = netNode[1];
            if (!isNaN(val)) {
                let index = parseInt(val);
                netName = netTable.get(index) || ("net_" + index);
            } else {
                netName = val;
            }
        }
    }
    
    let pinfunctionNode = findSublist(padNode, 'pinfunction');
    let pintypeNode = findSublist(padNode, 'pintype');
    let roundrectRratioNode = findSublist(padNode, 'roundrect_rratio');
    let uuidNode = findSublist(padNode, 'uuid') || findSublist(padNode, 'tstamp');
    
    let primitives = [];
    let primitivesNode = findSublist(padNode, 'primitives');
    if (primitivesNode) {
        for (let i = 1; i < primitivesNode.length; i++) {
            let prim = primitivesNode[i];
            if (Array.isArray(prim)) {
                let primType = prim[0];
                let typeClean = primType.replace('gr_', '');
                let centerNode = findSublist(prim, 'center');
                let endNode = findSublist(prim, 'end');
                let startNode = findSublist(prim, 'start');
                let ptsNode = findSublist(prim, 'pts');
                let widthNode = findSublist(prim, 'width');
                
                let pts = [];
                if (ptsNode) {
                    let xyNodes = findSublists(ptsNode, 'xy');
                    for (let xy of xyNodes) {
                        pts.push({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) });
                    }
                }
                
                primitives.push({
                    type: typeClean,
                    center: centerNode ? { x: parseFloat(centerNode[1]), y: parseFloat(centerNode[2]) } : undefined,
                    end: endNode ? { x: parseFloat(endNode[1]), y: parseFloat(endNode[2]) } : undefined,
                    start: startNode ? { x: parseFloat(startNode[1]), y: parseFloat(startNode[2]) } : undefined,
                    pts: pts.length > 0 ? pts : undefined,
                    width: widthNode ? parseFloat(widthNode[1]) : undefined,
                    radius: (typeClean === 'circle' && centerNode && endNode) ? 
                        Math.sqrt(Math.pow(parseFloat(endNode[1]) - parseFloat(centerNode[1]), 2) + Math.pow(parseFloat(endNode[2]) - parseFloat(centerNode[2]), 2)) : undefined
                });
            }
        }
    }
    
    let localAt = { x: lx, y: ly, rotation: lrot };
    let absAt = toBoardAbsolute(footprint, lx, ly, lrot);
    
    return {
        number,
        type,
        shape,
        localAt,
        absAt,
        size: { w, h },
        drill,
        layers,
        net: netName,
        pinfunction: pinfunctionNode ? pinfunctionNode[1] : undefined,
        pintype: pintypeNode ? pintypeNode[1] : undefined,
        roundrectRratio: roundrectRratioNode ? parseFloat(roundrectRratioNode[1]) : undefined,
        uuid: uuidNode ? uuidNode[1] : undefined,
        primitives: primitives.length > 0 ? primitives : undefined
    };
}

function parseFootprintGraphic(gNode, footprint) {
    let type = gNode[0].replace('fp_', '');
    let layerNode = findSublist(gNode, 'layer');
    let layer = layerNode ? layerNode[1] : "";
    let widthNode = findSublist(gNode, 'stroke') ? findSublist(findSublist(gNode, 'stroke'), 'width') : findSublist(gNode, 'width');
    let width = widthNode ? parseFloat(widthNode[1]) : undefined;
    let textNode = findSublist(gNode, 'text') || (type === 'text' ? gNode[1] : null);
    let text = (type === 'text' && typeof textNode === 'string') ? textNode : (textNode && textNode[1]);
    let uuidNode = findSublist(gNode, 'uuid') || findSublist(gNode, 'tstamp');
    
    let localPts = [];
    if (type === 'line' || type === 'rect') {
        let start = findSublist(gNode, 'start');
        let end = findSublist(gNode, 'end');
        if (start && end) {
            localPts.push({ x: parseFloat(start[1]), y: parseFloat(start[2]) });
            localPts.push({ x: parseFloat(end[1]), y: parseFloat(end[2]) });
        }
    } else if (type === 'circle') {
        let center = findSublist(gNode, 'center');
        let end = findSublist(gNode, 'end');
        if (center && end) {
            localPts.push({ x: parseFloat(center[1]), y: parseFloat(center[2]) });
            localPts.push({ x: parseFloat(end[1]), y: parseFloat(end[2]) });
        }
    } else if (type === 'poly') {
        let ptsNode = findSublist(gNode, 'pts');
        if (ptsNode) {
            let xyNodes = findSublists(ptsNode, 'xy');
            for (let xy of xyNodes) {
                localPts.push({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) });
            }
        }
    }
    
    let absPts = localPts.map(pt => {
        let res = toBoardAbsolute(footprint, pt.x, pt.y);
        return { x: res.x, y: res.y };
    });
    
    return {
        type,
        layer,
        localPts,
        absPts,
        width,
        text,
        uuid: uuidNode ? uuidNode[1] : undefined
    };
}

function parseSegment(segNode, netTable) {
    let startNode = findSublist(segNode, 'start');
    let endNode = findSublist(segNode, 'end');
    let widthNode = findSublist(segNode, 'width');
    let layerNode = findSublist(segNode, 'layer');
    let netNode = findSublist(segNode, 'net');
    let uuidNode = findSublist(segNode, 'uuid') || findSublist(segNode, 'tstamp');
    
    let netName = "";
    if (netNode) {
        let val = netNode[1];
        if (!isNaN(val)) {
            let index = parseInt(val);
            netName = netTable.get(index) || ("net_" + index);
        } else {
            netName = val;
        }
    }
    
    return {
        start: { x: parseFloat(startNode[1]), y: parseFloat(startNode[2]) },
        end: { x: parseFloat(endNode[1]), y: parseFloat(endNode[2]) },
        width: widthNode ? parseFloat(widthNode[1]) : 0,
        layer: layerNode ? layerNode[1] : "",
        net: netName,
        uuid: uuidNode ? uuidNode[1] : undefined
    };
}

function parseVia(viaNode, netTable) {
    let type = viaNode[1] === 'blind' || viaNode[1] === 'buried' || viaNode[1] === 'micro' ? viaNode[1] : undefined;
    let atNode = findSublist(viaNode, 'at');
    let sizeNode = findSublist(viaNode, 'size');
    let drillNode = findSublist(viaNode, 'drill');
    let layersNode = findSublist(viaNode, 'layers');
    let netNode = findSublist(viaNode, 'net');
    let uuidNode = findSublist(viaNode, 'uuid') || findSublist(viaNode, 'tstamp');
    
    let netName = "";
    if (netNode) {
        let val = netNode[1];
        if (!isNaN(val)) {
            let index = parseInt(val);
            netName = netTable.get(index) || ("net_" + index);
        } else {
            netName = val;
        }
    }
    
    let layers = [];
    if (layersNode) {
        for (let i = 1; i < layersNode.length; i++) {
            layers.push(layersNode[i]);
        }
    }
    
    return {
        type,
        at: { x: parseFloat(atNode[1]), y: parseFloat(atNode[2]) },
        size: sizeNode ? parseFloat(sizeNode[1]) : 0,
        drill: drillNode ? parseFloat(drillNode[1]) : 0,
        layers,
        net: netName,
        uuid: uuidNode ? uuidNode[1] : undefined
    };
}

function parseZone(zoneNode, netTable) {
    let netNode = findSublist(zoneNode, 'net');
    let netName = "";
    if (netNode) {
        let val = netNode[1];
        if (!isNaN(val)) {
            let index = parseInt(val);
            netName = netTable.get(index) || ("net_" + index);
        } else {
            netName = val;
        }
    }
    
    let layerNode = findSublist(zoneNode, 'layer');
    let layersNode = findSublist(zoneNode, 'layers');
    let layers = [];
    if (layerNode) {
        layers.push(layerNode[1]);
    } else if (layersNode) {
        for (let i = 1; i < layersNode.length; i++) {
            layers.push(layersNode[i]);
        }
    }
    
    let hatchNode = findSublist(zoneNode, 'hatch');
    let hatchMode = hatchNode ? hatchNode[1] : undefined;
    let hatchSize = (hatchNode && hatchNode[2]) ? parseFloat(hatchNode[2]) : undefined;
    
    let connectPadsNode = findSublist(zoneNode, 'connect_pads');
    let minThicknessNode = findSublist(zoneNode, 'min_thickness');
    let filledAreasThicknessNode = findSublist(zoneNode, 'filled_areas_thickness');
    let uuidNode = findSublist(zoneNode, 'uuid') || findSublist(zoneNode, 'tstamp');
    
    let polygonPts = [];
    let polygonNode = findSublist(zoneNode, 'polygon');
    if (polygonNode) {
        let ptsNode = findSublist(polygonNode, 'pts');
        if (ptsNode) {
            let xyNodes = findSublists(ptsNode, 'xy');
            for (let xy of xyNodes) {
                polygonPts.push({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) });
            }
        }
    }
    
    let filledPolygons = [];
    let filledPolys = findSublists(zoneNode, 'filled_polygon');
    for (let fp of filledPolys) {
        let layerSub = findSublist(fp, 'layer');
        let ptsSub = findSublist(fp, 'pts');
        let pts = [];
        if (ptsSub) {
            let xyNodes = findSublists(ptsSub, 'xy');
            for (let xy of xyNodes) {
                pts.push({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) });
            }
        }
        filledPolygons.push({
            layer: layerSub ? layerSub[1] : "",
            pts
        });
    }
    
    return {
        net: netName,
        layers,
        hatchMode,
        hatchSize,
        connectPads: connectPadsNode ? connectPadsNode[1] : undefined,
        minThickness: minThicknessNode ? parseFloat(minThicknessNode[1]) : undefined,
        filledAreasThickness: filledAreasThicknessNode ? filledAreasThicknessNode[1] : undefined,
        polygonPts,
        filledPolygons,
        uuid: uuidNode ? uuidNode[1] : undefined
    };
}

function parseBoardGraphic(gNode) {
    let type = gNode[0].replace('gr_', '');
    let layerNode = findSublist(gNode, 'layer');
    let layer = layerNode ? layerNode[1] : "";
    let widthNode = findSublist(gNode, 'stroke') ? findSublist(findSublist(gNode, 'stroke'), 'width') : findSublist(gNode, 'width');
    let width = widthNode ? parseFloat(widthNode[1]) : undefined;
    let textNode = findSublist(gNode, 'text') || (type === 'text' ? gNode[1] : null);
    let text = (type === 'text' && typeof textNode === 'string') ? textNode : (textNode && textNode[1]);
    let uuidNode = findSublist(gNode, 'uuid') || findSublist(gNode, 'tstamp');
    
    let pts = [];
    if (type === 'line' || type === 'rect') {
        let start = findSublist(gNode, 'start');
        let end = findSublist(gNode, 'end');
        if (start && end) {
            pts.push({ x: parseFloat(start[1]), y: parseFloat(start[2]) });
            pts.push({ x: parseFloat(end[1]), y: parseFloat(end[2]) });
        }
    } else if (type === 'circle') {
        let center = findSublist(gNode, 'center');
        let end = findSublist(gNode, 'end');
        if (center && end) {
            pts.push({ x: parseFloat(center[1]), y: parseFloat(center[2]) });
            pts.push({ x: parseFloat(end[1]), y: parseFloat(end[2]) });
        }
    } else if (type === 'poly') {
        let ptsNode = findSublist(gNode, 'pts');
        if (ptsNode) {
            let xyNodes = findSublists(ptsNode, 'xy');
            for (let xy of xyNodes) {
                pts.push({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) });
            }
        }
    }
    
    return {
        type,
        layer,
        pts,
        width,
        text,
        uuid: uuidNode ? uuidNode[1] : undefined
    };
}

function parseDimension(dimNode) {
    let type = dimNode[1];
    let pts = [];
    let ptsNode = findSublist(dimNode, 'pts');
    if (ptsNode) {
        let xyNodes = findSublists(ptsNode, 'xy');
        for (let xy of xyNodes) {
            pts.push({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) });
        }
    }
    
    let grNode = findSublist(dimNode, 'gr_text');
    let text = grNode ? grNode[1] : undefined;
    let layerNode = findSublist(dimNode, 'layer');
    let uuidNode = findSublist(dimNode, 'uuid') || findSublist(dimNode, 'tstamp');
    
    return {
        type,
        pts,
        text,
        layer: layerNode ? layerNode[1] : "",
        uuid: uuidNode ? uuidNode[1] : undefined
    };
}

function parseGroup(groupNode) {
    let name = groupNode[1];
    let uuidNode = findSublist(groupNode, 'uuid') || findSublist(groupNode, 'tstamp');
    let membersNode = findSublist(groupNode, 'members');
    let members = [];
    if (membersNode) {
        for (let i = 1; i < membersNode.length; i++) {
            members.push(membersNode[i]);
        }
    }
    return {
        name,
        uuid: uuidNode ? uuidNode[1] : undefined,
        members
    };
}

/**
 * Extracts and maps all track segments with their resolved net names and coordinates.
 *
 * Accepts a raw parsed AST (the result of parseSExpr on a .kicad_pcb file content)
 * and returns:
 *   - netIndexMap  Map<netId:number, netName:string>  — full net-index dictionary
 *   - trackSegments  Array<{ start, end, netId, netName, layer }>  — every (segment …) node
 *
 * This is intentionally a lightweight, focused decoder: it does NOT require the
 * full parseKiCadBoard pipeline and can therefore be used stand-alone by audit
 * reporters and diff processors that only need net-name resolution for trace diffs.
 */
function parsePcbNetSegments(pcbAst) {
  const netIndexMap = new Map(); // netId -> netName
  const trackSegments = [];

  // 1. Build Net ID → Net Name dictionary from (net N "NET_NAME") declarations
  for (const token of pcbAst) {
    if (
      Array.isArray(token) &&
      token[0] === 'net' &&
      token.length >= 3 &&
      !isNaN(token[1]) &&
      typeof token[2] === 'string'
    ) {
      netIndexMap.set(parseInt(token[1]), token[2]);
    }
  }

  // 2. Extract track segments with resolved net names
  for (const token of pcbAst) {
    if (!Array.isArray(token) || token[0] !== 'segment') continue;

    const segProps = Object.fromEntries(
      token.slice(1).map(item =>
        Array.isArray(item) ? [item[0], item.slice(1)] : [item, true]
      )
    );

    const netId   = segProps.net   ? parseInt(segProps.net[0]) : 0;
    const netName = netIndexMap.get(netId) || 'unconnected';
    const layer   = segProps.layer ? segProps.layer[0]        : 'F.Cu';
    const start   = segProps.start
      ? { x: parseFloat(segProps.start[0]), y: parseFloat(segProps.start[1]) }
      : null;
    const end     = segProps.end
      ? { x: parseFloat(segProps.end[0]),   y: parseFloat(segProps.end[1]) }
      : null;

    if (start && end) {
      trackSegments.push({ start, end, netId, netName, layer });
    }
  }

  return { netIndexMap, trackSegments };
}

/**
 * Main parse function. Takes file path, parses and returns the full typed board representation.
 */
function parseKiCadBoard(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const root = parseSExpr(fileContent);
    
    if (!root || root[0] !== 'kicad_pcb') {
        throw new Error("Invalid .kicad_pcb file: root S-expression must be (kicad_pcb ...)");
    }
    
    // 1. Metadata
    let version = "";
    let verNode = findSublist(root, 'version');
    if (verNode) version = verNode[1];
    
    let generator = "";
    let genNode = findSublist(root, 'generator');
    if (genNode) generator = genNode[1];
    
    let generatorVersion = "";
    let genVerNode = findSublist(root, 'generator_version');
    if (genVerNode) generatorVersion = genVerNode[1];
    
    let general = findSublist(root, 'general');
    let thickness = undefined;
    if (general) {
        let thickNode = findSublist(general, 'thickness');
        if (thickNode) thickness = parseFloat(thickNode[1]);
    }
    
    let paper = findSublist(root, 'paper');
    let paperSize = paper ? paper[1] : undefined;
    
    let titleBlockNode = findSublist(root, 'title_block');
    let titleBlock = undefined;
    if (titleBlockNode) {
        let title = findSublist(titleBlockNode, 'title');
        let date = findSublist(titleBlockNode, 'date');
        let rev = findSublist(titleBlockNode, 'rev');
        let company = findSublist(titleBlockNode, 'company');
        let comments = [];
        for (let i = 1; i <= 9; i++) {
            let comment = findSublist(titleBlockNode, 'comment ' + i) || findSublist(titleBlockNode, `comment_${i}`) || findSublist(titleBlockNode, `comment${i}`);
            if (comment) comments.push(comment[1]);
        }
        titleBlock = {
            title: title ? title[1] : undefined,
            date: date ? date[1] : undefined,
            rev: rev ? rev[1] : undefined,
            company: company ? company[1] : undefined,
            comments
        };
    }
    
    const metadata = { version, generator, generatorVersion, thickness, paperSize, titleBlock };
    
    // 2. Layers
    let layers = new Map();
    let layersNode = findSublist(root, 'layers');
    if (layersNode) {
        for (let i = 1; i < layersNode.length; i++) {
            let item = layersNode[i];
            if (Array.isArray(item)) {
                let index = parseInt(item[0]);
                let canonicalName = item[1];
                let type = item[2];
                let userName = item[3];
                layers.set(canonicalName, { index, name: canonicalName, type, userName });
            }
        }
    }
    
    // 3. Nets
    let nets = new Map();
    let netNodes = findSublists(root, 'net');
    for (let node of netNodes) {
        if (node.length >= 3) {
            let index = parseInt(node[1]);
            let name = node[2];
            nets.set(index, name);
        }
    }
    
    // 4. Net Classes
    let netClasses = [];
    let netClassNodes = findSublists(root, 'net_class');
    for (let node of netClassNodes) {
        let name = node[1];
        let descNode = findSublist(node, 'description');
        let description = descNode ? descNode[1] : undefined;
        
        let clearanceNode = findSublist(node, 'clearance');
        let traceWidthNode = findSublist(node, 'trace_width');
        let viaDiaNode = findSublist(node, 'via_dia');
        let viaDrillNode = findSublist(node, 'via_drill');
        let uviaDiaNode = findSublist(node, 'uvia_dia');
        let uviaDrillNode = findSublist(node, 'uvia_drill');
        
        let classNets = [];
        let addNetNodes = findSublists(node, 'add_net');
        for (let an of addNetNodes) {
            classNets.push(an[1]);
        }
        
        netClasses.push({
            name,
            description,
            clearance: clearanceNode ? parseFloat(clearanceNode[1]) : 0,
            traceWidth: traceWidthNode ? parseFloat(traceWidthNode[1]) : 0,
            viaDia: viaDiaNode ? parseFloat(viaDiaNode[1]) : 0,
            viaDrill: viaDrillNode ? parseFloat(viaDrillNode[1]) : 0,
            uviaDia: uviaDiaNode ? parseFloat(uviaDiaNode[1]) : undefined,
            uviaDrill: uviaDrillNode ? parseFloat(uviaDrillNode[1]) : undefined,
            nets: classNets
        });
    }
    
    // 5. Footprints, Tracks, Vias, Zones, Graphics, Dimensions, Groups
    let footprints = [];
    let tracks = [];
    let vias = [];
    let zones = [];
    let graphics = [];
    let dimensions = [];
    let groups = [];
    
    for (let item of root) {
        if (!Array.isArray(item)) continue;
        
        let keyword = item[0];
        if (keyword === 'footprint' || keyword === 'module') {
            let libId = item[1];
            let layerNode = findSublist(item, 'layer');
            let layer = layerNode ? layerNode[1] : "";
            
            let atNode = findSublist(item, 'at');
            let x = 0, y = 0, rotation = 0;
            if (atNode) {
                x = parseFloat(atNode[1]);
                y = parseFloat(atNode[2]);
                if (atNode[3]) rotation = parseFloat(atNode[3]);
            }
            
            let uuidNode = findSublist(item, 'uuid') || findSublist(item, 'tstamp');
            let descNode = findSublist(item, 'descr');
            
            let tagsNode = findSublist(item, 'tags');
            let tags = [];
            if (tagsNode) {
                for (let i = 1; i < tagsNode.length; i++) tags.push(tagsNode[i]);
            }
            
            let attrs = [];
            let attrNode = findSublist(item, 'attr');
            if (attrNode) {
                for (let i = 1; i < attrNode.length; i++) attrs.push(attrNode[i]);
            }
            
            let fp = {
                libId,
                layer,
                at: { x, y, rotation },
                reference: parseProperty(item, 'Reference'),
                value: parseProperty(item, 'Value'),
                uuid: uuidNode ? uuidNode[1] : undefined,
                descr: descNode ? descNode[1] : undefined,
                tags: tags.length > 0 ? tags : undefined,
                attr: attrs.length > 0 ? attrs : undefined,
                pads: [],
                graphics: []
            };
            
            // Model
            let modelNode = findSublist(item, 'model');
            if (modelNode) {
                let path = modelNode[1];
                let offsetNode = findSublist(modelNode, 'offset');
                let scaleNode = findSublist(modelNode, 'scale');
                let rotateNode = findSublist(modelNode, 'rotate');
                fp.model = {
                    path,
                    offset: offsetNode ? { x: parseFloat(offsetNode[1]), y: parseFloat(offsetNode[2]), z: parseFloat(offsetNode[3]) } : { x: 0, y: 0, z: 0 },
                    scale: scaleNode ? { x: parseFloat(scaleNode[1]), y: parseFloat(scaleNode[2]), z: parseFloat(scaleNode[3]) } : { x: 1, y: 1, z: 1 },
                    rotate: rotateNode ? { x: parseFloat(rotateNode[1]), y: parseFloat(rotateNode[2]), z: parseFloat(rotateNode[3]) } : { x: 0, y: 0, z: 0 }
                };
            }
            
            // Pad and Graphics parsing inside footprints
            for (let subItem of item) {
                if (!Array.isArray(subItem)) continue;
                if (subItem[0] === 'pad') {
                    fp.pads.push(parsePad(subItem, fp, nets));
                } else if (subItem[0].startsWith('fp_')) {
                    fp.graphics.push(parseFootprintGraphic(subItem, fp));
                }
            }
            
            footprints.push(fp);
        } else if (keyword === 'segment') {
            tracks.push(parseSegment(item, nets));
        } else if (keyword === 'via') {
            vias.push(parseVia(item, nets));
        } else if (keyword === 'zone') {
            zones.push(parseZone(item, nets));
        } else if (keyword.startsWith('gr_')) {
            graphics.push(parseBoardGraphic(item));
        } else if (keyword === 'dimension') {
            dimensions.push(parseDimension(item));
        } else if (keyword === 'group') {
            groups.push(parseGroup(item));
        }
    }
    
    return {
        metadata,
        layers,
        nets,
        netClasses,
        footprints,
        tracks,
        vias,
        zones,
        graphics,
        dimensions,
        groups
    };
}

/**
 * Direct S-Expression regex parser for KiCad PCB tracks, nets, and footprints.
 *
 * This is intentionally a lightweight, regex-based extractor that works on raw
 * file-content strings — no full AST parse required. It is designed to be called
 * from server.js to populate pcbMetadata before passing it into processSvgDiff.
 *
 * Returns:
 *   netMap     Map<netId:number, netName:string>
 *   segments   Array<{ start, end, layer, netId, netName }>
 *   footprints Array<{ ref, value, center: {x,y}, layer }>
 */
function parsePcbMetadata(pcbFileContent) {
  const netMap    = new Map(); // netId (number) -> netName (string)
  const segments  = [];       // { start:{x,y}, end:{x,y}, netName, layer }
  const footprints = [];      // { ref, value, center:{x,y}, layer }

  if (!pcbFileContent || typeof pcbFileContent !== 'string') {
    return { netMap, segments, footprints };
  }

  // 1. Extract all Net definitions: (net 14 "/ETHERNET/PMODE1")
  const netRegex = /\(net\s+(\d+)\s+"([^"]+)"\)/g;
  let netMatch;
  while ((netMatch = netRegex.exec(pcbFileContent)) !== null) {
    netMap.set(parseInt(netMatch[1], 10), netMatch[2]);
  }

  // 2. Extract all Track Segments:
  //    (segment (start X Y) (end X Y) (width W) (layer "L") (net N))
  const segRegex = /\(segment\s+\(start\s+([\d.-]+)\s+([\d.-]+)\)\s+\(end\s+([\d.-]+)\s+([\d.-]+)\).*?\(layer\s+"?([^"\s)]+)"?\).*?\(net\s+(\d+)\)/g;
  let segMatch;
  while ((segMatch = segRegex.exec(pcbFileContent)) !== null) {
    const netId = parseInt(segMatch[6], 10);
    segments.push({
      start:   { x: parseFloat(segMatch[1]), y: parseFloat(segMatch[2]) },
      end:     { x: parseFloat(segMatch[3]), y: parseFloat(segMatch[4]) },
      layer:   segMatch[5],
      netId,
      netName: netMap.get(netId) || `Net-${netId}`
    });
  }

  // 3. Extract Footprints / Components:
  //    (footprint "..." (layer "...") (at X Y) ... (fp_text reference "R38" ...) (fp_text value "10k" ...))
  const fpRegex = /\(footprint\s+"[^"]*"\s+\(layer\s+"?([^"\s)]+)"?\).*?\(at\s+([\d.-]+)\s+([\d.-]+)\).*?\(fp_text\s+reference\s+"([^"]+)"\s+\(at[^)]*\)[^)]*\)\s+\(fp_text\s+value\s+"([^"]+)"/gs;
  let fpMatch;
  while ((fpMatch = fpRegex.exec(pcbFileContent)) !== null) {
    footprints.push({
      layer:  fpMatch[1],
      center: { x: parseFloat(fpMatch[2]), y: parseFloat(fpMatch[3]) },
      ref:    fpMatch[4],
      value:  fpMatch[5]
    });
  }

  return { netMap, segments, footprints };
}

export {
    parseSExpr,
    toBoardAbsolute,
    parseKiCadBoard,
    parsePcbNetSegments,
    parsePcbMetadata
};
