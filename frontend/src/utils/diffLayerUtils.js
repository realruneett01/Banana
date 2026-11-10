export const PCB_LAYER_TOKENS = [
	"_cu",
	"silkscreen",
	"edge_cuts",
	"silks",
	"mask",
	"paste",
	"courtyard",
];

const LAYER_SPECS =
	"F.Cu:Front Copper;B.Cu:Back Copper;In1.Cu:Inner Copper 1;In2.Cu:Inner Copper 2;In3.Cu:Inner Copper 3;In4.Cu:Inner Copper 4;F.SilkS:Front Silkscreen;B.SilkS:Back Silkscreen;F.Mask:Front Solder Mask;B.Mask:Back Solder Mask;F.Paste:Front Solder Paste;B.Paste:Back Solder Paste;F.Adhes:Front Adhesive;B.Adhes:Back Adhesive;Edge.Cuts:Board Outline;Margin:Board Margin;F.Courtyard:Front Courtyard;B.Courtyard:Back Courtyard;F.Fab:Front Fabrication;B.Fab:Back Fabrication;Dwgs.User:Drawings User;Cmts.User:Comments User;Eco1.User:Eco 1 User;Eco2.User:Eco 2 User;User.Drawings:Drawings;User.Comments:Comments;User.Eco1:Eco 1;User.Eco2:Eco 2";

export const ALL_PCB_LAYERS = LAYER_SPECS.split(";").map((spec) => {
	const [value, desc] = spec.split(":");
	return { value, label: `${value} (${desc})` };
});

const SILKS_ALIASES = {
	f_silks: ["f_silkscreen", "f_silks"],
	b_silks: ["b_silkscreen", "b_silks"],
};

export function matchLayerName(name, layerStr) {
	const nl = layerStr.replace(".", "_").toLowerCase();
	const aliases = SILKS_ALIASES[nl];
	if (aliases) {
		return aliases.some((alias) => name.includes(alias));
	}
	return name.includes(nl);
}

export function isLayerActive(filename, activeLayers) {
	const name = filename.toLowerCase();
	const isPcbLayer = PCB_LAYER_TOKENS.some((token) => name.includes(token));
	if (!isPcbLayer) return true;
	return activeLayers.some((layer) => matchLayerName(name, layer));
}

export function isLayerSolo(filename, soloLayer) {
	if (!soloLayer) return true;
	const name = filename.toLowerCase();
	return matchLayerName(name, soloLayer);
}

export function getLayerOpacity(filename, layerOpacities) {
	if (!layerOpacities) return 1;
	const name = filename.toLowerCase();
	const match = Object.entries(layerOpacities).find(([layerValue]) =>
		matchLayerName(name, layerValue),
	);
	return match ? match[1] : 1;
}

export function resolveLayerVisuals(filename, soloLayer, layerOpacities) {
	const solo = isLayerSolo(filename, soloLayer);
	const greyOut = Boolean(soloLayer && !solo);
	const layerOp = getLayerOpacity(filename, layerOpacities);
	return {
		layerTier: greyOut ? "layer-background" : "layer-active",
		opacityStyle: greyOut ? 0.6 : layerOp,
		filterStyle: greyOut ? "grayscale(1) contrast(0.5)" : "none",
	};
}

export function applyTransformToDom(element, transform) {
	if (element && transform) {
		element.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
	}
}

function isValidViewBox(vb) {
	return vb.length >= 4 && vb[2] > 0 && vb[3] > 0;
}

function parseSvgViewBox(svg) {
	const viewBoxStr = svg?.getAttribute("viewBox");
	if (!viewBoxStr) return null;
	const vb = viewBoxStr.split(/[\s,]+/).map(Number);
	return isValidViewBox(vb) ? vb : null;
}

export function getScreenCoordsFromSvg(viewportContentEl, coords) {
	if (!coords || !viewportContentEl) return null;
	const svg = viewportContentEl.querySelector("svg");
	if (!svg) return null;

	const vb = parseSvgViewBox(svg);
	if (!vb) return null;

	const svgRect = svg.getBoundingClientRect();
	const normX = (coords.x - vb[0]) / vb[2];
	const normY = (coords.y - vb[1]) / vb[3];

	return {
		x: svgRect.left + normX * svgRect.width,
		y: svgRect.top + normY * svgRect.height,
	};
}

export function findDiffDomRect(rootEl, diffIdx) {
	if (!rootEl || diffIdx == null) return null;
	const target = rootEl.querySelector(`[data-diff-idx="${diffIdx}"]`);
	return target ? target.getBoundingClientRect() : null;
}

export function createPadLabelProps({
	repoPath,
	baseCommit,
	targetCommit,
	relativeFilePath,
	selectedRemoteRepo,
	githubToken,
}) {
	if (!relativeFilePath?.endsWith(".kicad_pcb")) return null;
	return {
		repoPath,
		baseCommit,
		targetCommit,
		relativeFilePath,
		owner: selectedRemoteRepo?.owner,
		repo: selectedRemoteRepo?.name,
		filePath: relativeFilePath,
		githubToken,
	};
}
