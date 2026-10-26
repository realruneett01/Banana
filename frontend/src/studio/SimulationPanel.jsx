import React from 'react';
import { Alert, Button, Empty, Space, Tag, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

const { Text } = Typography;

export default function SimulationPanel({ state, simulation, onRun, busy }) {
  const tests = state?.tests ?? [];
  return (
    <Space direction="vertical" style={{ width: '100%' }} data-testid="simulation-panel">
      <Button icon={<ThunderboltOutlined />} onClick={onRun} disabled={!tests.length} loading={busy === 'Simulating'} data-testid="run-simulation">
        Run simulation tests
      </Button>
      {!tests.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tests yet. Tell the assistant what the circuit must do (for example 'the output must be 3.3 V ±3%') and it will add one." />}
      {tests.length > 0 && !simulation && (
        <Text type="secondary">
          {tests.length} test{tests.length === 1 ? '' : 's'}: {tests.join(', ')}
        </Text>
      )}
      {simulation && (
        <>
          <Alert type={simulation.passed ? 'success' : 'error'} showIcon message={simulation.passed ? 'All simulation tests pass' : 'A simulation test failed'} data-testid="simulation-summary" />
          {simulation.results.map((r) => (
            <div key={r.name} style={{ border: '1px solid #232738', borderRadius: 6, padding: 8 }} data-testid={`sim-${r.name}`}>
              <Space>
                <Tag color={r.passed ? 'green' : 'red'}>{r.passed ? 'pass' : 'fail'}</Tag>
                <Text strong>{r.name}</Text>
              </Space>
              {r.error && (
                <Text type="danger" style={{ display: 'block', fontSize: 12 }}>
                  {r.error}
                </Text>
              )}
              {r.measures?.map((m, i) => (
                <Text key={i} style={{ display: 'block', fontSize: 12, color: m.pass ? '#86efac' : '#fca5a5' }}>
                  {m.measure}
                  {m.stat ? ` (${m.stat})` : ''}: {m.value === null ? 'no value' : Number(m.value).toPrecision(4)}
                  {m.expected ? ` · expected ${m.expected}` : ''}
                </Text>
              ))}
            </div>
          ))}
        </>
      )}
    </Space>
  );
}
