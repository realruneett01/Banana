function rows(text) {
	return text
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split("|"));
}

function mapTool([id, label, hotkey, icon, ready]) {
	return { id, label, hotkey, icon, ready: ready === "1" };
}

function mapPart([symbol, footprint = "", ref, value, label = value]) {
	const id = symbol.split(":")[1];
	return { id, label, symbol, footprint, ref, value };
}

function mapFootprint([footprint, ref, label]) {
	const id = footprint.split(":")[1];
	return { id, label, symbol: "", footprint, ref, value: id };
}

function deepFreeze(obj) {
	Object.freeze(obj);
	for (const val of Object.values(obj)) {
		if (val && typeof val === "object") {
			deepFreeze(val);
		}
	}
	return obj;
}

const SCHEMATIC_TOOL_TEXT = `
select|Select|esc|select|1
highlightNet|Highlight net|backquote|net|1
placeSymbol|Add symbol|a|symbol|1
placePower|Add power|p|power|1
placeWire|Wire|w|wire|1
placeBus|Bus|b|bus|1
placeNoConnect|No-connect flag|q|noconnect|1
placeJunction|Junction|j|junction|1
placeLabel|Net label|l|label|1
placeGlobalLabel|Global label|ctrl+l|glabel|1
placeHierLabel|Hierarchical label|h|hlabel|1
placeSheet|Sheet|s|sheet|1
placeText|Text|t|text|1
placeLine|Graphic line||line|1
`;

const PCB_TOOL_TEXT = `
select|Select|esc|select|1
highlightNet|Highlight net|backquote|net|1
placeFootprint|Add footprint|a|footprint|1
routeTrack|Route track|x|route|1
routeDiffPair|Differential pair|6|route|1
tuneLength|Tune length|7|route|1
addVia|Via|v|via|1
measure|Measure|ctrl+shift+m|dimension|1
addZone|Filled zone|ctrl+shift+z|zone|1
outlineRect|Board outline (rectangle)||outline|1
outlineRounded|Board outline (rounded)||outlineRounded|1
drawLine|Line|ctrl+shift+l|line|1
drawArc|Arc|ctrl+shift+a|arc|1
drawRect|Rectangle||rect|1
drawCircle|Circle|ctrl+shift+c|circle|1
placeText|Text|ctrl+shift+t|text|1
placeDimension|Dimension|ctrl+shift+h|dimension|1
`;

const SCHEMATIC_PART_TEXT = `
Device:R|Resistor_SMD:R_0603_1608Metric|R|10k|Resistor
Device:C|Capacitor_SMD:C_0603_1608Metric|C|100n|Capacitor
Device:C_Polarized|Capacitor_THT:CP_Radial_D5.0mm_P2.00mm|C|10u|Electrolytic cap
Device:L|Inductor_SMD:L_0805_2012Metric|L|10u|Inductor
Device:D|Diode_SMD:D_SOD-123|D|D|Diode
Device:D_Zener|Diode_SMD:D_SOD-123|D|5V1|Zener diode
Device:LED|LED_SMD:LED_0603_1608Metric|D|LED|LED
Device:Q_NPN|Package_TO_SOT_SMD:SOT-23-3|Q|NPN|NPN transistor
Device:Q_PNP|Package_TO_SOT_SMD:SOT-23-3|Q|PNP|PNP transistor
Device:Q_NMOS|Package_TO_SOT_SMD:SOT-23-3|Q|NMOS|N-MOSFET
Device:Q_PMOS|Package_TO_SOT_SMD:SOT-23-3|Q|PMOS|P-MOSFET
Amplifier_Operational:LM358|Package_SO:SOIC-8_3.9x4.9mm_P1.27mm|U|LM358|Op-amp
Connector:Conn_01x02_Pin|Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical|J|Conn_01x02|2-pin header
Switch:SW_Push|Button_Switch_THT:SW_PUSH_6mm|SW|SW_Push|Push button
Device:Crystal|Crystal:Crystal_HC49-4H_Vertical|Y|16MHz|Crystal
Device:Fuse|Fuse:Fuse_1206_3216Metric|F|500mA|Fuse
Device:Battery|Battery:BatteryHolder_Keystone_1060_1x2032|BT|CR2032|Battery
Device:R_Potentiometer|Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical|RV|10k|Potentiometer
`;

const POWER_TEXT = `
power:GND||#PWR|GND|GND
power:GNDA||#PWR|GNDA|GNDA
power:VCC||#PWR|VCC|VCC
power:+5V||#PWR|+5V|+5V
power:+3V3||#PWR|+3V3|+3V3
power:+12V||#PWR|+12V|+12V
power:PWR_FLAG||#FLG|PWR_FLAG|Power flag
`;

const PCB_FOOTPRINT_TEXT = `
Resistor_SMD:R_0603_1608Metric|R|Resistor
Capacitor_SMD:C_0603_1608Metric|C|Capacitor
LED_SMD:LED_0603_1608Metric|D|LED
Inductor_SMD:L_0805_2012Metric|L|Inductor
Diode_SMD:D_SOD-123|D|Diode
Package_TO_SOT_SMD:SOT-23-3|Q|SOT-23
Package_SO:SOIC-8_3.9x4.9mm_P1.27mm|U|SOIC-8
Package_DIP:DIP-8_W7.62mm|U|DIP-8
Package_TO_SOT_THT:TO-220-3_Vertical|U|TO-220
Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical|J|2-pin header
Capacitor_THT:CP_Radial_D5.0mm_P2.00mm|C|Electrolytic cap
Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal|R|Axial resistor
Button_Switch_THT:SW_PUSH_6mm|SW|Push button
Crystal:Crystal_HC49-4H_Vertical|Y|Crystal
MountingHole:MountingHole_3.2mm_M3|H|Mounting hole
`;

export const SCHEMATIC_TOOLS = deepFreeze(
	rows(SCHEMATIC_TOOL_TEXT).map(mapTool),
);
export const PCB_TOOLS = deepFreeze(rows(PCB_TOOL_TEXT).map(mapTool));
export const SCHEMATIC_QUICK_PARTS = deepFreeze(
	rows(SCHEMATIC_PART_TEXT).map(mapPart),
);
export const SCHEMATIC_POWER = deepFreeze(rows(POWER_TEXT).map(mapPart));
export const PCB_QUICK_FOOTPRINTS = deepFreeze(
	rows(PCB_FOOTPRINT_TEXT).map(mapFootprint),
);
export const PCB_QUICK_LAYERS = deepFreeze([
	"F.Cu",
	"B.Cu",
	"F.SilkS",
	"B.SilkS",
	"Edge.Cuts",
]);

const SCHEMATIC_PALETTE = deepFreeze({
	tools: SCHEMATIC_TOOLS,
	parts: SCHEMATIC_QUICK_PARTS,
	power: SCHEMATIC_POWER,
	layers: [],
});

const PCB_PALETTE = deepFreeze({
	tools: PCB_TOOLS,
	parts: PCB_QUICK_FOOTPRINTS,
	power: [],
	layers: PCB_QUICK_LAYERS,
});

export function paletteFor(tab) {
	if (tab === "schematic") {
		return SCHEMATIC_PALETTE;
	}
	if (tab === "pcb") {
		return PCB_PALETTE;
	}
	return null;
}
