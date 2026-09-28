import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_OAUTH_URL = 'https://github.com/login/oauth';
const USER_AGENT = 'Banana-Hardware-Diff-Studio';

/**
 * Generates the GitHub OAuth authorization URL.
 */
export function getOAuthAuthorizeUrl(state = 'banana_auth', callbackUrl = null) {
  if (!config.githubClientId) {
    throw new Error('GitHub Client ID is not configured. Please set GITHUB_CLIENT_ID in your environment.');
  }

  const redirectUri = callbackUrl || config.githubCallbackUrl;
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: redirectUri,
    scope: 'repo,read:user',
    state: state
  });

  return `${GITHUB_OAUTH_URL}/authorize?${params.toString()}`;
}

/**
 * Exchanges a temporary OAuth code for a GitHub access token.
 */
export async function exchangeCodeForToken(code) {
  if (!config.githubClientId || !config.githubClientSecret) {
    throw new Error('GitHub OAuth Client ID or Client Secret not configured.');
  }

  const response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code: code
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub token exchange failed (HTTP ${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }

  return data.access_token;
}

async function fetchGithubJson(endpoint, token, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': USER_AGENT,
      ...options.headers
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid or expired GitHub access token. Please re-authenticate.');
    }
    const errorText = await response.text();
    throw new Error(`GitHub request failed for ${url} (HTTP ${response.status}): ${errorText}`);
  }
  return response.json();
}

/**
 * Verifies a GitHub access token or personal access token (PAT) and retrieves user profile.
 */
export async function verifyTokenAndGetUser(token) {
  if (!token) throw new Error('Missing GitHub access token');

  const user = await fetchGithubJson('/user', token);
  return {
    id: user.id,
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
    publicRepos: user.public_repos || 0,
    totalPrivateRepos: user.total_private_repos || 0
  };
}

/**
 * Lists repositories the authenticated user has access to.
 */
export async function getUserRepositories(token, page = 1, perPage = 100) {
  if (!token) throw new Error('Missing GitHub access token');
  const path = `/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`;
  const repos = await fetchGithubJson(path, token);

  return repos.map(r => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner?.login,
    ownerAvatar: r.owner?.avatar_url,
    isPrivate: r.private,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch || 'main',
    description: r.description || '',
    updatedAt: r.updated_at
  }));
}

/**
 * Fetches branches for a repository.
 */
export async function getRepoBranches(token, owner, repo) {
  if (!token) throw new Error('Missing GitHub access token');
  const branches = await fetchGithubJson(`/repos/${owner}/${repo}/branches?per_page=100`, token);

  return branches.map(b => ({
    name: b.name,
    commitSha: b.commit?.sha
  }));
}

/**
 * Fetches commits for a repository, optionally filtered by branch and/or file path.
 */
function formatCommitItem(c) {
  const commitMsg = c.commit?.message || '';
  const authorName = c.commit?.author?.name || c.author?.login || 'Unknown';
  return {
    hash: c.sha,
    shortHash: c.sha ? c.sha.substring(0, 7) : '',
    message: commitMsg.split('\n')[0],
    fullMessage: commitMsg,
    author: authorName,
    authorAvatar: c.author?.avatar_url || null,
    date: c.commit?.author?.date || null
  };
}

function resolveCommitQuery(options, restArgs) {
  if (typeof options === 'object' && options !== null) {
    return {
      sha: options.sha,
      pathFilter: options.filePath || options.path,
      limit: options.perPage || 50
    };
  }
  return {
    sha: options,
    pathFilter: restArgs[0],
    limit: restArgs[1] || 50
  };
}

/**
 * Fetches commits for a repository, optionally filtered by branch and/or file path.
 */
export async function getRepoCommits(token, owner, repo, options = {}) {
  if (!token) throw new Error('Missing GitHub access token');

  const { sha, pathFilter, limit } = resolveCommitQuery(options, [arguments[4], arguments[5]]);
  const params = new URLSearchParams({ per_page: String(limit) });
  if (sha) params.append('sha', sha);
  if (pathFilter) params.append('path', pathFilter);

  const commits = await fetchGithubJson(`/repos/${owner}/${repo}/commits?${params.toString()}`, token);
  return commits.map(formatCommitItem);
}

/**
 * Fetches pull requests for a repository.
 */
export async function getRepoPullRequests(token, owner, repo, state = 'open') {
  if (!token) throw new Error('Missing GitHub access token');
  const pulls = await fetchGithubJson(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=50`, token);

  return pulls.map(pr => ({
    id: pr.id,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    author: pr.user?.login,
    authorAvatar: pr.user?.avatar_url,
    baseRef: pr.base?.ref,
    baseSha: pr.base?.sha,
    headRef: pr.head?.ref,
    headSha: pr.head?.sha,
    headLabel: pr.head?.label,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    htmlUrl: pr.html_url
  }));
}

/**
 * Scans the repository tree for hardware CAD files (.kicad_pcb, .kicad_sch).
 */
export async function getRepoHardwareFiles(token, owner, repo, ref = 'main') {
  if (!token) throw new Error('Missing GitHub access token');
  const data = await fetchGithubJson(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token);
  const tree = data.tree || [];

  return tree.filter(item => {
    if (item.type !== 'blob') return false;
    return /\.(kicad_pcb|kicad_sch|sch|brd)$/i.test(item.path);
  }).map(item => ({
    path: item.path,
    size: item.size,
    sha: item.sha,
    isPcb: /\.kicad_pcb$/i.test(item.path)
  }));
}

function resolveDownloadParams(options, restArgs) {
  if (typeof options === 'object' && options !== null) {
    return options;
  }
  return {
    owner: options,
    repo: restArgs[0],
    filePath: restArgs[1],
    commitSha: restArgs[2],
    destinationPath: restArgs[3]
  };
}

async function fetchRawFileBuffer(token, params) {
  const { owner, repo, filePath, commitSha } = params;
  const rawUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(commitSha)}`;
  const fallbackUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(commitSha)}/${filePath}`;

  const headers = { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT };
  let response = await fetch(rawUrl, {
    headers: { ...headers, 'Accept': 'application/vnd.github.raw+json' }
  });

  if (!response.ok) {
    response = await fetch(fallbackUrl, { headers });
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to download ${filePath} at ${commitSha} from ${owner}/${repo} (HTTP ${response.status}): ${errText}`);
  }

  return response.arrayBuffer();
}

async function isExistingFileNonEmpty(dest) {
  try {
    const stat = await fs.promises.stat(dest);
    return stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Downloads a specific version of a CAD file at a commit hash and writes it to disk.
 */
export async function downloadRepoFile(token, options) {
  if (!token) throw new Error('Missing GitHub access token');

  const params = resolveDownloadParams(options, Array.prototype.slice.call(arguments, 2));
  const dest = params.destinationPath;

  const parentDir = path.dirname(dest);
  await fs.promises.mkdir(parentDir, { recursive: true });

  if (await isExistingFileNonEmpty(dest)) {
    return dest;
  }

  const arrayBuffer = await fetchRawFileBuffer(token, params);
  await fs.promises.writeFile(dest, Buffer.from(arrayBuffer));
  return dest;
}

