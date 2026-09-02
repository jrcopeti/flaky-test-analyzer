---
name: flaky-test-analyzer
description: Audits a Playwright suite for the causes of flaky, intermittent, and unreliable e2e tests — hard waits, non-web-first assertions, brittle locators, shared state between tests, non-deterministic environment, and risky config. Reports ranked findings with the exact rewrite for each, then applies fixes on approval and verifies with repeat runs. Use when tests fail intermittently, pass locally but fail in CI, are marked flaky by the reporter, or when reviewing e2e tests for stability.
argument-hint: "[test file | directory | --report <path/to/results.json>]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Edit
  - Bash(npx playwright test:*)
---

# Playwright flaky test analyzer

Find why a Playwright suite is unreliable, report it in priority order, fix what the user
approves, and prove the fix with repeat runs.

Target: $ARGUMENTS

## Working context

- Playwright config in cwd: !`ls playwright.config.* 2>/dev/null || echo "none — search for it"`
- Reporter output present: !`ls -d test-results playwright-report 2>/dev/null || echo "none"`

## Reference material

Two files sit next to this skill. Read them before auditing — do not work from memory.

- `references/rule-catalog.md` — the rules to check, with severity, detection method, signal,
  and rewrite for each. **This is the checklist you execute.**
- `references/playwright-flakiness.md` — the explanation behind each rule ID, with worked
  before/after code. Read the relevant section before you rewrite anything, and cite the ID
  when you report a finding so the user can look it up.

Rule IDs are stable (`A01`, `C04`, `D03`, …) and shared between both files.

---

## Step 1 — Scope

Resolve the target from `$ARGUMENTS`:

- A spec file → audit that file.
- A directory → audit every `*.spec.*` / `*.test.*` under it.
- `--report <path>` → see Step 2; the report determines the scope.
- Nothing → read `playwright.config.*` and audit its `testDir`.

Read `playwright.config.*` regardless of scope. It is itself an audit target (all of category
F), and it tells you what the rest of the audit means: `fullyParallel`, `retries`, `trace`,
`workers`, and the `use` block for E03.

State the resolved scope in one line before doing anything else:

```
Scope: e2e/ — 7 spec files, config at playwright.config.ts (fullyParallel: true, retries: 0)
```

If there is no Playwright config anywhere, say so and stop — this skill has nothing to audit.

## Step 2 — Gather evidence (best-effort)

Look for reporter output: the path given after `--report`, then `test-results/*.json`, then
`playwright-report/`. If a JSON report exists, extract every test whose status is `flaky` or
`failed`, along with its error message.

That set changes the audit in two ways:

1. **Escalation.** Any rule that fires inside one of those tests becomes **P0**, whatever its
   catalog severity. Observed evidence outranks static risk.
2. **Ordering.** The report leads with those tests. Everything else follows.

The error message is a strong hint at the category — match it against the symptom table at the
end of `playwright-flakiness.md`. A `TimeoutError` immediately after a UI change is locator
drift (C01), not a waiting problem, and treating it as one leads to exactly the wrong fix.

If no reporter JSON exists, say so in one line and continue with static analysis. **Do not run
the suite just to produce one** — that is slow, may need infrastructure that is not up, and
static analysis does not depend on it.

## Step 3 — Audit

Work through `references/rule-catalog.md`.

1. **Grep pass.** The catalog's "Grep pass" section lists a pattern per mechanically-detectable
   rule. Run them across the scoped files. Then **look at each hit before recording it** —
   several rules have legitimate uses listed in the catalog's Exceptions column, and reporting
   those as defects trains the user to ignore the report.
2. **Read pass.** The rules marked `read` cannot be found by pattern. Read each spec file in
   full and judge: module-scope mutable state (D01), one test depending on another's data
   (D02), UI login in `beforeEach` (D03), hard-coded data that collides across workers (D04),
   missing teardown (D05), a page built in `beforeAll` (D06), conditional assertions (B05),
   hand-rolled polling (A06), positional locators (C02), unmocked third-party calls (E01).
3. **Config pass.** Judge category F, plus E03 and E06, from `playwright.config.*` and
   `package.json`.

Record each finding as rule ID + `file:line`. Assign severity from the catalog, escalating
anything inside a test the reporter marked flaky.

Two judgement rules that decide whether this report is useful:

- **A rule firing is not automatically a defect.** Check the Exceptions column. A `.first()`
  on a deliberately date-sorted table is correct code.
- **Do not manufacture findings.** A clean file gets reported as clean. A report padded with
  P2 noise buries the P0 that mattered.

## Step 4 — Report

Order P0 → P2, grouped by test. Per finding: severity, rule ID, `file:line`, one sentence on
the failure mechanism, and the concrete rewrite.

```
## e2e/checkout.spec.ts — "completes a purchase"   [flaky: 2 of last 10 runs]

[P0] A01  e2e/checkout.spec.ts:34
     Hard wait of 2000ms after "Place order" — passes locally, races under CI load.
     → await expect(page.getByRole('status')).toHaveText('Order confirmed')

[P0] B01  e2e/checkout.spec.ts:41
     expect(await …isVisible()) samples once; no retry against the async render.
     → await expect(page.getByTestId('receipt')).toBeVisible()

[P1] C02  e2e/checkout.spec.ts:28
     .first() on "Remove" silences a strict-mode violation; couples to cart order.
     → .filter({ hasText: 'Blue Widget' }).getByRole('button', { name: 'Remove' })
```

Close with a count by category. **The distribution is the diagnosis** — thirty C01 hits are
one locator-strategy problem, not thirty bugs, and should be described that way:

```
A 4 · B 7 · C 31 · D 2 · E 0 · F 3   (18 files)
→ Dominated by C: the suite selects on CSS structure rather than roles. Fixing that
  pattern once removes most of the exposure.
```

## Step 5 — Confirm

**Stop here. Do not edit anything before this point.**

Ask which findings to apply. Offer the useful groupings rather than a flat list: all P0; a
whole category; a single file. If any finding is a judgement call — a `.first()` that may be
intentional, a `describe.serial` that may be a deliberate flow — flag it as needing the
user's call rather than deciding for them.

## Step 6 — Fix

Apply approved rewrites in two waves.

**Mechanical first (A, B, C).** Local, well-defined substitutions.

The one rule that governs all of them: **preserve the test's intent.** A hard wait is standing
in for a real condition — removing it means naming that condition and asserting on it, never
just deleting the line. If you cannot work out what the wait was for, say so and leave it for
the user rather than guessing.

**Structural second (D, E, F).** These change test architecture — extracting a `storageState`
setup project, adding a teardown fixture, mocking a third-party boundary. Present each one
individually with its diff. They carry more risk and deserve separate review.

Do not restyle, rename, or reorganize anything the findings did not name.

## Step 7 — Verify

Run the touched tests repeatedly and report the measured pass rate:

```bash
npx playwright test <files> --repeat-each=20 --workers=4
```

`--workers=4` matters: shared-state flakes (category D) only appear under concurrency, so a
serial re-run would give a false all-clear.

When Step 2 found a reporter JSON, run this **before** applying fixes as well, so the result is
a real before/after rate ("3/20 → 0/20") rather than a claim.

If the suite cannot run — no dev server, missing browsers, unavailable backend — say that
explicitly and report the fixes as applied but unverified. Never present an unverified fix as
confirmed.

Note that repeat runs bound confidence, they do not prove absence: 20/20 green makes a
1-in-3 flake very unlikely, and says little about a 1-in-500 one. Report what was measured.
