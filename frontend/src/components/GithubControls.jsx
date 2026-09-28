import React, { useState, useEffect } from 'react';
import {
  Form,
  Select,
  Button,
  Radio,
  Space,
  Typography,
  Tag,
  Alert,
  Spin,
  Timeline,
  Tooltip,
  Card,
  Input,
  message
} from 'antd';
import {
  GithubOutlined,
  BranchesOutlined,
  PullRequestOutlined,
  SyncOutlined,
  LockOutlined,
  GlobalOutlined,
  HistoryOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { API_BASE_URL } from '../config.js';

const { Text, Title } = Typography;

export default function GithubControls({
  githubToken,
  githubUser,
  onOpenAuthModal,
  onFetchDiff,
  loading,
  selectedRepo,
  setSelectedRepo,
  baseCommit,
  setBaseCommit,
  targetCommit,
  setTargetCommit,
  relativeFilePath,
  setRelativeFilePath
}) {
  const [form] = Form.useForm();
  
  // Data states
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  
  const [compareMode, setCompareMode] = useState('pulls'); // 'pulls' | 'branches'
  const [pulls, setPulls] = useState([]);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [selectedPull, setSelectedPull] = useState(null);
  
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [baseBranch, setBaseBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  
  const [baseCommits, setBaseCommits] = useState([]);
  const [targetCommits, setTargetCommits] = useState([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  
  const [hardwareFiles, setHardwareFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  
  const [manualRepoMode, setManualRepoMode] = useState(false);
  const [manualRepoInput, setManualRepoInput] = useState('');

  // 1. Fetch repositories when token is present
  const fetchRepos = async () => {
    if (!githubToken) return;
    setLoadingRepos(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/github/repos`, {
        headers: { 'Authorization': `Bearer ${githubToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repos || []);
        if (data.repos?.length > 0 && !selectedRepo) {
          // Default to first repo if none selected
          setSelectedRepo(data.repos[0]);
        }
      } else {
        const err = await res.json();
        console.warn('Failed to fetch repositories:', err.message);
      }
    } catch (e) {
      console.error('Error fetching repos:', e);
    } finally {
      setLoadingRepos(false);
    }
  };

  useEffect(() => {
    if (githubToken) {
      fetchRepos();
    }
  }, [githubToken]);

  // 2. When selected repo changes, fetch its branches, PRs, and hardware files
  useEffect(() => {
    if (!githubToken || !selectedRepo) return;
    const { owner, name } = selectedRepo;
    if (!owner || !name) return;

    // Fetch branches
    setLoadingBranches(true);
    fetch(`${API_BASE_URL}/api/github/repos/${owner}/${name}/branches`, {
      headers: { 'Authorization': `Bearer ${githubToken}` }
    })
      .then(r => r.json())
      .then(d => {
        const bList = d.branches || [];
        setBranches(bList);
        const def = selectedRepo.defaultBranch || 'main';
        const hasDef = bList.some(b => b.name === def);
        const mainBranch = hasDef ? def : (bList[0]?.name || 'main');
        setBaseBranch(mainBranch);
        setTargetBranch(mainBranch);
      })
      .catch(e => console.warn('Branch fetch failed:', e))
      .finally(() => setLoadingBranches(false));

    // Fetch pull requests
    setLoadingPulls(true);
    fetch(`${API_BASE_URL}/api/github/repos/${owner}/${name}/pulls?state=all`, {
      headers: { 'Authorization': `Bearer ${githubToken}` }
    })
      .then(r => r.json())
      .then(d => {
        const prList = d.pulls || [];
        setPulls(prList);
        if (prList.length > 0) {
          handleSelectPull(prList[0], owner, name);
        } else {
          // If no PRs, switch to branch mode
          setCompareMode('branches');
        }
      })
      .catch(e => console.warn('PR fetch failed:', e))
      .finally(() => setLoadingPulls(false));

    // Fetch hardware files on default branch
    fetchFiles(owner, name, selectedRepo.defaultBranch || 'main');
  }, [selectedRepo, githubToken]);

  // Fetch hardware files (.kicad_pcb / .kicad_sch)
  const fetchFiles = async (owner, repo, ref) => {
    if (!githubToken || !owner || !repo) return;
    setLoadingFiles(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/github/repos/${owner}/${repo}/files?ref=${encodeURIComponent(ref)}`, {
        headers: { 'Authorization': `Bearer ${githubToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        const files = data.files || [];
        setHardwareFiles(files);
        if (files.length > 0) {
          const defaultFile = files.find(f => f.isPcb)?.path || files[0].path;
          setRelativeFilePath(defaultFile);
          form.setFieldValue('relativeFilePath', defaultFile);
        } else {
          setRelativeFilePath('');
          form.setFieldValue('relativeFilePath', '');
        }
      }
    } catch (e) {
      console.warn('Failed to fetch hardware files:', e);
    } finally {
      setLoadingFiles(false);
    }
  };

  // Fetch commits for a specific branch
  const fetchBranchCommits = async (branchName, isBase = true) => {
    if (!githubToken || !selectedRepo || !branchName) return;
    const { owner, name } = selectedRepo;
    setLoadingCommits(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/github/repos/${owner}/${name}/commits?sha=${encodeURIComponent(branchName)}&path=${encodeURIComponent(relativeFilePath || '')}`, {
        headers: { 'Authorization': `Bearer ${githubToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        const cList = data.commits || [];
        if (isBase) {
          setBaseCommits(cList);
          if (cList.length > 1) {
            setBaseCommit(cList[1].hash);
            form.setFieldValue('baseCommit', cList[1].hash);
          } else if (cList.length > 0) {
            setBaseCommit(cList[0].hash);
            form.setFieldValue('baseCommit', cList[0].hash);
          }
        } else {
          setTargetCommits(cList);
          if (cList.length > 0) {
            setTargetCommit(cList[0].hash);
            form.setFieldValue('targetCommit', cList[0].hash);
          }
        }
      }
    } catch (e) {
      console.warn('Commits fetch error:', e);
    } finally {
      setLoadingCommits(false);
    }
  };

  useEffect(() => {
    if (compareMode === 'branches' && selectedRepo) {
      if (baseBranch) fetchBranchCommits(baseBranch, true);
      if (targetBranch) fetchBranchCommits(targetBranch, false);
    }
  }, [baseBranch, targetBranch, compareMode, relativeFilePath]);

  const handleSelectPull = (pr, owner = selectedRepo?.owner, repo = selectedRepo?.name) => {
    if (!pr) return;
    setSelectedPull(pr);
    setBaseCommit(pr.baseSha || pr.baseRef);
    setTargetCommit(pr.headSha || pr.headRef);
    form.setFieldsValue({
      baseCommit: pr.baseSha || pr.baseRef,
      targetCommit: pr.headSha || pr.headRef
    });
    // Fetch files at head branch
    if (owner && repo) {
      fetchFiles(owner, repo, pr.headSha || pr.headRef || 'main');
    }
  };

  const handleManualRepoSubmit = () => {
    const trimmed = manualRepoInput.trim();
    if (!trimmed.includes('/')) {
      message.error('Format must be owner/repository (e.g. OLIMEX/OLIMEXINO-328)');
      return;
    }
    const [owner, name] = trimmed.split('/');
    setSelectedRepo({
      id: trimmed,
      name,
      fullName: trimmed,
      owner,
      isPrivate: false,
      defaultBranch: 'main'
    });
    setManualRepoMode(false);
  };

  const handleSubmit = () => {
    if (!selectedRepo) {
      message.error('Please select a repository');
      return;
    }
    if (!baseCommit || !targetCommit) {
      message.error('Please select base and target revisions');
      return;
    }
    if (!relativeFilePath) {
      message.error('Please select a hardware design file');
      return;
    }

    onFetchDiff({
      owner: selectedRepo.owner,
      repo: selectedRepo.name,
      baseCommit,
      targetCommit,
      filePath: relativeFilePath,
      isPcb: relativeFilePath.endsWith('.kicad_pcb')
    });
  };

  // If not authenticated, render prompt card
  if (!githubToken || !githubUser) {
    return (
      <div style={{ padding: '10px 0' }}>
        <Card
          style={{
            background: 'linear-gradient(180deg, #161821 0%, #0f1015 100%)',
            borderColor: '#232738',
            borderRadius: '8px',
            textAlign: 'center',
            padding: '16px 8px'
          }}
        >
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#24292e',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px',
            border: '2px solid #fadb14'
          }}>
            <GithubOutlined style={{ fontSize: '24px', color: '#fff' }} />
          </div>
          <Title level={5} style={{ color: '#fff', margin: '0 0 6px' }}>
            GitHub Cloud Diffing
          </Title>
          <Text style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginBottom: '16px' }}>
            Compare remote hardware branches, commits and Pull Requests directly from GitHub without cloning locally.
          </Text>

          <Button
            type="primary"
            icon={<GithubOutlined />}
            onClick={onOpenAuthModal}
            style={{
              background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
              color: '#000',
              fontWeight: 600,
              border: 'none',
              width: '100%',
              height: '36px'
            }}
          >
            Connect GitHub Account
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Connected Account Badge */}
      <div style={{
        background: '#0f1015',
        border: '1px solid #232738',
        borderRadius: '6px',
        padding: '8px 12px',
        marginBottom: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img
            src={githubUser.avatarUrl}
            alt={githubUser.login}
            style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid #fadb14' }}
          />
          <div>
            <Text style={{ color: '#fff', fontSize: '12px', fontWeight: 600 }}>
              {githubUser.login}
            </Text>
          </div>
        </div>

        <Tooltip title="Manage GitHub connection">
          <Button
            type="text"
            size="small"
            style={{ color: '#fadb14', fontSize: '11px', padding: 0 }}
            onClick={onOpenAuthModal}
          >
            Manage
          </Button>
        </Tooltip>
      </div>

      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        {/* Repository Selection */}
        <Form.Item
          label={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>
                Remote Repository
              </span>
              <Space size="small">
                <Button
                  type="link"
                  size="small"
                  icon={<SyncOutlined spin={loadingRepos} />}
                  onClick={fetchRepos}
                  style={{ color: '#fadb14', fontSize: '11px', padding: 0 }}
                  title="Refresh Repositories"
                />
                <Text type="secondary" style={{ fontSize: '10px' }}>|</Text>
                <Button
                  type="link"
                  size="small"
                  onClick={() => setManualRepoMode(!manualRepoMode)}
                  style={{ color: '#fadb14', fontSize: '11px', padding: 0 }}
                >
                  {manualRepoMode ? 'Select from list' : 'Custom repo'}
                </Button>
              </Space>
            </div>
          }
          style={{ marginBottom: '12px' }}
        >
          {manualRepoMode ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <Input
                placeholder="owner/repository"
                value={manualRepoInput}
                onChange={e => setManualRepoInput(e.target.value)}
                onPressEnter={handleManualRepoSubmit}
                style={{ background: '#0f1015', borderColor: '#232738', color: '#fff' }}
              />
              <Button type="primary" onClick={handleManualRepoSubmit} style={{ background: '#fadb14', color: '#000' }}>
                Set
              </Button>
            </div>
          ) : (
            <Select
              showSearch
              placeholder="Search repositories..."
              loading={loadingRepos}
              value={selectedRepo ? `${selectedRepo.owner}/${selectedRepo.name}` : undefined}
              onChange={(val) => {
                const found = repos.find(r => `${r.owner}/${r.name}` === val);
                if (found) setSelectedRepo(found);
              }}
              filterOption={(input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
              style={{ width: '100%' }}
            >
              {repos.map(r => (
                <Select.Option key={r.id || `${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 500 }}>
                      {r.name}
                      <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '4px' }}>({r.owner})</span>
                    </span>
                    {r.isPrivate ? (
                      <Tag color="warning" icon={<LockOutlined />} style={{ fontSize: '10px', padding: '0 4px', margin: 0 }}>
                        Private
                      </Tag>
                    ) : (
                      <Tag color="default" icon={<GlobalOutlined />} style={{ fontSize: '10px', padding: '0 4px', margin: 0 }}>
                        Public
                      </Tag>
                    )}
                  </div>
                </Select.Option>
              ))}
            </Select>
          )}
        </Form.Item>

        {/* Compare Mode Toggle: Pull Request vs Branches */}
        <div style={{ marginBottom: '14px' }}>
          <Text style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginBottom: '6px' }}>
            Comparison Target:
          </Text>
          <Radio.Group
            value={compareMode}
            onChange={e => setCompareMode(e.target.value)}
            style={{ width: '100%', display: 'flex' }}
            buttonStyle="solid"
          >
            <Radio.Button value="pulls" style={{ flex: 1, textAlign: 'center', fontSize: '11px' }}>
              <PullRequestOutlined style={{ marginRight: '4px' }} />
              Pull Request
            </Radio.Button>
            <Radio.Button value="branches" style={{ flex: 1, textAlign: 'center', fontSize: '11px' }}>
              <BranchesOutlined style={{ marginRight: '4px' }} />
              Branch / Commit
            </Radio.Button>
          </Radio.Group>
        </div>

        {compareMode === 'pulls' ? (
          // Pull Request Selection
          <Form.Item label="Pull Request" style={{ marginBottom: '12px' }}>
            {pulls.length === 0 ? (
              <Alert
                message="No open Pull Requests found"
                description="This repository has no open PRs. Switch to 'Branch / Commit' mode above."
                type="info"
                showIcon
                style={{ background: '#0f1015', borderColor: '#232738', fontSize: '11px' }}
              />
            ) : (
              <Select
                showSearch
                placeholder="Select Pull Request..."
                loading={loadingPulls}
                value={selectedPull?.number}
                onChange={(num) => {
                  const pr = pulls.find(p => p.number === num);
                  handleSelectPull(pr);
                }}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                style={{ width: '100%' }}
              >
                {pulls.map(pr => (
                  <Select.Option
                    key={pr.id || pr.number}
                    value={pr.number}
                    label={`#${pr.number} ${pr.title}`}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#f5f5f5', fontSize: '12px' }}>
                        #{pr.number}: {pr.title}
                      </div>
                      <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px' }}>
                        by @{pr.author} • <span style={{ color: '#fadb14' }}>{pr.baseRef}</span> ← <span style={{ color: '#00ff66' }}>{pr.headRef}</span>
                      </div>
                    </div>
                  </Select.Option>
                ))}
              </Select>
            )}
          </Form.Item>
        ) : (
          // Branch & Commit Selectors
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <Form.Item label="Base Branch" style={{ marginBottom: '8px' }}>
                <Select
                  showSearch
                  placeholder="Base Branch"
                  value={baseBranch}
                  loading={loadingBranches}
                  onChange={setBaseBranch}
                >
                  {branches.map(b => (
                    <Select.Option key={`base-${b.name}`} value={b.name}>{b.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item label="Target Branch" style={{ marginBottom: '8px' }}>
                <Select
                  showSearch
                  placeholder="Target Branch"
                  value={targetBranch}
                  loading={loadingBranches}
                  onChange={setTargetBranch}
                >
                  {branches.map(b => (
                    <Select.Option key={`tgt-${b.name}`} value={b.name}>{b.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </div>

            <Form.Item label="Base Commit" style={{ marginBottom: '8px' }}>
              <Select
                showSearch
                placeholder="Select base commit..."
                value={baseCommit}
                loading={loadingCommits}
                onChange={val => {
                  setBaseCommit(val);
                  form.setFieldValue('baseCommit', val);
                }}
              >
                {baseCommits.map(c => (
                  <Select.Option key={`base-${c.hash}`} value={c.hash}>
                    {c.shortHash} - {c.message} ({c.author})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item label="Target Commit" style={{ marginBottom: '12px' }}>
              <Select
                showSearch
                placeholder="Select target commit..."
                value={targetCommit}
                loading={loadingCommits}
                onChange={val => {
                  setTargetCommit(val);
                  form.setFieldValue('targetCommit', val);
                }}
              >
                {targetCommits.map(c => (
                  <Select.Option key={`tgt-${c.hash}`} value={c.hash}>
                    {c.shortHash} - {c.message} ({c.author})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </>
        )}

        {/* Hardware File Selector */}
        <Form.Item
          label={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>
                CAD Hardware File (.kicad_pcb / .kicad_sch)
              </span>
              {loadingFiles && <Spin size="small" />}
            </div>
          }
          style={{ marginBottom: '16px' }}
        >
          {hardwareFiles.length === 0 ? (
            <Input
              placeholder="e.g. path/to/board.kicad_pcb"
              value={relativeFilePath}
              onChange={e => {
                setRelativeFilePath(e.target.value);
                form.setFieldValue('relativeFilePath', e.target.value);
              }}
              style={{ background: '#0f1015', borderColor: '#232738', color: '#fff' }}
            />
          ) : (
            <Select
              showSearch
              placeholder="Select hardware design file..."
              value={relativeFilePath}
              onChange={val => {
                setRelativeFilePath(val);
                form.setFieldValue('relativeFilePath', val);
              }}
              style={{ width: '100%' }}
            >
              {hardwareFiles.map(f => (
                <Select.Option key={f.path} value={f.path}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{f.path}</span>
                    <Tag
                      color={f.isPcb ? 'gold' : 'blue'}
                      style={{ fontSize: '10px', padding: '0 4px', margin: 0 }}
                    >
                      {f.isPcb ? 'PCB' : 'SCH'}
                    </Tag>
                  </div>
                </Select.Option>
              ))}
            </Select>
          )}
        </Form.Item>

        {/* Action Button */}
        <Button
          type="primary"
          htmlType="submit"
          icon={<ThunderboltOutlined />}
          loading={loading}
          block
          style={{
            background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
            color: '#000',
            fontWeight: 700,
            border: 'none',
            height: '38px',
            fontSize: '13px',
            boxShadow: '0 4px 14px rgba(250, 219, 20, 0.35)'
          }}
        >
          Fetch & Render Remote Diff
        </Button>
      </Form>

      {/* Commit Evolution Timeline for Selected Remote Commits */}
      {baseCommits.length > 0 && (
        <div style={{ borderTop: '1px solid #232738', paddingTop: '16px', marginTop: '16px' }}>
          <Title level={5} style={{ color: '#fadb14', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '13px' }}>
            <HistoryOutlined /> Remote Commit Trail
          </Title>
          <div style={{ maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
            <Timeline
              pending={false}
              mode="left"
              items={baseCommits.slice(0, 10).map((c, idx) => ({
                color: idx === 0 ? '#faad14' : '#6b6375',
                children: (
                  <div style={{ fontSize: '11px', color: '#a6adbb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <Text strong style={{ color: '#f5f5f5', fontSize: '11px' }}>{c.shortHash}</Text>
                      <Text type="secondary" style={{ fontSize: '10px' }}>
                        {c.date ? new Date(c.date).toLocaleDateString() : ''}
                      </Text>
                    </div>
                    <div style={{ lineHeight: '1.3' }}>{c.message}</div>
                    <div style={{ fontSize: '10px', color: '#6b6375', marginTop: '2px' }}>by {c.author}</div>
                  </div>
                )
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
