# CLAUDE.md

Working rules for AI-assisted changes in this repository. They mirror the README; the README
wins on conflict.

## Non-negotiable rules

1. **Two calls, and the second never sees the case file.** `src/model/prompts.ts` holds both.
   Call one maps the case and must end in the `TABELA-RESUMO FINAL`; call two receives only
   the map. Do not pass the source text into the structuring call, do not merge them into
   one, and do not add a field to the schema that the map is not required to supply.
2. **Only the cheap gate can let a row through.** `src/gate/row-status.ts` decides what is
   writeable. `src/gate/auditor.ts` may demote and may never promote. Do not add a path that
   writes a row the deterministic gate refused.
3. **The auditor fails open in production and fails closed in measurement.** A failed audit
   call keeps the row in `gate/auditor.ts` and scores as severe in `eval/fidelity.ts`. Both
   comments explaining why must survive any refactor of either file.
4. **Three guards on the approved cells, in three modules.** `targetRows()` excludes them,
   `writeSummaries()` re-reads the font colour and refuses at the cell, `verifyOutput()`
   diffs the delivered file afterwards. Never collapse them into one, and never remove the
   rich-text branch of `isApproved()`.
5. **Demo adapters are selected only in `factory.ts`.** Nothing else reads `DEMO_MODE`.
   The fixture clients answer only for the sample cases and refuse everything else with an
   explanation rather than inventing a reading.
6. **Fixtures are provably fictional.** Case numbers dated 2099 with check digits that fail
   `hasValidCheckDigits()`; `scripts/make-fixtures.ts` refuses to build if one would be
   valid. No CPF, CNPJ, OAB number or contact detail, anywhere. Invented parties, judges,
   comarcas and a fictional state.
7. **An unpriced model reports `null`, never a guess.** `src/model/pricing.json` is
   configuration and every entry names its source. `BATCH_DISCOUNT` is part of the cost type
   so no caller can forget it.
8. **Case files and summaries are Portuguese; everything else is English.** The regexes in
   `domain/house-style.ts` and `extract/segment.ts` stay Portuguese because they match the
   documents. Code, prompts, console output and docs are English.

## Conventions

- Node 24 with native type stripping, TypeScript 5, Zod 4, Vitest 5. No build step: the CLI
  runs the `.ts` sources directly.
- `erasableSyntaxOnly` is on, so no parameter properties and no enums: declare fields
  explicitly in constructors.
- Modules import siblings with explicit `.ts` extensions and JSON with `with { type: "json" }`.
- Tests exercise the real code on real files written to a temp directory; no mocks of ExcelJS
  or of the file system, and no copies of the logic inside tests.
- `tests/demo.test.ts` pins the outcome of every fixture case. If a change is meant to alter
  one, change the expectation and say why in the commit message.
- Never commit `.env*` (except `.env.example`), `/cases`, `/out`, `/.demo`.
- Commits: English, Conventional Commits, one logical change each, no AI attribution trailers.
