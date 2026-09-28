import React, { useState } from 'react';
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
import { useGithubSync } from './useGithubSync.js';

const { Text, Title } = Typography;

const BANANA_BUTTON_STYLE = Object.freeze({
  background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
  color: '#000',
  fontWeight: 600,
  border: 'none'
});

function GithubPromptCard({ onOpenAuthModal }) {
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
            ...BANANA_BUTTON_STYLE,
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

function GithubAccountBadge({ githubUser, onOpenAuthModal }) {
  return (
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
        <Text style={{ color: '#fff', fontSize: '12px', fontWeight: 600 }}>
          {githubUser.login}
        </Text>
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
  );
}

function RepoOptionItem({ repo }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontWeight: 500 }}>
        {repo.name}
        <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '4px' }}>({repo.owner})</span>
      </span>
      {repo.isPrivate ? (
        <Tag color="warning" icon={<LockOutlined />} style={{ fontSize: '10px', padding: '0 4px', margin: 0 }}>
          Private
        </Tag>
      ) : (
        <Tag color="default" icon={<GlobalOutlined />} style={{ fontSize: '10px', padding: '0 4px', margin: 0 }}>
          Public
        </Tag>
      )}
    </div>
  );
}

function RepoSelectorLabel({ loadingRepos, onRefreshRepos, manualRepoMode, setManualRepoMode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
      <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>
        Remote Repository
      </span>
      <Space size="small">
        <Button
          type="link"
          size="small"
          icon={<SyncOutlined spin={loadingRepos} />}
          onClick={onRefreshRepos}
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
  );
}

function RepoSelector(props) {
  const {
    repos, selectedRepo, onSelectRepo, loadingRepos, onRefreshRepos,
    manualRepoMode, setManualRepoMode, manualRepoInput, setManualRepoInput, onManualRepoSubmit
  } = props;

  return (
    <Form.Item
      label={
        <RepoSelectorLabel
          loadingRepos={loadingRepos}
          onRefreshRepos={onRefreshRepos}
          manualRepoMode={manualRepoMode}
          setManualRepoMode={setManualRepoMode}
        />
      }
      style={{ marginBottom: '12px' }}
    >
      {manualRepoMode ? (
        <div style={{ display: 'flex', gap: '6px' }}>
          <Input
            placeholder="owner/repository"
            value={manualRepoInput}
            onChange={e => setManualRepoInput(e.target.value)}
            onPressEnter={onManualRepoSubmit}
            style={{ background: '#0f1015', borderColor: '#232738', color: '#fff' }}
          />
          <Button type="primary" onClick={onManualRepoSubmit} style={{ background: '#fadb14', color: '#000' }}>
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
            if (found) onSelectRepo(found);
          }}
          filterOption={(input, option) =>
            (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
          }
          style={{ width: '100%' }}
        >
          {repos.map(r => (
            <Select.Option key={r.id || `${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
              <RepoOptionItem repo={r} />
            </Select.Option>
          ))}
        </Select>
      )}
    </Form.Item>
  );
}

function CompareModeToggle({ compareMode, setCompareMode }) {
  return (
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
  );
}

function PullRequestSelector({ pulls, loadingPulls, selectedPull, onSelectPull }) {
  if (pulls.length === 0) {
    return (
      <Form.Item label="Pull Request" style={{ marginBottom: '12px' }}>
        <Alert
          message="No open Pull Requests found"
          description="This repository has no open PRs. Switch to 'Branch / Commit' mode above."
          type="info"
          showIcon
          style={{ background: '#0f1015', borderColor: '#232738', fontSize: '11px' }}
        />
      </Form.Item>
    );
  }

  return (
    <Form.Item label="Pull Request" style={{ marginBottom: '12px' }}>
      <Select
        showSearch
        placeholder="Select Pull Request..."
        loading={loadingPulls}
        value={selectedPull?.number}
        onChange={(num) => {
          const pr = pulls.find(p => p.number === num);
          onSelectPull(pr);
        }}
        filterOption={(input, option) =>
          (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
        }
        style={{ width: '100%' }}
      >
        {pulls.map(pr => (
          <Select.Option key={pr.id || pr.number} value={pr.number} label={`#${pr.number} ${pr.title}`}>
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
    </Form.Item>
  );
}

function CommitSelectFormItem({ label, placeholder, value, loading, commits, onChange, keyPrefix, marginBottom = '8px' }) {
  return (
    <Form.Item label={label} style={{ marginBottom }}>
      <Select
        showSearch
        placeholder={placeholder}
        value={value}
        loading={loading}
        onChange={onChange}
      >
        {commits.map(c => (
          <Select.Option key={`${keyPrefix}-${c.hash}`} value={c.hash}>
            {c.shortHash} - {c.message} ({c.author})
          </Select.Option>
        ))}
      </Select>
    </Form.Item>
  );
}

function BranchCommitSelector(props) {
  const {
    branches, loadingBranches, baseBranch, setBaseBranch,
    targetBranch, setTargetBranch, baseCommits, targetCommits,
    loadingCommits, baseCommit, targetCommit, setBaseCommit,
    setTargetCommit, form
  } = props;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Form.Item label="Base Branch" style={{ marginBottom: '8px' }}>
          <Select showSearch placeholder="Base Branch" value={baseBranch} loading={loadingBranches} onChange={setBaseBranch}>
            {branches.map(b => (
              <Select.Option key={`base-${b.name}`} value={b.name}>{b.name}</Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item label="Target Branch" style={{ marginBottom: '8px' }}>
          <Select showSearch placeholder="Target Branch" value={targetBranch} loading={loadingBranches} onChange={setTargetBranch}>
            {branches.map(b => (
              <Select.Option key={`tgt-${b.name}`} value={b.name}>{b.name}</Select.Option>
            ))}
          </Select>
        </Form.Item>
      </div>

      <CommitSelectFormItem
        label="Base Commit"
        placeholder="Select base commit..."
        value={baseCommit}
        loading={loadingCommits}
        commits={baseCommits}
        keyPrefix="base"
        onChange={val => {
          setBaseCommit(val);
          form.setFieldValue('baseCommit', val);
        }}
      />

      <CommitSelectFormItem
        label="Target Commit"
        placeholder="Select target commit..."
        value={targetCommit}
        loading={loadingCommits}
        commits={targetCommits}
        keyPrefix="tgt"
        marginBottom="12px"
        onChange={val => {
          setTargetCommit(val);
          form.setFieldValue('targetCommit', val);
        }}
      />
    </>
  );
}

function HardwareFileSelector({ hardwareFiles, loadingFiles, relativeFilePath, setRelativeFilePath, form }) {
  return (
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
                <Tag color={f.isPcb ? 'gold' : 'blue'} style={{ fontSize: '10px', padding: '0 4px', margin: 0 }}>
                  {f.isPcb ? 'PCB' : 'SCH'}
                </Tag>
              </div>
            </Select.Option>
          ))}
        </Select>
      )}
    </Form.Item>
  );
}

function RemoteCommitTrail({ baseCommits }) {
  if (baseCommits.length === 0) return null;

  return (
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
  );
}

function GithubComparisonSection({
  compareMode,
  syncState,
  baseCommit,
  targetCommit,
  setBaseCommit,
  setTargetCommit,
  form
}) {
  if (compareMode === 'pulls') {
    return (
      <PullRequestSelector
        pulls={syncState.pulls}
        loadingPulls={syncState.loadingPulls}
        selectedPull={syncState.selectedPull}
        onSelectPull={syncState.handleSelectPull}
      />
    );
  }
  return (
    <BranchCommitSelector
      branches={syncState.branches}
      loadingBranches={syncState.loadingBranches}
      baseBranch={syncState.baseBranch}
      setBaseBranch={syncState.setBaseBranch}
      targetBranch={syncState.targetBranch}
      setTargetBranch={syncState.setTargetBranch}
      baseCommits={syncState.baseCommits}
      targetCommits={syncState.targetCommits}
      loadingCommits={syncState.loadingCommits}
      baseCommit={baseCommit}
      targetCommit={targetCommit}
      setBaseCommit={setBaseCommit}
      setTargetCommit={setTargetCommit}
      form={form}
    />
  );
}

function FetchDiffSubmitButton({ loading }) {
  return (
    <Button
      type="primary"
      htmlType="submit"
      icon={<ThunderboltOutlined />}
      loading={loading}
      block
      style={{
        ...BANANA_BUTTON_STYLE,
        fontWeight: 700,
        height: '38px',
        fontSize: '13px',
        boxShadow: '0 4px 14px rgba(250, 219, 20, 0.35)'
      }}
    >
      Fetch & Render Remote Diff
    </Button>
  );
}

function validateGithubSubmission({ selectedRepo, baseCommit, targetCommit, relativeFilePath }) {
  if (!selectedRepo) {
    message.error('Please select a repository');
    return false;
  }
  if (!baseCommit || !targetCommit) {
    message.error('Please select base and target revisions');
    return false;
  }
  if (!relativeFilePath) {
    message.error('Please select a hardware design file');
    return false;
  }
  return true;
}

function parseManualRepoString(input) {
  const trimmed = input.trim();
  if (!trimmed.includes('/')) {
    message.error('Format must be owner/repository (e.g. OLIMEX/OLIMEXINO-328)');
    return null;
  }
  const [owner, name] = trimmed.split('/');
  return {
    id: trimmed,
    name,
    fullName: trimmed,
    owner,
    isPrivate: false,
    defaultBranch: 'main'
  };
}

function GithubDiffForm(props) {
  const {
    form, handleSubmit, syncState, selectedRepo, setSelectedRepo,
    manualRepoMode, setManualRepoMode, manualRepoInput, setManualRepoInput,
    handleManualRepoSubmit, compareMode, setCompareMode, baseCommit, setBaseCommit,
    targetCommit, setTargetCommit, relativeFilePath, setRelativeFilePath, loading
  } = props;

  return (
    <Form form={form} layout="vertical" onFinish={handleSubmit}>
      <RepoSelector
        repos={syncState.repos}
        selectedRepo={selectedRepo}
        onSelectRepo={setSelectedRepo}
        loadingRepos={syncState.loadingRepos}
        onRefreshRepos={syncState.fetchRepos}
        manualRepoMode={manualRepoMode}
        setManualRepoMode={setManualRepoMode}
        manualRepoInput={manualRepoInput}
        setManualRepoInput={setManualRepoInput}
        onManualRepoSubmit={handleManualRepoSubmit}
      />

      <CompareModeToggle compareMode={compareMode} setCompareMode={setCompareMode} />

      <GithubComparisonSection
        compareMode={compareMode}
        syncState={syncState}
        baseCommit={baseCommit}
        targetCommit={targetCommit}
        setBaseCommit={setBaseCommit}
        setTargetCommit={setTargetCommit}
        form={form}
      />

      <HardwareFileSelector
        hardwareFiles={syncState.hardwareFiles}
        loadingFiles={syncState.loadingFiles}
        relativeFilePath={relativeFilePath}
        setRelativeFilePath={setRelativeFilePath}
        form={form}
      />

      <FetchDiffSubmitButton loading={loading} />
    </Form>
  );
}

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
  const [compareMode, setCompareMode] = useState('pulls');
  const [manualRepoMode, setManualRepoMode] = useState(false);
  const [manualRepoInput, setManualRepoInput] = useState('');

  const syncState = useGithubSync({
    githubToken,
    selectedRepo,
    setSelectedRepo,
    setBaseCommit,
    setTargetCommit,
    relativeFilePath,
    setRelativeFilePath,
    compareMode,
    form
  });

  const handleManualRepoSubmit = () => {
    const parsed = parseManualRepoString(manualRepoInput);
    if (!parsed) return;
    setSelectedRepo(parsed);
    setManualRepoMode(false);
  };

  const handleSubmit = () => {
    if (!validateGithubSubmission({ selectedRepo, baseCommit, targetCommit, relativeFilePath })) return;

    onFetchDiff({
      owner: selectedRepo.owner,
      repo: selectedRepo.name,
      baseCommit,
      targetCommit,
      filePath: relativeFilePath,
      isPcb: relativeFilePath.endsWith('.kicad_pcb')
    });
  };

  if (!githubToken || !githubUser) {
    return <GithubPromptCard onOpenAuthModal={onOpenAuthModal} />;
  }

  return (
    <div style={{ width: '100%' }}>
      <GithubAccountBadge githubUser={githubUser} onOpenAuthModal={onOpenAuthModal} />

      <GithubDiffForm
        form={form}
        handleSubmit={handleSubmit}
        syncState={syncState}
        selectedRepo={selectedRepo}
        setSelectedRepo={setSelectedRepo}
        manualRepoMode={manualRepoMode}
        setManualRepoMode={setManualRepoMode}
        manualRepoInput={manualRepoInput}
        setManualRepoInput={setManualRepoInput}
        handleManualRepoSubmit={handleManualRepoSubmit}
        compareMode={compareMode}
        setCompareMode={setCompareMode}
        baseCommit={baseCommit}
        setBaseCommit={setBaseCommit}
        targetCommit={targetCommit}
        setTargetCommit={setTargetCommit}
        relativeFilePath={relativeFilePath}
        setRelativeFilePath={setRelativeFilePath}
        loading={loading}
      />

      <RemoteCommitTrail baseCommits={syncState.baseCommits} />
    </div>
  );
}
