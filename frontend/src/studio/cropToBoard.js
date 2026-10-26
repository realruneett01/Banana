/**
 * The engine renders the whole A4 sheet, so a small board is a speck on it. Cropping the viewBox to the board
 * (identically for both sides) zooms in without touching the engine's output, colours or geometry. Only done when
 * the sheet's units are the expected millimetres, otherwise the drawing is left exactly as the engine made it.
 */
export function cropToBoard(svgs, board) {
  if (!svgs || !board) return svgs;
  const m = Math.max(4, 0.12 * Math.max(board.width, board.height));
  const crop = [board.originX - m, board.originY - m, board.width + 2 * m, board.height + 2 * m];
  return svgs.map((layer) => {
    const match = /viewBox="([^"]*)"/.exec(layer.content ?? '');
    const vb = match?.[1].trim().split(/\s+/).map(Number);
    if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return layer;
    const [x, y, w, h] = vb;
    const fits = crop[0] >= x - 1 && crop[1] >= y - 1 && crop[0] + crop[2] <= x + w + 1 && crop[1] + crop[3] <= y + h + 1;
    if (!fits || w > 2000) return layer;
    return { ...layer, content: layer.content.replace(match[0], `viewBox="${crop.map((n) => Math.round(n * 1000) / 1000).join(' ')}"`) };
  });
}

