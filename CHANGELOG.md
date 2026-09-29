# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-29

First public release: the coded rebuild of a pipeline that summarised a backlog of Brazilian court decisions into a client's case spreadsheet, with a fictional corpus, recorded model readings and an offline demo.

### Added

- Document discovery across an untidy shared drive: attribution by the case number in the file name, then in the folder path, then by the twenty bare digits alone, reported as a progression so the gain from each relaxation is visible; a reading plan that takes up to two of each decisive filing, largest first, and falls back through generic, weak and whole-docket strategies.
- Segmentation that keeps the part of a case file that decides it: the header, the report section and everything from the operative marker onward for a single decision; merged windows around every operative marker for a docket past 60,000 characters, trimmed from the front so the governing ruling always survives; a fail-safe that returns the original whenever the cut would remove less than a tenth.
- A two-call reading where the second call cannot see the case file: call one produces a free-form map ending in a fixed summary table, call two receives only that map and emits a Zod-validated result whose fields almost all default, so the schema never forces an answer the documents do not support.
- Both rounds over the Message Batches API at half price, chunked at 100 requests with every batch id persisted before anything is awaited, resumable at every stage, and collection that skips results already on disk rather than re-pricing them.
- Two gates: a free deterministic check on the house-style opening, settlements without terms, and the model's own statements of insufficiency, keeping a correct report of "no decision here" distinct from a format failure; then a fidelity auditor that reads each accepted summary back against the same segmented source and can demote but never promote. The auditor fails open in production and fails closed in measurement, with the reason recorded in both places.
- Delivery to a copy of the workbook, with three independent guards on reviewer-approved cells: exclusion from the target list, a runtime font-colour check at the cell that reads every rich-text run, and a cell-by-cell diff of the delivered file against the original that fails the run on any change outside the summary column.
- Two measurement harnesses: fidelity over the rows actually delivered, and parity against the reviewer-approved rows, which generates its own summaries for cases the pipeline is forbidden to touch and scores "more complete" separately from "equivalent". Sampling is a reproducible uniform stride, and a rate over an empty denominator is null rather than zero.
- Reports: an approval pack that reproduces every refused summary in full with its reason, a coverage progression, and a house-style survey that counts the competing settlement wordings off the approved rows and names the ceiling on how strict the gate can be.
- Cost accounting from reported usage, with prices as sourced configuration, the batch discount built into the type, and unpriced models reported as unpriced rather than guessed.
- Adapters behind interfaces with two implementations each (batch client, analyser, auditor, parity judge, document store), selected only in `factory.ts`, which is the only module that reads `DEMO_MODE`.
- A fictional corpus of twelve synthetic Portuguese cases, each forcing one branch, rendered as PDFs with deliberately untidy names, plus a workbook covering every row state including partly-coloured rich text; every case number is dated 2099 with check digits that fail the CNJ checksum, and the builder refuses to run if one would be valid.
- 204 offline tests, including an end-to-end run on the committed fixtures that pins the outcome of every case; CI with typecheck, lint, tests, the reconnaissance commands, the full demo with asserted output, a second run that must cost nothing, both harnesses and a secret scan; a Dockerfile for staged runs.

[0.1.0]: https://github.com/fillipeml/judgment-summary-pipeline/releases/tag/v0.1.0
