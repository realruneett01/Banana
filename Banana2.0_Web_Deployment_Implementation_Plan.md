# Banana 2.0 — Web Deployment Implementation Plan
### Server-side KiCad diffing, GitHub + local repo upload, Docker, Drizzle ORM

_Scope: this plan covers the web-hosted version of Banana 2.0 only. The desktop
(Electron) build reuses the same backend/core code and is addressed briefly at
the end. The existing `svg-diff-processor.js` / `kicad-pcb-parser.js` diffing
logic is NOT modified by this plan — it is treated as a stable, already-audited
core that the web layer wraps._

---

## 1. Goals

1. Let a user provide board history two ways:
   - **GitHub repo access** via a GitHub App connection (user picks repos
     at install time; no raw token pasting) — then a repo/branch/commit
     picker in the UI, not manual SHA entry.
   - **Local repo upload** — a zip of a `.git`-containing folder, or a
     browser folder picker (`webkitdirectory`) reconstructing the directory
     server-side — for repos the user doesn't want to push anywhere.
2. Process diffs server-side using `kicad-cli` inside Docker, safely under
   concurrent multi-user load.
3. Keep the door open for persistence (job history, accounts, shareable
   result links) without committing to it today.
4. Reuse the same backend for the Electron desktop build later.

---

## 2. High-Level Architecture

```
                          ┌─────────────────────┐
   Browser (React/Vite)   │   Frontend (SPA)     │
   - GitHub URL form       │   built + served     │
   - Zip / folder upload   │   as static assets   │
                          └──────────┬───────────┘
                                     │ HTTP (multipart upload / JSON)
                                     ▼
                          ┌─────────────────────┐
                          │   Express API layer  │
                          │   /api/diff (enqueue) │
                          │   /api/diff/:id (poll)│
                          └──────────┬───────────┘
                                     │ enqueue job
                                     ▼
                          ┌─────────────────────┐
                          │  BullMQ + Redis      │
                          │  job queue           │
                          └──────────┬───────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │  Worker process       │
                          │  - clone/extract repo │
                          │  - checkout 2 commits │
                          │  - kicad-cli export   │
                          │  - processSvgDiff()   │  <-- unchanged core
                          │  - cleanup temp dir   │
                          └──────────┬───────────┘
                                     │ result JSON
                                     ▼
                          ┌─────────────────────┐
                          │  Postgres (Drizzle)   │
                          │  DiffJob / Repo /     │
                          │  (User — future)      │
                          └─────────────────────┘
```

Both API and Worker run in the same Docker image (or two images sharing the
same base) so `kicad-cli` and its shared libs only need to be built once.

---

## 3. Input Mode 1 — GitHub Repo Access

### Important correction from the original ask: do NOT collect raw Personal Access Tokens

Asking users to generate and paste a GitHub PAT is a real trust barrier —
especially for hardware teams with proprietary board designs (exactly
CounciL's own situation: IRIS/defense-adjacent work makes "paste your
GitHub token into a random SaaS" a non-starter for any security-conscious
customer). It also tends to over-scope (a PAT with `repo` scope grants
access to every repo the user can touch, not just the one they want
diffed).

**Use a GitHub App instead of asking for a token directly.** A GitHub App:
- Lets the user pick **exactly which repositories** to grant access to at
  install time (not all-or-nothing like a classic OAuth App scope).
- Issues short-lived installation tokens server-side — Banana never asks
  the user to generate or paste anything themselves.
- Is revocable by the user at any time from their GitHub settings, with
  no action needed on Banana's side.
- Reads much better on a security/trust page than "paste a token here."

### Flow (GitHub App-based)
1. User clicks **"Connect GitHub"** → redirected to GitHub's App
   installation page → picks specific repos to grant access to → GitHub
   redirects back with an installation ID.
2. Backend exchanges the installation ID for a short-lived installation
   access token (via GitHub's App JWT auth flow) whenever a job needs to
   clone — **tokens are generated per-job, not stored long-term.**
3. Backend calls GitHub's API to list the repos/branches/commits the
   installation has access to, and the frontend renders a repo picker +
   commit picker (branch dropdown → commit list) instead of asking the
   user to know/paste SHAs manually. This is also the accessibility win
   from the feature list below — most users don't know how to find a
   commit SHA, but they can recognize "3 days ago — fixed SPI2_CS
   routing" in a list.
4. Worker uses the short-lived installation token with `simple-git`,
   exactly as before, but the token is fetched fresh per job and never
   touches the database.

```javascript
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';

async function getInstallationToken(installationId) {
  const auth = createAppAuth({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    installationId,
  });
  const { token } = await auth({ type: 'installation' });
  return token; // short-lived, ~1 hour — fine for a single clone+diff job
}

async function listAccessibleRepos(installationId) {
  const token = await getInstallationToken(installationId);
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.apps.listReposAccessibleToInstallation();
  return data.repositories; // render as a picker in the frontend
}

async function fetchGithubRepo(repoUrl, installationId, jobDir) {
  const token = await getInstallationToken(installationId);
  const authedUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);

  const git = simpleGit();
  await git.clone(authedUrl, jobDir, ['--no-checkout']);

  const repoGit = simpleGit(jobDir);
  const baseDir = path.join(jobDir, '_base');
  const targetDir = path.join(jobDir, '_target');

  await repoGit.raw(['worktree', 'add', baseDir, baseCommit]);
  await repoGit.raw(['worktree', 'add', targetDir, targetCommit]);

  return { baseDir, targetDir };
}
```

### What to persist
Only the **installation ID** (not a token) needs to live in the database,
linked to whichever user/session connected it — e.g. a `GithubInstallation`
table with `installationId`, `userId` (nullable until accounts exist),
`accountLogin`, `createdAt`. Installation IDs are not secrets on their own
(they're not usable without your app's private key), so this is safe to
store in plaintext, unlike a token.

### Security notes (do not skip)
- **GitHub App private key**: stored as an encrypted environment secret
  (Railway/Render secret manager, or `.env` excluded from git on a VPS) —
  never committed, never logged.
- **Installation tokens are request-scoped only** — fetch fresh per job,
  never cache them beyond a single job's lifetime.
- **Repo size limits**: enforce a max clone size (e.g. reject if `.git`
  exceeds a configured threshold) to prevent one user's job from exhausting
  disk on a shared server.
- **Revocation handling**: if a user revokes the GitHub App installation
  from their GitHub settings, your next token-fetch attempt will fail —
  handle this gracefully (mark the `GithubInstallation` row inactive,
  prompt the user to reconnect) rather than surfacing a raw API error.

---

## 4. Input Mode 2 — Local Repo Upload

Two acceptable sub-modes; implement (a) first, add (b) if the UX is wanted:

### (a) Zip upload (simplest, most robust)
User zips their local repo folder (including `.git`) and uploads it via a
standard multipart file input.

```javascript
import multer from 'multer';
import unzipper from 'unzipper';

const upload = multer({
  dest: '/tmp/banana-uploads/',
  limits: { fileSize: 500 * 1024 * 1024 } // enforce a sane cap
});

app.post('/api/diff/upload', upload.single('repoZip'), async (req, res) => {
  const jobId = randomUUID();
  const extractDir = path.join('/tmp/banana-jobs', jobId, 'repo');

  await fs.promises
    .createReadStream(req.file.path)
    .pipe(unzipper.Extract({ path: extractDir }))
    .promise();

  // CRITICAL: validate no path traversal in zip entries (unzipper's
  // Extract is generally safe, but confirm the library version in use
  // sanitizes entry paths — do not assume, check the changelog/CVE list).

  await fs.promises.unlink(req.file.path); // remove the raw zip once extracted

  const job = await diffQueue.add('process-diff', {
    mode: 'local-upload', jobId, extractDir, baseCommit, targetCommit
  });
  res.json({ jobId: job.id });
});
```

Once extracted, the worker treats it exactly like a cloned repo — same
`git worktree add` flow against the extracted `.git` directory, no GitHub
interaction needed.

### (b) Folder picker (`<input webkitdirectory>`)
Reconstructs the directory tree client-side by uploading every file with
its relative path preserved, then rebuilding it server-side before the same
worktree flow. More UI work for marginal benefit over zip upload — **only
build this if users complain about having to zip first.** Flag as a
nice-to-have, not a v1 requirement.

### Security notes
- **Zip bomb protection**: cap total decompressed size, not just the
  upload size (a small zip can decompress to gigabytes).
- **Path traversal**: entries like `../../etc/passwd` inside a zip must be
  rejected — confirm the extraction library guards this rather than
  assuming.
- Uploaded repos should be deleted from disk immediately after job
  completion, success or failure (`finally` block, not just the happy path).

---

## 5. Job Queue & Worker

Reuse the queue design from the earlier plan — this doesn't change based on
which input mode was used, since by the time the worker runs, both modes
have produced the same shape of input: two directories (`baseDir`,
`targetDir`) each containing a checked-out `.kicad_pcb` tree.

```javascript
new Worker('diff-jobs', async (job) => {
  const { mode, jobId } = job.data;
  const jobDir = path.join('/tmp/banana-jobs', jobId);

  try {
    const { baseDir, targetDir } = mode === 'github'
      ? await fetchGithubRepo(job.data.repoUrl, job.data.token, jobDir)
      : { baseDir: path.join(jobDir, 'repo', '_base'), targetDir: path.join(jobDir, 'repo', '_target') };

    const svgResults = await exportBoardToSvg(baseDir, targetDir); // wraps kicad-cli
    const diffResult = processSvgDiff(...svgResults, boardData);   // UNCHANGED core logic

    await db.insert(diffJobs).values({
      id: jobId,
      status: 'COMPLETE',
      resultJson: diffResult,
      mode,
    });

    return diffResult;
  } catch (err) {
    await db.update(diffJobs).set({ status: 'FAILED' }).where(eq(diffJobs.id, jobId));
    throw err;
  } finally {
    await fs.promises.rm(jobDir, { recursive: true, force: true });
  }
}, { connection: redisConnection, concurrency: 2 }); // tune concurrency to CPU/kicad-cli cost
```

---

## 6. Docker Image

```dockerfile
FROM kicad/kicad:9.0 AS kicad-base
# Verify this tag's kicad-cli SVG export behavior matches your local
# KiCad 10.0.3 output before relying on it — do not assume compatibility.

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y git python3 unzip && rm -rf /var/lib/apt/lists/*

# Copy kicad-cli + dependencies discovered via `ldd $(which kicad-cli)`
# inside the kicad-base image — do not guess this list.
COPY --from=kicad-base /usr/bin/kicad-cli /usr/bin/kicad-cli
COPY --from=kicad-base /usr/lib/kicad /usr/lib/kicad
COPY --from=kicad-base /usr/share/kicad /usr/share/kicad
# ... additional shared libs as confirmed by ldd output ...

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 5000
CMD ["node", "backend/src/server.js"]
```

Run the API and worker as two processes from the same image (`docker-compose`
services `api` and `worker`, both `FROM` this image, different `CMD`), so
CPU-heavy `kicad-cli` work never blocks the HTTP-serving process.

```yaml
# docker-compose.yml (sketch)
services:
  api:
    build: .
    command: node backend/src/server.js
    ports: ["5000:5000"]
    depends_on: [redis, postgres]
  worker:
    build: .
    command: node backend/src/worker.js
    depends_on: [redis, postgres]
  redis:
    image: redis:7-alpine
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: banana
      POSTGRES_PASSWORD: ${DB_PASSWORD}
```

---

## 7. Database Schema — Drizzle ORM (Postgres)

```
npm install drizzle-orm pg
npm install -D drizzle-kit
```

```typescript
// db/schema.ts
import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const jobStatusEnum = pgEnum('job_status', ['PENDING', 'PROCESSING', 'COMPLETE', 'FAILED']);

export const diffJobs = pgTable('diff_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  mode: text('mode').notNull(),           // 'github' | 'local-upload'
  repoUrl: text('repo_url'),              // null for local-upload
  baseCommit: text('base_commit').notNull(),
  targetCommit: text('target_commit').notNull(),
  status: jobStatusEnum('status').notNull().default('PENDING'),
  resultJson: jsonb('result_json'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  userId: uuid('user_id'),                // nullable — no FK enforced yet
});

// Placeholder for future auth — not wired to anything yet, but the column
// above is ready to reference it once you decide to build accounts.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

```typescript
// db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);
```

Migrations:
```
npx drizzle-kit generate
npx drizzle-kit migrate
```

This schema is intentionally minimal — write a `DiffJob` row on every
completed/failed job regardless of whether a user is attached. If you never
build accounts, `userId` just stays null forever and nothing breaks. If you
do, it's already there.

---

## 8. API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/diff/github` | Enqueue a job from a GitHub URL + 2 commit refs |
| `POST` | `/api/diff/upload` | Enqueue a job from an uploaded zip |
| `GET` | `/api/diff/:jobId` | Poll job status; returns `resultJson` when `COMPLETE` |
| `GET` | `/api/health-check` | Existing liveness check, unchanged |

Frontend polls `/api/diff/:jobId` (simple interval poll is fine at this
scale — no need for WebSockets/SSE unless job volume grows significantly).

---

## 9. Frontend Changes

- Add a mode toggle: **"Connect GitHub"** vs **"Upload local repo"**.
- GitHub mode: a **"Connect GitHub"** button that starts the App
  installation flow (no manual URL or token fields at all). Once
  connected, show a searchable repo picker, then a branch dropdown, then a
  commit list (with commit message + relative date, e.g. "3 days ago —
  fixed SPI2_CS routing") for both base and target — this is the main
  accessibility win, since most users don't know how to find/paste a raw
  commit SHA.
- Upload mode: drag-and-drop zone accepting a `.zip`, with clear messaging
  that it should contain the `.git` folder (i.e. "zip your whole repo
  folder, not just the board file").
- Both modes converge on the same polling/result-rendering UI you already
  have (`SideBySideDiff.jsx`, Audit Modifications panel) — no changes
  needed there, since `resultJson` has the same shape either way.

---

## 10. Security Checklist Before Going Live

- [ ] Confirm zip extraction library rejects path traversal entries.
- [ ] Enforce upload size cap AND decompressed size cap.
- [ ] GitHub App private key stored as an encrypted secret, never
      committed, never logged; installation tokens fetched fresh per job
      and never persisted.
- [ ] Job temp directories always cleaned up (`finally`, not just success path).
- [ ] Rate-limit `/api/diff/*` endpoints per IP to prevent abuse (a single
      user shouldn't be able to queue unlimited `kicad-cli` jobs).
- [ ] Confirm `kicad-cli` runs with no network access needed at export time
      (sandboxing consideration — if it doesn't need network, consider
      running the worker container with restricted egress).
- [ ] Terms of Service / Privacy Policy published before any real user
      uploads a proprietary board file — see Section 18.
- [ ] A clear, working "delete my data" path (repo files, job results,
      GitHub App installation) — essential for any tool handling
      proprietary hardware IP, and likely required for GDPR-adjacent
      compliance if any EU users sign up.

---

## 11. Deployment Platform — Where to Host Web Banana 2.0

_This section is scoped strictly to the web-based deployment (Section 1–10
above). It does not apply to the Electron desktop build._

### Recommendation: **Railway**

Given this app's actual shape — a multi-service Docker setup (API + worker
+ Redis + Postgres), low-to-moderate expected traffic (an internal/niche
engineering tool, not a consumer product needing global low-latency
routing), and a solo/small-team maintainer — **Railway** is the best
default as of mid-2026:

- **Native Docker support** — deploys your existing `docker-compose.yml`
  services (`api`, `worker`, `redis`, `postgres`) with minimal translation.
- **One-click managed Postgres and Redis** — no separate provisioning step,
  they show up as linked services in the same project.
- **Usage-based billing** — since `kicad-cli` jobs are bursty (not
  constant load), you pay for actual compute time rather than a flat
  always-on rate, which suits a tool that's idle most of the day.
- Hobby plan: $5/mo base + usage (a small always-on API service plus a
  worker that mostly idles will likely land in the ~$10–20/mo range
  total including Postgres + Redis — confirm current numbers on Railway's
  pricing page before committing, as these figures shift).

### When to pick something else instead

| Platform | Pick it if... |
|---|---|
| **Render** | You want fixed, predictable monthly billing instead of usage-metered costs, or you're handing this off to a team that wants Heroku-style simplicity. Free tier exists but spins down after 15 min idle — a poor fit for a tool people expect to respond instantly. |
| **Fly.io** | You later need genuinely global low-latency access (e.g. distributed teams across continents hitting this daily) — Fly.io's whole value proposition is multi-region Docker deployment. More operational complexity than Railway; not worth it unless you have an actual multi-region need. |
| **Self-hosted VPS + `docker-compose`** | You want full control, no vendor billing surprises, and are comfortable managing your own Postgres/Redis backups and security patching. Cheapest at scale, but you own the ops burden. |

Given CounciL's existing infra habits (local RTX 5070 Ti workstation, prior
DigitalOcean deployment experience with SAGE-PRO), a **self-hosted VPS is
also a completely reasonable choice** if you'd rather not depend on a PaaS
— DigitalOcean or Hetzner with `docker-compose` up would work fine and
mirrors what you've already done for SAGE-PRO. Default to Railway only if
you want to avoid managing the VPS yourself.

### Step-by-step: Deploying to Railway

1. **Push the repo to GitHub** (Railway deploys from a connected repo).
2. **Create a new Railway project** → "Deploy from GitHub repo" → select
   the Banana 2.0 repo.
3. **Add the Postgres and Redis plugins** from Railway's service catalog
   inside the same project — they auto-generate `DATABASE_URL` and
   `REDIS_URL` environment variables that your app can read directly.
4. **Add two services from the same repo**, each pointing at your
   Dockerfile but with different start commands:
   - `api` service → `CMD ["node", "backend/src/server.js"]`
   - `worker` service → `CMD ["node", "backend/src/worker.js"]`
   Railway lets you override the container command per service without
   needing separate Dockerfiles.
5. **Set environment variables** per service: `DATABASE_URL`, `REDIS_URL`
   (both auto-populated by the plugins if referenced via Railway's
   variable-linking UI), plus any GitHub token handling config.
6. **Verify the `kicad-cli` shared-library step works inside Railway's
   build environment** — Railway builds your Dockerfile as-is, so if it
   built and ran locally with `docker build && docker run`, it should
   behave identically on Railway. Test with a real diff job immediately
   after first deploy, not just a health-check ping.
7. **Attach a custom domain** (optional) via Railway's networking settings
   once the service is confirmed working on its auto-generated `*.up.railway.app`
   URL.
8. **Set up basic monitoring**: Railway's dashboard shows per-service logs
   and resource usage out of the box — watch worker memory/CPU during your
   first few real `kicad-cli` jobs to size the service tier correctly
   (under-provisioning will cause slow or failed exports on larger boards).

### Step-by-step: Deploying to a self-hosted VPS (alternative)

1. Provision a VPS (DigitalOcean Droplet or Hetzner Cloud, 2 vCPU / 4GB RAM
   minimum given `kicad-cli` export cost — size up if boards are large or
   concurrency is expected).
2. Install Docker + Docker Compose on the VPS.
3. Copy `docker-compose.yml` (Section 6) and your `.env` file to the VPS
   (never commit secrets to the repo — use a `.env` file excluded via
   `.gitignore`, populated manually on the server).
4. `docker compose up -d` — brings up `api`, `worker`, `redis`, `postgres`
   together.
5. Put a reverse proxy in front (Caddy or Nginx) for TLS termination and a
   real domain — Caddy is the lower-effort choice since it handles
   Let's Encrypt certificates automatically with a two-line config.
6. Set up a basic backup cron for the Postgres volume if you decide to
   rely on `DiffJob` history going forward.
7. Monitor via `docker stats` / `docker compose logs -f worker` during
   initial real-world testing, same reasoning as the Railway step above.

---

## 12. Desktop (Electron) Reuse

Once the above is working and deployed, the Electron build becomes:
- Same Docker-image contents, minus the "multi-user" concerns (no need for
  BullMQ/Redis/Postgres locally — a single in-process job runner is enough
  since it's one user, one machine).
- `main.js` forks `backend/src/server.js` directly (no Docker needed on the
  user's machine — just Node + a locally-installed KiCad, detected at
  runtime).
- Local repo access can use the existing `BrowserGitFs`/File System Access
  API flow already built for desktop, in addition to or instead of the
  zip-upload flow — desktop doesn't need to route through HTTP upload at
  all if it already has direct filesystem access.

---

## 13. Free-Tier Launch Plan (Initial Phase)

_Current, verified free-tier limits (checked mid-2026 — reconfirm on
Render's pricing page before launch, as these numbers do shift):_

| Resource | Free tier limit | Implication for Banana |
|---|---|---|
| Render web service | 750 instance-hours/workspace/month, 512MB RAM/0.1 vCPU, spins down after 15 min idle (~1 min cold start on next request) | 750 hours ≈ 31 days, so **one always-on service just barely fits** — but any idle spin-down means your first visitor of the day waits ~60s. Acceptable for a free-tier launch, not for a paid tier. |
| Render Postgres (free) | 1GB storage, **expires 30 days after creation** | Fine for early `DiffJob` history, but you must migrate to a paid instance (or recreate + re-migrate) before day 30, or set a calendar reminder — this WILL catch you if forgotten. |
| Render Redis/Key-Value (free) | 25MB memory, 50 connections | Plenty for BullMQ at low job volume (early users won't stress this). Revisit once concurrent job volume grows. |
| Bandwidth | 100GB/month included | Fine unless you're serving large SVG payloads to many users — diff result JSON + SVG strings could add up; monitor this. |

### Recommended initial setup
1. **Deploy `api` as a single free Render web service.** Skip a separate
   `worker` service initially — run the BullMQ worker **in-process**
   within the same service for the free-tier phase (simpler, and you only
   get one free web service slot easily anyway). Split into a separate
   worker service once you're on a paid plan and job volume justifies it.
2. **Free Postgres for `DiffJob` storage**, with a hard calendar reminder
   at day 25 to either upgrade or migrate data before the 30-day expiry.
3. **Free Redis/Key-Value for BullMQ.**
4. **Accept the cold-start tradeoff for now** — put a small "waking up,
   this may take a minute" message in the UI for the free tier rather than
   trying to defeat Render's spin-down (attempting to keep it artificially
   always-warm via external pinging burns through your 750 free hours
   faster and doesn't actually help once you hit the monthly cap anyway).
5. **Set a real upgrade trigger**: the moment you have paying interest, or
   the free Postgres is about to expire, move to Render's Starter tier
   ($7/service/mo) or Railway — don't wait for a failure to force the
   migration.

---

## 14. Feature Roadmap — Reaching a Wider Audience

### Tier 1 — Essential for any real adoption (build before/shortly after launch)
- **Repo/branch/commit picker** (already specified in Section 3) — the
  single highest-leverage accessibility change, since manual SHA entry is
  a hard wall for non-git-fluent hardware engineers.
- **Two-file drag-and-drop mode** (no git knowledge required at all) — let
  someone upload just two `.kicad_pcb` files directly and get a diff,
  skipping repos/commits entirely. This is likely your single biggest
  audience-widening feature: many EEs use KiCad without disciplined git
  workflows, and "just drop two files" removes the git-literacy
  requirement completely.
- **Shareable public result links** (`banana.app/d/<short-id>`) — let a
  user share a diff result with a teammate or client without them needing
  an account. High virality potential for a niche tool like this (people
  share "look what this caught" links in EE forums/Discords).
- **A real landing page with a live example** — let a visitor see a real
  diff (using a sample public board) before signing up for anything. Cold
  free-tier spin-up makes a bad first impression, so cache/pre-render a
  demo example rather than running it live on every landing-page visit.

### Tier 2 — Strong differentiators (build once Tier 1 is stable)
- **GitHub PR bot / GitHub Action** — automatically post a diff summary
  comment on any PR that touches `.kicad_pcb` files ("Codecov for PCBs").
  This is arguably the single most valuable feature for adoption within
  existing engineering teams, since it puts Banana in front of an entire
  team automatically rather than requiring each person to visit the site.
- **Slack/Discord webhook notifications** for completed diffs — fits how
  hardware teams already coordinate.
- **VS Code extension** — surface diffs inline for engineers who live in
  an editor rather than a browser tab.

### Tier 3 — Broaden beyond KiCad (larger, longer-term bets)
- **Altium / Eagle / Fusion 360 Electronics export support** — KiCad is
  free and popular with hobbyists/startups, but a large fraction of
  professional PCB work happens in Altium. Supporting it (even just SVG
  export + the same diff core) meaningfully expands the addressable market
  beyond the KiCad community. This is a real engineering lift — treat as
  a separate roadmap item, not a v1 assumption.
- **BOM diff** (component value/footprint changes, not just layout) —
  complements the geometric diff you've already built and audited
  extensively in this project.
- **Public community gallery** of example diffs/boards — KiCad has a large
  hobbyist community; a "see interesting re-routes" gallery could drive
  organic discovery the way similar dev-tool galleries do (CodePen,
  Observable) for their respective niches.

### Explicitly deprioritize for now
- Multi-ECAD support and the PR-bot are both real engineering investments
  — don't start either until the core web flow (repo picker, upload mode,
  shareable links) is proven with real usage. Sequencing matters more than
  breadth here.

---

## 15. Growth Projection — Framework, Not a Forecast

**Honest framing: there is no real basis yet for confident user-count
numbers.** This product has zero live users today, no distribution
channel built, and no pricing tested. Any specific number I gave you here
("500 signups by month 3") would be fabricated precision dressed up as a
forecast — not useful, and actively risky if you use it to justify
spending decisions. What I can give you instead is the **framework** to
reason about this yourself once you have even a few weeks of real data,
plus rough, clearly-labeled scenario ranges based on how small, niche
developer-tool launches typically perform (KiCad's community is small and
specific — this is not a mass-market consumer app funnel).

### The funnel that actually matters
```
Landing page visit → tries the demo/uploads a file → completes 1 diff
  → returns for a 2nd diff (this is your real "activation" signal)
    → shares a result link or refers someone → becomes a habitual user
```

### Rough scenario ranges (illustrative only — replace with real data ASAP)

| Stage (Month 1) | Conservative | Moderate | Optimistic |
|---|---|---|---|
| Landing page visits (from KiCad forums/Discord/Reddit posts, no paid ads) | 200–500 | 800–1,500 | 3,000+ |
| Try the tool (upload/connect) | 20–50 (~10%) | 100–250 (~15%) | 500+ (~17%) |
| Complete ≥1 real diff | 10–25 | 60–150 | 300+ |
| Return for a 2nd diff within 2 weeks | 3–8 | 20–50 | 100+ |

**These numbers should be treated as a sanity-check floor/ceiling for
planning purposes, not a target you're expected to hit.** A niche
engineering tool's growth is driven almost entirely by word-of-mouth in a
small number of specific communities (r/PrintedCircuitBoard, KiCad's
official forum/Discord, relevant Hacker News threads) rather than broad
organic search in the first few months — so your actual distribution
effort (posting in the right 3–5 places, not building a broad marketing
funnel) matters more than any of these numbers.

### What to track from day one (regardless of volume)
- Visits → try-rate → completion-rate → return-rate (the funnel above)
- Where signups/visits actually came from (a specific forum post,
  Discord, HN, a teammate share link) — this tells you which single
  channel is worth doubling down on, which matters more at this stage
  than the absolute numbers.
- Time-to-first-successful-diff — if people are dropping off before
  completing one, that's a UX problem (likely the cold-start free-tier
  delay from Section 14, or friction in commit selection) worth fixing
  before anything else.

Revisit this section with real numbers after 4–6 weeks of live traffic —
at that point actual data will be far more useful than any projection
written before launch.

---

## 16. Pre-Launch Essentials (Not Yet Covered Above)

These are the things a SaaS handling other people's proprietary hardware
designs cannot skip, and weren't in the original technical scope:

- **Terms of Service + Privacy Policy**, written or reviewed by someone
  with actual legal competence — not optional the moment a real user
  (especially a company, not just a hobbyist) uploads a `.kicad_pcb` file
  to your server. Given CounciL's own work is defense/industrial-adjacent,
  you should expect some prospective users to ask hard questions about
  data handling before trusting you with their board files — have real
  answers ready, not placeholder text.
- **Explicit data retention & deletion policy**: how long are uploaded
  repos/board files kept, who can access them, and is there a working
  "delete my data now" button. This should be true in the code, not just
  in the policy document — verify it actually deletes everything (temp
  dirs, DB rows, any cached SVGs) rather than assuming.
- **An on-prem / self-hosted option for security-sensitive customers.**
  Given your own experience needing this kind of guarantee (IRIS is
  deployed at a government nuclear facility), expect some prospective
  Banana customers to have the same requirement — they may refuse to send
  proprietary board files to any third-party SaaS regardless of your
  security posture. Consider whether a self-hostable Docker image
  (basically what Section 6-11 already builds) is offered as a paid
  "on-prem" tier from day one, rather than bolted on later.
- **Basic auth/accounts** — not built anywhere in this plan yet. Needed
  before persistence (Section 7) is genuinely useful, and before any
  billing can exist. A simple approach: GitHub OAuth login (separate from
  the GitHub App connection in Section 3) or email magic links — don't
  build a full username/password system from scratch.
- **Billing integration** (Stripe) — not needed for the free-tier launch
  phase, but the schema/account model should be designed so adding it
  later doesn't require a rewrite (the nullable `userId` on `DiffJob` in
  Section 7 already anticipates this).
- **Error monitoring** (Sentry or similar) — you will not hear about
  failures from free-tier users the way you've been getting detailed
  bug reports from yourself throughout this project; you need the
  equivalent of that audit discipline running automatically in
  production.
- **Rate limiting / abuse prevention** — already flagged in Section 10,
  worth re-emphasizing: a free public tool that runs `kicad-cli` per
  request is a real target for abuse (someone scripting thousands of
  fake jobs to run up your Render bill or exhaust your free-tier hours).
- **A support channel** — even something as simple as a monitored email
  or a Discord server. Niche technical tools live and die by
  responsiveness to early users' bug reports, the same way this whole
  project's debugging process depended on tight feedback loops.

---

## 17. Suggested Build Order

1. Confirm `kicad-cli` runs correctly inside the Docker image (the `ldd`
   shared-lib step) — this is the one genuinely unverified piece.
2. Set up the GitHub App (Section 3) and confirm the installation-token
   flow works against one real repo before building anything else on top
   of it.
3. Job isolation + BullMQ queue (in-process worker for the free-tier
   phase, per Section 13), tested with the GitHub flow only.
4. Add zip-upload and two-file drag-and-drop modes once the GitHub flow is
   confirmed working end-to-end (two-file mode per Section 14 is the
   highest-leverage accessibility feature — don't skip it for later).
5. Add Drizzle + Postgres, writing `DiffJob` rows (read-path/UI for history
   can come later — writing them now costs nothing and pays off whenever
   you decide to build the read side).
6. Deploy to Render's free tier per Section 13 for initial launch; publish
   a Terms of Service/Privacy Policy and a working data-deletion path
   (Section 16) before inviting real (non-you) users to upload real board
   files.
7. Once there's real usage data, revisit Section 15's growth framework
   with actual numbers, and decide whether/when to upgrade off the free
   tier (Section 11) and split the worker into its own service.
8. Once the web app and landing page are live and stable, begin the
   desktop build — see Section 18 for why this comes second and
   deliberately, not as an afterthought.

---

## 18. Decision Log: Desktop App as the On-Prem Answer

**Decision:** rather than building a separate self-hosted Docker offering
(the "on-prem tier" raised in Section 16), the existing Electron desktop
build (Section 12) IS the on-prem answer. Customers who won't send
proprietary board files to any third-party SaaS get a downloadable
application instead — same core diff engine (`svg-diff-processor.js` /
`kicad-pcb-parser.js`, unmodified), running entirely on their machine
against their local KiCad CLI install, with no network dependency on
Banana's servers at all once installed.

This is a cleaner answer than standing up a separate self-hosted Docker
distribution: one codebase, two distribution shapes (a hosted URL for the
web version, a downloadable installer for the desktop version), rather
than maintaining a third deployment target.

### Sequencing (deliberate, not a gap)
Desktop build begins **after** the web app and landing page are complete,
not in parallel. This is the right order: the web version is where the
core diff engine gets exercised against real, varied boards from real
users first — any bug the audit process in this whole project has already
caught (net-isolation, geoKey vs fullKey, chain assembly, etc.) is far
cheaper to find via web traffic and fast iteration than after a desktop
installer is already in someone's hands. Shipping desktop second means it
inherits a backend that's already been proven under real usage, not a
theoretical one.

### What to carry over from Section 12 when this work starts
- Same Docker-image contents translate directly to Electron's bundled
  Node process — no server-side-only assumptions should have crept in by
  then (if they have, that's a sign the backend isn't as portable as
  intended and worth fixing before, not during, the desktop build).
- KiCad CLI is assumed pre-installed on the user's machine and detected at
  runtime (Section 12's existing guidance) — do not attempt to bundle a
  full KiCad install inside the Electron package; it's large and versioned
  separately from what most users will already have.
- The website's download page for the desktop build should clearly state
  "runs entirely locally — no board files ever leave your machine" as the
  explicit pitch to the exact audience Section 16 was written for
  (defense/industrial/IP-sensitive teams). This is a real differentiator
  worth stating plainly on the landing page, not just in this internal
  plan.

### Open question to resolve before this phase starts (not now)
Whether the desktop build is free, one-time-paid, or bundled with a paid
web tier is a pricing decision, not an engineering one — defer it until
the web app's pricing model (if any) is settled, so the two aren't decided
in isolation from each other.
