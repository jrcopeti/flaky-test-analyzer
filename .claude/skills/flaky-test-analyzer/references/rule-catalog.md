# Flaky Test Rule Catalog

The checklist the audit executes. `playwright-flakiness.md` is the prose explanation of each
of these; every rule ID here has a section there under the same ID.

**Severity**

- **P0** — near-certain flake, or any rule firing inside a test the reporter JSON already
  marked `flaky` / `failed`. Observed evidence always escalates to P0.
- **P1** — fails under parallelism, CI load, or on slower machines.
- **P2** — latent risk or hygiene; no failure yet, but the pattern degrades.

**Detection**

- `grep` — a mechanical text match finds it. Scan all target files in one pass.
- `read` — requires reading the whole file (or config) to judge structure or context.

Rules marked `read` cannot be resolved by pattern alone and must not be reported from a grep
hit without confirming the surrounding code. Rules marked `grep` still need a look at the
matched line before reporting — several have legitimate uses noted in the Exceptions column.

---

## A — Waiting and synchronization

| ID | Sev | Detection | Signal | Why it flakes | Rewrite | Exceptions |
|---|---|---|---|---|---|---|
| **A01** | P0 | grep | `waitForTimeout(` | Bets on machine speed; the bet loses under CI load | Assert the condition the wait stood in for: `await expect(loc).toBeVisible()` | Temporary debugging lines only |
| **A02** | P1 | grep | `networkidle` | Never fires on polling/websocket apps; fires too early on quiet ones | `await page.goto(url)` then assert a UI readiness signal | None |
| **A03** | P1 | grep | `waitForSelector(` | Returns a handle, splits wait from act, reintroduces the race | `await expect(locator).toBeVisible()` / `.toHaveCount(n)` | None |
| **A04** | P1 | grep | `waitForNavigation(` | Deprecated; navigation often starts before the listener attaches | `await page.waitForURL(...)` or `await expect(page).toHaveURL(...)` | None |
| **A05** | P1 | grep | `timeout: ` with a value ≥ 30000, or `test.setTimeout(` | Widens the race window instead of closing it; masks the real cause | Diagnose the underlying wait; use `expect.poll` on the real completion signal | A documented known-slow server operation |
| **A06** | P1 | read | `for`/`while` loop containing a `waitForTimeout` or repeated read | Hand-rolled polling, usually unbounded and invisible to the trace | `expect.poll(...)` for a value; `expect(async () => {...}).toPass({ timeout })` for a block | None |

## B — Assertions

| ID | Sev | Detection | Signal | Why it flakes | Rewrite | Exceptions |
|---|---|---|---|---|---|---|
| **B01** | P0 | grep | `expect(await ` | Samples a boolean at one instant; no retry | `await expect(locator).toBeVisible()` / `.toBeEnabled()` / `.toBeChecked()` | Asserting on an API response body already awaited |
| **B02** | P0 | grep | `expect(` or a locator action at line start with no preceding `await` | Floating promise: never blocks, failure is swallowed or misattributed — the test asserts nothing | Add `await` | `expect.soft` still needs await; `test.step` returns a promise too |
| **B03** | P1 | grep | `await ...textContent()` / `innerText()` / `inputValue()` assigned then compared | Reads once, possibly mid-render | `await expect(loc).toHaveText(...)` / `.toHaveValue(...)` | Reading a value to compute with, *after* a web-first assertion has settled the element |
| **B04** | P1 | grep | `page.content()`, `page.innerText('body')` | Whole-document snapshot; matches hidden templates and script tags | Assert on a specific locator | None |
| **B05** | P1 | read | `if` / `?:` / `try-catch` wrapping an `expect` in a test body | Asserts different things on different runs; the untaken branch is dead coverage | Split into two tests, or use `locator.or()` so it still retries | Fixture setup and helper functions outside the assertion path |

## C — Locators

| ID | Sev | Detection | Signal | Why it flakes | Rewrite | Exceptions |
|---|---|---|---|---|---|---|
| **C01** | P1 | grep | `page.locator('` with `>`, `nth-child`, a hashed class (`css-`, `sc-`, `_`+hash), or `//` XPath | Breaks on DOM restructure or CSS-in-JS rebuild; presents as a misleading `TimeoutError` | `getByRole(role, { name })`, per the priority ladder | A stable hand-authored class or id that is a deliberate contract |
| **C02** | P1 | read | `.first()` / `.last()` / `.nth(` | Silences a strict-mode violation without resolving the ambiguity; couples the test to DOM order | `.filter({ hasText })` / `.filter({ has })`, or chain from a unique container | Position is the actual requirement ("first row of a date-sorted table") |
| **C03** | P1 | grep | `getByText(` / `hasText:` containing a digit, date, currency symbol, or generated id | Text drifts with data and locale, failing at a time unrelated to any code change | Regex match on the stable part, or `getByTestId` | Genuinely fixed copy that happens to contain a number |
| **C04** | P0 | grep | `page.$(`, `page.$$(`, `$eval(`, `$$eval(`, `elementHandle` | Handle points at one node; detaches on re-render → "element is not attached to the DOM" | Locators — they re-resolve on every use | None in test code |
| **C05** | P1 | grep | `force: true` | Skips actionability; usually masks an overlay intercepting the click — a real bug | Dismiss the obstruction, then act normally | Custom controls with a hidden real hit target — must carry a comment saying why |

## D — Isolation and shared state

| ID | Sev | Detection | Signal | Why it flakes | Rewrite | Exceptions |
|---|---|---|---|---|---|---|
| **D01** | P0 | read | `let` / `var` at module scope, assigned inside a test | Shared and mutated across tests; undefined when a test runs alone or is retried | Create what the test needs in the test, via API where possible | `const` config values that are never reassigned |
| **D02** | P0 | read | A test referencing data another test created; `describe.serial` used broadly | Files run in parallel and single tests retry in fresh workers — "earlier" is not guaranteed | Make each test self-sufficient | `describe.serial` for a genuinely sequential flow, scoped tightly |
| **D03** | P1 | read | `beforeEach` containing a login form fill + submit | Slow ×N, and concentrates flake risk on the auth service; parallel workers trigger rate limits | `storageState` + a `setup` project with `dependencies` | The one test whose subject is logging in |
| **D04** | P1 | read | Hard-coded names/emails/ids in create flows | Two workers create the same record; one hits a uniqueness violation or deletes the other's row | Suffix with `test.info().testId`; partition backend fixtures by `parallelIndex` | Read-only reference data |
| **D05** | P1 | read | Creates server-side data with no matching cleanup | Leaks accumulate across runs; `toHaveCount(1)` starts failing on run 41 | Fixture with teardown after `use()` — runs even when the test throws | Environments reset between every run |
| **D06** | P1 | read | `newPage()` / `newContext()` inside `beforeAll` | Discards per-test isolation; cookies, storage, and scroll leak between tests | Use the per-test `page` fixture | Inside an explicit `describe.serial` where shared state is the point |

## E — Determinism of the environment

| ID | Sev | Detection | Signal | Why it flakes | Rewrite | Exceptions |
|---|---|---|---|---|---|---|
| **E01** | P1 | read | Test exercises a third-party integration with no `page.route` covering it | External latency, rate limits, and changing data you do not control | `page.route(...)` with `fulfill`, or `routeFromHAR` | A deliberate small integration suite against real services |
| **E02** | P1 | grep | `new Date()`, `Date.now()`, `setTimeout` assumptions in test or assertion | Wall-clock dependence fails at midnight, month end, and DST | `page.clock.setFixedTime(...)`, or `install` + `fastForward` | Timestamps only used to build unique data |
| **E03** | P1 | read | Config `use` block lacking `locale`, `timezoneId`, or `viewport` | Inherits from the machine, so local and CI differ — the classic "works on my laptop" | Pin all three in `playwright.config.ts` | Responsive suites that set viewport per project |
| **E04** | P1 | grep | `toHaveScreenshot(` / `toMatchSnapshot(` without `animations`, `mask`, or a diff tolerance | Mid-animation frames and cross-OS font anti-aliasing differ | Add `animations: 'disabled'`, `caret: 'hide'`, `mask`, `maxDiffPixelRatio` | Baselines generated in the same container CI uses, with stable content |
| **E05** | P1 | grep | `Math.random()`, `faker.` without a seed, `Date.now()` in field values | Most runs pass; the run with an apostrophe or a 200-char string fails | Fixed data; test edge cases as explicit cases | Uniqueness suffixes (see D04) — prefer `testId` |
| **E06** | P2 | read | Playwright version pinned with `^`; no container in CI | Browser build and OS differences between local and CI | Exact version pin; run CI on `mcr.microsoft.com/playwright` | — |

## F — Configuration, retries, and CI

| ID | Sev | Detection | Signal | Why it flakes | Rewrite | Exceptions |
|---|---|---|---|---|---|---|
| **F01** | P2 | read | `retries` > 0 with no flaky-count tracking in CI | Converts a measurable problem into an invisible, growing one | Keep `retries: process.env.CI ? 2 : 0`, and surface the flaky count in the CI summary | — |
| **F02** | P1 | read | `trace` absent or not `on-first-retry` | A flake does not reproduce on demand; without a trace there is no evidence | `use: { trace: 'on-first-retry' }` | `trace: 'on'` while actively debugging |
| **F03** | P1 | read | `fullyParallel: true` alongside any confirmed D-category finding | Parallelism exposes existing coupling all at once | Fix the D findings — do not disable parallelism | — |
| **F04** | P2 | read | `workers` unset or high, on a small CI runner | Saturating the box slows everything; margins vanish and tests time out | `workers: process.env.CI ? 2 : undefined`, tuned against measured runtimes | Large runners |
| **F05** | P2 | read | No `eslint-plugin-playwright` in devDependencies or ESLint config | A whole class of these rules goes uncaught until review, or never | Add the plugin plus `@typescript-eslint/no-floating-promises` | — |
| **F06** | P1 | read | `webServer` with no `url`, or `reuseExistingServer` true in CI | No readiness probe → first tests race the boot; a stale CI process serves an old build | Set `url`; `reuseExistingServer: !process.env.CI` | — |

---

## Grep pass

One scan covers every `grep`-detected rule. Run from the target root:

```
A01  waitForTimeout\(
A02  networkidle
A03  waitForSelector\(
A04  waitForNavigation\(
A05  timeout:\s*[3-9][0-9]{4,}|test\.setTimeout\(
B01  expect\(await
B02  ^\s*(expect|page|await\s+expect\.soft)\(   # then check each for a leading await
B03  (textContent|innerText|inputValue)\(\)
B04  page\.content\(\)
C01  \.locator\(['"][^'"]*([>]|nth-child|css-|//)
C03  getByText\(['"][^'"]*[0-9$£€]
C04  page\.\$\$?\(|\$\$?eval\(|elementHandle
C05  force:\s*true
E02  new Date\(\)|Date\.now\(\)
E04  toHaveScreenshot\(|toMatchSnapshot\(
E05  Math\.random\(\)|faker\.
```

`read`-detected rules (A06, B05, C02, all of D, E01, E03, E06, all of F) require reading the
spec files and `playwright.config.*` in full. Category F is judged from the config alone.

## Reporting a finding

```
[P0] A01  e2e/checkout.spec.ts:34
     Hard wait of 2000ms after "Place order" — passes locally, races under CI load.
     → await expect(page.getByRole('status')).toHaveText('Order confirmed')
```

One line of mechanism, one line of rewrite. Group by test, order P0 → P2, and close with a
count by category — the distribution is the diagnosis. Thirty C01 hits are one locator
strategy problem, not thirty bugs.
