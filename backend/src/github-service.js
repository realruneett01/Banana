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

/**
 * Verifies a GitHub access token or personal access token (PAT) and retrieves user profile.
 */
export async function verifyTokenAndGetUser(token) {
  if (!token) throw new Error('Missing GitHub access token');

  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid or expired GitHub access token. Please re-authenticate.');
    }
    const errorText = await response.text();
    throw new Error(`GitHub user profile fetch failed (HTTP ${response.status}): ${errorText}`);
  }

  const user = await response.json();
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

  const response = await fetch(
    `${GITHUB_API_URL}/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': USER_AGENT
      }
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list GitHub repositories (HTTP ${response.status}): ${errorText}`);
  }

  const repos = await response.json();
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

  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/branches?per_page=100`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch branches for ${owner}/${repo}: ${errorText}`);
  }

  const branches = await response.json();
  return branches.map(b => ({
    name: b.name,
    commitSha: b.commit?.sha
  }));
}

/**
 * Fetches commits for a repository, optionally filtered by branch and/or file path.
 */
export async function getRepoCommits(token, owner, repo, sha = '', filePath = '', perPage = 50) {
  if (!token) throw new Error('Missing GitHub access token');

  const params = new URLSearchParams({ per_page: String(perPage) });
  if (sha) params.append('sha', sha);
  if (filePath) params.append('path', filePath);

  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/commits?${params.toString()}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch commits for ${owner}/${repo}: ${errorText}`);
  }

  const commits = await response.json();
  return commits.map(c => ({
    hash: c.sha,
    shortHash: c.sha ? c.sha.substring(0, 7) : '',
    message: c.commit?.message?.split('\n')[0] || '',
    fullMessage: c.commit?.message || '',
    author: c.commit?.author?.name || c.author?.login || 'Unknown',
    authorAvatar: c.author?.avatar_url || null,
    date: c.commit?.author?.date || null
  }));
}

/**
 * Fetches pull requests for a repository.
 */
export async function getRepoPullRequests(token, owner, repo, state = 'open') {
  if (!token) throw new Error('Missing GitHub access token');

  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/pulls?state=${state}&per_page=50`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch pull requests for ${owner}/${repo}: ${errorText}`);
  }

  const pulls = await response.json();
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

  // Query git tree recursively for O(1) file discovery across the entire repository
  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch git tree for ${owner}/${repo} at ${ref}: ${errorText}`);
  }

  const data = await response.json();
  const tree = data.tree || [];

  const hardwareFiles = tree.filter(item => {
    if (item.type !== 'blob') return false;
    return /\.(kicad_pcb|kicad_sch|sch|brd)$/i.test(item.path);
  }).map(item => ({
    path: item.path,
    size: item.size,
    sha: item.sha,
    isPcb: /\.kicad_pcb$/i.test(item.path)
  }));

  return hardwareFiles;
}

/**
 * Downloads a specific version of a CAD file at a commit hash and writes it to disk.
 */
export async function downloadRepoFile(token, owner, repo, filePath, commitSha, destinationPath) {
  if (!token) throw new Error('Missing GitHub access token');

  const parentDir = path.dirname(destinationPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // If already cached on disk with size > 0, return cached path immediately
  if (fs.existsSync(destinationPath)) {
    try {
      const stat = fs.statSync(destinationPath);
      if (stat.size > 0) return destinationPath;
    } catch (_) {}
  }

  // 1. Fetch raw content directly using GitHub's raw content endpoint
  const rawUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(commitSha)}`;
  let response = await fetch(rawUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.raw+json',
      'User-Agent': USER_AGENT
    }
  });

  // 2. Fallback to raw.githubusercontent.com if needed
  if (!response.ok) {
    const fallbackUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(commitSha)}/${filePath}`;
    response = await fetch(fallbackUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': USER_AGENT
      }
    });
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to download ${filePath} at ${commitSha} from ${owner}/${repo} (HTTP ${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
  return destinationPath;
}
