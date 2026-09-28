import React from 'react';
import { Layout } from 'antd';
import { AuditSidebar } from '../AuditSidebar.jsx';
import { buildSidebarModifications } from '../utils/auditLogUtils.js';

const { Sider } = Layout;

export function WorkspaceAuditSidebar({
  rightCollapsed,
  setRightCollapsed,
  activeDiffData,
  activeAuditIdx,
  onHoverDiff,
  onSelectDiff,
  onClearFocus,
}) {
  return (
    <Sider
      width={340}
      collapsible
      collapsed={rightCollapsed}
      collapsedWidth={0}
      trigger={null}
      style={{
        background: '#0f121d',
        borderLeft: rightCollapsed ? 'none' : '1px solid #1e2438',
        padding: 0,
        overflowY: 'hidden',
        height: 'calc(100vh - 64px)',
        transition: 'all 0.2s',
      }}
    >
      {!rightCollapsed && (
        <AuditSidebar
          modifications={buildSidebarModifications(activeDiffData)}
          activeDiffIdx={activeAuditIdx}
          onHoverDiff={onHoverDiff}
          onSelectDiff={onSelectDiff}
          onClearFocus={onClearFocus}
          onCollapse={() => setRightCollapsed(true)}
        />
      )}
    </Sider>
  );
}
