# The seven stages, and what they leave on disk

Synchronously this pipeline is two dependent model calls per case: a map of the case, then a
structured result built from that map. The Message Batches API cannot express a dependency
inside one batch, so the two calls become two full rounds with a local collection step
between them. That is where the shape comes from:

```
extract → map-submit → (wait) → map-collect → structure-submit → (wait) → structure-collect
        → audit → write
```

Extraction stays local because it is local work. The audit stays synchronous because it is
small, late, and its result has to be read before anything is written.

Each stage is separately runnable:

```bash
npm run summarise -- stage extract --limit 50
npm run summarise -- stage map-submit
npm run summarise -- stage map-collect
```

`run` chains all seven and polls between rounds at `POLL_SECONDS`. In production the waits
are measured in hours, so the stages are usually run by hand across two days.

## The state directory

Everything a stage produces goes under `OUT_DIR` (`.demo` in demo mode, `out` otherwise):

```
out/
  batch/targets.json      the rows the run may write, keyed by custom id
  batch/plans.json        which documents each case's text actually came from
  batch/map.json          the batch ids of round A
  batch/structure.json    the batch ids of round B
  text/<id>.txt           extracted case text, before segmentation
  maps/<id>.txt           round A output, ending in the final summary table
  cases/<id>.json         the per-case record: summary, status, reason, claims, cost
  reports/                approval pack, coverage, house style, fidelity, parity
  delivered.xlsx          the copy of the workbook
```

This is what makes a run resumable. A stage skips work whose output already exists, so a run
that dies at hour three resumes at hour three, and a case whose summary was already accepted
is never paid for twice.

`<id>` is the case number with every non-alphanumeric character replaced by an underscore,
because the Batch API accepts only `[a-zA-Z0-9_-]` in a `custom_id`. The conversion back is
lossy, so it is resolved against the known case list rather than inverted.

## Stage by stage

**1 — extract.** Reads the workbook, picks the rows the pipeline may touch, attributes
documents to cases by three join keys, plans which filings to read, extracts their text, and
writes `text/` and `batch/plans.json`. A PDF with no text layer is a scan: it is reported and
left out, not passed on as an empty string. A case with nothing readable stays blank.

**2 — map-submit.** Segments each case's text, builds one request per case, chunks at
`BATCH_CHUNK_SIZE` (100), and persists the batch id after *every* chunk. The chunk size is
ours — the API takes 100,000 requests or 256 MB in one batch — and it exists so that an
interrupted submission loses one chunk rather than the whole run. An interrupted submission
must not lose a batch id.

**3 — map-collect.** Polls each batch. When one has ended, streams its results — an iterator,
so several hundred are never in memory at once — and writes `maps/`. Usage is priced at the
batch rate. Collection is attempted on every poll rather than only at the end, so an
interrupted wait has already banked whatever finished.

**4 — structure-submit.** One request per collected map, with the map as the *entire* user
turn. The system prompt carries the claim catalogue and is marked for caching. Chunked and
persisted the same way.

**5 — structure-collect.** Parses each result against the Zod schema, repairs claim names
against the catalogue, runs the deterministic gate, and writes `cases/`. A result that fails
validation is counted and left unwritten rather than coerced.

**6 — audit.** Reads back every summary the first gate passed, against the same segmented
source the generator saw. Severe demotes; minor and ok keep. A failed call keeps the row —
see the note in `src/gate/auditor.ts` for why, and `src/eval/fidelity.ts` for why the
measurement harness does the opposite.

**7 — write.** Opens the original, writes accepted summaries in blue and tints held-back rows
amber without erasing their text, saves to `delivered.xlsx`, then re-opens both files and
diffs them cell by cell. Any change outside the summary column, or to any approved cell,
fails the run and sets a non-zero exit code.

## Where each guard lives

The approved cells are protected three times, in three different modules, on purpose:

| Where | What it does |
| --- | --- |
| `workbook/read.ts` → `targetRows()` | An approved row is never a target |
| `workbook/write.ts` → `writeSummaries()` | Re-reads the font colour at the cell and refuses, whatever the plan said |
| `workbook/verify.ts` → `verifyOutput()` | Diffs the delivered file against the original afterwards |

The first is the plan, the second is the runtime check, the third is the proof. A guard that
depends on the previous one being correct is one guard, not three.

## Configuration

Every setting is an environment variable, and `src/config.ts` is the only module that knows
their names.

| Variable | Default | What it is |
| --- | --- | --- |
| `DEMO_MODE` | on when no API key | Recorded readings, sample files, no network |
| `ANTHROPIC_API_KEY` | — | Required for a real run |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Must have an entry in `pricing.json` or costs report as unpriced |
| `WORKBOOK_PATH` | fixtures | The client's workbook. Never written to |
| `SUMMARY_HEADER` | `Resumo Decisão` | Found by header name; `SUMMARY_COLUMN` is the fallback index |
| `CASE_COLUMN` | `1` | Which column holds the case number |
| `SOURCE_DIR` | fixtures | Where the case files are |
| `OUT_DIR` | `.demo` / `out` | Run state and deliverables |
| `CONCURRENCY` | `2` | Model calls at once, outside the Batch API |
| `BATCH_CHUNK_SIZE` | `100` | Requests per submission |
| `POLL_SECONDS` | `120` | Between polls of a batch |
| `RETRY_ATTEMPTS` / `RETRY_MAX_MS` | `20` / `60000` | Linear backoff, capped |
| `MAX_DOCUMENT_MB` | `120` | Larger than this is a scanning artefact, not a filing |
