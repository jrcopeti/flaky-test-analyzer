# Expected findings — positive control oracle

What the flaky-test-analyzer skill must report when run against this directory. Every rule ID
in `references/rule-catalog.md` is seeded exactly once.

Run the check with:

```
/flaky-test-analyzer fixtures/
```

Then diff the output against the tables below. **A rule that does not fire on its own fixture
is a broken rule** — fix the catalog's signal, not this file. Line numbers are the anchor; if
you edit a fixture, re-verify them.

## `flaky-samples.spec.ts` — categories A–E

| ID | Line | What is seeded |
|---|---|---|
| **A01** | 31, 76 | `waitForTimeout(2000)` after Create; `waitForTimeout(1000)` inside the poll loop |
| **A02** | 24 | `goto('/projects', { waitUntil: 'networkidle' })` |
| **A03** | 43 | `waitForSelector('.project-row')` |
| **A04** | 68 | `waitForNavigation()` inside `Promise.all` |
| **A05** | 29 | `click({ timeout: 60000 })` on Create |
| **A06** | 73–78 | `for` loop polling `innerText` with a sleep, then a non-retrying compare |
| **B01** | 33 | `expect(await …isVisible()).toBe(true)` |
| **B02** | 60 | `expect(page.getByText('Project deleted')).toBeVisible()` — no `await` |
| **B03** | 35–36 | `textContent()` read into `id`, compared with `toBe('PRJ-001')` |
| **B04** | 63 | `expect(await page.content()).toContain(...)` |
| **B05** | 59–61 | `if (await …isVisible())` wrapping the only assertion |
| **C01** | 50 | `locator('#app > div:nth-child(2) > .css-1x2y3z4 button')` — structural + hashed class |
| **C02** | 56 | `.first()` on the Delete button to escape strict mode |
| **C03** | 80 | `getByText('3 items exported')` — volatile count in the text |
| **C04** | 44, 47 | `page.$$('.project-row')`; `page.$eval('h1', …)` |
| **C05** | 57 | `click({ force: true })` on Confirm |
| **D01** | 9 | module-scope `let createdProjectId`, assigned at line 37 |
| **D02** | 41 | "shows the project in the list" reads `createdProjectId` created by an earlier test |
| **D03** | 17–21 | `beforeEach` performing a full UI login |
| **D04** | 27 | hard-coded `'Test Project'` — collides across parallel workers |
| **D05** | — | project created at 26–29, no teardown anywhere in the file |
| **D06** | 10, 12–14 | `sharedPage` created via `newPage()` in `beforeAll` |
| **E01** | 84–85 | billing test hits the real payment provider; no `page.route` in the file |
| **E02** | 87–88 | `new Date()` + `toLocaleDateString()` compared against rendered output |
| **E04** | 90 | `toHaveScreenshot('billing.png')` with no `animations`/`mask`/tolerance |
| **E05** | 28 | `Math.random()` in the Owner field |

Notes on grading:

- **A01 must report both hits.** Reporting only the first means the grep pass stopped early.
- **B02 is the one most often missed** — it looks like an ordinary assertion. Line 60 is inside
  the `if` block, so a reader who only checks top-level statements will skip it.
- **D05 has no single line.** It is an absence, and can only be found by the read pass. A
  report that anchors it to a line number is guessing.
- **C03 vs B03**: line 80 is a locator problem (volatile text in the selector), line 35 is an
  assertion problem (value sampled once). Conflating them is a miss.

### Expected overlaps — not false positives

Some lines legitimately match more than one signal. A report that mentions both is correct;
what matters is that it gives the line the *right rewrite*.

- Line 63 matches **B01** (`expect(await …)`) as well as **B04**. Report it as B04 — the fix is
  to assert on a locator, not merely to move the `await`.
- Line 74 matches **B03** (`innerText()`) as well as **A06**. Report it as A06 — the read is a
  symptom of the hand-rolled poll loop, and rewriting it in isolation leaves the loop.

### B02 decoys — the over-reporting check

Grepping for un-awaited `expect(` in this file returns five lines: **36, 45, 48, 60, 78**.
Only **line 60** is a defect. The other four assert on plain values that were already awaited
into a variable, and correctly need no `await`.

This is deliberate. It tests the catalog's instruction to inspect each hit rather than report
the grep output directly. A run that flags all five is over-reporting and fails this control
just as surely as one that flags none.

## `playwright.config.ts` — category F and E03

| ID | Line | What is seeded |
|---|---|---|
| **F01** | 9 | `retries: 2` unconditionally, with no flaky-count tracking |
| **F02** | 12–14 | `use` block has no `trace` — nothing to debug a flake with |
| **F03** | 8 | `fullyParallel: true` alongside the confirmed D01/D02/D06 findings above |
| **F04** | 10 | `workers: 8` hard-coded regardless of runner size |
| **F05** | — | no `eslint-plugin-playwright`; absence of a `package.json` here counts as unconfigured |
| **F06** | 18, 19 | `port` instead of `url` (no readiness probe); `reuseExistingServer: true` in CI |
| **E03** | 12–14 | `use` block sets only `baseURL` — no `locale`, `timezoneId`, or `viewport` |

## Not covered here

- **E06** (unpinned Playwright version / no CI container) needs a `package.json` and a CI
  workflow to judge. Verified against a real repo instead, not this fixture.

## Negative control

`~/code/fe-interview-2026/e2e/updates.spec.ts` is clean: one `goto`, one web-first
`toBeVisible`, no shared state. It must produce **zero findings on the test body**.

Its `playwright.config.ts` should still raise **F02** (no `trace`), **F04** (`workers` unset),
**F05** (no lint plugin), and **E03** (no `locale`/`timezoneId`/`viewport`) — which confirms
the config pass runs independently of the spec pass. It must **not** raise F06: that config
correctly sets `url` and `reuseExistingServer: !process.env.CI`. A report that flags F06 there
is a false positive and the catalog signal needs tightening.
