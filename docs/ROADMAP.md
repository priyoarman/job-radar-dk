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

- [x] **1.10 Polite fetch helper**: `pipeline/src/lib/http.ts` sets the User-Agent, uses a 15-second timeout, and retries once on 5xx (never on 4xx). Tests go in the same commit.
  - Check: tests cover the 200, 500→200, 404 and header cases, and all pass.
  - Commit: `feat(pipeline): add polite fetch helper`

### 1D. Teamtailor adapter

- [x] **1.11 Save fixtures**: 2–3 real feeds via `curl` into `pipeline/test/fixtures/teamtailor/`, plus one hand-edited feed with **one** item and one with **zero** items.
  - Check: the files open and look like valid XML.
  - Commit: `test: add Teamtailor RSS fixtures`

- [x] **1.12 Parse the RSS**: in `teamtailor.ts`, turn XML into a list of raw items with `fast-xml-parser` (`isArray` for `item`).
  - Check: tests show each fixture gives the right item count, and the zero-item feed gives `[]`.
  - Commit: `feat(sources): parse Teamtailor RSS feed`

- [x] **1.13 Adapter interface + Job schema**: `pipeline/src/sources/types.ts` with `SourceAdapter` and the `NormalizedJob` Zod schema.
  - Check: `pnpm typecheck` passes.
  - Commit: `feat(sources): add SourceAdapter interface and Job schema`

- [x] **1.14 HTML to text**: `pipeline/src/lib/html.ts` strips HTML with Cheerio and collapses whitespace. Include a test.
  - Check: `"<p>Hi&nbsp;<b>there</b></p>"` becomes `"Hi there"`.
  - Commit: `feat(pipeline): add HTML-to-text helper`

- [x] **1.15 Normalize Teamtailor jobs**: finish `fetchJobs` and `normalize`. Invalid items are logged and skipped.
  - Check: snapshot test of the first job passes, and a job with no title is skipped without a crash.
  - Commit: `feat(sources): normalize Teamtailor jobs`

- [x] **1.16 Adapter registry**: `registry.ts` maps `TEAMTAILOR` to the adapter.
  - Check: `getAdapter("TEAMTAILOR")` works, and an unknown source throws.
  - Commit: `feat(sources): add adapter registry`

### 1E. Saving and dedupe

- [x] **1.17 Find new jobs (pure function)**: `diffJobs(existingIds, incoming)` returns `{ newJobs, seenIds, goneIds }`. Table tests in the same commit.
  - Check: tests pass.
  - Commit: `feat(pipeline): add diffJobs to find new, seen and gone jobs`

- [x] **1.18 Save new jobs + baseline**: `saveJobs.ts` inserts with `skipDuplicates`. On a company's first fetch it sets `isBaseline: true` and fills in `baselineDoneAt`.
  - Check: on the `dev` DB, the first run saves jobs as baseline and the second run saves 0 new jobs.
  - Commit: `feat(pipeline): save new jobs with per-company baseline`

- [x] **1.19 Seen and closed jobs**: update `lastSeenAt`, and set `closedAt` for jobs that disappeared. Skip closing when the fetch returned 0 jobs but the company had jobs last time (mark the fetch `SUSPICIOUS_EMPTY`).
  - Check: delete an item from a fixture and that job gets closed. With an empty fixture, nothing gets closed.
  - Commit: `feat(pipeline): track seen and closed jobs safely`

- [x] **1.20 Title filter**: `filter.ts` keeps titles with dev keywords and drops senior/lead/principal/staff/manager. Store `filterReason`. Table test with ~25 real titles.
  - Check: all table cases pass, and "AI Engineer" passes while "Maintenance Lead" is dropped.
  - Commit: `feat(pipeline): add title keyword filter`

### 1F. The run

- [x] **1.21 Loop over companies**: `fetchCompanies.ts` fetches companies one at a time with a 1-second pause, skips any fetched within `MIN_FETCH_INTERVAL_HOURS`, and wraps each company in try/catch so one failure doesn't stop the run.
  - Check: give one company a bad URL and the others still save.
  - Commit: `feat(pipeline): fetch all active companies politely`

- [x] **1.21b Tighten title filter** (added after the first real run): entry-level words (student, junior, graduate, intern, trainee, praktikant…) only pass together with a tech word (software, data, IT, tech, web, cloud…). Dev words (developer, engineer, udvikler, AI…) still pass on their own. Existing baseline jobs were re-filtered.
  - Check: "Junior Accountant" and "Internship: Direct Procurement" are dropped as `title:entry-without-tech`, while "Junior Developer" and "Studentermedhjælper til IT-afdelingen" pass.
  - Commit: `fix(pipeline): require a tech word for entry-level titles`

- [x] **1.22 Record runs**: `index.ts` creates a `Run` row and one `FetchLog` row per company, and tracks `consecutiveFailures`. If the whole run crashes, it records `FAILED` and exits with code 1.
  - Check: after a run, Studio shows a Run with counts and its FetchLogs.
  - Commit: `feat(pipeline): record runs and fetch logs`

- [x] **1.23 Dry-run mode**: with `DRY_RUN=true`, the pipeline sends no emails and prints what it would send.
  - Check: `DRY_RUN=true pnpm pipeline:run` prints, and no email arrives.
  - Commit: `feat(pipeline): add dry-run mode`

### 1G. Email

- [x] **1.24 Resend sender + template**: `email/send.ts` and `email/templates.ts` build a simple HTML list of jobs.
  - Check: a test script sends one test email to yourself and it arrives.
  - Commit: `feat(email): add Resend sender and summary template`

- [x] **1.25 Email new jobs once**: `notify.ts` sends **one** email per run listing unsent, non-baseline jobs that passed the filter. After the email is sent, it creates the Notification and sets `notificationId` in one transaction.
  - Check: delete one Job row in `dev`, run, and one email arrives. Run again and no email arrives.
  - Commit: `feat(pipeline): email new jobs once per run`

- [x] **1.26 Broken-source warning**: the email footer lists companies with `consecutiveFailures >= 3` or `SUSPICIOUS_EMPTY`. If there are no jobs, a warning-only email is sent at most once a day.
  - Check: with a bad URL and 3 runs, the warning appears.
  - Commit: `feat(email): warn about broken sources`

### 1H. Automation and go live

- [x] **1.27 CI workflow**: `.github/workflows/ci.yml` runs install, typecheck and tests on every push.
  - Check: a green tick on GitHub.
  - Commit: `ci: run typecheck and tests on push`

- [x] **1.28 Cron workflow**: `.github/workflows/pipeline.yml` runs every 3 hours and has a manual button. It uses a `concurrency` group so runs never overlap, runs `prisma migrate deploy`, then `pnpm pipeline:run`. Add the secrets in GitHub.
  - Check: the manual "Run workflow" goes green, and the logs show companies fetched.
  - Commit: `ci: run pipeline every 3 hours`

- [x] **1.29 Go live**: point the secrets at the Neon `main` branch, run the sync script against it, and trigger one manual run. That run is the baseline, so expect zero emails.
  - Check: the baseline run sends no email, and over the next days new jobs arrive exactly once.
  - Commit: `docs: add setup notes to README` (a short "how to run" section)

**🏁 Phase 1 done** when a real new job has reached your inbox once, and only once.

---

## Phase S: More sources (added after go-live)

**Goal:** cover the portals Danish companies actually use, not only Teamtailor. These portals have no global search, so each one needs an adapter, and each company needs an entry in `config/companies.json`.
**Time:** about 30–40 hours (3–5 weeks). Comes before Phase 2's LLM scoring.
**Defaults chosen:** cheapest portals first; location rule pulled forward; no language rules (decided 2026-11-15: ads in Danish or any language are fine, only the location must be in Denmark); custom portals start with JSON-LD only.

### S1. Groundwork

- [x] **S1.1 New source types**: add `WORKDAY`, `SUCCESSFACTORS`, `WORKABLE`, `TALENTECH`, `CUSTOM` to the `SourceType` enum (migration). The company sync still rejects any source without an adapter.
  - Check: `prisma migrate status` is up to date, and syncing a `WORKDAY` company fails with `no adapter for source "WORKDAY" yet`.
  - Commit: `feat(db): add more source types`

- [x] **S1.2 JSON fetch helper**: `fetchJson()` in `lib/http.ts` with the same User-Agent, timeout and retry rules, plus POST support (Workday and Workable need it).
  - Commit: `feat(pipeline): add fetchJson helper`

- [x] **S1.3 Location rule** (pulled forward from 2.1): keep jobs anywhere in Denmark (on-site, hybrid or remote), plus remote/Europe/Nordic and unknown locations; drop jobs whose every listed place is abroad (`location:abroad`). No language rule. Table tests.
  - Commit: `feat(pipeline): filter jobs by location`

### S2. Easy JSON portals (~2 h each)

- [x] **S2.1 Greenhouse** adapter (`boards-api.greenhouse.io`), fixtures, tests, registry.
- [x] **S2.2 Lever** adapter (`api.lever.co/v0/postings`).
- [x] **S2.3 Ashby** adapter (`api.ashbyhq.com/posting-api/job-board`). Then move the ready companies from `companies-later.json`.
- [x] **S2.4 Recruitee** adapter (`{company}.recruitee.com/api/offers/`).
- [x] **S2.5 Workable** adapter.

### S3. Big-company portals (~3–4 h each, research first)

- [x] **S3.1 Workday**: research the career-site endpoint, then the adapter with a page limit per run.
- [x] **S3.2 SAP SuccessFactors**: research the job feed per site, then the adapter.

### S4. Nordic portals (~3 h each, research first)

- [x] **S4.1 Emply** (look for hidden JSON before parsing HTML). Found it: the listing page loads jobs from `POST /api/integration/vacancy/get-page` (research in PLAN.md §5d).
  - Result: Matas added (21 jobs, 1 passes the filter). EG's Emply site is empty (EG now uses HR Manager), and the other 18 "Emply" candidates have no site under their name.
  - Commit: `feat(pipeline): add Emply adapter`
- [x] **S4.2 HR Manager**: Talentech's public Job Portal API (`recruiter-api.hr-manager.net/jobportal.svc/{alias}/positionlist/json/`), with the customer alias as `sourceKey` (research in PLAN.md §5e).
  - Result: BEC added (38 jobs, 17 in Denmark, none pass the filter today). EG's real board turned out to be Teamtailor, so it was added as Teamtailor. EWII and JP/Politikens Hus show only a numeric ID, and their alias is unknown; JP/Pol lists its jobs on jppol.dk (a job for S5.2).
  - Commit: `feat(pipeline): add HR Manager adapter`
- [x] ~~**S4.3 Talentech / ReachMee**~~: skipped on 2026-11-16. None of the 150 candidates use ReachMee, and the careers detector found it on no site. Talentech's HR Manager is covered by S4.2. The one "Talentium" claim (DR) turned out to be SuccessFactors.

### S5. Custom portals and coverage

- [x] **S5.0 Verify the candidate list** (added 2026-11-15): `config/candidates.json` holds the user's 150 companies; `pnpm candidates:verify` checks each claimed board with the real adapters and tries the company name on Teamtailor, Greenhouse, Lever (+EU), Ashby, Workable and Recruitee, 1 request/second. Writes `docs/candidates-report.md` and `config/candidates-suggested.json`; adds nothing by itself.
  - Result: only 6 of 39 checkable claims were right; 13 confirmed boards with jobs, 26 unused (empty) accounts, 31 claim systems we can't check yet (20 Emply), 19 need a manual look (Workday/SuccessFactors), 46 not found under their name.
  - Commit: `feat(tools): verify candidate companies against real job boards`

- [x] **S5.0b Location rule for global boards**: recognise US states (names and ", CA"-style codes), every country name (via `Intl.DisplayNames`), codes like `USCA`, big world cities and non-European regions (APAC, NAMER, Latin America…), so "Mountain View, California" or "Seoul, South Korea" no longer count as unknown. Found by S5.0: only 3 of Databricks' 25 "matches" were really in Denmark.
  - Commit: `fix(pipeline): recognise US states and all countries in the location rule`

- [x] **S5.1 robots.txt checker**, cached per domain for 24 h; HTML sources skip and log `robots-disallowed` when blocked.
  - Done: one shared cache in `lib/robots.ts` (per HTTP client, so per run; 24 h is the most RFC 9309 allows, and a cache across runs would need a table for ~50 tiny requests a day). The careers detector uses it too. A blocked company gets the new fetch status `SKIPPED_ROBOTS`: not an error, no failure count, run stays `SUCCESS`, and the email footer says "blocked by its robots.txt".
  - Check: `prisma migrate status` shows the new migration applied after the next pipeline run.
  - Commit: `feat(pipeline): cache robots.txt and skip blocked sources`
- [x] **S5.2 Career-page adapter** (`CUSTOM`, changed from "JSON-LD only" on 2026-11-16 because no candidate site has JSON-LD): reads a company's own job list page, opens each job page, and uses `schema.org/JobPosting` JSON-LD when present, otherwise the heading and main text (research in PLAN.md §5f).
  - Result: JP/Politikens Hus added (12 jobs, 1 passes the filter: Fullstack-udvikler).
  - Commit: `feat(pipeline): add career-page adapter, watch JP/Politikens Hus`
- [x] **S5.3 Careers-page detection** (`pnpm candidates:detect`): reads each candidate's website (robots.txt respected, 1 request/second), finds exact board URLs and their keys, follows up to 3 careers links, and checks supported boards with the real adapters. Writes `docs/careers-detection-report.md` and `config/detected-suggested.json`; adds nothing by itself.
  - Result (117 websites): 13 boards confirmed with jobs (e.g. Monta, Trackunit, Systematic, SYBO, Fellowmind), 9 found but not verified (Workday: LEGO, Stibo, JBT/Marel, GN, NVIDIA), HR Manager at 4 companies, Emply at 1 (Matas), 72 with no recognisable board, 17 unreachable, 1 blocked by robots.txt.
  - Commit: `feat(tools): detect job boards from company careers pages`
- [ ] **S5.4 Grow the company list** to about 100–150 (by hand, with the script's help).
  - Round 1 (2026-11-16): 57 → 63. `candidates:detect` now also reports a company's own career page with job links (`found-custom`), and its rerun on the 94 unwatched candidates found 2 (Dept: really Greenhouse; Salling: category pages, not jobs). Probing HR Manager aliases and Emply hosts by name found Energinet, Andel, Nemlig.com (HR Manager), Init, Novicell (Emply); NNIT and Jyske Bank have empty HR Manager accounts. IMC Trading found on Greenhouse as `imc` (Aarhus office). Fixed the location rule for Hong Kong, Macao, Korea and a few short country names (IMC's Hong Kong jobs passed as "unknown").
  - Left out: Dept (locations are office codes like DTNL, so the location rule can't tell its few Danish jobs apart), Coop and Grundfos-style newer SuccessFactors pages, Agreena (Ashby board gone).
  - Next round: the remaining ~90 candidates mostly load jobs with JavaScript or are big companies on Workday/SuccessFactors with their own domains; they need a look by hand (find the careers page in a browser, note the board, verify with the adapter).
- [x] ~~**S5.5 Email grouped by company**, plus a per-source health overview~~: dropped on 2026-11-16. The new email (step 2.4) lists the newest jobs first with their matched keywords, and the footer already flags sources that need action.

---

## New direction (decided 2026-11-16)

Job Radar is now a **discovery and alert tool only**: find new Danish job posts that mention your stack, fast, so you can be one of the first applicants. Reviewing the fit and writing the CV and cover letter happen by hand, with Claude, outside the app.

**Dropped:** LLM scoring, drafted applications, "mark as applied" links (the old Phases 2 and 3). The dashboard is now optional (Phase 6).
**Kept:** every source adapter, the dedupe, the baseline, the health warnings, the cron.
**Details:** [PLAN.md §7](PLAN.md#7-new-direction-discovery-and-fast-alerts-2026-11-16).

---

## Phase 1R: Reliability

**Goal:** the alerts can never stop silently.
**Time:** about 3 hours.

- [ ] **R.1 Acceptance check** (left over from 1.29): a real new job reached the inbox exactly once. Note the date and the job.
  - Checked 2026-11-16 20:16 UTC: **not passed yet.** 0 emails sent so far; the 01:05 run's 22 passing jobs were the quiet baseline of the 26 companies added on 15 Nov. GitHub config is right (`DRY_RUN=false`, email secrets set).
  - Found: **GitHub started only 2 of ~7 scheduled runs in 19 h** (01:05 and 11:33 UTC; 12:17, 15:17 and 18:17 never ran). GitHub's scheduler is best effort and drops runs under load. Fixed by R.4.
  - Found: Maersk and Workday (Peakon) get HTTP 429 on their first request every run (2 failures in a row). Workday seems to rate-limit GitHub's cloud IPs. To look at in Phase 2 (2.3 touches the Workday adapter).
  - Re-check after R.4 has run for a day.
- [ ] **R.4 Reliable trigger** (added after R.1): a free external scheduler (cron-job.org) calls GitHub's "run workflow" API every hour with a fine-grained token that can only start workflows in this repo. The GitHub schedule stays as a backup; the `concurrency` group stops overlaps, and `MIN_FETCH_INTERVAL_HOURS` stops any company being fetched too often.
  - Code (done): the "Run workflow" button has a `source` input (`manual` or `scheduler`), stored as the run's `trigger`, so scheduler runs can be told apart from clicks.
  - Setup (by hand, once):
    1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate: name `job-radar-scheduler`, expiry 1 year (note the date), repository access **only `job-radar-dk`**, permission **Actions: Read and write** (nothing else).
    2. cron-job.org → free account → Create cronjob: URL `https://api.github.com/repos/priyoarman/job-radar-dk/actions/workflows/pipeline.yml/dispatches`, every hour at minute 7. Advanced: method `POST`; headers `Accept: application/vnd.github+json`, `Authorization: Bearer <token>`, `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`; body `{"ref":"main","inputs":{"source":"scheduler"}}`. Turn on its failure emails.
    3. "Test run" in cron-job.org → expect HTTP **204**, and a new run in GitHub Actions within a minute.
  - Check: `gh run list --workflow pipeline.yml` shows a `workflow_dispatch` run every hour for a day, and the `Run` table has `trigger = "scheduler"` rows.
  - Commit: `ci: let an external scheduler start the pipeline`
  - Progress 2026-11-16 20:58 UTC: cron-job.org test run → HTTP 204; GitHub started the run; it is stored with `trigger = "scheduler"`, and it applied the S5.1 migration. Tick after a full day of hourly runs.
- [x] **R.5 Sync companies in CI** (found during R.4): only 52 of the 63 companies in `config/companies.json` were in the database, because `pnpm db:sync` is a manual step. Run the sync in the workflow before the pipeline, so the config file in git is always the truth (new companies still start with a quiet baseline).
  - Done: `pnpm db:sync` runs after `db:deploy` with `continue-on-error`, so a broken `companies.json` can't stop the alerts (CI already rejects a broken file on push). The sync now also resets a company's baseline when its `source` or `sourceKey` changes, so moving a company to a new board never emails that board's existing jobs.
  - Verified 2026-11-16 21:09 UTC (manual run): `Synced 63 companies — created: 11, updated: 52`; the 11 new companies (Emply, HR Manager, CUSTOM, DR) were fetched from GitHub with 0 failures, 337 baseline jobs, no email.
  - Commit: `ci: sync companies before each run`
- [x] **R.6 Workday is blocked from GitHub** (found during R.4): all 7 Workday companies (LEGO, Maersk, NVIDIA, GN, Stibo, JBT Marel, Workday) get HTTP 429 within ~1 s of their first request, every run, although each gets only one request. They answer from a home connection, so Workday is refusing GitHub's cloud IPs. Options to research: an Apify Workday actor (step 3.4 builds the client), or pausing these companies until then. Until fixed, Workday coverage is zero and the email footer will list them.
  - Done 2026-11-16: the 7 companies are paused (`active: false`, with a note), which also stops the daily warning email. Resume them through Apify after step 3.4.
- [x] **R.2 Keep the cron alive**: GitHub switches off scheduled workflows in a public repo after 60 days without commits (mid-January 2027 at the latest). Add a monthly workflow that keeps the schedule enabled.
  - Note (2026-11-16): after R.4 this only protects the **backup** schedule; runs started through the API (R.4) are not switched off.
  - Done: every run ends with "Keep the backup schedule enabled", which calls GitHub's "enable workflow" API with the run's own token (`actions: write`, nothing more). An hourly scheduler run therefore switches the backup schedule back on if GitHub ever disables it. No commits or extra accounts needed.
  - Check: that step is green in the next run.
  - Commit: `ci: keep the scheduled pipeline enabled`
- [ ] **R.3 "Robot is down" email**: if no run has succeeded for 6 hours, send one warning email (at most once a day).
  - Code (done): every run ends by pinging `HEALTHCHECK_URL` (a GitHub secret; `/fail` when the run failed). An outside watcher is needed because a stopped robot cannot report itself. Without the secret nothing changes.
  - Setup (by hand, once): healthchecks.io → free account → Add Check "Job Radar pipeline", **Period 1 hour, Grace 5 hours** (= email after 6 h without a ping), email notifications on. Copy its ping URL and run `gh secret set HEALTHCHECK_URL` (paste it).
  - Check: after the next run the check shows "up"; pause cron-job.org for 6 h once to see the alert (optional).
  - Commit: `feat(pipeline): warn when no run has succeeded for 6 hours`

---

## Phase 2: Keyword filter

**Goal:** a job reaches you when its title or description mentions your stack.
**Time:** about 6–8 hours.

- [ ] **2.1 Keyword config**: `config/keywords.json` with each keyword and its spellings, e.g. `node` → "node", "node.js", "nodejs"; `next.js` → "next.js", "nextjs" (never the bare word "next"); `postgresql` → "postgresql", "postgres"; `react` as a whole word ("React Native" yes, "reactive" no). Plus the drop words (senior, lead, …) and whether the seniority rule is on. Zod-validated. Table tests.
  - Commit: `feat(pipeline): add keyword config with spelling variants`
- [ ] **2.2 New filter rule**: pass when a keyword appears in the title **or** description, the job is in Denmark (location rule unchanged) and the title is not senior (if switched on). Store the matched keywords on the job (`matchedKeywords`, migration). Drop reasons stay in `filterReason`.
  - Commit: `feat(pipeline): filter jobs by stack keywords`
- [ ] **2.3 Descriptions for Workday and SuccessFactors**: their adapters only read titles. Fetch the job page for **new** jobs only, so a job that mentions React only in its text can still match.
  - Commit: `feat(pipeline): fetch descriptions for new Workday and SuccessFactors jobs`
- [ ] **2.4 Better email**: newest first, the job's own posting date ("posted 2 h ago"), the matched keywords, and the source.
  - Commit: `feat(email): show posting date, keywords and source`
- [ ] **2.5 Dry run on saved jobs**: a script that runs the new rule over the jobs already in the database and prints what would pass, compared with the old rule. Tune the keywords before switching over.
  - Commit: `feat(tools): compare the keyword filter with the title filter`

---

## Phase 3: Job sites

**Goal:** one alert covers company boards **and** the big Danish job sites, without duplicates.
**Time:** about 12–15 hours.

- [ ] **3.1 Groundwork**: new source types `JOBINDEX`, `ITJOBBANK`, `THEHUB`, `LINKEDIN`, `INDEED`, `JOBNET` (migration). An `employer` field on jobs, because one search covers many companies. Search sources never close jobs that drop out of the results (a search only shows the newest jobs). Search sources read their search words from `config/keywords.json`.
  - Commit: `feat(db): add job-site sources and employer name`
- [ ] **3.2 Jobindex and IT-Jobbank** (official RSS, free): `https://www.jobindex.dk/jobsoegning.rss?q=<keyword>` and the same on `www.it-jobbank.dk`. **One plain `q=` per feed**: their `robots.txt` forbids `sort=`, `page=`, `jobage=`, several parameters, and multi-word queries with `+`. First check how a feed orders its 20 jobs; if it is not newest first, adjust before relying on it. Fixtures, tests, then live.
  - Commit: `feat(sources): add Jobindex and IT-Jobbank RSS`
- [ ] **3.3 The Hub** (free): `https://thehub.io/api/v2/jobsandfeatured?countryCode=DK&sorting=newJobs&page=N`, pages 1–2 per run (15 jobs each). No description in the list, so read the job page for new jobs only. Not an official API: keep fixtures, and the health warning catches changes.
  - Commit: `feat(sources): add The Hub`
- [ ] **3.4 Apify client**: run an actor through Apify's API with `APIFY_TOKEN` (GitHub secret), a cap on results per run, a timeout, and the cost of each run in the log.
  - Commit: `feat(pipeline): add Apify client with a cost cap`
- [ ] **3.5 LinkedIn via Apify** (`valig/linkedin-jobs-scraper`, about $0.40 per 1,000 jobs): first a small paid test run to see the real output and cost, then the adapter: your keywords, Denmark, only recent posts (and maybe "under 10 applicants").
  - Commit: `feat(sources): add LinkedIn jobs via Apify`
- [ ] **3.6 Indeed and Jobnet via Apify** (`valig/indeed-jobs-scraper` ~$0.10 per 1,000; `blackfalcondata/jobnet-scraper` ~$2 per 1,000, with a "new only" mode). Jobnet is the search behind Workindenmark. A test run each, then keep or drop.
  - Commit: `feat(sources): add Indeed and Jobnet via Apify`
- [ ] **3.7 No duplicates across sources**: the same job on a company board, Jobindex and LinkedIn becomes **one** email entry ("also on Jobindex, LinkedIn"). Match on a cleaned employer name ("EG A/S" = "EG") plus a cleaned title, within 30 days. Do this right after the second source goes live.
  - Commit: `feat(pipeline): merge the same job from several sources`
- [ ] **3.8 Jobbank.dk** (parked): `jobbank.dk` answers our bot with HTTP 500 even on `/job/`, which its `robots.txt` allows. Ask Jobbank's support whether a feed or API exists; until then, use Jobbank's own job-agent email.

---

## Phase 4: Speed (optional)

- [ ] **4.1 Hourly runs for free sources**: company boards with light APIs, Jobindex, IT-Jobbank and The Hub every hour; Workday, career pages and Apify sources stay at every 3 hours (rate limits and cost).
  - Commit: `feat(pipeline): check light sources every hour`

---

## Phase 5: README and polish

**Goal:** a recruiter understands the project in 60 seconds.

- [ ] **5.1 README**: what it is (one alert, many sources, early applicant), how to run it locally, the sources it covers.
- [ ] **5.2 Architecture diagram** (Mermaid): sources → normalize → dedupe → filter → email.
- [ ] **5.3 Design decisions and ethics**: polite fetching (robots.txt, pauses, intervals), no auto-applying, and how the LinkedIn/Indeed/Jobnet data is obtained (through Apify, logged out, against those sites' terms; your own account is never used).
- [ ] **5.4 Example email** (fake data) and CI badge.
- [ ] **5.5 Privacy check**: search the git history for your surname, email and phone number.
- [ ] **5.6 Release**: tag `v1.0.0`.

---

## Phase 6: Dashboard (optional)

A small read-only Next.js page: latest jobs with their keywords and sources, and source health. Only if there is time; the inbox is the product.
