import React from 'react';
import { Tag, Typography } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { isLayerActive, resolveLayerVisuals } from '../utils/diffLayerUtils.js';

const { Text } = Typography;

export const SideBySideSvgLayer = React.memo(({ content, layerTier, opacityStyle, filterStyle }) => {
  return (
    <div
      className={layerTier}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity: opacityStyle,
        filter: filterStyle,
        transition: 'opacity 0.15s, filter 0.2s',
        pointerEvents: 'none',
      }}
      dangerouslySetInnerHTML={{
        __html: content.replace(/<svg/, '<svg style="width:100%;height:100%;position:absolute;"')
      }}
    />
  );
}, (prev, next) => (
  prev.content === next.content &&
  prev.layerTier === next.layerTier &&
  prev.opacityStyle === next.opacityStyle &&
  prev.filterStyle === next.filterStyle
));

function PanelHeader({ isBase, commitLabel }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 14px', background: isBase ? 'rgba(192,57,43,0.12)' : 'rgba(39,174,96,0.12)',
      borderBottom: `1px solid ${isBase ? '#3d1f1f' : '#1f3d2a'}`, flexShrink: 0, gap: '8px',
    }}>
      <Tag color={isBase ? 'red' : 'green'} style={{ margin: 0, fontWeight: 700, letterSpacing: '0.05em' }}>
        {isBase ? <><ArrowLeftOutlined /> BASE</> : <>TARGET <ArrowRightOutlined /></>}
      </Tag>
      <Text style={{ fontSize: '11px', color: '#a6adbb', fontFamily: 'monospace', flex: 1, textAlign: 'center' }}>
        {commitLabel}
      </Text>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: isBase ? '#ff3366' : '#00ff66', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: isBase ? '#ff3366' : '#00ff66', display: 'inline-block' }} />
          {isBase ? 'Deleted' : 'Added'}
        </span>
        <span style={{ fontSize: '10px', color: '#ffff00', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffff00', display: 'inline-block' }} />
          Changed
        </span>
        <span style={{ fontSize: '10px', color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#71717a', display: 'inline-block' }} />
          Unchanged
        </span>
      </div>
    </div>
  );
}

function SvgLayerList({ filtered, side, soloLayer, layerOpacities }) {
  if (filtered.length === 0) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 14 }}>
        No layers selected
      </div>
    );
  }

  return filtered.map((svg) => {
    const visuals = resolveLayerVisuals(svg.filename, soloLayer, layerOpacities);
    return (
      <SideBySideSvgLayer
        key={`${side}-${svg.filename}`}
        content={svg.content}
        layerTier={visuals.layerTier}
        opacityStyle={visuals.opacityStyle}
        filterStyle={visuals.filterStyle}
      />
    );
  });
}

export function SvgPanel({ svgs, activeLayers, soloLayer, layerOpacities, contentRef, side, commitLabel, transform }) {
  const filtered = (svgs || []).filter((svg) => isLayerActive(svg.filename, activeLayers));
  const isBase = side === 'base';

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
      overflow: 'hidden', borderRadius: '6px',
      border: `1px solid ${isBase ? '#3d1f1f' : '#1f3d2a'}`, background: '#12131e',
    }}>
      <PanelHeader isBase={isBase} commitLabel={commitLabel} />

      <div className="diff-viewport" style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: 'grab', userSelect: 'none' }}>
        <div
          ref={contentRef}
          style={{
            width: '100%', height: '100%', transformOrigin: '0 0', position: 'relative',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
          }}
        >
          <SvgLayerList
            filtered={filtered}
            side={side}
            soloLayer={soloLayer}
            layerOpacities={layerOpacities}
          />
        </div>
      </div>
    </div>
  );
}
