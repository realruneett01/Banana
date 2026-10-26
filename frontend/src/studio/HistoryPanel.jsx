import React from 'react';
import { Button, Empty, List, Space, Tag, Tooltip, Typography } from 'antd';
import { BranchesOutlined, EyeOutlined, SwapOutlined } from '@ant-design/icons';

const { Text } = Typography;

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function HistoryPanel({ history, head, viewing, onView, onCompare, onOpenDiff }) {
  if (!history.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No builds yet" />;
  return (
    <List
      data-testid="history-panel"
      size="small"
      dataSource={history}
      renderItem={(c, i) => {
        const isHead = c.hash === head;
        const isViewing = viewing === c.hash;
        // the oldest entry only holds design.json, so it cannot be a comparison base
        const parent = i + 1 < history.length - 1 ? history[i + 1] : null;
        return (
          <List.Item
            data-testid={`commit-${c.short}`}
            style={{ padding: '6px 8px', background: isViewing ? 'rgba(250, 219, 20, 0.1)' : 'transparent' }}
            actions={[
              <Tooltip title="View the board as it was at this build" key="v">
                <Button size="small" type="text" icon={<EyeOutlined />} data-testid={`view-${c.short}`} onClick={() => onView(isHead ? 'working' : c.hash)} />
              </Tooltip>,
              parent && (
                <Tooltip title="See what this build changed (yellow/green/red)" key="c">
                  <Button size="small" type="text" icon={<SwapOutlined />} data-testid={`compare-${c.short}`} onClick={() => onCompare(parent.hash, c.hash)} />
                </Tooltip>
              ),
              parent && (
                <Tooltip title="Open this comparison in the Diff view" key="d">
                  <Button size="small" type="text" icon={<BranchesOutlined />} data-testid={`opendiff-${c.short}`} onClick={() => onOpenDiff(parent.hash, c.hash)} />
                </Tooltip>
              ),
            ].filter(Boolean)}
          >
            <Space direction="vertical" size={0} style={{ minWidth: 0, flex: 1 }}>
              <Space size={6}>
                <Text code style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {c.short}
                </Text>
                {isHead && <Tag color="green" style={{ margin: 0, whiteSpace: 'nowrap' }}>latest</Tag>}
                {isViewing && !isHead && <Tag color="gold" style={{ margin: 0, whiteSpace: 'nowrap' }}>viewing</Tag>}
              </Space>
              <Text style={{ fontSize: 12 }} ellipsis>
                {c.message}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {when(c.date)}
              </Text>
            </Space>
          </List.Item>
        );
      }}
    />
  );
}
