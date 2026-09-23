import React from 'react';

export const AuditSidebar = ({ 
  modifications = [], 
  onSelectDiff, 
  activeDiffIdx,
  onHoverDiff,
  onCollapse,
  onClearFocus
}) => {
  const getActionBadge = (action) => {
    switch (action) {
      case 'CHANGED':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'ADDED':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'DELETED':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
    }
  };

  const getActionBadgeStyle = (action) => {
    switch (action) {
      case 'CHANGED':
        return { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', borderColor: 'rgba(245, 158, 11, 0.3)' };
      case 'ADDED':
        return { backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' };
      case 'DELETED':
        return { backgroundColor: 'rgba(244, 63, 94, 0.15)', color: '#fb7185', borderColor: 'rgba(244, 63, 94, 0.3)' };
      default:
        return { backgroundColor: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8', borderColor: 'rgba(100, 116, 139, 0.3)' };
    }
  };

  return (
    <aside className="w-84 bg-slate-900/95 border-l border-slate-800 flex flex-col h-full select-none audit-sidebar"
      style={{
        width: '320px',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderLeft: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        userSelect: 'none'
      }}
    >
      {/* Header */}
      <div 
        className="p-4 border-b border-slate-800 flex items-center justify-between"
        style={{
          padding: '16px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div className="flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span 
            className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#34d399',
              boxShadow: '0 0 8px #34d399'
            }} 
          />
          <h3 
            className="text-xs font-semibold uppercase tracking-wider text-slate-200"
            style={{
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#e2e8f0',
              margin: 0
            }}
          >
            Audit Modifications
          </h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeDiffIdx !== null && activeDiffIdx !== undefined && onClearFocus && (
            <button
              onClick={onClearFocus}
              title="Clear active focus and restore full view"
              style={{
                background: 'rgba(250, 219, 20, 0.15)',
                border: '1px solid #fadb14',
                color: '#fadb14',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >
              ✕ Exit Focus
            </button>
          )}
          <span 
            className="text-xs font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full"
            style={{
              fontSize: '12px',
              fontFamily: 'monospace',
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              padding: '2px 8px',
              borderRadius: '9999px'
            }}
          >
            {modifications.length}
          </span>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Hide Audit Panel"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: '4px',
                transition: 'color 0.15s, background 0.15s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fadb14'; e.currentTarget.style.background = 'rgba(250, 219, 20, 0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Modifications List */}
      <div 
        className="flex-1 overflow-y-auto p-3 space-y-2.5"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        {modifications.length === 0 ? (
          <div 
            className="text-center text-xs text-slate-500 py-8"
            style={{
              textAlign: 'center',
              fontSize: '12px',
              color: '#64748b',
              padding: '32px 0'
            }}
          >
            No semantic modifications detected between revisions.
          </div>
        ) : (
          modifications.map((item) => {
            const isSelected = activeDiffIdx === item.diffIdx;
            const badgeClass = getActionBadge(item.action);
            const badgeStyle = getActionBadgeStyle(item.action);

            return (
              <div
                key={item.diffIdx ?? Math.random()}
                onClick={() => onSelectDiff && onSelectDiff(item)}
                onMouseEnter={() => onHoverDiff && onHoverDiff(item.diffIdx)}
                onMouseLeave={() => onHoverDiff && onHoverDiff(null)}
                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800 border-indigo-500 shadow-md ring-1 ring-indigo-500/50'
                    : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'
                }`}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: isSelected ? '1px solid #6366f1' : '1px solid rgba(51, 65, 85, 0.5)',
                  backgroundColor: isSelected ? '#1e293b' : 'rgba(30, 41, 59, 0.5)',
                  boxShadow: isSelected ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(99, 102, 241, 0.5)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out'
                }}
              >
                {/* Header: Action Badge & Layer */}
                <div 
                  className="flex items-center justify-between gap-2 mb-1.5"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    marginBottom: '6px'
                  }}
                >
                  <span 
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${badgeClass}`}
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      ...badgeStyle
                    }}
                  >
                    {item.action}
                  </span>
                  <span 
                    className="text-[10px] font-mono text-slate-400 truncate max-w-[120px]"
                    style={{
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      color: '#94a3b8',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '120px'
                    }}
                  >
                    {item.layer}
                  </span>
                </div>

                {/* Primary Semantic Phrase */}
                <div
                  className="text-xs font-semibold text-slate-100 capitalize"
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#f1f5f9',
                    textTransform: 'capitalize'
                  }}
                >
                  {item.title || `${item.action.toLowerCase()} ${item.name}`}
                </div>

                {/* Connection / Displacement Context */}
                {item.detail && (
                  <div
                    className="text-[11px] text-slate-400 mt-1 leading-relaxed"
                    style={{
                      fontSize: '11px',
                      color: '#94a3b8',
                      marginTop: '4px',
                      lineHeight: '1.5'
                    }}
                  >
                    {item.detail}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default AuditSidebar;
