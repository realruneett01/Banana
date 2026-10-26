import React from 'react';
import { Alert, Button, Collapse, Empty, Space, Tag, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, SafetyCertificateOutlined } from '@ant-design/icons';

const { Text } = Typography;

const sev = (s) => (s === 'error' ? <CloseCircleFilled style={{ color: '#f87171' }} /> : <ExclamationCircleFilled style={{ color: '#facc15' }} />);

function Section({ title, status, issues }) {
  const label = status === 'ok' || (!status && !issues.length) ? 'pass' : status === 'unavailable' ? 'unavailable' : `${issues.length || 1} to look at`;
  return {
    key: title,
    label: (
      <Space>
        {issues.length === 0 && status !== 'unavailable' && status !== 'error' && status !== 'mismatch' ? (
          <CheckCircleFilled style={{ color: '#4ade80' }} />
        ) : status === 'unavailable' ? (
          <ExclamationCircleFilled style={{ color: '#94a3b8' }} />
        ) : (
          <CloseCircleFilled style={{ color: '#f87171' }} />
        )}
        <Text>{title}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {label}
        </Text>
      </Space>
    ),
    children: issues.length ? (
      <Space direction="vertical" size={4}>
        {issues.slice(0, 40).map((i, n) => (
          <Space key={n} align="start" size={6}>
            {sev(i.severity)}
            <Text style={{ fontSize: 12 }}>{i.message}</Text>
          </Space>
        ))}
      </Space>
    ) : (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {status === 'unavailable' ? 'Not available with this KiCad version.' : 'Nothing to report.'}
      </Text>
    ),
  };
}

export default function ChecksPanel({ checks, onRun, busy }) {
  const mismatch = checks?.netlistParity?.mismatches?.map((m) => ({ severity: 'error', message: `Net ${m.net}: design has ${m.expected.join(', ')}, KiCad has ${m.kicad.join(', ') || 'nothing'}` })) ?? [];
  const items = checks
    ? [
        Section({ title: 'Electrical rules (ERC)', status: checks.erc.kicad.status === 'unavailable' ? undefined : checks.erc.kicad.status, issues: [...checks.erc.lite, ...checks.erc.kicad.issues] }),
        Section({ title: 'Netlist matches KiCad', status: checks.netlistParity.status, issues: mismatch }),
        Section({ title: 'Placement', issues: checks.placement }),
        Section({ title: 'Copper clearance', issues: checks.copper }),
        Section({
          title: 'Routing',
          issues: checks.routing.unrouted.map((u) => ({ severity: 'error', message: `Net ${u.net} is not fully routed (${u.islands} separate pieces)` })),
        }),
        Section({ title: 'KiCad DRC', status: checks.drc.status, issues: checks.drc.issues }),
      ]
    : [];
  return (
    <Space direction="vertical" style={{ width: '100%' }} data-testid="checks-panel">
      <Button icon={<SafetyCertificateOutlined />} onClick={onRun} loading={busy === 'Running checks'} data-testid="run-checks">
        Run all checks
      </Button>
      {!checks && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run the checks to see ERC, DRC, clearance and routing in one place." />}
      {checks && (
        <>
          <Alert
            data-testid="checks-summary"
            type={checks.ok ? 'success' : 'error'}
            showIcon
            message={checks.ok ? 'Clean: no errors, every net routed' : `${checks.errors} error${checks.errors === 1 ? '' : 's'}, ${checks.warnings} warning${checks.warnings === 1 ? '' : 's'}`}
            description={checks.note}
          />
          <Collapse size="small" items={items} />
          <Tag color="default" style={{ alignSelf: 'flex-start' }}>
            DRC engine: {checks.drc.engine}
          </Tag>
        </>
      )}
    </Space>
  );
}
