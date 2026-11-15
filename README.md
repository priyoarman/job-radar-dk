# Job Radar DK

[![CI](https://github.com/priyoarman/job-radar-dk/actions/workflows/ci.yml/badge.svg)](https://github.com/priyoarman/job-radar-dk/actions/workflows/ci.yml)

A personal job alert system. Every 3 hours it reads the public job feeds of Danish tech companies, saves new jobs to Postgres, filters them by title, and emails a short summary of new matches. It never applies to anything: every application is reviewed and sent by hand.

**Status:** Phase 1 is live (Teamtailor feeds, dedupe, title filter, email alerts). LLM scoring and a dashboard are planned; see [docs/ROADMAP.md](docs/ROADMAP.md).

## How it works

```
GitHub Actions (every 3 h)
  → fetch each company's feed (one at a time, polite User-Agent, skip if fetched < 2.5 h ago)
  → normalize to one Job shape → title filter → save new jobs (dedupe on company + external id)
  → email one summary of new matches (never the same job twice) + warnings for broken sources
  → record the run and one fetch log per company
```

A company's first fetch is a silent **baseline**: its existing jobs are saved but never emailed.

## Run it locally

Requirements: Node 24, pnpm, a Postgres database (for example a free [Neon](https://neon.tech) project) and a [Resend](https://resend.com) API key.

```bash
pnpm install                 # also generates the Prisma client
cp .env.example .env         # then fill in your own values
pnpm db:deploy               # create the tables
pnpm db:sync                 # load config/companies.json into the database
pnpm pipeline:run            # one full run (keep DRY_RUN=true to print instead of email)
```

| Command | What it does |
|---|---|
| `pnpm test` / `pnpm typecheck` | Unit tests (Vitest) and type checks for all packages |
| `pnpm pipeline:run` | One pipeline run |
| `pnpm db:sync` | Add or update companies from `config/companies.json` (never deletes) |
| `pnpm db:migrate` | Create a new migration after changing `db/prisma/schema.prisma` |
| `pnpm db:deploy` | Apply pending migrations |
| `pnpm db:studio` | Browse the database |
| `pnpm email:test` | Send one test email to `EMAIL_TO` |

To watch another company, add it to [config/companies.json](config/companies.json) (only `TEAMTAILOR` sources are supported for now) and run `pnpm db:sync`. To stop watching one, set `"active": false`.

## Run it on GitHub Actions

[.github/workflows/pipeline.yml](.github/workflows/pipeline.yml) runs the pipeline every 3 hours and has a manual **Run workflow** button. In **Settings → Secrets and variables → Actions**, add:

| Secrets | Variables |
|---|---|
| `DATABASE_URL`, `DIRECT_URL`, `RESEND_API_KEY`, `EMAIL_TO` | `DRY_RUN` (`false` to send email), `USER_AGENT` |

Optional variables: `EMAIL_FROM`, `MIN_FETCH_INTERVAL_HOURS`. All variables are described in [.env.example](.env.example) and validated at startup.

## Project layout

| Folder | Contents |
|---|---|
| `db/` | Prisma schema, migrations, shared client, company sync script |
| `pipeline/` | The scheduled job: sources, steps, email, tests with saved feed fixtures |
| `config/` | The list of companies to watch |
| `docs/` | Plan and roadmap |
