import React from 'react';
import { MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons';

export function EdgeCollapseTabs({ leftCollapsed, setLeftCollapsed, rightCollapsed, setRightCollapsed }) {
  return (
    <>
      {leftCollapsed && (
        <div
          onClick={() => setLeftCollapsed(false)}
          title="Show Controls Panel"
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 200,
            background: '#161821',
            border: '1px solid #fadb14',
            borderLeft: 'none',
            borderRadius: '0 6px 6px 0',
            padding: '10px 5px',
            cursor: 'pointer',
            boxShadow: '2px 0 10px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            color: '#fadb14'
          }}
        >
          <MenuUnfoldOutlined style={{ fontSize: '14px' }} />
          <span style={{ writingMode: 'vertical-rl', fontSize: '10px', letterSpacing: '1px', fontWeight: 700 }}>CONTROLS</span>
        </div>
      )}

      {rightCollapsed && (
        <div
          onClick={() => setRightCollapsed(false)}
          title="Show Audit Modifications Panel"
          style={{
            position: 'absolute',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 200,
            background: '#161821',
            border: '1px solid #fadb14',
            borderRight: 'none',
            borderRadius: '6px 0 0 6px',
            padding: '10px 5px',
            cursor: 'pointer',
            boxShadow: '-2px 0 10px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            color: '#fadb14'
          }}
        >
          <MenuFoldOutlined style={{ fontSize: '14px' }} />
          <span style={{ writingMode: 'vertical-rl', fontSize: '10px', letterSpacing: '1px', fontWeight: 700 }}>AUDIT</span>
        </div>
      )}
    </>
  );
}
