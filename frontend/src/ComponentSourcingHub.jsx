import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Input,
  Button,
  Table,
  Tag,
  Space,
  Badge,
  message,
  Divider,
  Alert
} from 'antd';
import {
  SearchOutlined,
  DollarCircleOutlined,
  SwapOutlined,
  CheckCircleFilled,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  ShopOutlined
} from '@ant-design/icons';
import { API_BASE_URL } from './config.js';

const { Text, Title, Paragraph } = Typography;

export default function ComponentSourcingHub({
  activeCircuit,
  onSubstituteComponent
}) {
  const [searchQuery, setSearchQuery] = useState('AMS1117-3.3');
  const [loading, setLoading] = useState(false);
  const [alternatives, setAlternatives] = useState([]);
  const [selectedPart, setSelectedPart] = useState('AMS1117-3.3');

  useEffect(() => {
    fetchAlternatives(searchQuery);
  }, []);

  const fetchAlternatives = async (part) => {
    if (!part || !part.trim()) return;
    setLoading(true);
    setSelectedPart(part);
    try {
      const res = await fetch(`${API_BASE_URL}/api/components/alternatives?part=${encodeURIComponent(part)}`);
      if (res.ok) {
        const data = await res.json();
        setAlternatives(data.alternatives || []);
      } else {
        message.error('Failed to fetch alternatives');
      }
    } catch (err) {
      console.error('Sourcing error:', err);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: 'Alternative Part Number',
      dataIndex: 'partNumber',
      key: 'partNumber',
      render: (text, record) => (
        <div>
          <Text strong style={{ color: '#fff' }}>{text}</Text>
          <div style={{ fontSize: '11px', color: '#6b6375' }}>{record.manufacturer}</div>
        </div>
      )
    },
    {
      title: 'Package',
      dataIndex: 'package',
      key: 'package',
      render: (text) => <Tag color="blue">{text || 'SMD'}</Tag>
    },
    {
      title: 'Live Stock (LCSC / JLCPCB)',
      dataIndex: 'stock',
      key: 'stock',
      render: (stock) => (
        <Space>
          <Badge status={stock > 1000 ? 'success' : 'warning'} />
          <Text style={{ color: '#a6adbb' }}>{(stock || 0).toLocaleString()} pcs</Text>
        </Space>
      )
    },
    {
      title: 'Unit Price',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      render: (price) => <Text strong style={{ color: '#faad14' }}>${(price || 0.05).toFixed(3)}</Text>
    },
    {
      title: 'JLCPCB SMT Category',
      dataIndex: 'jlcpcbBasic',
      key: 'jlcpcbBasic',
      render: (isBasic) => isBasic ? (
        <Tag color="green">Basic Part ($0 Feeder Fee)</Tag>
      ) : (
        <Tag color="default">Extended Library</Tag>
      )
    },
    {
      title: 'Compatibility & Savings',
      dataIndex: 'savings',
      key: 'savings',
      render: (savings, record) => (
        <div>
          <Text style={{ color: '#52c41a', fontSize: '11px' }}>{savings}</Text>
          {record.dropInCompatible && (
            <div style={{ marginTop: '2px' }}>
              <Tag color="gold" style={{ fontSize: '10px', lineHeight: '14px', padding: '0 4px' }}>Drop-in Pinout</Tag>
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Action',
      key: 'action',
      render: (_, record) => (
        <Button
          size="small"
          type="primary"
          icon={<SwapOutlined />}
          style={{ background: '#fadb14', borderColor: '#fadb14', color: '#000' }}
          onClick={() => {
            if (onSubstituteComponent) {
              onSubstituteComponent(selectedPart, record);
              message.success(`Substituted ${selectedPart} with ${record.partNumber}!`);
            } else {
              message.info(`Selected ${record.partNumber} as primary alternative.`);
            }
          }}
        >
          Substitute
        </Button>
      )
    }
  ];

  const circuitComponents = activeCircuit?.components || [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '16px', gap: '16px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        background: '#161821',
        border: '1px solid #232738',
        borderRadius: '8px',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <Space align="center" size="small">
            <ShopOutlined style={{ color: '#fadb14', fontSize: '20px' }} />
            <Title level={4} style={{ margin: 0, color: '#fff' }}>Component Sourcing & Alternative Hub</Title>
            <Tag color="gold">Real-Time Web Scraper</Tag>
          </Space>
          <div style={{ fontSize: '12px', color: '#6b6375', marginTop: '4px' }}>
            Autonomously discovers pin-compatible replacements, JLCPCB Basic SMT parts, and distributor stock.
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ display: 'flex', gap: '8px', width: '380px' }}>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={() => fetchAlternatives(searchQuery)}
            placeholder="Search part e.g. TPS54302, AMS1117..."
            prefix={<SearchOutlined style={{ color: '#6b6375' }} />}
            style={{ background: '#0e1017', borderColor: '#232738', color: '#fff' }}
          />
          <Button
            type="primary"
            loading={loading}
            onClick={() => fetchAlternatives(searchQuery)}
            style={{ background: '#fadb14', borderColor: '#fadb14', color: '#000', fontWeight: 600 }}
          >
            Search
          </Button>
        </div>
      </div>

      {/* Main Grid: Active Circuit BOM Quick-Pills + Alternatives Table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
        {/* Quick Component Selection from Active Circuit */}
        {circuitComponents.length > 0 && (
          <Card
            size="small"
            style={{ background: '#161821', borderColor: '#232738' }}
            title={<Text strong style={{ color: '#a6adbb', fontSize: '12px' }}>Components in Active Circuit ({activeCircuit.title})</Text>}
          >
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {circuitComponents.map((comp) => {
                const partName = comp.value || comp.name;
                const isSelected = selectedPart === partName;
                return (
                  <Button
                    key={comp.id || comp.refDes}
                    size="small"
                    type={isSelected ? 'primary' : 'default'}
                    onClick={() => {
                      setSearchQuery(partName);
                      fetchAlternatives(partName);
                    }}
                    style={{
                      background: isSelected ? '#fadb14' : '#0e1017',
                      color: isSelected ? '#000' : '#a6adbb',
                      borderColor: '#232738',
                      fontSize: '11px'
                    }}
                  >
                    <strong>{comp.refDes}</strong>: {partName}
                  </Button>
                );
              })}
            </div>
          </Card>
        )}

        {/* Alternatives Table */}
        <div style={{ flex: 1, background: '#161821', border: '1px solid #232738', borderRadius: '8px', padding: '16px', overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <Title level={5} style={{ margin: 0, color: '#fff' }}>
              Available Alternatives for <span style={{ color: '#fadb14' }}>{selectedPart}</span>
            </Title>
            <Tag color="cyan">
              {alternatives.length} verified alternatives found
            </Tag>
          </div>

          <Table
            dataSource={alternatives.map((alt, i) => ({ ...alt, key: alt.partNumber || i }))}
            columns={columns}
            pagination={false}
            loading={loading}
            size="middle"
            style={{ background: '#161821' }}
          />
        </div>
      </div>
    </div>
  );
}
