# Banana 2.0 — Web Deployment: Detailed Implementation Plan

> Scope: everything needed to turn the current local-only desktop tool into a publicly hosted web service. The diff engine (`svg-diff-processor.js`, `kicad-pcb-parser.js`, `kicad-renderer.js`) is **not modified** — it is treated as a stable, tested black box. All work is wrapper infrastructure around it.

---

## Current State vs Target State

### What exists today
| Component | Current State |
|---|---|
| `backend/src/server.js` | Express API, all endpoints assume `repoPath` = absolute local filesystem path |
| `backend/src/git-extractor.js` | `extractFileFromCommit(repoPath, commitHash, ...)` — uses local `git show` |
| `backend/src/kicad-renderer.js` | Invokes `kicad-cli` from `config.kicadCliPath` — hardcoded local OS path |
| `backend/src/svg-diff-processor.js` | Pure in-process JS diff — **no changes needed** |
| `backend/src/kicad-pcb-parser.js` | Pure in-process JS parser — **no changes needed** |
| `frontend/src/App.jsx` | Hardcoded `repoPath` state, manual SHA entry, calls `localhost:5000` |
| **No Docker image** | Runs on host OS |
| **No queue** | Synchronous HTTP — `kicad-cli` export blocks the response for 3–8s |
| **No database** | No job history, no persistence |
| **No auth** | Single user on localhost |

### Target after this plan
- Any browser can upload two `.kicad_pcb` files directly → get a diff (no git required).
- Any browser can connect a GitHub repo → pick commits → get a diff.
- Backend runs inside Docker with `kicad-cli` installed.
- Jobs are queued via BullMQ + Redis (non-blocking response).
- Results stored in Postgres via Drizzle ORM.
- Deployed on Railway (or self-hosted VPS with `docker-compose`).

---

## Phase 0 — Prerequisites & Setup (Do Before Anything Else)

### 0.1 Verify `kicad-cli` shared-library dependencies (CRITICAL — unverified)

This is the only genuinely unknown step in the entire plan. **Do this before writing a single line of Docker config.**

```bash
# On a fresh Ubuntu 22.04 or Debian Bookworm Docker container:
docker run -it ubuntu:22.04 bash
apt-get update && apt-get install -y kicad
ldd $(which kicad-cli)
# Document every .so dependency printed — that list goes into the Dockerfile
```

If `kicad-cli` isn't in the Ubuntu repos at the required version, use the KiCad PPA:
```bash
apt-add-repository ppa:kicad/kicad-9.0-releases
apt-get update && apt-get install -y kicad-cli
```

**Verify it can actually export SVGs** inside the container:
```bash
kicad-cli pcb export svg --mode-multi --layers "F.Cu,B.Cu" --output /tmp/test/ /path/to/test.kicad_pcb
ls /tmp/test/
# Must produce *.svg files — if it fails, debug before continuing
```

### 0.2 Install new backend dependencies

```bash
cd backend
npm install bullmq ioredis drizzle-orm pg @octokit/auth-app octokit multer unzipper uuid dotenv
npm install -D drizzle-kit @types/pg
```

### 0.3 Environment variables schema

Create `backend/.env.example` (commit this; never commit actual `.env`):
```env
PORT=5000
DATABASE_URL=postgresql://banana:password@localhost:5432/banana
REDIS_URL=redis://localhost:6379
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=       # Multi-line PEM — use \n escaping or a file path
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=
KICAD_CLI_PATH=/usr/bin/kicad-cli   # overrides config.js auto-detection in web mode
MAX_UPLOAD_MB=200
MAX_DECOMPRESSED_MB=800
JOB_CONCURRENCY=2
```

---

## Phase 1 — Job Queue Infrastructure

### 1.1 Create `backend/src/queue.js`

```javascript
// backend/src/queue.js
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null // required by BullMQ
});

export const diffQueue = new Queue('diff-jobs', { connection });
export const diffQueueEvents = new QueueEvents('diff-jobs', { connection });
export { connection as redisConnection };
```

### 1.2 Create `backend/src/worker.js`

This is the new file that runs as a separate process. It contains the `kicad-cli` + diff logic that was previously inline in `server.js`.

```javascript
// backend/src/worker.js
import { Worker } from 'bullmq';
import { redisConnection } from './queue.js';
import { processGithubJob } from './jobs/github-job.js';
import { processUploadJob } from './jobs/upload-job.js';
import { processTwoFileJob } from './jobs/two-file-job.js';
import { db } from './db/client.js';
import { diffJobs } from './db/schema.js';
import { eq } from 'drizzle-orm';

new Worker('diff-jobs', async (job) => {
  const { mode, jobId } = job.data;

  await db.update(diffJobs)
    .set({ status: 'PROCESSING' })
    .where(eq(diffJobs.id, jobId));

  try {
    let result;
    if (mode === 'github')    result = await processGithubJob(job.data);
    else if (mode === 'upload') result = await processUploadJob(job.data);
    else if (mode === 'two-file') result = await processTwoFileJob(job.data);
    else throw new Error(`Unknown job mode: ${mode}`);

    await db.update(diffJobs)
      .set({ status: 'COMPLETE', resultJson: result })
      .where(eq(diffJobs.id, jobId));

    return result;
  } catch (err) {
    await db.update(diffJobs)
      .set({ status: 'FAILED', errorMessage: err.message })
      .where(eq(diffJobs.id, jobId));
    throw err;
  }
}, {
  connection: redisConnection,
  concurrency: parseInt(process.env.JOB_CONCURRENCY || '2')
});

console.log('Worker started, listening for diff jobs...');
```

### 1.3 Shared job utility: `backend/src/jobs/run-diff.js`

This extracts the core render+diff logic from `server.js` into a reusable function that all job types call:

```javascript
// backend/src/jobs/run-diff.js
import path from 'path';
import fs from 'fs';
import { renderKicadFile } from '../kicad-renderer.js';
import { processSvgDiff } from '../svg-diff-processor.js';

/**
 * Given two .kicad_pcb file paths (already on disk), run kicad-cli export
 * on both, then processSvgDiff per layer. Returns the same resultJson shape
 * as the current /api/diff/process endpoint.
 */
export async function runDiff(basePcbPath, targetPcbPath, isPcb = true) {
  const [baseRenders, targetRenders] = await Promise.all([
    renderKicadFile(basePcbPath, isPcb),
    renderKicadFile(targetPcbPath, isPcb),
  ]);

  const readSvgs = (renderResult) => renderResult.svgFiles.map(filePath => ({
    filename: path.basename(filePath),
    content: fs.readFileSync(filePath, 'utf8')
  }));

  const baseSvgs   = readSvgs(baseRenders);
  const targetSvgs = readSvgs(targetRenders);

  const sideBySideBase   = [];
  const sideBySideTarget = [];
  const allModifications = [];

  for (const baseSvg of baseSvgs) {
    const matchingTarget = targetSvgs.find(t => t.filename === baseSvg.filename);
    if (matchingTarget) {
      const { baseSvg: ab, targetSvg: at, modifications } =
        processSvgDiff(baseSvg.content, matchingTarget.content, baseSvg.filename);
      allModifications.push(...modifications.map(m => ({ ...m, layer: baseSvg.filename })));
      sideBySideBase.push({ filename: baseSvg.filename, content: ab });
      sideBySideTarget.push({ filename: matchingTarget.filename, content: at });
    } else {
      sideBySideBase.push(baseSvg);
      allModifications.push({ type: 'delete_layer', layer: baseSvg.filename, id: baseSvg.filename });
    }
  }
  for (const tSvg of targetSvgs) {
    if (!baseSvgs.find(b => b.filename === tSvg.filename)) {
      sideBySideTarget.push(tSvg);
      allModifications.push({ type: 'add_layer', layer: tSvg.filename, id: tSvg.filename });
    }
  }

  // Cleanup render temp dirs
  try { fs.rmSync(baseRenders.outputDir,   { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(targetRenders.outputDir, { recursive: true, force: true }); } catch (_) {}

  return {
    base:       { svgs: baseSvgs },
    target:     { svgs: targetSvgs },
    sideBySide: { base: sideBySideBase, target: sideBySideTarget },
    modifications: allModifications
  };
}
```

---

## Phase 2 — Database Layer (Drizzle + Postgres)

### 2.1 Create `backend/db/schema.js`

```javascript
// backend/db/schema.js
import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const jobStatusEnum = pgEnum('job_status', ['PENDING', 'PROCESSING', 'COMPLETE', 'FAILED']);

export const diffJobs = pgTable('diff_jobs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  mode:          text('mode').notNull(),          // 'github' | 'upload' | 'two-file'
  repoUrl:       text('repo_url'),                // null for upload/two-file modes
  baseCommit:    text('base_commit'),
  targetCommit:  text('target_commit'),
  status:        jobStatusEnum('status').notNull().default('PENDING'),
  resultJson:    jsonb('result_json'),
  errorMessage:  text('error_message'),
  userId:        uuid('user_id'),                 // nullable — for future auth
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  completedAt:   timestamp('completed_at'),
});

// Placeholder for future auth — not wired yet, but column is ready
export const users = pgTable('users', {
  id:        uuid('id').primaryKey().defaultRandom(),
  email:     text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const githubInstallations = pgTable('github_installations', {
  id:             uuid('id').primaryKey().defaultRandom(),
  installationId: text('installation_id').notNull().unique(),
  accountLogin:   text('account_login').notNull(),
  userId:         uuid('user_id'),   // nullable — link to user once auth exists
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  revokedAt:      timestamp('revoked_at'),
});
```

### 2.2 Create `backend/db/client.js`

```javascript
// backend/db/client.js
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

### 2.3 Create `backend/drizzle.config.js`

```javascript
// backend/drizzle.config.js
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './db/schema.js',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL }
});
```

### 2.4 Run first migration

```bash
cd backend
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

## Phase 3 — Three Job Handlers

### 3.1 Two-File Upload Mode (build this first — highest value, least infrastructure needed)

`backend/src/jobs/two-file-job.js`:
```javascript
import path from 'path';
import fs from 'fs';
import { runDiff } from './run-diff.js';

export async function processTwoFileJob({ jobId, basePcbPath, targetPcbPath }) {
  const jobDir = path.dirname(basePcbPath); // both files land in /tmp/banana-jobs/<jobId>/
  try {
    return await runDiff(basePcbPath, targetPcbPath, true);
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
```

**New API endpoint** in `server.js`:
```javascript
// POST /api/diff/two-file
// Accepts multipart form with two files: 'base' and 'target'
import multer from 'multer';
const upload = multer({
  dest: '/tmp/banana-uploads/',
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_MB || '200') * 1024 * 1024 }
});

app.post('/api/diff/two-file', upload.fields([
  { name: 'base', maxCount: 1 },
  { name: 'target', maxCount: 1 }
]), async (req, res) => {
  if (!req.files?.base?.[0] || !req.files?.target?.[0]) {
    return res.status(400).json({ error: 'Both base and target .kicad_pcb files are required' });
  }

  const jobId = randomUUID();
  const jobDir = path.join('/tmp/banana-jobs', jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  // Move uploaded temp files to job dir with proper names
  const basePath   = path.join(jobDir, 'base.kicad_pcb');
  const targetPath = path.join(jobDir, 'target.kicad_pcb');
  fs.renameSync(req.files.base[0].path, basePath);
  fs.renameSync(req.files.target[0].path, targetPath);

  // Create DB row
  await db.insert(diffJobs).values({ id: jobId, mode: 'two-file', status: 'PENDING' });

  // Enqueue
  await diffQueue.add('process-diff', { mode: 'two-file', jobId, basePcbPath: basePath, targetPcbPath: targetPath });

  res.json({ jobId });
});
```

### 3.2 Git Zip Upload Mode

`backend/src/jobs/upload-job.js`:
```javascript
import path from 'path';
import fs from 'fs';
import unzipper from 'unzipper';
import simpleGit from 'simple-git';
import { runDiff } from './run-diff.js';

export async function processUploadJob({ jobId, extractDir, baseCommit, targetCommit, relativeFilePath }) {
  const jobDir = path.dirname(extractDir);
  try {
    // Validate it's actually a git repo
    const repoGit = simpleGit(extractDir);
    if (!fs.existsSync(path.join(extractDir, '.git'))) {
      throw new Error('Uploaded zip does not contain a .git folder at root level');
    }

    // Worktree checkout approach
    const baseDir   = path.join(jobDir, '_base');
    const targetDir = path.join(jobDir, '_target');
    await repoGit.raw(['worktree', 'add', baseDir,   baseCommit]);
    await repoGit.raw(['worktree', 'add', targetDir, targetCommit]);

    const basePcbPath   = path.join(baseDir,   relativeFilePath);
    const targetPcbPath = path.join(targetDir, relativeFilePath);

    return await runDiff(basePcbPath, targetPcbPath, true);
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
```

**Security guards** for zip extraction — add these checks before the extract:
```javascript
// Zip bomb: cap decompressed bytes
// Path traversal: verify no entry path starts with '../' or absolute '/'
const MAX_DECOMPRESSED = parseInt(process.env.MAX_DECOMPRESSED_MB || '800') * 1024 * 1024;
let totalBytes = 0;
// These guards must be implemented when using unzipper — check their docs
// for the exact API to intercept each entry before writing it.
```

### 3.3 GitHub App Mode

`backend/src/jobs/github-job.js`:
```javascript
import { createAppAuth } from '@octokit/auth-app';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import { runDiff } from './run-diff.js';

async function getInstallationToken(installationId) {
  const auth = createAppAuth({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    installationId,
  });
  const { token } = await auth({ type: 'installation' });
  return token;
}

export async function processGithubJob({ jobId, repoUrl, installationId, baseCommit, targetCommit, relativeFilePath }) {
  const jobDir = path.join('/tmp/banana-jobs', jobId);
  try {
    const token = await getInstallationToken(installationId);
    const authedUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);

    const git = simpleGit();
    await git.clone(authedUrl, jobDir, ['--no-checkout', '--depth=50']); // shallow clone reduces disk/time

    const repoGit = simpleGit(jobDir);
    const baseDir   = path.join(jobDir, '_base');
    const targetDir = path.join(jobDir, '_target');

    // Ensure both commits are available (shallow clone might need to deepen)
    await repoGit.raw(['fetch', '--depth=1', 'origin', baseCommit]);
    await repoGit.raw(['fetch', '--depth=1', 'origin', targetCommit]);
    await repoGit.raw(['worktree', 'add', baseDir,   baseCommit]);
    await repoGit.raw(['worktree', 'add', targetDir, targetCommit]);

    const basePcbPath   = path.join(baseDir,   relativeFilePath);
    const targetPcbPath = path.join(targetDir, relativeFilePath);

    return await runDiff(basePcbPath, targetPcbPath, true);
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
```

---

## Phase 4 — New API Endpoints

### 4.1 Add to `server.js`

```javascript
// GET /api/diff/:jobId — poll job status
app.get('/api/diff/:jobId', async (req, res) => {
  const job = await db.query.diffJobs.findFirst({
    where: eq(diffJobs.id, req.params.jobId)
  });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'COMPLETE') {
    return res.json({ status: 'COMPLETE', result: job.resultJson });
  }
  if (job.status === 'FAILED') {
    return res.json({ status: 'FAILED', error: job.errorMessage });
  }
  return res.json({ status: job.status });
});

// GET /api/github/repos — list repos accessible to an installation
app.get('/api/github/repos', async (req, res) => {
  const { installationId } = req.query;
  if (!installationId) return res.status(400).json({ error: 'installationId required' });
  const token = await getInstallationToken(installationId);
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.apps.listReposAccessibleToInstallation();
  res.json({ repos: data.repositories.map(r => ({ id: r.id, fullName: r.full_name, cloneUrl: r.clone_url })) });
});

// GET /api/github/commits — list commits for a repo/branch
app.get('/api/github/commits', async (req, res) => {
  const { installationId, owner, repo, branch, filePath } = req.query;
  const token = await getInstallationToken(installationId);
  const octokit = new Octokit({ auth: token });
  const params = { owner, repo, sha: branch, per_page: 30 };
  if (filePath) params.path = filePath;
  const { data } = await octokit.rest.repos.listCommits(params);
  res.json({ commits: data.map(c => ({
    sha: c.sha,
    shortSha: c.sha.substring(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author.name,
    date: c.commit.author.date
  }))});
});

// POST /api/diff/github — enqueue a GitHub diff job
app.post('/api/diff/github', async (req, res) => {
  const { installationId, repoUrl, baseCommit, targetCommit, relativeFilePath } = req.body;
  const jobId = randomUUID();
  await db.insert(diffJobs).values({ id: jobId, mode: 'github', repoUrl, baseCommit, targetCommit, status: 'PENDING' });
  await diffQueue.add('process-diff', { mode: 'github', jobId, repoUrl, installationId, baseCommit, targetCommit, relativeFilePath });
  res.json({ jobId });
});
```

### 4.2 GitHub App webhook handler

```javascript
// POST /api/github/webhook — handle installation created/deleted events
app.post('/api/github/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-hub-signature-256'];
  // Verify HMAC signature using GITHUB_WEBHOOK_SECRET — do not skip this
  const event = req.headers['x-github-event'];
  const body  = JSON.parse(req.body);

  if (event === 'installation' && body.action === 'deleted') {
    await db.update(githubInstallations)
      .set({ revokedAt: new Date() })
      .where(eq(githubInstallations.installationId, String(body.installation.id)));
  }
  if (event === 'installation' && body.action === 'created') {
    await db.insert(githubInstallations).values({
      installationId: String(body.installation.id),
      accountLogin:   body.installation.account.login,
    }).onConflictDoNothing();
  }
  res.sendStatus(200);
});
```

### 4.3 Rate limiting

```javascript
import rateLimit from 'express-rate-limit';

const diffLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,                    // 20 diff jobs per IP per 15 min
  message: { error: 'Too many diff requests. Please wait before submitting another.' }
});

app.use('/api/diff', diffLimiter);
```

```bash
npm install express-rate-limit
```

---

## Phase 5 — Docker Image

### 5.1 `Dockerfile`

```dockerfile
# Stage 1: Build-time (npm ci)
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
RUN npm ci

COPY . .
RUN npm run build --workspace=frontend   # produces frontend/dist/

# Stage 2: Runtime image
FROM node:22-bookworm-slim AS runtime

# Install git (needed for git worktree operations) and kicad-cli
# IMPORTANT: verify this apt source produces the same SVG output as your local KiCad 10.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      software-properties-common \
 && add-apt-repository --yes ppa:kicad/kicad-9.0-releases \
 && apt-get update \
 && apt-get install -y --no-install-recommends kicad-cli \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only production node_modules
COPY --from=builder /app/node_modules         ./node_modules
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/frontend/dist        ./frontend/dist

# Copy source (only backend — frontend is static)
COPY backend/ ./backend/
COPY package.json ./

# Static frontend will be served by Express in production
# (add app.use(express.static('frontend/dist')) to server.js — see Phase 6)

EXPOSE 5000
# Default: API server. Worker overrides CMD in docker-compose.
CMD ["node", "backend/src/server.js"]
```

> ⚠️ **The `ldd` verification from Phase 0 must be done before finalising this Dockerfile.** If `kicad-cli` needs additional shared libraries not pulled in by `apt-get install kicad-cli`, add explicit `COPY --from=kicad-base` lines for them.

### 5.2 `docker-compose.yml`

```yaml
version: '3.9'

services:
  api:
    build: .
    command: node backend/src/server.js
    ports:
      - "5000:5000"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      GITHUB_APP_ID: ${GITHUB_APP_ID}
      GITHUB_APP_PRIVATE_KEY: ${GITHUB_APP_PRIVATE_KEY}
      GITHUB_APP_CLIENT_ID: ${GITHUB_APP_CLIENT_ID}
      GITHUB_APP_CLIENT_SECRET: ${GITHUB_APP_CLIENT_SECRET}
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET}
      MAX_UPLOAD_MB: ${MAX_UPLOAD_MB:-200}
      MAX_DECOMPRESSED_MB: ${MAX_DECOMPRESSED_MB:-800}
      KICAD_CLI_PATH: /usr/bin/kicad-cli
    depends_on:
      - redis
      - postgres
    volumes:
      - /tmp/banana-jobs:/tmp/banana-jobs
      - /tmp/banana-uploads:/tmp/banana-uploads

  worker:
    build: .
    command: node backend/src/worker.js
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      GITHUB_APP_ID: ${GITHUB_APP_ID}
      GITHUB_APP_PRIVATE_KEY: ${GITHUB_APP_PRIVATE_KEY}
      JOB_CONCURRENCY: ${JOB_CONCURRENCY:-2}
      KICAD_CLI_PATH: /usr/bin/kicad-cli
    depends_on:
      - redis
      - postgres
    volumes:
      - /tmp/banana-jobs:/tmp/banana-jobs

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: banana
      POSTGRES_USER: banana
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  redis_data:
  postgres_data:
```

---

## Phase 6 — Frontend Changes

### 6.1 Serve static frontend from Express (production)

Add to `server.js`:
```javascript
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist');

// Serve built frontend (only in production / when dist/ exists)
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
}
```

### 6.2 Update `frontend/src/App.jsx` — new input modes

**Mode 1: Two-File Drop (highest priority — remove the git-path requirement entirely)**

Replace the current form with a three-tab UI:
- Tab 1: "**Two Files**" — drag-and-drop two `.kicad_pcb` files directly. No git needed.
- Tab 2: "**GitHub Repo**" — Connect GitHub App → pick repo → pick branch → pick base/target commits from a list (with message + date).
- Tab 3: "**Local Repo**" (keep current form as-is — still works for local desktop use).

**Polling logic** (replaces the synchronous call):

```javascript
// After POSTing to /api/diff/two-file, /api/diff/github, or /api/diff/upload:
const pollJob = async (jobId) => {
  setLoading(true);
  setLoadingStage('Processing your board diff…');
  const interval = setInterval(async () => {
    const res = await fetch(`http://localhost:5000/api/diff/${jobId}`);
    const data = await res.json();
    if (data.status === 'COMPLETE') {
      clearInterval(interval);
      setDiffData(data.result);
      setLoading(false);
    } else if (data.status === 'FAILED') {
      clearInterval(interval);
      setLoading(false);
      message.error(`Diff failed: ${data.error}`);
    }
    // PENDING / PROCESSING — keep polling
  }, 1500);
};
```

### 6.3 GitHub App OAuth flow

The GitHub App installation redirect goes to `https://yourapp.com/github/callback`.

```javascript
// frontend: start installation
const connectGitHub = () => {
  window.location.href = `https://github.com/apps/YOUR_APP_NAME/installations/new`;
};

// After redirect back, URL contains ?installation_id=12345&setup_action=install
// Store installationId in component state, then call /api/github/repos to list repos
```

Backend callback handler:
```javascript
app.get('/github/callback', async (req, res) => {
  const { installation_id } = req.query;
  // Store in DB (already handled by webhook), redirect to app with installationId in URL hash
  res.redirect(`/?installationId=${installation_id}`);
});
```

### 6.4 Commit picker component (replaces manual SHA input)

```jsx
// New component: CommitPicker.jsx
// Props: installationId, repoFullName, label ('Base' | 'Target')
// - Calls GET /api/github/commits?installationId=...&owner=...&repo=...&filePath=...
// - Renders a searchable Select dropdown with commits as:
//   "abc1234 — 2 days ago — fix SPI2_CS routing (Alice)"
// - On select, calls onCommitSelected(sha)
```

---

## Phase 7 — GitHub App Registration

Steps to perform manually in the GitHub App dashboard (not code):

1. Go to GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
2. **App name**: Banana PCB Diff (or similar)
3. **Homepage URL**: your deployed domain
4. **Callback URL**: `https://yourapp.com/github/callback`
5. **Webhook URL**: `https://yourapp.com/api/github/webhook`
6. **Webhook secret**: generate a random string → put in `GITHUB_WEBHOOK_SECRET` env var
7. **Permissions** (repository-level, read-only):
   - Contents: Read
   - Metadata: Read
8. **Subscribe to events**: `installation`, `installation_repositories`
9. After creating, note the **App ID** and generate a **Private Key** (PEM file).
10. Store `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (multi-line PEM, escaped as `\n`) as env secrets.

---

## Phase 8 — Deploy to Railway

### 8.1 Step-by-step

1. Push all changes to the GitHub repo.
2. Go to `railway.app` → New Project → Deploy from GitHub repo → select this repo.
3. In Railway project settings, add:
   - **Redis** service from the template catalog.
   - **Postgres** service from the template catalog.
   - Railway auto-generates `REDIS_URL` and `DATABASE_URL` — reference them in service env vars.
4. Create two services from the same repo:
   - `api` service → Start command: `node backend/src/server.js`
   - `worker` service → Start command: `node backend/src/worker.js`
5. Set all environment variables from `backend/.env.example` on both services.
6. After first deploy, run migrations:
   ```bash
   # From Railway's shell (or locally with DATABASE_URL pointing to Railway Postgres)
   npx drizzle-kit migrate
   ```
7. Test with a real diff job immediately (not just health check).
8. Attach custom domain via Railway's networking panel.

---

## Phase 9 — Security Hardening Checklist

- [ ] **Zip bomb protection**: cap total decompressed bytes at `MAX_DECOMPRESSED_MB` — assert on every zip entry, not just total upload size.
- [ ] **Zip path traversal**: verify unzipper library sanitizes `../` entries, or add explicit entry path validation.
- [ ] **GitHub webhook HMAC**: verify `x-hub-signature-256` on every webhook request before processing — reject without verification.
- [ ] **Installation token lifetime**: never cache installation tokens beyond a single job's lifetime — fetch fresh per job.
- [ ] **GitHub App private key**: stored as encrypted Railway secret, never committed, never logged in any `console.log`.
- [ ] **Job temp directory cleanup**: `finally` block in every job handler — not just the happy path.
- [ ] **Rate limiting**: 20 diff jobs per IP per 15 minutes on `/api/diff/*`.
- [ ] **File type validation**: only accept `.kicad_pcb` / `.kicad_sch` — reject any uploaded file with wrong extension or magic bytes.
- [ ] **Max clone size**: reject GitHub repos where `.git` is extremely large (set a configurable threshold).
- [ ] **kicad-cli network isolation**: confirm it doesn't need network egress at export time — if it doesn't, configure worker container with restricted egress.
- [ ] **Terms of Service + Privacy Policy**: must be live before inviting any non-developer user to upload real board files.
- [ ] **Data deletion path**: `/api/jobs/:jobId` DELETE endpoint — removes DB row, confirms temp files are already gone.
- [ ] **Error monitoring**: Sentry (or similar) on both `api` and `worker` services before public launch.

---

## Phase 10 — Pre-Launch Validation

### Local Docker smoke test
```bash
docker compose up -d
# Upload two test .kicad_pcb files via the UI
# Verify the diff renders correctly
# Confirm temp files are cleaned up after job completes
docker compose logs worker -f
```

### End-to-end test matrix
| Test case | Expected result |
|---|---|
| Two identical `.kicad_pcb` files | 0 modifications |
| Two files with one moved component | 1 `modify` entry in audit list |
| File with added copper trace | `add` entries in audit list, trace highlighted green |
| GitHub repo + two commits | Diff renders same as local path mode |
| 200MB zip upload | Accepted, processed, temp files deleted after |
| 250MB zip upload | Rejected by `MAX_UPLOAD_MB` limit |
| Zip with `../etc/passwd` entry | Rejected by path traversal guard |
| 51st diff request in 15 min | Rate limit 429 response |
| GitHub App installation revoked | Next token fetch fails gracefully, DB row marked revoked |

---

## Build Order (Non-Negotiable Sequence)

1. **Phase 0** — `kicad-cli` in Docker verified working ← block on this
2. **Phase 1** — BullMQ queue + `worker.js` + `run-diff.js`
3. **Phase 2** — Drizzle schema + migrations
4. **Phase 3.1 + 4.1 partial** — Two-file upload endpoint only (fastest path to a working web demo)
5. **Phase 5** — Docker image + compose
6. **Phase 6.1 + 6.2** — Frontend two-file drag-drop tab + polling UI
7. **Deploy to Railway** with two-file mode only — prove the full stack works in production
8. **Phase 3.2 + 4.1** — Zip upload mode
9. **Phase 7 + 3.3 + 6.3 + 6.4** — GitHub App + repo/commit picker
10. **Phase 9** — Full security checklist before any public announcement
11. **Phase 10** — End-to-end validation matrix

---

## Open Questions (Resolve Before Starting)

> [!IMPORTANT]
> **Q1: Which kicad-cli version will be in Docker?** The local machine runs KiCad 10.0. The current stable Ubuntu PPA may offer 9.0. SVG output format differences between versions could cause silent diff engine regressions. Verify SVG output compatibility between both versions against your existing test boards before committing to a Docker base image.

> [!IMPORTANT]
> **Q2: Two-file mode — does it need git at all?** If users just drop two `.kicad_pcb` files directly, no git worktree is needed. The job handler just runs `runDiff(basePath, targetPath)` immediately. This is both the simplest and highest-value mode — build it first in isolation before touching any of the git infrastructure.

> [!WARNING]
> **Q3: Auth timing.** The plan defers auth/accounts to after launch. But `/api/github/repos` returns a user's private repo list. Without auth, any caller who has an `installationId` (which appears in the redirect URL) can list repos. Decide before launch whether the GitHub mode needs at least a session cookie to protect the installation ID, or whether the ID alone is acceptable as a bearer token for the MVP.
