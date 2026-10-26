import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Spin, Tooltip, Typography } from 'antd';
import { AimOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { useCanvasTransform } from '../useCanvasTransform.js';

const { Text } = Typography;

/** Pixels per millimetre of the unzoomed drawing. */
const PX_PER_MM = 6;
const SNAP_MM = 0.5;
const DRAG_THRESHOLD_PX = 3;
const snap = (v) => Math.round(v / SNAP_MM) * SNAP_MM;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * KiCad's own drawing of the board (or schematic) with an interactive layer on top: every part's courtyard can
 * be selected and dragged on a 0.5 mm grid, R rotates, Delete removes. The overlay is in the same transformed
 * element as the picture, so it always lines up with what KiCad drew.
 */
export default function BoardCanvas({
  url,
  vb,
  transform,
  parts = [],
  selected,
  onSelect,
  onMove,
  onRotate,
  onDelete,
  interactive,
  loading,
  error,
  emptyText,
}) {
  const outerRef = useRef(null);
  const contentRef = useRef(null);
  const {
    transform: view,
    transformRef,
    animateTo,
    zoomIn,
    zoomOut,
    onMouseDown,
    onMouseMove,
    onDoubleClick,
  } = useCanvasTransform({ outerRef, contentRef });
  const [ghost, setGhost] = useState(null);
  const dragRef = useRef(null);
  const fittedRef = useRef('');

  const width = vb ? vb[2] * PX_PER_MM : 0;
  const height = vb ? vb[3] * PX_PER_MM : 0;

  const fit = useCallback(() => {
    const el = outerRef.current;
    if (!el || !width) return;
    const rect = el.getBoundingClientRect();
    const scale = Math.min((rect.width - 40) / width, (rect.height - 40) / height);
    animateTo({ scale, x: (rect.width - width * scale) / 2, y: (rect.height - height * scale) / 2 }, 1);
  }, [animateTo, width, height]);

  // fit once per drawing size (not on every re-render of the same board)
  useEffect(() => {
    const key = vb ? `${vb[2]}x${vb[3]}` : '';
    if (key && fittedRef.current !== key) {
      fittedRef.current = key;
      requestAnimationFrame(fit);
    }
  }, [vb, fit]);

  const toPx = useCallback(
    (x, y) => ({
      left: (x * (transform?.scale ?? 1) + (transform?.offsetX ?? 0)) * PX_PER_MM,
      top: (y * (transform?.scale ?? 1) + (transform?.offsetY ?? 0)) * PX_PER_MM,
    }),
    [transform],
  );

  const startDrag = (e, part) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect?.(part.ref);
    if (!interactive || !part.at) return;
    dragRef.current = {
      ref: part.ref,
      startX: e.clientX,
      startY: e.clientY,
      origX: part.at.x,
      origY: part.at.y,
      rot: part.at.rot || 0,
      moved: false,
    };
  };

  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dxPx = e.clientX - d.startX;
      const dyPx = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const k = PX_PER_MM * transformRef.current.scale;
      d.x = round2(snap(d.origX + dxPx / k));
      d.y = round2(snap(d.origY + dyPx / k));
      setGhost({ ref: d.ref, dx: d.x - d.origX, dy: d.y - d.origY });
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setGhost(null);
      if (d?.moved && (d.x !== d.origX || d.y !== d.origY)) onMove?.(d.ref, d.x, d.y, d.rot);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onMove, transformRef]);

  const onKeyDown = (e) => {
    if (!interactive || !selected) return;
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      onRotate?.(selected);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete?.(selected);
    } else if (e.key === 'Escape') onSelect?.(null);
  };

  const overlay = useMemo(() => {
    if (!interactive || !transform) return null;
    return parts.filter((p) => p.courtyard);
  }, [interactive, parts, transform]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={outerRef}
        data-testid="board-canvas"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onDoubleClick={onDoubleClick}
        onClick={() => onSelect?.(null)}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          background: '#0b0e17',
          cursor: 'grab',
          userSelect: 'none',
          outline: 'none',
          borderRadius: 6,
        }}
      >
        {url && (
          <div
            ref={contentRef}
            data-testid="board-content"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width,
              height,
              transformOrigin: '0 0',
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          >
            <img
              src={url}
              alt="KiCad drawing"
              data-testid="kicad-image"
              draggable={false}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            />
            {overlay?.map((part) => {
              const c = part.courtyard;
              const tl = toPx(c.minX, c.minY);
              const br = toPx(c.maxX, c.maxY);
              const isSel = selected === part.ref;
              const g = ghost?.ref === part.ref ? ghost : null;
              return (
                <React.Fragment key={part.ref}>
                  <div
                    data-testid={`part-${part.ref}`}
                    data-selected={isSel ? 'true' : 'false'}
                    title={`${part.ref}  ${part.value}`}
                    onMouseDown={(e) => startDrag(e, part)}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: tl.left,
                      top: tl.top,
                      width: br.left - tl.left,
                      height: br.top - tl.top,
                      boxSizing: 'border-box',
                      border: isSel ? '1.5px solid #22d3ee' : '1px solid transparent',
                      background: isSel ? 'rgba(34, 211, 238, 0.12)' : 'transparent',
                      cursor: interactive ? 'move' : 'pointer',
                      transform: g ? `translate(${g.dx * PX_PER_MM}px, ${g.dy * PX_PER_MM}px)` : undefined,
                      opacity: g ? 0.8 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) e.currentTarget.style.border = '1px dashed rgba(250, 219, 20, 0.8)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSel) e.currentTarget.style.border = '1px solid transparent';
                    }}
                  />
                  {isSel &&
                    part.pads.map((pad) => {
                      const p1 = toPx(pad.x - pad.w / 2, pad.y - pad.h / 2);
                      const p2 = toPx(pad.x + pad.w / 2, pad.y + pad.h / 2);
                      return (
                        <div
                          key={pad.pin}
                          data-testid={`pad-${pad.pin}`}
                          title={`${pad.pin}${pad.net ? ` → ${pad.net}` : ' (unconnected)'}`}
                          style={{
                            position: 'absolute',
                            left: p1.left,
                            top: p1.top,
                            width: p2.left - p1.left,
                            height: p2.top - p1.top,
                            border: `1px solid ${pad.net ? '#a3e635' : '#f87171'}`,
                            pointerEvents: 'none',
                            transform: g ? `translate(${g.dx * PX_PER_MM}px, ${g.dy * PX_PER_MM}px)` : undefined,
                          }}
                        />
                      );
                    })}
                </React.Fragment>
              );
            })}
          </div>
        )}
        {!url && !loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Text type="secondary" data-testid="canvas-empty">
              {error || emptyText || 'Nothing to show yet'}
            </Text>
          </div>
        )}
      </div>
      {(loading || error) && (
        <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          {loading && <Spin size="small" data-testid="canvas-loading" />}
          {error && url && (
            <Text type="danger" style={{ fontSize: 12 }}>
              {error}
            </Text>
          )}
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 12, right: 12 }}>
        <Space.Compact>
          <Tooltip title="Zoom in">
            <Button icon={<ZoomInOutlined />} onClick={zoomIn} data-testid="zoom-in" />
          </Tooltip>
          <Tooltip title="Zoom out">
            <Button icon={<ZoomOutOutlined />} onClick={zoomOut} data-testid="zoom-out" />
          </Tooltip>
          <Tooltip title="Fit to window">
            <Button icon={<AimOutlined />} onClick={fit} data-testid="zoom-fit" />
          </Tooltip>
        </Space.Compact>
      </div>
    </div>
  );
}
