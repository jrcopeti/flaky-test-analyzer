# Playwright Flakiness: Root Causes and Correct Patterns

A flaky test is one whose result changes without the code changing. It passed this morning,
failed in CI at 14:02, and passed again on retry. Nothing was deployed in between.

Flakiness is not randomness. Every flake has a mechanism, and in Playwright those mechanisms
fall into a small number of families. This document is organized by those families — by
**root cause**, not by API — because that is the axis you search along when a test is
failing and you do not yet know why.

## The triage stance

**Fix > quarantine > retry.**

Retries are a diagnostic instrument, not a remedy. Playwright labels a test `flaky` when it
fails and then passes on retry — that label is the *signal you wanted*, and configuring
`retries: 2` to make CI green while ignoring the label converts a signal into noise. A suite
where 8% of tests are marked flaky and nobody looks at the label has no test suite; it has a
random number generator with a CI bill.

The working order:

1. **Fix** it if the mechanism is identifiable. Most are — the categories below cover the
   large majority of real cases.
2. **Quarantine** it (`test.fixme`, or a separate non-blocking project) if it is genuinely
   unstable and you cannot fix it today. Quarantine is honest; a retry that hides it is not.
3. **Retry** only for failures whose cause is genuinely external and transient — a flaky
   staging dependency you do not control. Even then, keep the flaky-count visible.

A practical threshold for calling something flaky rather than broken: it fails 3 times in 10
consecutive runs, or 4 times in 20 with varying failure signatures. Consistent failure is a
bug, not a flake, and should be debugged as one.

## The two things Playwright already does for you

Almost every flake in categories A and B comes from fighting these two mechanisms instead of
using them.

**Auto-waiting via actionability checks.** Before any action, Playwright waits for the target
element to pass a set of checks. It does not act on an element that is not ready:

| Check | Meaning |
|---|---|
| **Visible** | Non-empty bounding box, not `visibility: hidden`. Note `opacity: 0` still counts as visible; `display: none` and zero-size do not. |
| **Stable** | The bounding box has been unchanged for two consecutive animation frames — i.e. it is not mid-animation. |
| **Receives events** | The element is the actual hit target at the action point; no overlay, toast, or modal is intercepting. |
| **Enabled** | No `[disabled]` attribute, not inside a disabled `fieldset`, no `aria-disabled`. |
| **Editable** | Enabled, and not `[readonly]` / `aria-readonly`. |

Different actions run different subsets. `click()` runs all five. `fill()` runs visible +
enabled + editable. `focus()`, `blur()`, and `press()` run none.

**Auto-retrying assertions.** Web-first assertions re-evaluate until they pass or the expect
timeout (default 5s) expires. They are async and must be awaited.

*Auto-retrying* (use these): `toBeVisible`, `toBeHidden`, `toBeInViewport`, `toBeChecked`,
`toBeDisabled`, `toBeEnabled`, `toBeEditable`, `toBeFocused`, `toBeEmpty`, `toHaveText`,
`toContainText`, `toHaveValue`, `toHaveValues`, `toHaveAttribute`, `toHaveClass`,
`toHaveCSS`, `toHaveId`, `toHaveCount`, `toHaveURL`, `toHaveTitle`, `toHaveScreenshot`.

*Non-retrying* (sample once, race by construction): `toBe`, `toEqual`, `toStrictEqual`,
`toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeDefined`, `toBeGreaterThan`, `toBeLessThan`,
`toContain`, `toHaveLength`, `toHaveProperty`.

The single highest-yield rule in this entire document: **the target of an assertion should be
a locator, not a value you already awaited out of one.**

---

# A. Waiting and synchronization

The largest source of flakes, and the most mechanical to fix.

## A01 — Hard waits (`page.waitForTimeout`)

`waitForTimeout` asserts that the application will be ready in exactly N milliseconds. On
your laptop with a warm cache it is; on a loaded CI runner sharing four vCPUs with three
other jobs it is not. The failure is load-dependent, which is precisely why it reproduces in
CI and not locally.

```ts
// ✗ Wrong — a bet on machine speed
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForTimeout(2000)
await expect(page.getByText('Saved')).toBeVisible()

// ✓ Right — wait for the condition itself
await page.getByRole('button', { name: 'Save' }).click()
await expect(page.getByText('Saved')).toBeVisible()
```

The second version is also *faster*: it proceeds the instant the text appears rather than
always burning 2000ms.

Every hard wait is standing in for a real condition. Removing one means naming that
condition, never just deleting the line. If the wait guards something with no visible
signal — a background write, a debounce — see A06.

`waitForTimeout` is legitimate in exactly one place: exploratory debugging, on a line you
intend to delete.

## A02 — `waitUntil: 'networkidle'`

Officially discouraged. It waits for 500ms with no network connections, which is a proxy for
"the page is ready" that breaks on any app with polling, analytics beacons, websockets, or
long-lived connections — where the network is never idle, so the wait runs to timeout.
On apps that *are* quiet it fires before a render that was already scheduled.

```ts
// ✗ Wrong
await page.goto('/dashboard', { waitUntil: 'networkidle' })

// ✓ Right — assert on the UI state that means "ready"
await page.goto('/dashboard')
await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
```

## A03 — `page.waitForSelector`

Superseded by locators and web-first assertions. It returns an ElementHandle (see C04), it
detaches from the locator's auto-retry machinery, and it encourages the wait-then-act split
that reintroduces the race the wait was meant to close.

```ts
// ✗ Wrong
await page.waitForSelector('.row-item')
const rows = await page.$$('.row-item')
expect(rows.length).toBe(3)

// ✓ Right
await expect(page.getByRole('row')).toHaveCount(3)
```

## A04 — `page.waitForNavigation`

Deprecated and race-prone: the navigation frequently begins before the listener is attached,
so the wait hangs until timeout. If you need to wait on a URL, wait on the URL.

```ts
// ✗ Wrong
await Promise.all([
  page.waitForNavigation(),
  page.getByRole('link', { name: 'Reports' }).click(),
])

// ✓ Right — the click auto-waits; then assert where you landed
await page.getByRole('link', { name: 'Reports' }).click()
await expect(page).toHaveURL(/\/reports/)
// or, when you must block on it: await page.waitForURL('**/reports')
```

## A05 — Inflated timeouts

Raising a timeout does not fix a race; it widens the window in which the race is usually won.
The test still fails, just more rarely and on worse days. It also slows every genuine failure
to the new ceiling.

```ts
// ✗ Wrong — a 60s click is not a click, it is a symptom
await page.getByRole('button', { name: 'Export' }).click({ timeout: 60_000 })
```

An inflated timeout is a **marker for investigation**, not a defect in itself. Ask what is
slow: a real backend operation (then the wait belongs in an `expect.poll` on the operation's
completion signal, not on the click), an element obscured by an overlay (then it is a
receives-events failure and the timeout is masking a genuine bug), or an app that is
genuinely slow (then it is a performance issue and the test is reporting it accurately).

The legitimate use of a raised timeout is a known-slow operation with a stated reason:

```ts
// ✓ Acceptable — bounded, deliberate, documented
// Report generation is a synchronous server-side job, p99 ~40s.
await expect(page.getByText('Report ready')).toBeVisible({ timeout: 60_000 })
```

## A06 — Hand-rolled polling

Loops with sleeps reimplement `expect.toPass` and `expect.poll`, badly — usually without a
timeout, and always without the trace integration.

```ts
// ✗ Wrong
let status = ''
for (let i = 0; i < 10; i++) {
  status = await page.getByTestId('status').innerText()
  if (status === 'Complete') break
  await page.waitForTimeout(1000)
}
expect(status).toBe('Complete')

// ✓ Right — poll a value
await expect
  .poll(async () => {
    const res = await page.request.get('/api/job-status')
    return (await res.json()).status
  }, { timeout: 30_000, intervals: [500, 1000, 2000] })
  .toBe('Complete')

// ✓ Right — retry a whole block until its assertions pass
await expect(async () => {
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByTestId('status')).toHaveText('Complete')
}).toPass({ timeout: 30_000 })
```

Use `expect.poll` for a value you can read; `expect.toPass` when the block has side effects
that must be repeated. Note `toPass` has no default timeout — always set one.

When the thing you are waiting for is a specific network response, wait for it directly:

```ts
const responsePromise = page.waitForResponse(r => r.url().includes('/api/orders') && r.ok())
await page.getByRole('button', { name: 'Place order' }).click()
await responsePromise
```

Start the wait *before* the action that triggers it, or you may miss it.

---

# B. Assertions

## B01 — Non-web-first assertions

The defining anti-pattern. `await locator.isVisible()` resolves to a boolean *at one instant*.
Wrapping it in `expect` compares that stale boolean. There is no retry — the assertion is a
snapshot of a moment that may be the wrong moment.

```ts
// ✗ Wrong — samples once, races the render
expect(await page.getByText('Welcome').isVisible()).toBe(true)
expect(await page.getByRole('button').isEnabled()).toBeTruthy()

// ✓ Right — retries until true or timeout
await expect(page.getByText('Welcome')).toBeVisible()
await expect(page.getByRole('button')).toBeEnabled()
```

The tell is `expect(await …)`. When you see `await` inside `expect(...)`, the assertion has
almost certainly lost its retry-ability.

## B02 — Missing `await`

An un-awaited assertion is a floating promise. It never blocks, its failure surfaces as an
unhandled rejection attributed to a *different* test, or is swallowed entirely — so the test
passes while asserting nothing. The same applies to un-awaited actions, which produce
interleaved operations and impossible-looking failures.

```ts
// ✗ Wrong — passes unconditionally
expect(page.getByText('Saved')).toBeVisible()
page.getByRole('button', { name: 'Submit' }).click()

// ✓ Right
await expect(page.getByText('Saved')).toBeVisible()
await page.getByRole('button', { name: 'Submit' }).click()
```

Catch these mechanically rather than by review: enable
`@typescript-eslint/no-floating-promises` and `playwright/missing-playwright-await`. This is
the single highest-value lint rule for a Playwright suite.

## B03 — Sampling a value, then comparing it

Same failure as B01, in the content dimension. `textContent()` reads once; if the element is
still rendering a skeleton or an old value, you compare the wrong string.

```ts
// ✗ Wrong
const total = await page.getByTestId('total').textContent()
expect(total).toBe('$42.00')

// ✓ Right
await expect(page.getByTestId('total')).toHaveText('$42.00')
```

When you genuinely need the value in JS (to compute with it), read it *after* a web-first
assertion has established that the element has settled:

```ts
await expect(page.getByTestId('total')).not.toBeEmpty()
const total = await page.getByTestId('total').textContent()
```

## B04 — Asserting against page-level HTML

`page.content()` and full-page `innerText` are single snapshots of the entire document, and
they match text anywhere — including in a hidden template, a script tag, or an element the
user cannot see. They are both racy and imprecise.

```ts
// ✗ Wrong
expect(await page.content()).toContain('Order confirmed')

// ✓ Right
await expect(page.getByRole('status')).toHaveText('Order confirmed')
```

## B05 — Conditional logic in tests

A test that branches asserts different things on different runs. When it passes, you do not
know what it verified; the branch that never executes is dead coverage that silently
protects nothing.

```ts
// ✗ Wrong — the assertion may never run
if (await page.getByRole('dialog').isVisible()) {
  await expect(page.getByText('Confirm')).toBeVisible()
}

// ✓ Right — decide what should happen and assert it
await expect(page.getByRole('dialog')).toBeVisible()
await expect(page.getByText('Confirm')).toBeVisible()
```

If two outcomes are both legitimate, they are two tests with two setups, not one test with an
`if`. If you truly must accept either of two states, express it in the locator layer where it
still retries:

```ts
await expect(page.getByText('Saved').or(page.getByText('No changes')).first()).toBeVisible()
```

## Soft assertions

`expect.soft` records a failure without halting the test, so one run reports every problem
instead of only the first. Useful for checking many independent fields on one page. It does
not affect flakiness either way, but it shortens the debug loop.

```ts
await expect.soft(page.getByTestId('status')).toHaveText('Success')
await expect.soft(page.getByTestId('owner')).toHaveText('Ada')
await page.getByRole('link', { name: 'Next' }).click()  // still runs
```

Do not use soft assertions for preconditions — if the page did not load, continuing produces
a cascade of meaningless failures.

---

# C. Locators

## The priority ladder

In order. Go down a rung only when the rung above genuinely does not apply.

1. **`getByRole(role, { name })`** — how users and assistive technology perceive the page.
   Survives restructuring and restyling; breaks only when the semantics actually change,
   which is when a test *should* break. Switching a suite to role-based locators eliminates
   more flakes than any other single change.
2. **`getByLabel`** — form controls.
3. **`getByPlaceholder`** — inputs with no label (and note: that is usually an accessibility
   bug worth fixing at the source).
4. **`getByText`** — non-interactive content: paragraphs, spans, list copy.
5. **`getByAltText`** / **`getByTitle`** — images, and elements whose title carries meaning.
6. **`getByTestId`** — resilient but invisible to users. The right choice for elements with no
   stable accessible identity: a chart canvas, a virtualized row, a container div. Treat it
   as an explicit contract between the app and the suite, not as an escape hatch used because
   `getByRole` was slightly more effort.
7. **CSS / XPath** — last resort.

## C01 — CSS/XPath chains and generated class names

```ts
// ✗ Wrong
page.locator('#tsf > div:nth-child(2) > div.A8SBwf > div.RNNXgb > button')
page.locator('.css-1x2y3z4')                     // CSS-in-JS hash, changes on rebuild
page.locator('//div[@class="card"][3]//button')   // structural, and blind to shadow DOM

// ✓ Right
page.getByRole('button', { name: 'Search' })
```

These break on any DOM restructure or CSS-in-JS rebuild. The resulting failure is a
`TimeoutError` that looks like a timing problem and is not — which is why locator drift is
so often misdiagnosed as a wait problem and "fixed" with a longer timeout.

XPath additionally does not pierce shadow DOM; Playwright's own locators do (except
closed-mode roots, which nothing can reach).

## C02 — `.nth()` / `.first()` / `.last()` as a strict-mode escape

Locators are strict by default: if a locator matches more than one element, the action throws
rather than silently picking one. That error is Playwright telling you the locator is
ambiguous. Appending `.first()` silences the message without resolving the ambiguity — and
now the test depends on DOM order, so it breaks when a row is inserted, when results arrive
in a different order, or when a sort default changes.

```ts
// ✗ Wrong — silences the message, keeps the ambiguity
await page.getByRole('button', { name: 'Delete' }).first().click()

// ✓ Right — narrow by the container that makes it unique
await page
  .getByRole('listitem')
  .filter({ hasText: 'Invoice 2024-03' })
  .getByRole('button', { name: 'Delete' })
  .click()
```

Filtering and chaining are the real fix: `.filter({ hasText })`, `.filter({ hasNotText })`,
`.filter({ has: locator })`, `.filter({ hasNot: locator })`, and `.and()` / `.or()`.

Positional selection is legitimate when position is the actual semantics — "the first row of
a table sorted by date" is a real requirement. The distinction is whether you chose `.first()`
because position matters or because the error was inconvenient.

## C03 — Text locators on volatile content

Text that includes a date, a count, a currency amount, a generated id, or anything localized
will drift. The test then fails at a time unrelated to any code change.

```ts
// ✗ Wrong
page.getByText('Last updated 14 Mar 2026, 09:31')
page.getByText('3 items in cart')

// ✓ Right
page.getByText(/Last updated/)
page.getByTestId('cart-count')
page.getByRole('status').filter({ hasText: /\d+ items? in cart/ })
```

Note that `hasText` normalizes whitespace, so it tolerates formatting changes — but not
content changes.

## C04 — Element handles

`page.$()`, `page.$$()`, `page.$eval()`, and `elementHandle` predate locators. A handle points
at a specific DOM node captured at one moment; if React re-renders, the node is detached and
every subsequent operation fails with "element is not attached to the DOM". A locator is a
*description*, re-resolved on every use — which is exactly what makes it survive re-renders.

```ts
// ✗ Wrong
const button = await page.$('.submit')
await button.click()                    // may be detached by now

const count = await page.$$eval('.row', els => els.length)
expect(count).toBe(5)

// ✓ Right
await page.locator('.submit').click()   // better: getByRole('button', { name: 'Submit' })
await expect(page.getByRole('row')).toHaveCount(5)
```

## C05 — `force: true`

`force` skips the actionability checks. It is not "click harder" — it is "click even though
Playwright determined a user could not". It is most often added to defeat a receives-events
failure, which means an overlay, a cookie banner, a toast, or a modal was covering the target.
Forcing through it hides a genuine bug and produces a test that passes while the user cannot
perform the action.

```ts
// ✗ Wrong — masks whatever is covering the element
await page.getByRole('button', { name: 'Accept' }).click({ force: true })

// ✓ Right — deal with the obstruction
await page.getByRole('dialog', { name: 'Cookies' })
  .getByRole('button', { name: 'Dismiss' })
  .click()
await page.getByRole('button', { name: 'Accept' }).click()
```

Legitimate uses exist — custom controls where the real hit target is a hidden input, or
deliberately testing a disabled-looking element — and they deserve a comment saying which.

---

# D. Isolation and shared state

Playwright gives each test a fresh `BrowserContext`: separate cookies, storage, and cache.
That covers browser state. It does not cover anything *outside* the browser — your database,
your API, the filesystem, a shared account. Those you must manage.

These flakes are the nastiest to diagnose because the failing test is usually innocent; the
cause is another test running concurrently.

## D01 — Module-level mutable state

```ts
// ✗ Wrong — shared across every test in the file, and mutated by them
let createdOrderId: string

test('creates an order', async ({ page }) => {
  createdOrderId = await createOrder(page)
})
test('views the order', async ({ page }) => {
  await page.goto(`/orders/${createdOrderId}`)  // undefined if run alone or out of order
})
```

The second test cannot run alone, cannot be retried alone, and fails under `fullyParallel`.
Make each test self-sufficient — create its own order in its own setup, via API rather than
UI where possible:

```ts
// ✓ Right
test('views an order', async ({ page, request }) => {
  const order = await createOrderViaApi(request)
  await page.goto(`/orders/${order.id}`)
  await expect(page.getByRole('heading', { name: order.reference })).toBeVisible()
})
```

## D02 — Order dependence

A test that assumes an earlier test ran is not a test, it is a step. Playwright runs files in
parallel and may retry any single test in a fresh worker, so "earlier" is not guaranteed.

`test.describe.serial()` is a legitimate tool for genuinely sequential flows — a multi-step
wizard where re-establishing state per step would triple the runtime. But note the cost: if
one test in a serial block fails, the rest are skipped, and on retry the *whole block* reruns.
Used as a blanket fix for isolation problems, it serializes the suite and hides the coupling
instead of removing it.

## D03 — Logging in through the UI in `beforeEach`

Slow (multiply by every test), and a concentration of flake risk: every test now depends on
the login form, the auth service, and rate limits. Parallel workers hammering a login
endpoint is a common source of CAPTCHA and 429 responses that look like random failures.

Authenticate once in a setup project and reuse the storage state:

```ts
// auth.setup.ts
import { test as setup } from '@playwright/test'
const authFile = 'playwright/.auth/user.json'

setup('authenticate', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(process.env.TEST_USER!)
  await page.getByLabel('Password').fill(process.env.TEST_PASS!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/dashboard')
  await page.context().storageState({ path: authFile })
})
```

```ts
// playwright.config.ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/ },
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup'],
  },
]
```

Faster still: obtain the token via an API call in setup and write the storage state directly,
never touching the login form except in the one test that exists to test logging in.

## D04 — Fixed test data colliding across workers

Two workers creating "Test User" in the same database race each other: one gets a uniqueness
violation, or one deletes the row the other is asserting on. The failure lands in whichever
test lost, which is usually not the test with the bug.

```ts
// ✗ Wrong
await page.getByLabel('Project name').fill('Test Project')

// ✓ Right — collision-free by construction
const name = `Test Project ${test.info().testId}`
await page.getByLabel('Project name').fill(name)
```

For backend fixtures, partition by worker with a worker-scoped fixture keyed on
`test.info().parallelIndex` (stable and small — better than `workerIndex` for indexing into a
pool of pre-provisioned accounts). Each worker gets its own account or schema and cannot
collide with any other.

## D05 — No teardown

State left behind accumulates: run 40 leaks 40 projects, and a later assertion like
`toHaveCount(1)` starts failing on run 41. The symptom appears long after the cause, and
often only in the environment that is not reset between runs.

Clean up in the same construct that created the data — a fixture with teardown after `use()`
is better than `afterEach`, because it runs even if the test throws mid-way.

```ts
const test = base.extend<{ project: Project }>({
  project: async ({ request }, use) => {
    const project = await createProject(request)
    await use(project)
    await deleteProject(request, project.id)   // runs even on failure
  },
})
```

## D06 — A page created in `beforeAll` and reused

```ts
// ✗ Wrong — one page shared by every test in the file
let page: Page
test.beforeAll(async ({ browser }) => { page = await browser.newPage() })
```

This discards the isolation Playwright provides: cookies, storage, and scroll position all
leak between tests, and a failure in one leaves the page in a state that breaks the next.
Playwright's per-test `page` fixture exists precisely to avoid this. Reuse a page only inside
an explicit `describe.serial` block where the shared state is the point.

---

# E. Determinism of the environment

## E01 — Real third-party network calls

Anything you do not control can be slow, rate-limited, or down, and its data changes. A test
that fails because a partner API had a bad minute tells you nothing about your code.

```ts
// ✓ Mock at the boundary
await page.route('**/api.stripe.com/**', route =>
  route.fulfill({ status: 200, json: { id: 'pi_test', status: 'succeeded' } }),
)
```

Register routes *before* the navigation that triggers them. For a large or awkward-to-author
payload, record once and replay:

```ts
await page.routeFromHAR('./hars/checkout.har', { url: '**/api/**', update: false })
```

Your own backend is a judgement call: mocking it makes tests fast and deterministic but stops
them testing integration. A common split is to mock third parties always, and run a small
subset of true end-to-end tests against a real backend with stable seeded data.

## E02 — Time-dependent logic

Tests that wait out real timeouts are slow, and tests that depend on the wall clock fail at
midnight, at month boundaries, and across DST changes. The Clock API removes both problems.

```ts
// Freeze time so date rendering is deterministic
await page.clock.setFixedTime(new Date('2026-03-14T09:00:00Z'))

// Or take manual control and jump forward
await page.clock.install({ time: new Date('2026-03-14T09:00:00Z') })
await page.goto('/session')
await page.clock.fastForward('30:00')          // 30-minute idle timeout, instantly
await expect(page.getByText('Session expired')).toBeVisible()
```

`setFixedTime` is the right default — `Date.now()` is pinned while timers still run normally.
Use `install` + `fastForward` / `runFor` / `pauseAt` when you need to drive timers.

## E03 — Unpinned locale, timezone, and viewport

Locale changes number and date formatting; timezone shifts every rendered timestamp; viewport
determines whether an element is in a responsive layout that hides it. Left unset, all three
inherit from the machine — so they differ between your laptop and CI, which is exactly the
"passes locally, fails in CI" signature.

```ts
// playwright.config.ts
use: {
  locale: 'en-GB',
  timezoneId: 'Europe/Berlin',
  viewport: { width: 1280, height: 720 },
}
```

## E04 — Visual comparisons without control

Screenshots taken mid-animation differ frame to frame. Font rendering and anti-aliasing differ
between macOS and Linux, so a baseline captured locally will not match CI.

```ts
await expect(page).toHaveScreenshot('dashboard.png', {
  animations: 'disabled',      // stops CSS animations and transitions
  caret: 'hide',               // the text caret blinks
  mask: [page.getByTestId('timestamp')],
  maxDiffPixelRatio: 0.01,
})
```

Generate baselines in the same environment CI uses — in practice, the official
`mcr.microsoft.com/playwright` container. Baselines committed from a Mac and compared on
Linux will not stabilize no matter how the threshold is tuned.

## E05 — Unseeded randomness

`Math.random()` or an unseeded faker produces different data each run. Most runs pass; the run
that generates an apostrophe in a name, a 200-character string, or an empty value fails. That
is a real bug being reported unreliably — which is the worst of both worlds. Use fixed data
in tests, and test edge cases explicitly as their own cases.

## E06 — Local/CI environment divergence

Different OS, browser build, screen size, CPU count, and network characteristics. Pin the
Playwright version (`@playwright/test` exact, not `^`), run CI in the official container, and
when a failure is CI-only, reproduce it in that container locally rather than guessing.

---

# F. Configuration, retries, and CI

The suite-level settings that decide whether flakiness is visible, hidden, or manufactured.

## The seven timeouts

| Timeout | Default | Set with |
|---|---|---|
| Test | 30s | `timeout` in config; `test.setTimeout()`; `test.slow()` triples it |
| Expect (assertion) | 5s | `expect: { timeout }`; per-assertion `{ timeout }` |
| Action | none | `use: { actionTimeout }`; per-action `{ timeout }` |
| Navigation | none | `use: { navigationTimeout }`; per-call `{ timeout }` |
| Global (whole run) | none | `globalTimeout` |
| `beforeAll` / `afterAll` | 30s | `test.setTimeout()` inside the hook |
| Fixture | shares the test timeout | `{ timeout }` in the fixture definition |

The test timeout covers fixtures and `beforeEach` as well as the body — a slow fixture eats
the budget the test needed.

Timeouts should catch genuine hangs, not absorb design problems. Before raising one, work out
which of the categories above is actually firing. See A05.

## F01 — Retries with no visibility

```ts
retries: process.env.CI ? 2 : 0,
```

This is the standard setting and it is fine — *provided the flaky count is tracked*. Retries
without tracking convert a measurable problem into an invisible one that grows. Keep the
flaky count in your CI summary, and treat an increase as a regression.

Run with `retries: 0` locally so that flakiness surfaces while you are writing the test rather
than months later in CI.

## F02 — No trace on retry

```ts
use: { trace: 'on-first-retry' }
```

The single most useful debugging setting in Playwright. A flake by definition does not
reproduce on demand, so the trace from the run that actually failed is often the only evidence
you will get. `on-first-retry` costs nothing on passing tests. Open with
`npx playwright show-trace trace.zip` for the timeline, DOM snapshots, network log, and console.

Prefer traces over screenshots and video — a screenshot shows you the end state, the trace
shows you how it got there.

## F03 — `fullyParallel` over a suite with shared state

`fullyParallel: true` is the right default and makes suites dramatically faster. But it is the
setting that *exposes* every category-D problem at once, so enabling it on a suite written
sequentially produces a burst of failures. Those failures are real — the coupling existed
before — and the fix is category D, not turning parallelism back off.

Turning `fullyParallel` off to make CI green hides the coupling and guarantees the suite gets
slower and more coupled over time.

## F04 — Oversubscribed workers

Playwright defaults to roughly half the available cores. On a 2-vCPU CI runner, the default
plus browser overhead saturates the box, everything slows, and tests that pass with margin
locally start timing out. Pin it: `workers: process.env.CI ? 2 : undefined`, and tune against
measured runtimes rather than guessing.

## F05 — No lint floor

`eslint-plugin-playwright` catches an entire class of these mechanically, on every commit,
before review. The rules that map directly onto this document:

| Rule | Catches |
|---|---|
| `missing-playwright-await` | B02 |
| `prefer-web-first-assertions` | B01, B03 |
| `no-wait-for-timeout` | A01 |
| `no-networkidle` | A02 |
| `no-wait-for-selector` | A03 |
| `no-wait-for-navigation` | A04 |
| `no-conditional-in-test`, `no-conditional-expect` | B05 |
| `no-element-handle`, `no-eval` | C04 |
| `no-force-option` | C05 |

Add `@typescript-eslint/no-floating-promises` alongside them for B02 coverage outside
Playwright's own APIs.

## F06 — `webServer` misconfiguration

```ts
webServer: {
  command: 'npm run dev',
  url: 'http://localhost:5173',        // readiness probe — not `port` alone
  reuseExistingServer: !process.env.CI, // never reuse in CI
  timeout: 120_000,
}
```

`url` makes Playwright poll until the server actually responds; without a readiness check the
first tests race the boot. `reuseExistingServer` must be false in CI, or a stale process from a
previous job serves an old build — which produces failures that make no sense against the
current diff.

---

# Quick reference

| Symptom | Likely cause | Go to |
|---|---|---|
| Passes locally, fails in CI | Hard waits, unpinned env, worker saturation | A01, E03, F04 |
| `TimeoutError` right after a UI refactor | Locator drift, not timing | C01 |
| Fails only under `fullyParallel` | Shared state between tests | D01–D06 |
| Different error each run | Shared state, or unseeded data | D01, E05 |
| Fails at midnight / month end | Wall-clock dependence | E02 |
| Strict mode violation "resolved to N elements" | Ambiguous locator | C02 |
| "Element is not attached to the DOM" | Element handle across a re-render | C04 |
| Click times out, element looks visible | Overlay intercepting; receives-events | C05 |
| Visual diff fails only in CI | Font/AA differences across OS | E04, E06 |
| Test passes but asserts nothing | Missing `await` | B02 |
