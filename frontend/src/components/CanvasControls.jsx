import React from 'react';
import { Typography } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined, UndoOutlined } from '@ant-design/icons';

const { Text } = Typography;

const BUTTON_BASE_STYLE = {
  background: '#1e2230',
  border: '1px solid #333a4d',
  color: '#cbd5e1',
  borderRadius: '4px',
  padding: '3px 8px',
  fontSize: '11px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

function ZoomButton({ onClick, title, children, style = {} }) {
  return (
    <button onClick={onClick} title={title} style={{ ...BUTTON_BASE_STYLE, ...style }}>
      {children}
    </button>
  );
}

function ToolbarModeIndicator({ isSlider }) {
  const accentColor = isSlider ? '#fadb14' : '#10b981';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: accentColor,
          boxShadow: `0 0 6px ${accentColor}`,
        }}
      />
      <Text style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: 500 }}>
        {isSlider ? 'Overlay Slider Diff' : 'Color Delta Map'}
      </Text>
      <Text style={{ color: '#64748b', fontSize: '11px', marginLeft: '6px' }}>
        {isSlider
          ? '· Drag canvas to pan · Scroll to zoom · Drag yellow line to wipe'
          : '· Red = Base | Green = Target · Drag to pan · Scroll to zoom'}
      </Text>
    </div>
  );
}

function ZoomControls({ currentZoomPercent, onZoomIn, onZoomOut, onReset }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <ZoomButton onClick={onZoomOut} title="Zoom Out (Scroll Down)">
        <ZoomOutOutlined />
      </ZoomButton>

      <ZoomButton
        onClick={onReset}
        title="Click to reset to 100%"
        style={{ color: '#fadb14', fontFamily: 'monospace', minWidth: '50px', textAlign: 'center' }}
      >
        {currentZoomPercent}%
      </ZoomButton>

      <ZoomButton onClick={onZoomIn} title="Zoom In (Scroll Up)">
        <ZoomInOutlined />
      </ZoomButton>

      <ZoomButton
        onClick={onReset}
        title="Reset to Center (Double-click canvas)"
        style={{ padding: '3px 10px', marginLeft: '4px' }}
      >
        <UndoOutlined /> Reset
      </ZoomButton>
    </div>
  );
}

export function CanvasTopToolbar({ isSlider, currentZoomPercent, onZoomIn, onZoomOut, onReset }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 14px',
        background: '#0e1017',
        borderBottom: '1px solid #1e2230',
        zIndex: 20,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <ToolbarModeIndicator isSlider={isSlider} />
      <ZoomControls
        currentZoomPercent={currentZoomPercent}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={onReset}
      />
    </div>
  );
}

export function SliderSplitHandle({ sliderValue }) {
  return (
    <div
      className="diff-slider-handle"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${sliderValue}%`,
        width: '14px',
        marginLeft: '-7px',
        cursor: 'ew-resize',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '2px',
          height: '100%',
          backgroundColor: '#fadb14',
          boxShadow: '0 0 8px rgba(250, 219, 20, 0.9)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          backgroundColor: '#161821',
          border: '2px solid #fadb14',
          boxShadow: '0 0 10px rgba(0,0,0,0.5), 0 0 8px rgba(250, 219, 20, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fadb14',
          fontSize: '11px',
          cursor: 'ew-resize',
          userSelect: 'none',
        }}
      >
        ↔
      </div>
    </div>
  );
}
