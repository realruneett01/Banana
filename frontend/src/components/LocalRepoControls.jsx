import React from 'react';
import { Form, Input, Button, Upload, Alert, Switch, Select, Timeline, Typography } from 'antd';
import { InboxOutlined, FileSearchOutlined, HistoryOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function RecentCommitsList({ commits }) {
  if (!commits || commits.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid #232738', paddingTop: '20px', marginTop: '20px' }}>
      <Title level={5} style={{ color: '#fadb14', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
        <HistoryOutlined /> Recent Git Commits
      </Title>
      <div style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '5px' }}>
        <Timeline
          pending={false}
          mode="left"
          items={commits.slice(0, 15).map((c, idx) => ({
            color: idx === 0 ? '#faad14' : '#6b6375',
            children: (
              <div style={{ fontSize: '11px', color: '#a6adbb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <Text strong style={{ color: '#f5f5f5', fontSize: '11px' }}>{c.hash.substring(0, 7)}</Text>
                  <Text type="secondary" style={{ fontSize: '10px' }}>{c.date}</Text>
                </div>
                <div style={{ lineHeight: '1.3' }}>{c.subject}</div>
                <div style={{ fontSize: '10px', color: '#6b6375', marginTop: '2px' }}>by {c.author}</div>
              </div>
            )
          }))}
        />
      </div>
    </div>
  );
}

function CommitOrBranchSelect({ isBranch, repoInfo, value, placeholder, onChange }) {
  if (!repoInfo) {
    return <Input placeholder="e.g. HEAD or commit hash" onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <Select
      showSearch
      placeholder={placeholder}
      onChange={onChange}
      value={value}
    >
      {isBranch
        ? repoInfo.branches.map((b) => (
            <Select.Option key={`branch-${b}`} value={b}>{b}</Select.Option>
          ))
        : repoInfo.commits.map((c) => (
            <Select.Option key={`commit-${c.hash}`} value={c.hash}>
              {c.hash.substring(0, 7)} - {c.subject} ({c.author})
            </Select.Option>
          ))}
    </Select>
  );
}

function LocalRepoDragger({ onFileDropped }) {
  return (
    <Upload.Dragger
      directory
      multiple={false}
      showUploadList={false}
      beforeUpload={(file) => {
        onFileDropped(file);
        return false;
      }}
      style={{
        background: '#0f1015',
        borderColor: '#232738',
        borderRadius: '4px',
        marginBottom: '15px',
        padding: '10px 0'
      }}
    >
      <p className="ant-upload-drag-icon" style={{ color: '#faad14', margin: 0 }}>
        <InboxOutlined style={{ fontSize: '24px' }} />
      </p>
      <p className="ant-upload-text" style={{ fontSize: '12px', color: '#f5f5f5', margin: '4px 0 0' }}>
        Drag KiCad Project Folder Here
      </p>
      <p className="ant-upload-hint" style={{ fontSize: '10px', color: '#6b6375', margin: 0 }}>
        Supports entire directory drops containing .kicad_pcb/.kicad_sch
      </p>
    </Upload.Dragger>
  );
}

function RepoPathInput({ repoPath, setRepoPath, loadRepoInfo, form }) {
  return (
    <Form.Item
      label="Local Repo Root Absolute Path"
      name="repoPath"
      rules={[{ required: true, message: 'Please input absolute repo path' }]}
      style={{ marginBottom: '8px' }}
    >
      <div style={{ display: 'flex', gap: '8px' }}>
        <Input
          placeholder="e.g. C:\Users\project"
          onChange={(e) => {
            setRepoPath(e.target.value);
            form.setFieldValue('repoPath', e.target.value);
          }}
        />
        <Button type="default" onClick={() => loadRepoInfo(repoPath, false)}>Load</Button>
      </div>
    </Form.Item>
  );
}

function SandboxSecurityNotice() {
  return (
    <Alert
      message="Sandbox Security Notice"
      description="Because of browser sandbox security, please verify your local absolute repository path above so the Git engine can target it on disk."
      type="info"
      showIcon
      style={{
        marginBottom: '15px',
        background: '#161722',
        borderColor: '#232738',
        fontSize: '11px',
        color: '#a6adbb'
      }}
    />
  );
}

function LocalDesignFileSelector({ compareBranches, changedFiles, repoInfo, relativeFilePath, onSelectFile }) {
  if (compareBranches) {
    if (!changedFiles || changedFiles.length === 0) {
      return <Select placeholder="No changed KiCad files found" disabled />;
    }
    return (
      <Select
        showSearch
        placeholder="Select changed KiCad file"
        onChange={onSelectFile}
        value={relativeFilePath}
      >
        {changedFiles.map((file) => (
          <Select.Option key={`changed-${file}`} value={file}>{file}</Select.Option>
        ))}
      </Select>
    );
  }

  if (!repoInfo?.kicadFiles || repoInfo.kicadFiles.length === 0) {
    return <Input placeholder="e.g. layout/board.kicad_pcb" onChange={(e) => onSelectFile(e.target.value)} />;
  }

  return (
    <Select
      showSearch
      placeholder="Select KiCad file"
      onChange={onSelectFile}
      value={relativeFilePath}
    >
      {repoInfo.kicadFiles.map((file) => (
        <Select.Option key={`file-${file}`} value={file}>{file}</Select.Option>
      ))}
    </Select>
  );
}

function LocalRepoForm(props) {
  const {
    form, repoPath, setRepoPath, loadRepoInfo, baseCommit, targetCommit,
    relativeFilePath, onFetchDiff, compareBranches, handleBranchToggle,
    repoInfo, handleBaseChange, handleTargetChange, changedFiles,
    setRelativeFilePath, loading
  } = props;

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ repoPath, baseCommit, targetCommit, relativeFilePath }}
      onFinish={onFetchDiff}
    >
      <RepoPathInput repoPath={repoPath} setRepoPath={setRepoPath} loadRepoInfo={loadRepoInfo} form={form} />
      <SandboxSecurityNotice />

      <Form.Item label="Compare Branches instead of Commits" valuePropName="checked" style={{ marginBottom: '12px' }}>
        <Switch checked={compareBranches} onChange={handleBranchToggle} />
      </Form.Item>

      <Form.Item
        label={compareBranches ? 'Base Branch' : 'Base Commit'}
        name="baseCommit"
        rules={[{ required: true, message: 'Please select base version' }]}
      >
        <CommitOrBranchSelect
          isBranch={compareBranches}
          repoInfo={repoInfo}
          value={baseCommit}
          placeholder={compareBranches ? 'Select base branch' : 'Select base commit'}
          onChange={handleBaseChange}
        />
      </Form.Item>

      <Form.Item
        label={compareBranches ? 'Target Branch' : 'Target Commit'}
        name="targetCommit"
        rules={[{ required: true, message: 'Please select target version' }]}
      >
        <CommitOrBranchSelect
          isBranch={compareBranches}
          repoInfo={repoInfo}
          value={targetCommit}
          placeholder={compareBranches ? 'Select target branch' : 'Select target commit'}
          onChange={handleTargetChange}
        />
      </Form.Item>

      <Form.Item
        label="Design File Path"
        name="relativeFilePath"
        rules={[{ required: true, message: 'Please select file path' }]}
      >
        <LocalDesignFileSelector
          compareBranches={compareBranches}
          changedFiles={changedFiles}
          repoInfo={repoInfo}
          relativeFilePath={relativeFilePath}
          onSelectFile={(val) => {
            setRelativeFilePath(val);
            form.setFieldValue('relativeFilePath', val);
          }}
        />
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" icon={<FileSearchOutlined />} loading={loading} block>
          Fetch and Render Diff
        </Button>
      </Form.Item>
    </Form>
  );
}

export function LocalRepoControls({
  form,
  repoPath,
  setRepoPath,
  loadRepoInfo,
  baseCommit,
  setBaseCommit,
  targetCommit,
  setTargetCommit,
  relativeFilePath,
  setRelativeFilePath,
  repoInfo,
  compareBranches,
  setCompareBranches,
  changedFiles,
  setChangedFiles,
  fetchChangedFiles,
  loading,
  onFetchDiff,
  onFileDropped,
}) {
  const handleBranchToggle = (checked) => {
    setCompareBranches(checked);
    setBaseCommit('');
    setTargetCommit('');
    form.setFieldsValue({ baseCommit: '', targetCommit: '' });
    if (checked) {
      setChangedFiles([]);
      setRelativeFilePath('');
      form.setFieldValue('relativeFilePath', '');
    }
  };

  const handleBaseChange = (val) => {
    setBaseCommit(val);
    form.setFieldValue('baseCommit', val);
    if (compareBranches && targetCommit) {
      fetchChangedFiles(repoPath, val, targetCommit);
    }
  };

  const handleTargetChange = (val) => {
    setTargetCommit(val);
    form.setFieldValue('targetCommit', val);
    if (compareBranches && baseCommit) {
      fetchChangedFiles(repoPath, baseCommit, val);
    }
  };

  return (
    <>
      <LocalRepoDragger onFileDropped={onFileDropped} />
      <LocalRepoForm
        form={form}
        repoPath={repoPath}
        setRepoPath={setRepoPath}
        loadRepoInfo={loadRepoInfo}
        baseCommit={baseCommit}
        targetCommit={targetCommit}
        relativeFilePath={relativeFilePath}
        onFetchDiff={onFetchDiff}
        compareBranches={compareBranches}
        handleBranchToggle={handleBranchToggle}
        repoInfo={repoInfo}
        handleBaseChange={handleBaseChange}
        handleTargetChange={handleTargetChange}
        changedFiles={changedFiles}
        setRelativeFilePath={setRelativeFilePath}
        loading={loading}
      />
      <RecentCommitsList commits={repoInfo?.commits} />
    </>
  );
}
