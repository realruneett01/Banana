import React, { useState } from 'react';
import { Typography, Segmented, Button, Space, Input, Checkbox, Slider } from 'antd';
import { ALL_PCB_LAYERS } from '../utils/diffLayerUtils.js';

const { Title, Text } = Typography;

function LayerRowItem({ layer, isActive, isSolo, opacity, onDoubleClick, onOpacityChange }) {
  return (
    <div
      onDoubleClick={onDoubleClick}
      style={{
        userSelect: 'none',
        padding: '3px 6px 4px',
        borderRadius: '4px',
        background: isSolo ? 'rgba(250, 219, 20, 0.12)' : 'transparent',
        border: isSolo ? '1px dashed #fadb14' : '1px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
      title="Double click to Solo this layer"
    >
      <Checkbox value={layer.value} style={{ margin: 0, color: '#a6adbb', fontSize: '12px' }}>
        {layer.label}
        {isSolo && <span style={{ color: '#fadb14', fontSize: '10px', marginLeft: '5px' }}>(Soloed)</span>}
      </Checkbox>

      {isActive && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', paddingLeft: '24px' }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Slider
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={onOpacityChange}
            style={{ flex: 1, margin: 0 }}
            tooltip={{ formatter: (v) => `${v}%` }}
            styles={{
              track: { background: '#fadb14', height: 2 },
              rail: { background: '#2a2a38', height: 2 },
              handle: { width: 10, height: 10, marginTop: -4 },
            }}
          />
          <Text style={{ fontSize: '10px', color: '#6b6375', width: '30px', textAlign: 'right', flexShrink: 0 }}>
            {Math.round(opacity * 100)}%
          </Text>
        </div>
      )}
    </div>
  );
}

function LayerHeaderActions({ onSelectAll, onClear }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Title level={5} style={{ color: '#f5f5f5', margin: 0 }}>Active Layers (PCB)</Title>
        <Text type="secondary" style={{ fontSize: '10px' }}>Double click to solo layer</Text>
      </div>
      <Space size="small">
        <Button
          type="link"
          size="small"
          style={{ padding: 0, fontSize: '11px', color: '#fadb14' }}
          onClick={onSelectAll}
        >
          Select All
        </Button>
        <Text type="secondary" style={{ fontSize: '10px' }}>|</Text>
        <Button
          type="link"
          size="small"
          style={{ padding: 0, fontSize: '11px', color: '#fadb14' }}
          onClick={onClear}
        >
          Clear
        </Button>
      </Space>
    </div>
  );
}

function LayerListContainer({
  selectedLayers,
  setSelectedLayers,
  filteredLayers,
  soloLayer,
  layerOpacities,
  onDoubleClick,
  onOpacityChange,
}) {
  return (
    <div style={{
      height: '180px',
      overflowY: 'auto',
      border: '1px solid #232738',
      borderRadius: '4px',
      padding: '8px 12px',
      background: '#0f1015'
    }}>
      <Checkbox.Group
        value={selectedLayers}
        onChange={setSelectedLayers}
        style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}
      >
        {filteredLayers.map((l) => (
          <LayerRowItem
            key={l.value}
            layer={l}
            isActive={selectedLayers.includes(l.value)}
            isSolo={soloLayer === l.value}
            opacity={layerOpacities[l.value] ?? 1}
            onDoubleClick={() => onDoubleClick(l.value)}
            onOpacityChange={(v) => onOpacityChange(l.value, v)}
          />
        ))}
        {filteredLayers.length === 0 && (
          <div style={{ color: '#6b6375', textAlign: 'center', fontSize: '12px', padding: '10px 0' }}>
            No layers match filter
          </div>
        )}
      </Checkbox.Group>
    </div>
  );
}

export function LayerSelector({
  diffMode,
  setDiffMode,
  selectedLayers,
  setSelectedLayers,
  soloLayer,
  setSoloLayer,
  layerOpacities,
  setLayerOpacities,
}) {
  const [layerFilter, setLayerFilter] = useState('');

  const filteredLayers = ALL_PCB_LAYERS.filter((l) =>
    l.label.toLowerCase().includes(layerFilter.toLowerCase()) ||
    l.value.toLowerCase().includes(layerFilter.toLowerCase())
  );

  const handleLayerDoubleClick = (layerValue) => {
    if (soloLayer === layerValue) {
      setSoloLayer(null);
    } else {
      setSoloLayer(layerValue);
      if (!selectedLayers.includes(layerValue)) {
        setSelectedLayers([...selectedLayers, layerValue]);
      }
    }
  };

  return (
    <div style={{ borderTop: '1px solid #232738', paddingTop: '20px' }}>
      <Title level={5} style={{ color: '#f5f5f5' }}>Visual Diff Mode</Title>
      <Segmented
        block
        options={['Overlay Slider', 'Color Delta Map', 'Side by Side']}
        value={diffMode}
        onChange={setDiffMode}
        style={{ marginBottom: '20px', background: '#0f1015' }}
      />

      <LayerHeaderActions
        onSelectAll={() => setSelectedLayers(ALL_PCB_LAYERS.map((l) => l.value))}
        onClear={() => setSelectedLayers([])}
      />

      <Input
        placeholder="Search layers..."
        value={layerFilter}
        onChange={(e) => setLayerFilter(e.target.value)}
        style={{ marginBottom: '10px', background: '#0f1015', borderColor: '#232738' }}
        size="small"
      />

      <LayerListContainer
        selectedLayers={selectedLayers}
        setSelectedLayers={setSelectedLayers}
        filteredLayers={filteredLayers}
        soloLayer={soloLayer}
        layerOpacities={layerOpacities}
        onDoubleClick={handleLayerDoubleClick}
        onOpacityChange={(layerVal, v) => setLayerOpacities((prev) => ({ ...prev, [layerVal]: v / 100 }))}
      />
    </div>
  );
}
