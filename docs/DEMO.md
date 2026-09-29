# The demo, case by case

Everything here runs with no API key, no network call and no bill. `factory.ts` reads
`DEMO_MODE` (default: on whenever `ANTHROPIC_API_KEY` is empty) and swaps two things: the
Message Batches client for one that answers from `fixtures/recordings.json`, and the model
for the same recordings. Nothing else changes. The demo still chunks the submission,
persists the batch ids, polls for completion, matches results back by custom id, runs both
gates, writes a copy of the workbook and diffs it against the original.

```bash
npm install
npm run summarise -- inspect
npm run summarise -- coverage
npm run summarise -- style
npm run summarise -- run
npm run eval
```

Reports land in `.demo/reports/`. The delivered workbook is `.demo/delivered.xlsx`; open it
next to `fixtures/workbook/caseload.xlsx` and the only thing that differs is column D.

## The twelve cases, and what each one is for

The corpus is small on purpose. Every case forces a branch that would otherwise go untested,
and `tests/demo.test.ts` pins what each one does.

| Case | Forces | Outcome |
| --- | --- | --- |
| `1000001-11` | The ordinary path: partly upheld, retention, indexation, interest, one claim moot | written |
| `1000002-22` | An appellate ruling that amends the judgment; fees 10% raised to 15% on appeal | written, audited as *minor* |
| `1000003-33` | A settlement approved with its terms stated; also the only case whose file name punctuates the number differently | written |
| `1000004-44` | A settlement approved with **no** terms in the file | held back by gate 1 |
| `1000005-55` | A file with no final decision at all: complaint, order, pending appeal | held back, reason `no_final_decision` |
| `1000006-66` | A whole docket over the segmenter's threshold, with a superseded judgment early and the governing appellate ruling last | written |
| `1000007-77` | A summary that passes the cheap gate and states a retention of 20% where the judgment says 10% | **demoted by the auditor** |
| `1000008-88` | A decision too short to be worth segmenting | written |
| `2000001-11` | Approved row: pipeline and reviewer agree | parity `equivalent` |
| `2000002-22` | Approved row where the reviewer's version omits the index and a charge | parity `ours_more_complete` |
| `2000003-33` | Approved row where the pipeline drops a fee percentage and a legal-aid suspension | parity `ours_worse` |
| `2000004-44` | Approved row written before the appeal; the pipeline reports the reversal | parity `conflict` |

Plus, in the source folder: a case whose only document is a scan with no text layer (left
blank rather than guessed at), a document carrying no case number (reported as
unattributable), and a file that is not a PDF (skipped).

And, in the workbook: rows already in house style that nobody has approved (skipped as
already correct), rows a reviewer approved that are *not* in house style (reported as the
ceiling on how strict the gate can be), two approved rows stored as rich text with only part
of the run coloured, and seven approved settlement rows that exist so the house-style survey
has a real contest to count.

## What to look at

**`1000007-77` is the one worth reading.** Open `.demo/reports/approval-pack.md` and find it.
The generated paragraph opens correctly, reads fluently and states a retention percentage the
judgment does not contain. The free gate passes it — that is the point of the fixture. The
auditor reads it back against the source and names the figure. The row reaches the reviewer
in amber with its text intact and the reason beside it, which is the whole argument for the
second gate in one row.

**The coverage progression.** `.demo/reports/coverage.md` shows three join keys recovering
progressively more cases. The relaxation is not a trick to inflate a number; each generation
found documents that existed all along under a name the previous key could not see.

**The house-style survey.** `.demo/reports/house-style.md` counts two competing settlement
wordings off the approved rows and declares a winner with its margin. That count, not a
preference, is why the prompt asks for `Acordo homologado` and why the gate accepts it.

**The parity report is deliberately unflattering.** Of four approved cases, the pipeline wins
one, ties one, loses one and conflicts with one. A harness that reported four wins would be
worth nothing. The conflict is the instructive case: the reviewer's row is *stale*, written
before the appellate ruling arrived, and surfacing that is exactly what the harness is for.

## Running it against real data

```bash
export ANTHROPIC_API_KEY=...
export WORKBOOK_PATH=cases/caseload.xlsx
export SOURCE_DIR=cases/documents
export DEMO_MODE=false
npm run summarise -- inspect
```

`inspect` first, always. It costs nothing and tells you how large the job actually is. Then
`coverage`, which tells you how much of it has a document to read. Only then `run`, or the
stages one at a time — see [FLOW.md](FLOW.md).

`/cases`, `/out` and `/.demo` are in `.gitignore`: real judgments never enter the repository.
