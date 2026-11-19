// What a left click on the schematic canvas acts on. As in KiCad, a pin
// click only wires while wire mode (W) is on; otherwise it selects the part.
export function pointerDownTarget(hitKind, wireMode) {
	if (hitKind === "pin") return wireMode ? "connect" : "part";
	return hitKind ?? "empty";
}

// A pointer-down that pans instead of clicking: middle button, or left
// button while Space is held.
export function isPanPointer(button, isSpaceDown) {
	return button === 1 || (button === 0 && isSpaceDown);
}
