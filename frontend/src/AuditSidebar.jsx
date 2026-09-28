import React, { useRef, useEffect } from 'react';
import { getCleanLayerName } from './utils/auditLogUtils.js';

const ACTION_CONFIG = Object.freeze({
  CHANGED: {
    bg: 'rgba(245, 158, 11, 0.18)',
    border: 'rgba(245, 158, 11, 0.45)',
    color: '#fbbf24',
    label: 'CHANGED'
  },
  ADDED: {
    bg: 'rgba(16, 185, 129, 0.18)',
    border: 'rgba(16, 185, 129, 0.45)',
    color: '#34d399',
    label: 'ADDED'
  },
  DELETED: {
    bg: 'rgba(244, 63, 94, 0.18)',
    border: 'rgba(244, 63, 94, 0.45)',
    color: '#fb7185',
    label: 'DELETED'
  },
  DEFAULT: {
    bg: 'rgba(148, 163, 184, 0.18)',
    border: 'rgba(148, 163, 184, 0.35)',
    color: '#cbd5e1',
    label: 'MODIFIED'
  }
});

function ActionBadge({ action }) {
  const normAction = (action || '').toUpperCase();
  const conf = ACTION_CONFIG[normAction] ?? ACTION_CONFIG.DEFAULT;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.06em',
      padding: '2px 7px',
      borderRadius: '4px',
      background: conf.bg,
      border: `1px solid ${conf.border}`,
      color: conf.color,
      textTransform: 'uppercase',
      userSelect: 'none',
      lineHeight: '1.2'
    }}>
      {conf.label}
    </span>
  );
}

function cleanDisplayTitle(item) {
  let raw = item.title || item.name || '';
  // Strip redundant leading action words since ActionBadge clearly shows it
  raw = raw.replace(/^(changed|added|deleted|modified)\s+/i, '');
  return raw || 'Modification';
}

function ModificationCard({ item, idx, isSelected, onSelect, onHover }) {
  const cardRef = useRef(null);
  const [hovered, setHovered] = React.useState(false);

  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [isSelected]);

  const cleanLayer = getCleanLayerName(item.layer || item.time || '');
  const title = cleanDisplayTitle(item);
  const coords = item.targetCoords || item.baseCoords;

  return (
    <div
      ref={cardRef}
      onClick={() => onSelect?.(item, idx)}
      onMouseEnter={() => {
        setHovered(true);
        onHover?.(item.diffIdx ?? idx);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHover?.(null);
      }}
      style={{
        padding: '10px 12px',
        borderRadius: '6px',
        border: isSelected
          ? '1px solid #fadb14'
          : (hovered ? '1px solid #3b4468' : '1px solid #23283e'),
        background: isSelected
          ? 'linear-gradient(135deg, rgba(250, 219, 20, 0.16) 0%, rgba(24, 29, 46, 0.98) 100%)'
          : (hovered ? '#1c2238' : 'rgba(22, 26, 42, 0.8)'),
        boxShadow: isSelected
          ? '0 0 14px rgba(250, 219, 20, 0.35), inset 0 0 8px rgba(250, 219, 20, 0.1)'
          : (hovered ? '0 4px 10px rgba(0, 0, 0, 0.4)' : '0 2px 6px rgba(0, 0, 0, 0.25)'),
        cursor: 'pointer',
        transition: 'all 0.18s ease-in-out',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        position: 'relative'
      }}
    >
      {/* Top Row: Action Badge + Layer Chip + Focused Indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ActionBadge action={item.action || item.type} />
          {cleanLayer && cleanLayer !== 'Unknown' && (
            <span style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              padding: '1px 6px',
              borderRadius: '4px',
              background: '#181d2f',
              border: '1px solid #28304c',
              color: '#94a3b8',
              letterSpacing: '0.02em'
            }}>
              {cleanLayer}
            </span>
          )}
        </div>

        {isSelected ? (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '9px',
            fontWeight: 800,
            letterSpacing: '0.05em',
            padding: '2px 6px',
            borderRadius: '4px',
            background: '#fadb14',
            color: '#0f1015'
          }}>
            <span style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: '#0f1015',
              display: 'inline-block'
            }} />
            FOCUSED
          </span>
        ) : (
          <span style={{
            fontSize: '10px',
            color: hovered ? '#fadb14' : '#64748b',
            transition: 'color 0.15s'
          }}>
            #{idx + 1}
          </span>
        )}
      </div>

      {/* Middle Row: Semantic Title */}
      <div style={{
        fontSize: '12px',
        fontWeight: 600,
        color: isSelected ? '#ffffff' : '#f1f5f9',
        letterSpacing: '0.01em',
        wordBreak: 'break-word',
        lineHeight: '1.35'
      }}>
        {title}
      </div>

      {/* Bottom Row: Detail / Physical Delta Description */}
      {item.detail && (
        <div style={{
          fontSize: '11px',
          color: isSelected ? '#cbd5e1' : '#94a3b8',
          lineHeight: '1.45',
          wordBreak: 'break-word'
        }}>
          {item.detail}
        </div>
      )}

      {/* Optional Coordinates Footer */}
      {coords && (
        <div style={{
          fontSize: '10px',
          fontFamily: 'monospace',
          color: '#64748b',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          marginTop: '2px'
        }}>
          <span>📍</span>
          <span>({coords.x.toFixed(2)}, {coords.y.toFixed(2)}) mm</span>
        </div>
      )}
    </div>
  );
}

function SidebarHeader({ count, onCollapse }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: '1px solid #1e2438',
      background: '#121520',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#10b981',
          boxShadow: '0 0 8px #10b981',
          display: 'inline-block'
        }} />
        <h3 style={{
          margin: 0,
          fontSize: '12px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: '#e2e8f0'
        }}>
          Audit Modifications
        </h3>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          fontSize: '11px',
          fontFamily: 'monospace',
          background: '#1a1f33',
          border: '1px solid #283250',
          color: '#94a3b8',
          padding: '2px 8px',
          borderRadius: '12px'
        }}>
          {count} {count === 1 ? 'change' : 'changes'}
        </span>

        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse audit sidebar"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s, background 0.15s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#fadb14';
              e.currentTarget.style.background = 'rgba(250, 219, 20, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#94a3b8';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function FocusController({ modifications, activeDiffIdx, onSelectDiff, onClearFocus }) {
  const focusedIndex = modifications.findIndex((m, i) =>
    activeDiffIdx !== null && activeDiffIdx !== undefined && (
      activeDiffIdx === m.diffIdx ||
      activeDiffIdx === i ||
      (m.diffIdx !== undefined && String(activeDiffIdx) === String(m.diffIdx))
    )
  );

  const isAnyFocused = focusedIndex !== -1;

  const handlePrev = (e) => {
    e.stopPropagation();
    if (modifications.length === 0) return;
    const prevIdx = focusedIndex <= 0 ? modifications.length - 1 : focusedIndex - 1;
    const targetItem = modifications[prevIdx];
    onSelectDiff?.(targetItem, targetItem.diffIdx ?? prevIdx);
  };

  const handleNext = (e) => {
    e.stopPropagation();
    if (modifications.length === 0) return;
    const nextIdx = (focusedIndex < 0 || focusedIndex >= modifications.length - 1) ? 0 : focusedIndex + 1;
    const targetItem = modifications[nextIdx];
    onSelectDiff?.(targetItem, targetItem.diffIdx ?? nextIdx);
  };

  if (modifications.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      background: isAnyFocused ? 'rgba(250, 219, 20, 0.08)' : '#141724',
      borderBottom: '1px solid #1e2438',
      fontSize: '11px',
      flexShrink: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {isAnyFocused ? (
          <>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#fadb14',
              boxShadow: '0 0 6px #fadb14',
              display: 'inline-block'
            }} />
            <span style={{ color: '#fadb14', fontWeight: 600 }}>
              Focus: {focusedIndex + 1} of {modifications.length}
            </span>
          </>
        ) : (
          <span style={{ color: '#94a3b8' }}>
            Click an item to zoom & focus on PCB
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button
          onClick={handlePrev}
          title="Previous modification (←)"
          style={{
            background: '#1a1f33',
            border: '1px solid #283250',
            color: '#cbd5e1',
            borderRadius: '4px',
            padding: '2px 7px',
            fontSize: '11px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: '1.2'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fadb14'; e.currentTarget.style.borderColor = '#fadb14'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.borderColor = '#283250'; }}
        >
          ◀
        </button>

        <button
          onClick={handleNext}
          title="Next modification (→)"
          style={{
            background: '#1a1f33',
            border: '1px solid #283250',
            color: '#cbd5e1',
            borderRadius: '4px',
            padding: '2px 7px',
            fontSize: '11px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: '1.2'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fadb14'; e.currentTarget.style.borderColor = '#fadb14'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.borderColor = '#283250'; }}
        >
          ▶
        </button>

        {isAnyFocused && onClearFocus && (
          <button
            onClick={onClearFocus}
            title="Exit focus mode and restore full view (Esc)"
            style={{
              background: 'rgba(250, 219, 20, 0.15)',
              border: '1px solid #fadb14',
              color: '#fadb14',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              marginLeft: '4px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(250, 219, 20, 0.28)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(250, 219, 20, 0.15)'; }}
          >
            ✕ Exit Focus
          </button>
        )}
      </div>
    </div>
  );
}

export const AuditSidebar = ({
  modifications = [],
  onSelectDiff,
  activeDiffIdx,
  onHoverDiff,
  onCollapse,
  onClearFocus
}) => {
  const focusedIndex = modifications.findIndex((m, i) =>
    activeDiffIdx !== null && activeDiffIdx !== undefined && (
      activeDiffIdx === m.diffIdx ||
      activeDiffIdx === i ||
      (m.diffIdx !== undefined && String(activeDiffIdx) === String(m.diffIdx))
    )
  );

  return (
    <aside style={{
      width: '100%',
      height: '100%',
      background: '#0f121d',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
      overflow: 'hidden'
    }}>
      <SidebarHeader
        count={modifications.length}
        onCollapse={onCollapse}
      />

      <FocusController
        modifications={modifications}
        activeDiffIdx={activeDiffIdx}
        onSelectDiff={onSelectDiff}
        onClearFocus={onClearFocus}
      />

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        {modifications.length === 0 ? (
          <div style={{
            textAlign: 'center',
            fontSize: '12px',
            color: '#64748b',
            padding: '32px 16px',
            lineHeight: '1.6'
          }}>
            No semantic modifications detected between these revisions.
          </div>
        ) : (
          modifications.map((item, idx) => (
            <ModificationCard
              key={item.diffIdx ?? idx}
              item={item}
              idx={idx}
              isSelected={focusedIndex === idx}
              onSelect={onSelectDiff}
              onHover={onHoverDiff}
            />
          ))
        )}
      </div>
    </aside>
  );
};

export default AuditSidebar;
