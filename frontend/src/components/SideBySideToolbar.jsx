import React from 'react';
import { Typography, Switch } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { DIFF_CONFIG } from '../sideBySideStyles.js';

const { Text } = Typography;

export function SideBySideToolbar({
  synced,
  setSynced,
  selectedTraceWidth,
  setSelectedTraceWidth,
  activeAuditIdx,
  onReset
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 14px', background: '#0e0f18',
      borderBottom: '1px solid #232738', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <SwapOutlined style={{ color: '#fadb14' }} />
        <Text style={{ color: '#a6adbb', fontSize: '12px' }}>
          Scroll to zoom · Drag to pan {synced ? '(Linked Views)' : '(Independent Views)'}
        </Text>
        <span style={{ color: synced ? '#faad14' : '#6b7280', fontSize: '11px', fontWeight: 600, marginLeft: '12px', userSelect: 'none' }}>
          Sync Views
        </span>
        <Switch
          size="small"
          checked={synced}
          onChange={setSynced}
          style={{ background: synced ? '#faad14' : '#3f3f46' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{
          background: '#161823', border: '1px solid #2e334d', color: '#94a3b8',
          fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace',
          display: 'inline-flex', alignItems: 'center', gap: '6px'
        }}>
          <span style={{ color: '#fadb14', fontWeight: 600 }}>Trace:</span>
          <select
            value={selectedTraceWidth}
            onChange={(e) => setSelectedTraceWidth(e.target.value)}
            style={{
              background: 'transparent', border: 'none', color: '#f1f5f9',
              fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer', outline: 'none',
            }}
          >
            {DIFF_CONFIG.TRACE_WIDTH_PRESETS.map((p) => (
              <option key={p.value} value={p.value} style={{ background: '#1e2030', color: '#e2e8f0' }}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {activeAuditIdx !== null && (
          <button
            onClick={onReset}
            style={{
              background: 'rgba(250, 219, 20, 0.15)', border: '1px solid #fadb14', color: '#fadb14',
              borderRadius: 4, padding: '2px 10px', fontSize: '11px', fontWeight: 600,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}
            title="Exit focused modification and restore full view (Esc)"
          >
            ✕ Exit Focus (Esc)
          </button>
        )}

        <button
          onClick={onReset}
          style={{
            background: 'transparent', border: '1px solid #333', color: '#fadb14',
            borderRadius: 4, padding: '2px 10px', fontSize: '11px', cursor: 'pointer',
          }}
        >
          Reset View
        </button>
      </div>
    </div>
  );
}
