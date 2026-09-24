import React from 'react';
import { Button, Tooltip, Tag, Segmented } from 'antd';
import {
  StepBackwardOutlined,
  StepForwardOutlined,
  CaretRightOutlined,
  PauseOutlined,
  CloseOutlined,
  BranchesOutlined,
  ArrowRightOutlined
} from '@ant-design/icons';

export default function EvolutionTimeline({
  commits = [],
  activeStep = 0,
  onStepChange,
  isPlaying = false,
  onTogglePlay,
  onClose,
  isLoading = false,
  mode = 'step',
  onModeChange
}) {
  if (!commits || commits.length < 2) return null;

  const totalSteps = commits.length - 1;
  const currentBase = mode === 'cumulative' ? commits[0] : commits[activeStep];
  const currentTarget = commits[activeStep + 1] || commits[commits.length - 1];

  const handlePrev = () => {
    if (activeStep > 0 && onStepChange) {
      onStepChange(activeStep - 1);
    }
  };

  const handleNext = () => {
    if (activeStep < totalSteps - 1 && onStepChange) {
      onStepChange(activeStep + 1);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '16px',
        left: '20px',
        right: '20px',
        zIndex: 40,
        backgroundColor: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        borderRadius: '12px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55), 0 0 16px rgba(59, 130, 246, 0.2)',
        padding: '12px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        userSelect: 'none',
        transition: 'all 0.25s ease-in-out'
      }}
    >
      {/* ─── Top Row: Status, Active Step Info, and Close ─────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <Tag
            color="processing"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '11px',
              letterSpacing: '0.04em',
              background: 'rgba(59, 130, 246, 0.2)',
              borderColor: 'rgba(59, 130, 246, 0.4)',
              color: '#60a5fa',
              margin: 0
            }}
          >
            <BranchesOutlined /> EVOLUTION PATH
          </Tag>

          <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>
            Step <strong style={{ color: '#f8fafc' }}>{activeStep + 1}</strong> of <strong style={{ color: '#f8fafc' }}>{totalSteps}</strong>
          </span>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: '#cbd5e1',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            <span style={{ color: '#f43f5e', fontWeight: 600 }}>{currentBase?.shortHash || currentBase?.hash?.substring(0, 7)}</span>
            <ArrowRightOutlined style={{ fontSize: '10px', color: '#64748b' }} />
            <span style={{ color: '#10b981', fontWeight: 600 }}>{currentTarget?.shortHash || currentTarget?.hash?.substring(0, 7)}</span>
            <span style={{ color: '#64748b' }}>•</span>
            <span
              style={{
                color: '#e2e8f0',
                fontWeight: 500,
                maxWidth: '380px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={currentTarget?.message}
            >
              "{currentTarget?.message}"
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {onModeChange && (
            <Segmented
              size="small"
              value={mode}
              onChange={onModeChange}
              options={[
                { label: 'Step Delta', value: 'step' },
                { label: 'Cumulative', value: 'cumulative' }
              ]}
              style={{
                backgroundColor: 'rgba(30, 41, 59, 0.8)',
                color: '#cbd5e1',
                border: '1px solid rgba(51, 65, 85, 0.6)'
              }}
            />
          )}

          {onClose && (
            <Tooltip title="Exit History Evolution (Return to Direct Snapshot Diff)">
              <button
                onClick={onClose}
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  borderRadius: '6px',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '11px',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; }}
              >
                <CloseOutlined />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ─── Middle Row: Stepper Nodes Track ──────────────────────────────── */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          marginTop: '2px'
        }}
      >
        {/* Continuous background track line */}
        <div
          style={{
            position: 'absolute',
            left: '20px',
            right: '20px',
            top: '50%',
            height: '3px',
            backgroundColor: '#334155',
            zIndex: 1,
            transform: 'translateY(-50%)'
          }}
        />

        {/* Active progress track line */}
        <div
          style={{
            position: 'absolute',
            left: '20px',
            width: `${totalSteps > 0 ? (activeStep / (totalSteps - 1 || 1)) * 95 : 0}%`,
            top: '50%',
            height: '3px',
            background: 'linear-gradient(90deg, #3b82f6, #10b981)',
            zIndex: 2,
            transform: 'translateY(-50%)',
            transition: 'width 0.3s ease-out'
          }}
        />

        {/* Commit Nodes */}
        {commits.map((commit, idx) => {
          const isStepTarget = idx === activeStep + 1;
          const isPast = idx <= activeStep;

          return (
            <Tooltip
              key={commit.hash || idx}
              title={
                <div>
                  <div style={{ fontWeight: 700, color: '#f8fafc', marginBottom: '2px' }}>
                    {idx === 0 ? 'Start: ' : `Commit ${idx}: `}{commit.message}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Hash: <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>{commit.shortHash || commit.hash?.substring(0, 7)}</span>
                  </div>
                  {commit.author && (
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      Author: {commit.author}
                    </div>
                  )}
                  {commit.date && (
                    <div style={{ fontSize: '10px', color: '#64748b' }}>
                      {commit.date}
                    </div>
                  )}
                </div>
              }
            >
              <div
                onClick={() => {
                  if (idx > 0 && onStepChange) {
                    onStepChange(idx - 1);
                  }
                }}
                style={{
                  position: 'relative',
                  zIndex: 3,
                  cursor: idx > 0 ? 'pointer' : 'default',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {/* Node Pill / Circle */}
                <div
                  style={{
                    width: isStepTarget ? '22px' : '16px',
                    height: isStepTarget ? '22px' : '16px',
                    borderRadius: '50%',
                    backgroundColor: isStepTarget
                      ? '#10b981'
                      : (isPast ? '#3b82f6' : '#1e293b'),
                    border: isStepTarget
                      ? '3px solid #f8fafc'
                      : (isPast ? '2px solid #60a5fa' : '2px solid #475569'),
                    boxShadow: isStepTarget
                      ? '0 0 12px #10b981, 0 0 4px #10b981'
                      : (isPast ? '0 0 6px rgba(59, 130, 246, 0.4)' : 'none'),
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {isStepTarget && (
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ffffff' }} />
                  )}
                </div>

                {/* Commit Short Hash Label */}
                <span
                  style={{
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    fontWeight: isStepTarget ? 700 : 500,
                    color: isStepTarget ? '#34d399' : (isPast ? '#93c5fd' : '#64748b'),
                    marginTop: '2px',
                    transition: 'color 0.15s'
                  }}
                >
                  {commit.shortHash || commit.hash?.substring(0, 7)}
                </span>
              </div>
            </Tooltip>
          );
        })}
      </div>

      {/* ─── Bottom Row: Media Transport Player Controls ──────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', paddingTop: '2px' }}>
        <Button
          size="small"
          icon={<StepBackwardOutlined />}
          onClick={handlePrev}
          disabled={activeStep === 0 || isLoading}
          style={{
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            color: activeStep === 0 ? '#475569' : '#e2e8f0',
            borderRadius: '6px'
          }}
        >
          Previous Step
        </Button>

        <Button
          type="primary"
          size="small"
          icon={isPlaying ? <PauseOutlined /> : <CaretRightOutlined />}
          onClick={onTogglePlay}
          loading={isLoading}
          style={{
            backgroundColor: isPlaying ? '#f59e0b' : '#3b82f6',
            borderColor: isPlaying ? '#f59e0b' : '#3b82f6',
            borderRadius: '6px',
            minWidth: '95px',
            fontWeight: 600
          }}
        >
          {isPlaying ? 'Pause' : 'Auto Play'}
        </Button>

        <Button
          size="small"
          icon={<StepForwardOutlined />}
          onClick={handleNext}
          disabled={activeStep >= totalSteps - 1 || isLoading}
          style={{
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            color: activeStep >= totalSteps - 1 ? '#475569' : '#e2e8f0',
            borderRadius: '6px'
          }}
        >
          Next Step
        </Button>
      </div>
    </div>
  );
}
