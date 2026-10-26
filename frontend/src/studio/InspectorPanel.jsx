import React, { useEffect, useState } from 'react';
import { AutoComplete, Button, Empty, Input, InputNumber, Popconfirm, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, RotateRightOutlined } from '@ant-design/icons';

const { Text } = Typography;

function PinRow({ pin, net, nets, onConnect, disabled }) {
  const [draft, setDraft] = useState(net || '');
  useEffect(() => setDraft(net || ''), [net]);
  const commit = () => {
    const next = draft.trim();
    if (next === (net || '')) return;
    onConnect(pin, next);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-testid={`pin-row-${pin}`}>
      <Text style={{ width: 70, fontFamily: 'monospace', fontSize: 12 }}>{pin}</Text>
      <AutoComplete
        size="small"
        style={{ flex: 1 }}
        disabled={disabled}
        value={draft}
        onChange={setDraft}
        onSelect={(v) => {
          setDraft(v);
          if (v !== (net || '')) onConnect(pin, v);
        }}
        onBlur={commit}
        options={nets.map((n) => ({ value: n }))}
        placeholder="unconnected"
        data-testid={`pin-net-${pin}`}
        filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
      />
    </div>
  );
}

export default function InspectorPanel({ state, selected, onEdit, onDelete, disabled }) {
  const part = state?.parts?.find((p) => p.ref === selected);
  const [value, setValue] = useState('');
  const [footprint, setFootprint] = useState('');
  useEffect(() => {
    setValue(part?.value ?? '');
    setFootprint(part?.footprint ?? '');
  }, [part?.ref, part?.value, part?.footprint]);

  if (!part) {
    return (
      <Empty
        data-testid="inspector-empty"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Select a part on the board or in the list to edit it."
      />
    );
  }
  const nets = Object.keys(state.nets ?? {});
  const at = part.at ?? { x: 0, y: 0, rot: 0 };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }} data-testid="inspector">
      <Space>
        <Tag color="gold" data-testid="inspector-ref">
          {part.ref}
        </Tag>
        <Text type="secondary">{(part.symbol || '').split(':')[1] || ''}</Text>
      </Space>
      <div>
        <Text type="secondary">Value</Text>
        <Input
          data-testid="inspector-value"
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={() => value !== part.value && onEdit([{ op: 'set_value', ref: part.ref, value }], `Set ${part.ref} value to ${value}`)}
          onBlur={() => value !== part.value && value.trim() && onEdit([{ op: 'set_value', ref: part.ref, value }], `Set ${part.ref} value to ${value}`)}
        />
      </div>
      <div>
        <Text type="secondary">Footprint</Text>
        <Input
          data-testid="inspector-footprint"
          disabled={disabled}
          value={footprint}
          onChange={(e) => setFootprint(e.target.value)}
          onPressEnter={() => footprint !== part.footprint && onEdit([{ op: 'set_footprint', ref: part.ref, footprint }], `Set ${part.ref} footprint`)}
        />
      </div>
      <div>
        <Text type="secondary">Position (mm) and rotation</Text>
        <Space wrap>
          <InputNumber
            key={`x-${part.ref}-${at.x}`}
            size="small"
            addonBefore="X"
            step={0.5}
            defaultValue={at.x}
            disabled={disabled || !part.placed}
            data-testid="inspector-x"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== at.x) onEdit([{ op: 'place', ref: part.ref, x: v, y: at.y, rot: at.rot || 0 }], `Move ${part.ref}`, { reroute: true });
            }}
          />
          <InputNumber
            key={`y-${part.ref}-${at.y}`}
            size="small"
            addonBefore="Y"
            step={0.5}
            defaultValue={at.y}
            disabled={disabled || !part.placed}
            data-testid="inspector-y"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== at.y) onEdit([{ op: 'place', ref: part.ref, x: at.x, y: v, rot: at.rot || 0 }], `Move ${part.ref}`, { reroute: true });
            }}
          />
          <Button
            size="small"
            icon={<RotateRightOutlined />}
            disabled={disabled || !part.placed}
            data-testid="inspector-rotate"
            onClick={() => onEdit([{ op: 'place', ref: part.ref, x: at.x, y: at.y, rot: ((at.rot || 0) + 90) % 360 }], `Rotate ${part.ref}`, { reroute: true })}
          >
            {at.rot || 0}°
          </Button>
        </Space>
        {!part.placed && (
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            Auto-placed. Drag it on the board, or route the board, to fix its position.
          </Text>
        )}
      </div>
      <div>
        <Text type="secondary">Pins and nets</Text>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {part.pads.map((pad) => (
            <PinRow
              key={pad.pin}
              pin={pad.pin}
              net={pad.net}
              nets={nets}
              disabled={disabled}
              onConnect={(pin, net) =>
                onEdit(
                  net ? [{ op: 'connect', net, pins: [pin], move: true }] : [{ op: 'disconnect', pins: [pin] }],
                  net ? `Connect ${pin} to ${net}` : `Disconnect ${pin}`,
                  { reroute: (state.routing?.tracks ?? 0) > 0 },
                )
              }
            />
          ))}
        </Space>
      </div>
      <Popconfirm title={`Remove ${part.ref}?`} okText="Remove" onConfirm={() => onDelete(part.ref)} disabled={disabled}>
        <Button danger icon={<DeleteOutlined />} disabled={disabled} data-testid="inspector-delete">
          Remove part
        </Button>
      </Popconfirm>
    </Space>
  );
}
