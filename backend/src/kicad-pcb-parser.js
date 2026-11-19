import fs from "fs";

/**
 * Parses a KiCad S-expression string into a generic nested array AST.
 * Handles nested parens, quoted strings with escapes, and preserves number precision.
 */
function parseSExpr(str) {
	let i = 0;

	function parseExpr() {
		while (i < str.length) {
			const c = str[i];

			if (c === "(") {
				i++;
				const list = [];
				while (i < str.length) {
					// skip whitespace
					while (i < str.length && /\s/.test(str[i])) i++;
					if (str[i] === ")") {
						i++;
						break;
					}
					const expr = parseExpr();
					if (expr !== undefined) {
						list.push(expr);
					}
				}
				return list;
			} else if (c === ")") {
				i++;
				return null;
			} else if (/\s/.test(c)) {
				i++;
			} else if (c === '"') {
				let val = "";
				i++; // skip open quote
				while (i < str.length) {
					if (str[i] === '"') {
						i++;
						break;
					}
					if (str[i] === "\\") {
						i++;
						if (i < str.length) val += str[i];
					} else {
						val += str[i];
					}
					i++;
				}
				return val;
			} else {
				let val = "";
				while (i < str.length && !/\s|\(|\)/.test(str[i])) {
					val += str[i];
					i++;
				}
				return val;
			}
		}
	}

	while (i < str.length && /\s/.test(str[i])) i++;
	if (str[i] === "(") {
		return parseExpr();
	}
	return null;
}

// AST helper functions
function findSublist(list, name) {
	if (!Array.isArray(list)) return null;
	for (const item of list) {
		if (Array.isArray(item) && item[0] === name) {
			return item;
		}
	}
	return null;
}

function findSublists(list, name) {
	const result = [];
	if (!Array.isArray(list)) return result;
	for (const item of list) {
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
	const fx = footprint.at.x;
	const fy = footprint.at.y;
	const frot = footprint.at.rotation;
	const rad = (frot * Math.PI) / 180.0;

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

function extractPropertyDetails(itemNode) {
	const text = itemNode[2];
	const atNode = findSublist(itemNode, "at");
	let x = 0,
		y = 0,
		rot = 0;
	if (atNode) {
		x = parseFloat(atNode[1]);
		y = parseFloat(atNode[2]);
		if (atNode[3]) rot = parseFloat(atNode[3]);
	}
	const layerNode = findSublist(itemNode, "layer");
	const layer = layerNode ? layerNode[1] : "";
	const hide = findSublist(itemNode, "hide") !== null;
	return { text, at: { x, y, rotation: rot }, layer, hide };
}

function parseProperty(fpNode, propertyName) {
	const targetName = propertyName.toLowerCase();
	const candidates = [
		...findSublists(fpNode, "property"),
		...findSublists(fpNode, "fp_text"),
	];
	for (const item of candidates) {
		if (typeof item[1] === "string" && item[1].toLowerCase() === targetName) {
			return extractPropertyDetails(item);
		}
	}
	return { text: "", at: { x: 0, y: 0, rotation: 0 }, layer: "", hide: true };
}

function resolveNetName(netNode, netTable) {
	if (!netNode) return undefined;
	if (netNode.length >= 3) return netNode[2];
	const val = netNode[1];
	if (!isNaN(val)) {
		const index = parseInt(val, 10);
		return netTable.get(index) || "net_" + index;
	}
	return val;
}

function extractLayersList(layersNode) {
	if (!layersNode) return [];
	const layers = [];
	for (let i = 1; i < layersNode.length; i++) {
		layers.push(layersNode[i]);
	}
	return layers;
}

function extractPointList(ptsNode) {
	if (!ptsNode) return [];
	const xyNodes = findSublists(ptsNode, "xy");
	return xyNodes.map((xy) => ({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) }));
}

function parsePadDrill(drillNode) {
	if (!drillNode) return undefined;
	let sizeW = 0,
		sizeH = 0;
	let offset;
	const isOval = drillNode[1] === "oval";
	let idx = isOval ? 2 : 1;

	if (drillNode[idx]) {
		sizeW = parseFloat(drillNode[idx]);
		sizeH = sizeW;
		if (isOval && drillNode[idx + 1]) {
			sizeH = parseFloat(drillNode[idx + 1]);
			idx++;
		}
		idx++;
	}

	const offsetNode = findSublist(drillNode, "offset");
	if (offsetNode) {
		offset = { x: parseFloat(offsetNode[1]), y: parseFloat(offsetNode[2]) };
	}
	return { size: { w: sizeW, h: sizeH }, offset };
}

function parseNodePoint(node) {
	return node ? { x: parseFloat(node[1]), y: parseFloat(node[2]) } : undefined;
}

function calculateCircleRadius(centerNode, endNode) {
	if (!centerNode || !endNode) return undefined;
	return Math.hypot(
		parseFloat(endNode[1]) - parseFloat(centerNode[1]),
		parseFloat(endNode[2]) - parseFloat(centerNode[2]),
	);
}

function parsePadPrimitive(prim) {
	if (!Array.isArray(prim)) return null;
	const typeClean = prim[0].replace("gr_", "");
	const centerNode = findSublist(prim, "center");
	const endNode = findSublist(prim, "end");
	const startNode = findSublist(prim, "start");
	const pts = extractPointList(findSublist(prim, "pts"));
	const widthNode = findSublist(prim, "width");
	const radius =
		typeClean === "circle"
			? calculateCircleRadius(centerNode, endNode)
			: undefined;

	return {
		type: typeClean,
		center: parseNodePoint(centerNode),
		end: parseNodePoint(endNode),
		start: parseNodePoint(startNode),
		pts: pts.length > 0 ? pts : undefined,
		width: widthNode ? parseFloat(widthNode[1]) : undefined,
		radius,
	};
}

function parsePadPrimitives(primitivesNode) {
	if (!primitivesNode) return [];
	const primitives = [];
	for (let i = 1; i < primitivesNode.length; i++) {
		const parsed = parsePadPrimitive(primitivesNode[i]);
		if (parsed) primitives.push(parsed);
	}
	return primitives;
}

function parseAtNode(atNode) {
	if (!atNode) return { x: 0, y: 0, rotation: 0 };
	return {
		x: parseFloat(atNode[1]),
		y: parseFloat(atNode[2]),
		rotation: atNode[3] ? parseFloat(atNode[3]) : 0,
	};
}

function parseSizeNode(sizeNode) {
	if (!sizeNode) return { w: 0, h: 0 };
	return { w: parseFloat(sizeNode[1]), h: parseFloat(sizeNode[2]) };
}

function extractPadMetadata(padNode) {
	const pinfunctionNode = findSublist(padNode, "pinfunction");
	const pintypeNode = findSublist(padNode, "pintype");
	const roundrectRratioNode = findSublist(padNode, "roundrect_rratio");
	const uuidNode =
		findSublist(padNode, "uuid") || findSublist(padNode, "tstamp");
	return {
		pinfunction: pinfunctionNode ? pinfunctionNode[1] : undefined,
		pintype: pintypeNode ? pintypeNode[1] : undefined,
		roundrectRratio: roundrectRratioNode
			? parseFloat(roundrectRratioNode[1])
			: undefined,
		uuid: uuidNode ? uuidNode[1] : undefined,
	};
}

function parsePad(padNode, footprint, netTable) {
	const number = padNode[1];
	const type = padNode[2];
	const shape = padNode[3];
	const localAt = parseAtNode(findSublist(padNode, "at"));
	const absAt = toBoardAbsolute(
		footprint,
		localAt.x,
		localAt.y,
		localAt.rotation,
	);
	const size = parseSizeNode(findSublist(padNode, "size"));
	const drill = parsePadDrill(findSublist(padNode, "drill"));
	const layers = extractLayersList(findSublist(padNode, "layers"));
	const net = resolveNetName(findSublist(padNode, "net"), netTable);
	const primitives = parsePadPrimitives(findSublist(padNode, "primitives"));
	const meta = extractPadMetadata(padNode);

	return {
		number,
		type,
		shape,
		localAt,
		absAt,
		size,
		drill,
		layers,
		net,
		primitives: primitives.length > 0 ? primitives : undefined,
		...meta,
	};
}

function extractTwoPoints(node, aKey, bKey) {
	const a = findSublist(node, aKey);
	const b = findSublist(node, bKey);
	return a && b
		? [
				{ x: parseFloat(a[1]), y: parseFloat(a[2]) },
				{ x: parseFloat(b[1]), y: parseFloat(b[2]) },
			]
		: [];
}

function extractShapePoints(type, node) {
	if (type === "line" || type === "rect")
		return extractTwoPoints(node, "start", "end");
	if (type === "circle") return extractTwoPoints(node, "center", "end");
	if (type === "poly") {
		const ptsNode = findSublist(node, "pts");
		return ptsNode
			? findSublists(ptsNode, "xy").map((xy) => ({
					x: parseFloat(xy[1]),
					y: parseFloat(xy[2]),
				}))
			: [];
	}
	return [];
}

function extractGraphicWidth(gNode) {
	const strokeNode = findSublist(gNode, "stroke");
	const widthNode = strokeNode
		? findSublist(strokeNode, "width")
		: findSublist(gNode, "width");
	return widthNode ? parseFloat(widthNode[1]) : undefined;
}

function extractGraphicText(type, gNode) {
	const textNode =
		findSublist(gNode, "text") || (type === "text" ? gNode[1] : null);
	return type === "text" && typeof textNode === "string"
		? textNode
		: textNode && textNode[1];
}

function extractGraphicCommon(gNode) {
	const rawType = gNode[0];
	const type = rawType.replace(/^(?:fp_|gr_)/, "");
	const layerNode = findSublist(gNode, "layer");
	const uuidNode = findSublist(gNode, "uuid") || findSublist(gNode, "tstamp");
	return {
		type,
		layer: layerNode ? layerNode[1] : "",
		width: extractGraphicWidth(gNode),
		text: extractGraphicText(type, gNode),
		uuid: uuidNode ? uuidNode[1] : undefined,
		pts: extractShapePoints(type, gNode),
	};
}

function parseFootprintGraphic(gNode, footprint) {
	const common = extractGraphicCommon(gNode);
	const absPts = common.pts.map((pt) => {
		const res = toBoardAbsolute(footprint, pt.x, pt.y);
		return { x: res.x, y: res.y };
	});
	return {
		type: common.type,
		layer: common.layer,
		width: common.width,
		text: common.text,
		uuid: common.uuid,
		localPts: common.pts,
		absPts,
	};
}

function parseSegment(segNode, netTable) {
	const startNode = findSublist(segNode, "start");
	const endNode = findSublist(segNode, "end");
	const widthNode = findSublist(segNode, "width");
	const layerNode = findSublist(segNode, "layer");
	const uuidNode =
		findSublist(segNode, "uuid") || findSublist(segNode, "tstamp");

	return {
		start: { x: parseFloat(startNode[1]), y: parseFloat(startNode[2]) },
		end: { x: parseFloat(endNode[1]), y: parseFloat(endNode[2]) },
		width: widthNode ? parseFloat(widthNode[1]) : 0,
		layer: layerNode ? layerNode[1] : "",
		net: resolveNetName(findSublist(segNode, "net"), netTable) || "",
		uuid: uuidNode ? uuidNode[1] : undefined,
	};
}

function resolveViaType(keyword) {
	if (keyword === "blind" || keyword === "buried" || keyword === "micro")
		return keyword;
	return undefined;
}

function parseVia(viaNode, netTable) {
	const type = resolveViaType(viaNode[1]);
	const atNode = findSublist(viaNode, "at");
	const sizeNode = findSublist(viaNode, "size");
	const drillNode = findSublist(viaNode, "drill");
	const uuidNode =
		findSublist(viaNode, "uuid") || findSublist(viaNode, "tstamp");

	return {
		type,
		at: { x: parseFloat(atNode[1]), y: parseFloat(atNode[2]) },
		size: sizeNode ? parseFloat(sizeNode[1]) : 0,
		drill: drillNode ? parseFloat(drillNode[1]) : 0,
		layers: extractLayersList(findSublist(viaNode, "layers")),
		net: resolveNetName(findSublist(viaNode, "net"), netTable) || "",
		uuid: uuidNode ? uuidNode[1] : undefined,
	};
}

function extractFilledPolygons(zoneNode) {
	const filledPolygons = [];
	const filledPolys = findSublists(zoneNode, "filled_polygon");
	for (const fp of filledPolys) {
		const layerSub = findSublist(fp, "layer");
		const pts = extractPointList(findSublist(fp, "pts"));
		filledPolygons.push({
			layer: layerSub ? layerSub[1] : "",
			pts,
		});
	}
	return filledPolygons;
}

function extractZoneHatch(zoneNode) {
	const hatchNode = findSublist(zoneNode, "hatch");
	if (!hatchNode) return { hatchMode: undefined, hatchSize: undefined };
	return {
		hatchMode: hatchNode[1],
		hatchSize: hatchNode[2] ? parseFloat(hatchNode[2]) : undefined,
	};
}

function extractZoneThickness(zoneNode) {
	const connectPadsNode = findSublist(zoneNode, "connect_pads");
	const minThicknessNode = findSublist(zoneNode, "min_thickness");
	const filledAreasThicknessNode = findSublist(
		zoneNode,
		"filled_areas_thickness",
	);
	return {
		connectPads: connectPadsNode ? connectPadsNode[1] : undefined,
		minThickness: minThicknessNode
			? parseFloat(minThicknessNode[1])
			: undefined,
		filledAreasThickness: filledAreasThicknessNode
			? parseFloat(filledAreasThicknessNode[1])
			: undefined,
	};
}

function parseZone(zoneNode, netTable) {
	const layerNode = findSublist(zoneNode, "layer");
	const layers = layerNode
		? [layerNode[1]]
		: extractLayersList(findSublist(zoneNode, "layers"));
	const hatch = extractZoneHatch(zoneNode);
	const thick = extractZoneThickness(zoneNode);
	const uuidNode =
		findSublist(zoneNode, "uuid") || findSublist(zoneNode, "tstamp");
	const polygonNode = findSublist(zoneNode, "polygon");
	const polygonPts = polygonNode
		? extractPointList(findSublist(polygonNode, "pts"))
		: [];
	const filledPolygons = extractFilledPolygons(zoneNode);

	return {
		net: resolveNetName(findSublist(zoneNode, "net"), netTable) || "",
		layers,
		...hatch,
		...thick,
		polygon: polygonPts,
		filledPolygons,
		uuid: uuidNode ? uuidNode[1] : undefined,
	};
}

function parseBoardGraphic(gNode) {
	return extractGraphicCommon(gNode);
}

function parseDimension(dimNode) {
	const type = dimNode[1];
	const pts = [];
	const ptsNode = findSublist(dimNode, "pts");
	if (ptsNode) {
		const xyNodes = findSublists(ptsNode, "xy");
		for (const xy of xyNodes) {
			pts.push({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) });
		}
	}

	const grNode = findSublist(dimNode, "gr_text");
	const text = grNode ? grNode[1] : undefined;
	const layerNode = findSublist(dimNode, "layer");
	const uuidNode =
		findSublist(dimNode, "uuid") || findSublist(dimNode, "tstamp");

	return {
		type,
		pts,
		text,
		layer: layerNode ? layerNode[1] : "",
		uuid: uuidNode ? uuidNode[1] : undefined,
	};
}

function parseGroup(groupNode) {
	const name = groupNode[1];
	const uuidNode =
		findSublist(groupNode, "uuid") || findSublist(groupNode, "tstamp");
	const membersNode = findSublist(groupNode, "members");
	const members = [];
	if (membersNode) {
		for (let i = 1; i < membersNode.length; i++) {
			members.push(membersNode[i]);
		}
	}
	return {
		name,
		uuid: uuidNode ? uuidNode[1] : undefined,
		members,
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
function isNetDeclarationToken(token) {
	return (
		Array.isArray(token) &&
		token[0] === "net" &&
		token.length >= 3 &&
		!isNaN(token[1]) &&
		typeof token[2] === "string"
	);
}

function extractSegPoints(segProps) {
	const start = segProps.start
		? { x: parseFloat(segProps.start[0]), y: parseFloat(segProps.start[1]) }
		: null;
	const end = segProps.end
		? { x: parseFloat(segProps.end[0]), y: parseFloat(segProps.end[1]) }
		: null;
	return { start, end };
}

function parseSingleTrackSegment(token, netIndexMap) {
	const segProps = Object.fromEntries(
		token
			.slice(1)
			.map((item) =>
				Array.isArray(item) ? [item[0], item.slice(1)] : [item, true],
			),
	);

	const netId = segProps.net ? parseInt(segProps.net[0], 10) : 0;
	const netName = netIndexMap.get(netId) || "unconnected";
	const layer = segProps.layer ? segProps.layer[0] : "F.Cu";
	const { start, end } = extractSegPoints(segProps);

	return start && end ? { start, end, netId, netName, layer } : null;
}

/**
 * Extracts and maps all track segments with their resolved net names and coordinates.
 */
function parsePcbNetSegments(pcbAst) {
	const netIndexMap = new Map();
	const trackSegments = [];

	for (const token of pcbAst) {
		if (isNetDeclarationToken(token)) {
			netIndexMap.set(parseInt(token[1], 10), token[2]);
		}
	}

	for (const token of pcbAst) {
		if (Array.isArray(token) && token[0] === "segment") {
			const seg = parseSingleTrackSegment(token, netIndexMap);
			if (seg) trackSegments.push(seg);
		}
	}

	return { netIndexMap, trackSegments };
}

function extractPcbTitleBlock(titleBlockNode) {
	if (!titleBlockNode) return undefined;
	const title = findSublist(titleBlockNode, "title")?.[1];
	const date = findSublist(titleBlockNode, "date")?.[1];
	const rev = findSublist(titleBlockNode, "rev")?.[1];
	const company = findSublist(titleBlockNode, "company")?.[1];
	const comments = [];
	for (let i = 1; i <= 9; i++) {
		const comment =
			findSublist(titleBlockNode, "comment " + i) ||
			findSublist(titleBlockNode, `comment_${i}`) ||
			findSublist(titleBlockNode, `comment${i}`);
		if (comment) comments.push(comment[1]);
	}
	return { title, date, rev, company, comments };
}

function parsePcbMetadataHeader(root) {
	const version = findSublist(root, "version")?.[1] || "";
	const generator = findSublist(root, "generator")?.[1] || "";
	const generatorVersion = findSublist(root, "generator_version")?.[1] || "";
	const general = findSublist(root, "general");
	const thickNode = general ? findSublist(general, "thickness") : null;
	const thickness = thickNode ? parseFloat(thickNode[1]) : undefined;
	const paper = findSublist(root, "paper");
	const paperSize = paper ? paper[1] : undefined;
	const titleBlock = extractPcbTitleBlock(findSublist(root, "title_block"));
	return {
		version,
		generator,
		generatorVersion,
		thickness,
		paperSize,
		titleBlock,
	};
}

function parsePcbLayers(root) {
	const layers = new Map();
	const layersNode = findSublist(root, "layers");
	if (layersNode) {
		for (let i = 1; i < layersNode.length; i++) {
			const item = layersNode[i];
			if (Array.isArray(item)) {
				const index = parseInt(item[0], 10);
				const canonicalName = item[1];
				const type = item[2];
				const userName = item[3];
				layers.set(canonicalName, {
					index,
					name: canonicalName,
					type,
					userName,
				});
			}
		}
	}
	return layers;
}

function parsePcbNets(root) {
	const nets = new Map();
	const netNodes = findSublists(root, "net");
	for (const node of netNodes) {
		if (node.length >= 3) {
			const index = parseInt(node[1], 10);
			const name = node[2];
			nets.set(index, name);
		}
	}
	return nets;
}

function parseSingleNetClass(node) {
	const name = node[1];
	const descNode = findSublist(node, "description");
	const description = descNode ? descNode[1] : undefined;
	const clearanceNode = findSublist(node, "clearance");
	const traceWidthNode = findSublist(node, "trace_width");
	const viaDiaNode = findSublist(node, "via_dia");
	const viaDrillNode = findSublist(node, "via_drill");
	const uviaDiaNode = findSublist(node, "uvia_dia");
	const uviaDrillNode = findSublist(node, "uvia_drill");
	const nets = findSublists(node, "add_net").map((an) => an[1]);
	return {
		name,
		description,
		clearance: clearanceNode ? parseFloat(clearanceNode[1]) : 0,
		traceWidth: traceWidthNode ? parseFloat(traceWidthNode[1]) : 0,
		viaDia: viaDiaNode ? parseFloat(viaDiaNode[1]) : 0,
		viaDrill: viaDrillNode ? parseFloat(viaDrillNode[1]) : 0,
		uviaDia: uviaDiaNode ? parseFloat(uviaDiaNode[1]) : undefined,
		uviaDrill: uviaDrillNode ? parseFloat(uviaDrillNode[1]) : undefined,
		nets,
	};
}

function parsePcbNetClasses(root) {
	return findSublists(root, "net_class").map(parseSingleNetClass);
}

function parseFootprint3DModel(modelNode) {
	if (!modelNode) return undefined;
	const offsetNode = findSublist(modelNode, "offset");
	const scaleNode = findSublist(modelNode, "scale");
	const rotateNode = findSublist(modelNode, "rotate");
	return {
		path: modelNode[1],
		offset: offsetNode
			? {
					x: parseFloat(offsetNode[1]),
					y: parseFloat(offsetNode[2]),
					z: parseFloat(offsetNode[3]),
				}
			: { x: 0, y: 0, z: 0 },
		scale: scaleNode
			? {
					x: parseFloat(scaleNode[1]),
					y: parseFloat(scaleNode[2]),
					z: parseFloat(scaleNode[3]),
				}
			: { x: 1, y: 1, z: 1 },
		rotate: rotateNode
			? {
					x: parseFloat(rotateNode[1]),
					y: parseFloat(rotateNode[2]),
					z: parseFloat(rotateNode[3]),
				}
			: { x: 0, y: 0, z: 0 },
	};
}

function populateFootprintChildren(item, fp, nets) {
	for (const subItem of item) {
		if (!Array.isArray(subItem)) continue;
		if (subItem[0] === "pad") {
			fp.pads.push(parsePad(subItem, fp, nets));
		} else if (subItem[0].startsWith("fp_")) {
			fp.graphics.push(parseFootprintGraphic(subItem, fp));
		}
	}
}

function parsePcbFootprintItem(item, nets) {
	const libId = item[1];
	const layerNode = findSublist(item, "layer");
	const layer = layerNode ? layerNode[1] : "";
	const at = parseAtNode(findSublist(item, "at"));
	const uuidNode = findSublist(item, "uuid") || findSublist(item, "tstamp");
	const descNode = findSublist(item, "descr");
	const tags = extractLayersList(findSublist(item, "tags"));
	const attrs = extractLayersList(findSublist(item, "attr"));

	const fp = {
		libId,
		layer,
		at,
		reference: parseProperty(item, "Reference"),
		value: parseProperty(item, "Value"),
		uuid: uuidNode ? uuidNode[1] : undefined,
		descr: descNode ? descNode[1] : undefined,
		tags: tags.length > 0 ? tags : undefined,
		attr: attrs.length > 0 ? attrs : undefined,
		pads: [],
		graphics: [],
		model: parseFootprint3DModel(findSublist(item, "model")),
	};

	populateFootprintChildren(item, fp, nets);
	return fp;
}

const BOARD_ITEM_DISPATCHERS = {
	footprint: (item, nets, c) =>
		c.footprints.push(parsePcbFootprintItem(item, nets)),
	module: (item, nets, c) =>
		c.footprints.push(parsePcbFootprintItem(item, nets)),
	segment: (item, nets, c) => c.tracks.push(parseSegment(item, nets)),
	arc: (item, nets, c) => c.tracks.push(parseSegment(item, nets)),
	via: (item, nets, c) => c.vias.push(parseVia(item, nets)),
	zone: (item, nets, c) => c.zones.push(parseZone(item, nets)),
	dimension: (item, nets, c) => c.dimensions.push(parseDimension(item)),
	group: (item, nets, c) => c.groups.push(parseGroup(item)),
};

function dispatchBoardItem(item, nets, collections) {
	const keyword = item[0];
	const handler = BOARD_ITEM_DISPATCHERS[keyword];
	if (handler) {
		handler(item, nets, collections);
	} else if (keyword?.startsWith("gr_")) {
		collections.graphics.push(parseBoardGraphic(item));
	}
}

/**
 * Main parse function. Takes file path, parses and returns the full typed board representation.
 */
function parseKiCadBoard(filePath) {
	const fileContent = fs.readFileSync(filePath, "utf8");
	const root = parseSExpr(fileContent);

	if (!root || root[0] !== "kicad_pcb") {
		throw new Error(
			"Invalid .kicad_pcb file: root S-expression must be (kicad_pcb ...)",
		);
	}

	const metadata = parsePcbMetadataHeader(root);
	const layers = parsePcbLayers(root);
	const nets = parsePcbNets(root);
	const netClasses = parsePcbNetClasses(root);

	const collections = {
		footprints: [],
		tracks: [],
		vias: [],
		zones: [],
		graphics: [],
		dimensions: [],
		groups: [],
	};

	for (const item of root) {
		if (Array.isArray(item)) dispatchBoardItem(item, nets, collections);
	}

	return {
		metadata,
		layers,
		nets,
		netClasses,
		...collections,
	};
}

function extractRegexNets(content) {
	const netMap = new Map();
	const netRegex = /\(net\s+(\d+)\s+(?:"([^"]+)"|([^\s)]+))\)/g;
	let m = netRegex.exec(content);
	while (m !== null) {
		netMap.set(parseInt(m[1], 10), m[2] !== undefined ? m[2] : m[3]);
		m = netRegex.exec(content);
	}
	return netMap;
}

function extractRegexSegments(content, netMap) {
	const segments = [];
	const segRegex =
		/\((?:segment|arc)\s+.*?\(start\s+([\d.-]+)\s+([\d.-]+)\).*?\(end\s+([\d.-]+)\s+([\d.-]+)\).*?\(layer\s+"?([^"\s)]+)"?\).*?\(net\s+(\d+)\)/gs;
	let m = segRegex.exec(content);
	while (m !== null) {
		const netId = parseInt(m[6], 10);
		segments.push({
			start: { x: parseFloat(m[1]), y: parseFloat(m[2]) },
			end: { x: parseFloat(m[3]), y: parseFloat(m[4]) },
			layer: m[5],
			netId,
			netName: netMap.get(netId) || `Net-${netId}`,
		});
		m = segRegex.exec(content);
	}
	return segments;
}

function extractRegexFootprints(content) {
	const footprints = [];
	const fpBlockRegex =
		/\((?:footprint|module)\s+"[^"]*"\s+\(layer\s+"?([^"\s)]+)"?\).*?\(at\s+([\d.-]+)\s+([\d.-]+)(?:\s+[\d.-]+)?\)([\s\S]*?)(?=\n\s*\((?:footprint|module|segment|arc|via|zone)|\n\s*\)$|$)/g;
	let m = fpBlockRegex.exec(content);
	while (m !== null) {
		const body = m[4];
		const refMatch = body.match(
			/\((?:property|fp_text)\s+"?[Rr]eference"?\s+"([^"]+)"/i,
		);
		const valMatch = body.match(
			/\((?:property|fp_text)\s+"?[Vv]alue"?\s+"([^"]+)"/i,
		);
		if (refMatch) {
			footprints.push({
				layer: m[1],
				center: { x: parseFloat(m[2]), y: parseFloat(m[3]) },
				ref: refMatch[1],
				value: valMatch ? valMatch[1] : "",
			});
		}
		m = fpBlockRegex.exec(content);
	}
	return footprints;
}

/**
 * Direct S-Expression regex parser for KiCad PCB tracks, nets, and footprints.
 */
function parsePcbMetadata(pcbFileContent) {
	if (!pcbFileContent || typeof pcbFileContent !== "string") {
		return { netMap: new Map(), segments: [], footprints: [] };
	}
	const netMap = extractRegexNets(pcbFileContent);
	const segments = extractRegexSegments(pcbFileContent, netMap);
	const footprints = extractRegexFootprints(pcbFileContent);
	return { netMap, segments, footprints };
}

export {
	parseKiCadBoard,
	parsePcbMetadata,
	parsePcbNetSegments,
	parseSExpr,
	toBoardAbsolute,
};
