import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config.js';

async function fetchGithubApi(url, token, prop) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data[prop] || [];
  } catch {
    return [];
  }
}

export const fetchRemoteRepos = (token) =>
  fetchGithubApi(`${API_BASE_URL}/api/github/repos`, token, 'repos');

export const fetchRemoteBranches = (token, owner, repo) =>
  fetchGithubApi(`${API_BASE_URL}/api/github/repos/${owner}/${repo}/branches`, token, 'branches');

export const fetchRemotePulls = (token, owner, repo) =>
  fetchGithubApi(`${API_BASE_URL}/api/github/repos/${owner}/${repo}/pulls?state=all`, token, 'pulls');

export const fetchRemoteFiles = (token, owner, repo, ref) =>
  fetchGithubApi(`${API_BASE_URL}/api/github/repos/${owner}/${repo}/files?ref=${encodeURIComponent(ref)}`, token, 'files');

export const fetchRemoteCommits = (token, options) => {
  const { owner, repo, branch, filePath } = options;
  const pathParam = encodeURIComponent(filePath || '');
  const url = `${API_BASE_URL}/api/github/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${pathParam}`;
  return fetchGithubApi(url, token, 'commits');
};

const hasRepo = (token, repo) => Boolean(token && repo?.owner && repo?.name);

function useRepoList(githubToken, selectedRepo, setSelectedRepo) {
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  const refreshRepos = useCallback(async () => {
    if (!githubToken) return;
    setLoadingRepos(true);
    const list = await fetchRemoteRepos(githubToken);
    setRepos(list);
    if (list.length > 0 && !selectedRepo) {
      setSelectedRepo(list[0]);
    }
    setLoadingRepos(false);
  }, [githubToken, selectedRepo, setSelectedRepo]);

  useEffect(() => {
    if (githubToken) refreshRepos();
  }, [githubToken, refreshRepos]);

  return { repos, loadingRepos, refreshRepos };
}

function useBranchesAndPulls(githubToken, selectedRepo, onSelectPull) {
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [baseBranch, setBaseBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  const [pulls, setPulls] = useState([]);
  const [loadingPulls, setLoadingPulls] = useState(false);

  useEffect(() => {
    if (!hasRepo(githubToken, selectedRepo)) return;
    const { owner, name, defaultBranch = 'main' } = selectedRepo;

    setLoadingBranches(true);
    fetchRemoteBranches(githubToken, owner, name).then(bList => {
      setBranches(bList);
      const hasDef = bList.some(b => b.name === defaultBranch);
      const mainBranch = hasDef ? defaultBranch : (bList[0]?.name || 'main');
      setBaseBranch(mainBranch);
      setTargetBranch(mainBranch);
      setLoadingBranches(false);
    });

    setLoadingPulls(true);
    fetchRemotePulls(githubToken, owner, name).then(prList => {
      setPulls(prList);
      if (prList.length > 0) onSelectPull(prList[0], owner, name);
      setLoadingPulls(false);
    });
  }, [selectedRepo, githubToken, onSelectPull]);

  return {
    branches, loadingBranches, baseBranch, setBaseBranch,
    targetBranch, setTargetBranch, pulls, loadingPulls
  };
}

function syncCommitsToForm(cList, isBase, setters) {
  const { setCommits, setCommit, form } = setters;
  setCommits(cList);
  const chosen = isBase ? (cList[1]?.hash || cList[0]?.hash) : cList[0]?.hash;
  const fieldName = isBase ? 'baseCommit' : 'targetCommit';
  if (chosen) {
    setCommit(chosen);
    form.setFieldValue(fieldName, chosen);
  }
}

function useBranchCommits(config) {
  const {
    githubToken, selectedRepo, compareMode, baseBranch,
    targetBranch, relativeFilePath, setBaseCommit, setTargetCommit, form
  } = config;

  const [baseCommits, setBaseCommits] = useState([]);
  const [targetCommits, setTargetCommits] = useState([]);
  const [loadingCommits, setLoadingCommits] = useState(false);

  const loadCommitList = useCallback(async (branch, isBase) => {
    if (!hasRepo(githubToken, selectedRepo) || !branch) return;
    setLoadingCommits(true);
    const opts = { owner: selectedRepo.owner, repo: selectedRepo.name, branch, filePath: relativeFilePath };
    const cList = await fetchRemoteCommits(githubToken, opts);

    const setters = isBase
      ? { setCommits: setBaseCommits, setCommit: setBaseCommit, form }
      : { setCommits: setTargetCommits, setCommit: setTargetCommit, form };

    syncCommitsToForm(cList, isBase, setters);
    setLoadingCommits(false);
  }, [githubToken, selectedRepo, relativeFilePath, form, setBaseCommit, setTargetCommit]);

  useEffect(() => {
    if (compareMode !== 'branches' || !selectedRepo) return;
    if (baseBranch) loadCommitList(baseBranch, true);
    if (targetBranch) loadCommitList(targetBranch, false);
  }, [baseBranch, targetBranch, compareMode, relativeFilePath, selectedRepo, loadCommitList]);

  return { baseCommits, targetCommits, loadingCommits };
}

function useHardwareFiles(githubToken, selectedRepo, form, setRelativeFilePath) {
  const [hardwareFiles, setHardwareFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const loadFiles = useCallback(async (owner, repo, ref) => {
    if (!githubToken || !owner || !repo) return;
    setLoadingFiles(true);
    const files = await fetchRemoteFiles(githubToken, owner, repo, ref);
    setHardwareFiles(files);
    const defaultFile = files.find(f => f.isPcb)?.path || files[0]?.path || '';
    setRelativeFilePath(defaultFile);
    form.setFieldValue('relativeFilePath', defaultFile);
    setLoadingFiles(false);
  }, [githubToken, form, setRelativeFilePath]);

  useEffect(() => {
    if (!hasRepo(githubToken, selectedRepo)) return;
    loadFiles(selectedRepo.owner, selectedRepo.name, selectedRepo.defaultBranch || 'main');
  }, [selectedRepo, githubToken, loadFiles]);

  return { hardwareFiles, loadingFiles, loadFiles };
}

export function useGithubSync(props) {
  const {
    githubToken, selectedRepo, setSelectedRepo,
    setBaseCommit, setTargetCommit, relativeFilePath,
    setRelativeFilePath, compareMode, form
  } = props;

  const [selectedPull, setSelectedPull] = useState(null);

  const { repos, loadingRepos, refreshRepos } = useRepoList(githubToken, selectedRepo, setSelectedRepo);
  const { hardwareFiles, loadingFiles, loadFiles } = useHardwareFiles(githubToken, selectedRepo, form, setRelativeFilePath);

  const handleSelectPull = useCallback((pr, owner = selectedRepo?.owner, repo = selectedRepo?.name) => {
    if (!pr) return;
    setSelectedPull(pr);
    const bCommit = pr.baseSha || pr.baseRef;
    const tCommit = pr.headSha || pr.headRef;
    setBaseCommit(bCommit);
    setTargetCommit(tCommit);
    form.setFieldsValue({ baseCommit: bCommit, targetCommit: tCommit });
    if (owner && repo) {
      loadFiles(owner, repo, pr.headSha || pr.headRef || 'main');
    }
  }, [selectedRepo, form, setBaseCommit, setTargetCommit, loadFiles]);

  const {
    branches, loadingBranches, baseBranch, setBaseBranch,
    targetBranch, setTargetBranch, pulls, loadingPulls
  } = useBranchesAndPulls(githubToken, selectedRepo, handleSelectPull);

  const { baseCommits, targetCommits, loadingCommits } = useBranchCommits({
    githubToken, selectedRepo, compareMode, baseBranch,
    targetBranch, relativeFilePath, setBaseCommit, setTargetCommit, form
  });

  return {
    repos, loadingRepos, fetchRepos: refreshRepos,
    pulls, loadingPulls, selectedPull, handleSelectPull,
    branches, loadingBranches, baseBranch, setBaseBranch,
    targetBranch, setTargetBranch, baseCommits, targetCommits,
    loadingCommits, hardwareFiles, loadingFiles
  };
}
