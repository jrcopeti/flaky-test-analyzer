# flaky-test-analyzer

A Claude Code skill that finds why a Playwright suite is unreliable, reports the causes in
priority order with the exact rewrite for each, and applies fixes on approval.

It is built on a researched reference document — [`playwright-flakiness.md`](.claude/skills/flaky-test-analyzer/references/playwright-flakiness.md) —
which is useful on its own, with or without the skill.

## What it checks

Six root-cause categories, ~30 rules with stable IDs:

| | Category | Examples |
|---|---|---|
| **A** | Waiting & synchronization | hard waits, `networkidle`, `waitForSelector`, hand-rolled polling |
| **B** | Assertions | `expect(await …isVisible())`, missing `await`, sampled values |
| **C** | Locators | CSS/XPath chains, `.first()` escaping strict mode, element handles, `force: true` |
| **D** | Isolation & shared state | module-scope state, order dependence, UI login per test, colliding data |
| **E** | Environment determinism | unmocked third parties, wall-clock dependence, unpinned locale/timezone |
| **F** | Config, retries & CI | missing `trace`, oversubscribed workers, `webServer` readiness |

Full detail in [`rule-catalog.md`](.claude/skills/flaky-test-analyzer/references/rule-catalog.md).

## Install

```bash
ln -s ~/code/flaky-test-analyzer/.claude/skills/flaky-test-analyzer \
      ~/.claude/skills/flaky-test-analyzer
```

The skill is then available in every project on the machine. It also triggers on natural
language — "these e2e tests keep flaking in CI" — not only on the slash command.

## Use

```
/flaky-test-analyzer                      # audits testDir from playwright.config
/flaky-test-analyzer e2e/checkout.spec.ts # one file
/flaky-test-analyzer e2e/                 # a directory
/flaky-test-analyzer --report test-results/results.json
```

Passing a Playwright JSON report changes the audit: tests the reporter marked `flaky` or
`failed` are escalated to P0 and lead the output, so findings are ranked by what actually
broke rather than by static risk.

The workflow is: scope → gather evidence → audit → **report and stop** → fix on approval →
verify with `--repeat-each`. It never edits before you approve.

## Development

`fixtures/` is the positive control: one seeded violation per rule ID, with
[`EXPECTED.md`](fixtures/EXPECTED.md) as the oracle. After changing a rule signal, run the
skill against `fixtures/` and diff against it. A rule that does not fire on its own fixture is
a broken rule.
