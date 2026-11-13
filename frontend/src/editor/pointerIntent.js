// What a left click on the schematic canvas acts on. As in KiCad, a pin
// click only wires while wire mode (W) is on; otherwise it selects the part.
export function pointerDownTarget(hitKind, wireMode) {
	if (hitKind === "pin") return wireMode ? "connect" : "part";
	return hitKind ?? "empty";
}
