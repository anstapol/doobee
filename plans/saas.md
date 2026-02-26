# Doobee SaaS Conversion Plan

## What's already in our favor

- **GitHub App model** — already supports multi-installation. Each org/user that installs the app gets a unique `installationId`, and we already scope API clients per installation.
- **Stateless design** — no database, all state flows through function params. Easy to bolt on persistence without refactoring internals.
- **Per-repo config** — `.doobee.json` already gives tenants control without touching our code.
- **Worktree isolation** — repos are already isolated per job.

## What we need to add

### Must-have (MVP)

1. **Database** — Track installations, jobs, and usage. Postgres or SQLite (Turso if serverless). Map `installation_id` → tenant with plan/tier info.
2. **Persistent queue** — In-memory queue (`src/queue.ts`) loses jobs on restart and can only run 1 at a time. Move to Redis/BullMQ or Postgres-backed queue with per-tenant fairness.
3. **Billing/metering** — Track Claude invocations, duration, and tokens per tenant. Stripe for billing.
4. **Rate limiting** — Per-tenant concurrency caps and request limits based on plan tier.
5. **OAuth install flow** — Landing page where users click "Install GitHub App" and we capture the installation event to onboard them.

### Should-have

6. **Dashboard** — Simple web UI showing job history, status, usage per org.
7. **Persistent repo storage** — S3 or a volume instead of local `REPOS_DIR`. Add cleanup policies for stale repos.
8. **Multi-replica deployment** — Stateless servers behind a load balancer, shared queue in Redis/Postgres.

### Nice-to-have

9. **Tenant isolation** — Separate Docker/sandbox per tenant for stronger security boundaries.
10. **Webhook replay / job recovery** — Persist pending jobs so restarts don't lose work.

## Rough effort

| Layer | Effort |
|---|---|
| DB + tenant model | Small — a few tables |
| Persistent queue w/ fairness | Medium — replace `queue.ts` |
| OAuth install flow + onboarding | Small — GitHub handles most of it |
| Billing (Stripe) | Medium |
| Dashboard UI | Medium-Large (new surface area) |
| Multi-replica infra | Medium — Redis + deploy config |

## Hard parts (non-code)

- **Cost model** — Claude Code invocations are expensive. Need to meter accurately and price so we don't lose money on heavy users.
- **Security** — Running arbitrary code (via Claude) against customer repos. Sandboxing matters.
- **Reliability** — Customers expect jobs to complete. Need retries, observability, and graceful degradation.
- **Trust** — Customers give us write access to their repos. SOC 2, clear data handling policies, and audit logs become important.
