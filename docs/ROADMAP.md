# Job Radar DK: Roadmap

The full project from zero to finished, in small steps. Each step is **one small commit**.
The details (schema, env vars, risks) are in [PLAN.md](PLAN.md). This file is the checklist you work through.

## How to use this file

1. Do one step.
2. Run its **Check**. If the check fails, fix it before moving on.
3. Commit with the message given and push.
4. Tick the box `[x]`.

**Commit message style** (called "Conventional Commits"): `type(area): what you did`
- `feat`: new feature · `fix`: bug fix · `test`: tests only · `docs`: documentation
- `chore`: setup/config · `ci`: GitHub Actions · `refactor`: same behaviour, cleaner code

A small commit is easy to understand, easy to review, and easy to undo if something breaks.

---

## Phase 0: Setup (no app code yet)

**Goal:** accounts ready, repo clean, company list written.

- [x] **0.1 Create accounts**: GitHub (public repo `job-radar-dk`), Neon, Resend. Groq can wait until Phase 2.
  - Check: you can log in to all three and you've copied the Resend API key somewhere safe.
  - Commit: *none (no files changed)*

- [x] **0.2 Add .gitignore**: ignore `node_modules`, `.env`, `profile.md`, `.next`, `dist`.
  - Check: `git status` shows only `.gitignore` and `docs/`.
  - Commit: `chore: add gitignore`

- [x] **0.3 Commit the plan docs**: `docs/PLAN.md` and `docs/ROADMAP.md`.
  - Check: both files appear on GitHub after pushing.
  - Commit: `docs: add implementation plan and roadmap`

- [x] **0.4 Write the company list**: `config/companies.json` with 10–15 Teamtailor companies (format in PLAN.md §1). Open each `.../jobs.rss` in the browser first to check it works.
  - Check: every URL returned XML in the browser.
  - Commit: `chore: add Teamtailor company seed list`

- [x] **0.5 Write the fake profile**: `profile.example.md` (an invented person with a similar stack). Write your **real** `profile.md` too, but it stays uncommitted because it's in `.gitignore`.
  - Check: `git status` shows `profile.example.md` and **not** `profile.md`.
  - Commit: `docs: add example profile`

---

## Phase 1: Teamtailor → database → email → cron

**Goal:** a new job reaches your inbox within about 3 hours, and never twice.
**Time:** about 2 weeks.

### 1A. Project skeleton

- [x] **1.1 pnpm workspace**: root `package.json` and `pnpm-workspace.yaml` listing `db`, `pipeline`, `web`.
  - Check: `pnpm install` runs without errors.
  - Commit: `chore: set up pnpm workspace`

- [x] **1.2 Pipeline package + TypeScript**: `tsconfig.base.json`, `pipeline/package.json`, `pipeline/tsconfig.json`, and `pipeline/src/index.ts` that prints "hello". Add `tsx` and a root script `pipeline:run`.
  - Check: `pnpm pipeline:run` prints "hello". `pnpm typecheck` passes.
  - Commit: `chore: add pipeline package with TypeScript`

- [x] **1.3 Vitest**: add Vitest, `pipeline/vitest.config.ts`, and one smoke test.
  - Check: `pnpm test` shows 1 passing test.
  - Commit: `test: add vitest with smoke test`

### 1B. Database

- [x] **1.4 Prisma schema**: `db/package.json` and `db/prisma/schema.prisma` with only the Phase 1 models: Company, Job, Run, FetchLog, Notification (copy from PLAN.md §2).
  - Check: `prisma validate` passes.
  - Commit: `feat(db): add Prisma schema for Phase 1`

- [x] **1.5 First migration**: put the Neon `dev` branch URLs in `.env`, then run `prisma migrate dev --name init`.
  - Check: `prisma studio` shows the empty tables.
  - Commit: `feat(db): add initial migration`

- [x] **1.6 Shared Prisma client**: `db/src/index.ts` exports one `prisma` instance. Import it from `pipeline` to prove the link works.
  - Check: the pipeline can run `prisma.company.count()` and prints `0`.
  - Commit: `feat(db): export shared Prisma client`

- [x] **1.7 Company sync script**: `db/scripts/sync-companies.ts` reads `config/companies.json`, validates it with Zod, and upserts by `slug` (never deletes).
  - Check: run it twice and the company count stays the same. Break the JSON and you get a clear error.
  - Commit: `feat(db): add script to sync companies from seed file`

### 1C. Pipeline basics

- [x] **1.8 Env config**: `.env.example` and `pipeline/src/config.ts` (Zod-validated env), with a test.
  - Check: test passes. Removing `DATABASE_URL` gives an error that names the variable.
  - Commit: `feat(pipeline): validate env vars with Zod`

- [x] **1.9 Logger**: `pipeline/src/lib/logger.ts`. One line per event, like `fetch.ok {"company":"x","jobs":5}`.
  - Check: calling it from `index.ts` prints a readable line.
  - Commit: `feat(pipeline): add simple structured logger`

- [ ] **1.10 Polite fetch helper**: `pipeline/src/lib/http.ts` sets the User-Agent, uses a 15-second timeout, and retries once on 5xx (never on 4xx). Tests go in the same commit.
  - Check: tests cover the 200, 500→200, 404 and header cases, and all pass.
  - Commit: `feat(pipeline): add polite fetch helper`

### 1D. Teamtailor adapter

- [ ] **1.11 Save fixtures**: 2–3 real feeds via `curl` into `pipeline/test/fixtures/teamtailor/`, plus one hand-edited feed with **one** item and one with **zero** items.
  - Check: the files open and look like valid XML.
  - Commit: `test: add Teamtailor RSS fixtures`

- [ ] **1.12 Parse the RSS**: in `teamtailor.ts`, turn XML into a list of raw items with `fast-xml-parser` (`isArray` for `item`).
  - Check: tests show each fixture gives the right item count, and the zero-item feed gives `[]`.
  - Commit: `feat(sources): parse Teamtailor RSS feed`

- [ ] **1.13 Adapter interface + Job schema**: `pipeline/src/sources/types.ts` with `SourceAdapter` and the `NormalizedJob` Zod schema.
  - Check: `pnpm typecheck` passes.
  - Commit: `feat(sources): add SourceAdapter interface and Job schema`

- [ ] **1.14 HTML to text**: `pipeline/src/lib/html.ts` strips HTML with Cheerio and collapses whitespace. Include a test.
  - Check: `"<p>Hi&nbsp;<b>there</b></p>"` becomes `"Hi there"`.
  - Commit: `feat(pipeline): add HTML-to-text helper`

- [ ] **1.15 Normalize Teamtailor jobs**: finish `fetchJobs` and `normalize`. Invalid items are logged and skipped.
  - Check: snapshot test of the first job passes, and a job with no title is skipped without a crash.
  - Commit: `feat(sources): normalize Teamtailor jobs`

- [ ] **1.16 Adapter registry**: `registry.ts` maps `TEAMTAILOR` to the adapter.
  - Check: `getAdapter("TEAMTAILOR")` works, and an unknown source throws.
  - Commit: `feat(sources): add adapter registry`

### 1E. Saving and dedupe

- [ ] **1.17 Find new jobs (pure function)**: `diffJobs(existingIds, incoming)` returns `{ newJobs, seenIds, goneIds }`. Table tests in the same commit.
  - Check: tests pass.
  - Commit: `feat(pipeline): add diffJobs to find new, seen and gone jobs`

- [ ] **1.18 Save new jobs + baseline**: `saveJobs.ts` inserts with `skipDuplicates`. On a company's first fetch it sets `isBaseline: true` and fills in `baselineDoneAt`.
  - Check: on the `dev` DB, the first run saves jobs as baseline and the second run saves 0 new jobs.
  - Commit: `feat(pipeline): save new jobs with per-company baseline`

- [ ] **1.19 Seen and closed jobs**: update `lastSeenAt`, and set `closedAt` for jobs that disappeared. Skip closing when the fetch returned 0 jobs but the company had jobs last time (mark the fetch `SUSPICIOUS_EMPTY`).
  - Check: delete an item from a fixture and that job gets closed. With an empty fixture, nothing gets closed.
  - Commit: `feat(pipeline): track seen and closed jobs safely`

- [ ] **1.20 Title filter**: `filter.ts` keeps titles with dev keywords and drops senior/lead/principal/staff/manager. Store `filterReason`. Table test with ~25 real titles.
  - Check: all table cases pass, and "AI Engineer" passes while "Maintenance Lead" is dropped.
  - Commit: `feat(pipeline): add title keyword filter`

### 1F. The run

- [ ] **1.21 Loop over companies**: `fetchCompanies.ts` fetches companies one at a time with a 1-second pause, skips any fetched within `MIN_FETCH_INTERVAL_HOURS`, and wraps each company in try/catch so one failure doesn't stop the run.
  - Check: give one company a bad URL and the others still save.
  - Commit: `feat(pipeline): fetch all active companies politely`

- [ ] **1.22 Record runs**: `index.ts` creates a `Run` row and one `FetchLog` row per company, and tracks `consecutiveFailures`. If the whole run crashes, it records `FAILED` and exits with code 1.
  - Check: after a run, Studio shows a Run with counts and its FetchLogs.
  - Commit: `feat(pipeline): record runs and fetch logs`

- [ ] **1.23 Dry-run mode**: with `DRY_RUN=true`, the pipeline sends no emails and prints what it would send.
  - Check: `DRY_RUN=true pnpm pipeline:run` prints, and no email arrives.
  - Commit: `feat(pipeline): add dry-run mode`

### 1G. Email

- [ ] **1.24 Resend sender + template**: `email/send.ts` and `email/templates.ts` build a simple HTML list of jobs.
  - Check: a test script sends one test email to yourself and it arrives.
  - Commit: `feat(email): add Resend sender and summary template`

- [ ] **1.25 Email new jobs once**: `notify.ts` sends **one** email per run listing unsent, non-baseline jobs that passed the filter. After the email is sent, it creates the Notification and sets `notificationId` in one transaction.
  - Check: delete one Job row in `dev`, run, and one email arrives. Run again and no email arrives.
  - Commit: `feat(pipeline): email new jobs once per run`

- [ ] **1.26 Broken-source warning**: the email footer lists companies with `consecutiveFailures >= 3` or `SUSPICIOUS_EMPTY`. If there are no jobs, a warning-only email is sent at most once a day.
  - Check: with a bad URL and 3 runs, the warning appears.
  - Commit: `feat(email): warn about broken sources`

### 1H. Automation and go live

- [ ] **1.27 CI workflow**: `.github/workflows/ci.yml` runs install, typecheck and tests on every push.
  - Check: a green tick on GitHub.
  - Commit: `ci: run typecheck and tests on push`

- [ ] **1.28 Cron workflow**: `.github/workflows/pipeline.yml` runs every 3 hours and has a manual button. It uses a `concurrency` group so runs never overlap, runs `prisma migrate deploy`, then `pnpm pipeline:run`. Add the secrets in GitHub.
  - Check: the manual "Run workflow" goes green, and the logs show companies fetched.
  - Commit: `ci: run pipeline every 3 hours`

- [ ] **1.29 Go live**: point the secrets at the Neon `main` branch, run the sync script against it, and trigger one manual run. That run is the baseline, so expect zero emails.
  - Check: the baseline run sends no email, and over the next days new jobs arrive exactly once.
  - Commit: `docs: add setup notes to README` (a short "how to run" section)

**🏁 Phase 1 done** when a real new job has reached your inbox once, and only once.

---

## Phase 2: Smart filtering + LLM scoring

**Goal:** only good matches reach you, each with a score and a reason.
**Time:** about 2–3 weeks.

### 2A. Better filter

- [ ] **2.1 Location rule**: keep Copenhagen/København, remote-DK and hybrid jobs. Unknown location stays in. Table tests.
  - Commit: `feat(filter): keep Copenhagen, remote-DK and hybrid jobs`

- [ ] **2.2 Danish rule**: drop jobs with phrases like "flydende dansk" or "Danish is a must". Table tests.
  - Commit: `feat(filter): drop jobs that require Danish`

### 2B. LLM scoring

- [ ] **2.3 Score table**: add the `Score` model and run the migration.
  - Check: Studio shows the Score table.
  - Commit: `feat(db): add Score model`

- [ ] **2.4 Profile loader**: `lib/profile.ts` reads `profile.md` locally or the `PROFILE_MD` env var in CI, and computes `profileHash`.
  - Commit: `feat(pipeline): load profile and compute hash`

- [ ] **2.5 Score schema**: a Zod schema for the LLM answer (the four parts, level, danishRequired, skills, redFlags, reason).
  - Commit: `feat(llm): add score response schema`

- [ ] **2.6 Groq client**: `llm/groq.ts` calls the model in JSON mode at temperature 0, validates the answer with Zod, and retries once with the error message if validation fails.
  - Check: one real call returns a valid object.
  - Commit: `feat(llm): add Groq client with schema validation`

- [ ] **2.7 Score prompt v1**: `llm/score.prompt.ts` with the rubric, today's date and your graduation date, and the job wrapped as untrusted data. Export `SCORE_PROMPT_VERSION = "score-v1"`.
  - Commit: `feat(llm): add score prompt v1 with rubric`

- [ ] **2.8 Score step**: score `PENDING` jobs, oldest first, up to `MAX_LLM_CALLS_PER_RUN` per run. The code adds up the parts, caps the score at 40 if Danish is required, and saves the Score.
  - Check: a dry run on `dev` scores a few jobs, and the rows appear in Studio.
  - Commit: `feat(pipeline): score pending jobs with per-run cap`

### 2C. Measure quality

- [ ] **2.9 Eval set**: `eval/jobs.json` with 20 real jobs **you** scored by hand before running the model.
  - Commit: `test(eval): add 20 hand-scored jobs`

- [ ] **2.10 Eval script**: `pnpm eval` prints a table, the average error, and the % of jobs placed in the same bucket as yours.
  - Check: it runs and prints numbers. Write them down.
  - Commit: `feat(eval): add eval script`

- [ ] **2.11 Improve the prompt** (repeat as needed): change the prompt, bump the version, and rerun the eval. Aim for ≥ 80 % bucket agreement.
  - Commit: `feat(llm): improve score prompt (v2)` and so on.

### 2D. Smarter emails

- [ ] **2.12 Instant email for 75+**: one email per strong job, with the score and reason.
  - Commit: `feat(email): send instant email for 75+ jobs`

- [ ] **2.13 Daily digest for 55–74**: sent on the first run after 08:00 Copenhagen time, once a day.
  - Commit: `feat(email): send daily digest for 55-74 jobs`

- [ ] **2.14 Remove the Phase 1 summary email**, since instant + digest replace it.
  - Commit: `refactor(email): replace run summary with instant and digest`

- [ ] **2.15 CI secrets**: add `GROQ_API_KEY` and `PROFILE_MD` to GitHub and to the workflow.
  - Check: a cron run scores jobs in production.
  - Commit: `ci: pass Groq and profile secrets to pipeline`

**🏁 Phase 2 done** when you get instant emails for good matches, a daily digest, and the eval shows ≥ 80 % agreement.

---

## Phase 3: Draft applications + "mark as applied"

**Goal:** strong matches arrive with a ready draft, and you can mark them as applied from the email.
**Time:** about 1–2 weeks.

### 3A. Drafts

- [ ] **3.1 Draft table**: add the `Draft` model and run the migration.
  - Commit: `feat(db): add Draft model`

- [ ] **3.2 Draft schema + prompt v1**: cover letter (≤ 200 words, direct tone), 3–4 CV bullets, screening answers, a gaps note. Only facts from your profile.
  - Commit: `feat(llm): add draft prompt v1`

- [ ] **3.3 Draft step**: only for jobs scoring 75+, and only once per job.
  - Commit: `feat(pipeline): draft applications for strong matches`

- [ ] **3.4 Anti-invention check**: the code lists skills and companies in the draft that are **not** in your profile and saves them as `warnings`. Include a test.
  - Check: a fake draft mentioning "Kubernetes" gets a warning.
  - Commit: `feat(pipeline): flag draft claims not found in profile`

- [ ] **3.5 Draft in the email**: the instant email shows the draft, with any warnings in red at the top.
  - Commit: `feat(email): include draft and warnings in instant email`

### 3B. Mark as applied

- [ ] **3.6 Create the web app**: a Next.js + Tailwind app in `web/` showing one simple page.
  - Check: `pnpm --filter web dev` opens at localhost:3000.
  - Commit: `feat(web): scaffold Next.js app with Tailwind`

- [ ] **3.7 Signed links**: a helper that signs and checks `jobId + action` with `LINK_SIGNING_SECRET` (HMAC). Include tests.
  - Check: a tampered link is rejected.
  - Commit: `feat: add signed action links`

- [ ] **3.8 Confirm page**: `/a/[action]` shows a "Confirm" button. Pressing it sends a POST that updates the job. Opening the link alone changes nothing, so email scanners can't trigger it.
  - Commit: `feat(web): add confirm page for applied / not interested`

- [ ] **3.9 Links in email**: add "Mark as applied" and "Not interested" links to the instant email.
  - Commit: `feat(email): add mark-as-applied links`

- [ ] **3.10 Deploy to Vercel**: set the env vars and set `APP_BASE_URL` to the Vercel URL.
  - Check: clicking a link in a real email and confirming updates the job.
  - Commit: `chore(web): configure Vercel deploy`

**🏁 Phase 3 done** when a 75+ email contains a usable draft and the applied link works.

---

## Phase 4: Dashboard

**Goal:** see and manage everything in a web UI, plus a public demo.
**Time:** about 2–3 weeks.

### 4A. Login and layout

- [ ] **4.1 Login**: NextAuth with GitHub. Only `ALLOWED_GITHUB_LOGIN` can log in.
  - Check: you can log in, and a different GitHub account is rejected.
  - Commit: `feat(web): add GitHub login restricted to owner`

- [ ] **4.2 Layout + nav**: sidebar or top nav with Jobs, Companies, Pipeline, Health.
  - Commit: `feat(web): add app layout and navigation`

### 4B. Jobs

- [ ] **4.3 Jobs table**: title, company, score, status, date, sorted by score.
  - Commit: `feat(web): add jobs table`

- [ ] **4.4 Filters**: by bucket, status, company, and "dropped" with its reason.
  - Commit: `feat(web): add job filters`

- [ ] **4.5 Job detail page**: description, score breakdown, skills, red flags, the draft with copy buttons, and the filter reason.
  - Commit: `feat(web): add job detail page`

- [ ] **4.6 Status buttons**: Interested / Applied / Not interested, using server actions.
  - Commit: `feat(web): change job status from detail page`

### 4C. Companies

- [ ] **4.7 Companies list**: last fetch, job count, failures, last error.
  - Commit: `feat(web): add companies page`

- [ ] **4.8 Add company form**: validated with the same Zod schema as the seed file.
  - Commit: `feat(web): add company form`

- [ ] **4.9 Pause / resume a company**
  - Commit: `feat(web): pause and resume companies`

### 4D. Pipeline and health

- [ ] **4.10 Pipeline page**: funnel for the last run and the last 7 days (fetched → new → passed → scored → 55+ → 75+ → applied).
  - Commit: `feat(web): add pipeline funnel page`

- [ ] **4.11 Health page**: time since the last good run (red if over 6 hours), failing companies, LLM calls today, latest errors.
  - Commit: `feat(web): add health page`

### 4E. Demo

- [ ] **4.12 Demo seed script**: `db/src/seed-demo.ts` creates fake companies, jobs, scores and drafts. Run it against a new Neon `demo` branch.
  - Commit: `feat(db): add demo seed data`

- [ ] **4.13 Demo mode**: when `DEMO_MODE=true`, there's no login, no changes are allowed, and a "Demo data" banner shows.
  - Commit: `feat(web): add read-only demo mode`

- [ ] **4.14 Deploy the demo**: a second Vercel project using the demo DB and `DEMO_MODE=true`.
  - Check: opening the demo URL in a private window shows fake data and no login.
  - Commit: `chore: document demo deployment`

**🏁 Phase 4 done** when you use the dashboard daily and the demo link works for strangers.

---

## Phase 5: Portfolio polish

**Goal:** a recruiter understands the project in 60 seconds.
**Time:** about 1 week.

- [ ] **5.1 README intro**: what it is, why you built it, the demo link, how to run it locally.
  - Commit: `docs: write README intro and setup`
- [ ] **5.2 Architecture diagram**: a Mermaid diagram of the pipeline steps.
  - Commit: `docs: add architecture diagram`
- [ ] **5.3 How scoring works**: the rubric, the eval set, and your eval results table.
  - Commit: `docs: explain scoring and eval results`
- [ ] **5.4 Screenshots + GIF**: dashboard and an example email (fake data only).
  - Commit: `docs: add screenshots and demo GIF`
- [ ] **5.5 Design decisions + ethics**: why each main choice; no auto-apply, polite fetching, no LinkedIn.
  - Commit: `docs: add design decisions and ethics section`
- [ ] **5.6 Badges**: CI status and test count.
  - Commit: `docs: add CI badge`
- [ ] **5.7 Privacy check**: search the git history for your surname, email and phone number. Fix anything you find before sharing the repo.
  - Commit: *only if you had to fix something*
- [ ] **5.8 Release**: tag `v1.0.0` on GitHub with short release notes.
  - Commit: *none, it's a git tag:* `git tag v1.0.0 && git push --tags`

**🏁 Project done.** 🎉

---

## Extra: more job sources (any time after Phase 2)

Each adapter follows the same five steps, each with its own commit:
1. Save a fixture → `test: add <source> fixtures`
2. Parse it → `feat(sources): parse <source> response`
3. Normalize it + snapshot test → `feat(sources): normalize <source> jobs`
4. Register it → `feat(sources): register <source> adapter`
5. Add one real company to `companies.json` → `chore: add first <source> company`

Order:
- [ ] Recruitee
- [ ] Greenhouse
- [ ] Lever
- [ ] Ashby
- [ ] robots.txt checker (needed before HTML sources) → `feat(pipeline): respect robots.txt for HTML sources`
- [ ] Emply / HR Manager (look for hidden JSON first, use Cheerio only if there's none)
