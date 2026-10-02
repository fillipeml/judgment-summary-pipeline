/** The command line.
 *
 * The pipeline is deliberately not one button. A production run waits hours between rounds,
 * so each stage is separately runnable and separately resumable, and the reconnaissance
 * commands — `inspect`, `coverage`, `style` — are the ones worth running first. They cost
 * nothing, they answer the questions that decide whether the run is worth starting, and two
 * of them exist because the answers were surprising the first time. */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  audit,
  collectMaps,
  collectStructuring,
  deliver,
  extract,
  runAll,
  submitMaps,
  submitStructuring,
  type Runner,
} from "./batch/runner.ts";
import { RunState } from "./batch/state.ts";
import { loadConfig, type Config } from "./config.ts";
import { deliveredCases, measureFidelity, renderFidelity } from "./eval/fidelity.ts";
import { generateForCases } from "./eval/generate.ts";
import { measureParity, renderParity, type ParityCase } from "./eval/parity.ts";
import { uniformStride } from "./eval/sample.ts";
import { build } from "./factory.ts";
import { segmentDecision } from "./extract/segment.ts";
import { formatUsage, sumUsage, unpricedWarning } from "./model/cost.ts";
import { renderApprovalPack } from "./report/approval.ts";
import { renderCoverage } from "./report/coverage.ts";
import { renderStyleSurvey, surveyHouseStyle } from "./report/house-style-survey.ts";
import { coverageProgression } from "./sources/coverage.ts";
import { indexByCase, planFor, type SourcePlan } from "./sources/plan.ts";
import { toCustomId } from "./domain/case-number.ts";
import {
  approvedButOffStyle,
  goldStandardRows,
  loadWorkbook,
  targetRows,
} from "./workbook/read.ts";
import { columnLetter } from "./workbook/verify.ts";

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function workbookOptions(config: Config) {
  return {
    summaryHeader: config.summaryHeader,
    summaryColumn: config.summaryColumn,
    caseColumn: config.caseColumn,
  };
}

function makeRunner(config: Config): Runner {
  const parts = build(config);
  log(parts.banner);
  const warning = unpricedWarning(config.model);
  if (warning) log(warning);
  return {
    config,
    state: new RunState(config.outDir),
    store: parts.store,
    mapBatches: parts.mapBatches,
    structureBatches: parts.structureBatches,
    auditor: parts.auditor,
    log,
  };
}

function save(config: Config, name: string, content: string): void {
  const dir = join(config.outDir, "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  log(`wrote ${path}`);
}

/** What is actually in this spreadsheet?
 *
 *  This was the first thing written and the first thing run. Working on someone else's
 *  workbook starts by finding out where the columns are and how many rows are already
 *  finished, and that answer decided the size of the job. */
async function inspect(config: Config): Promise<void> {
  const loaded = await loadWorkbook(config.workbookPath, workbookOptions(config));
  const rows = loaded.rows;
  const approved = rows.filter((r) => r.approved);
  const targets = targetRows(rows);
  const gold = goldStandardRows(rows);
  const drift = approvedButOffStyle(rows);

  log(`${basename(config.workbookPath)} — sheet "${loaded.sheet.name}"`);
  log(`  summary column: ${columnLetter(loaded.summaryColumn)} (index ${loaded.summaryColumn})`);
  log(`  case column: ${columnLetter(config.caseColumn)}`);
  log(`  rows with a recognisable case number: ${rows.length}`);
  log("");
  log(`  human-approved (never touched): ${approved.length}`);
  log(`  already in house style: ${rows.filter((r) => r.state === "house_style").length}`);
  log(`  off-format text to replace: ${rows.filter((r) => r.state === "off_style").length}`);
  log(`  blank: ${rows.filter((r) => r.state === "blank").length}`);
  log("");
  log(`  rows the pipeline may write: ${targets.length}`);
  log(`  gold standard for the parity harness: ${gold.length}`);
  if (drift.length) {
    log(
      `  ${drift.length} approved row(s) are NOT in house style — the gate cannot be stricter ` +
        "than the reviewers' own output",
    );
  }
}

async function coverage(config: Config): Promise<void> {
  const loaded = await loadWorkbook(config.workbookPath, workbookOptions(config));
  const targets = targetRows(loaded.rows).map((r) => r.caseNumber);
  const parts = build(config);
  log(parts.banner);
  const documents = parts.store.list();
  log(`${targets.length} target row(s), ${documents.length} document(s) in ${config.sourceDir}`);

  const byCase = indexByCase(documents, targets);
  const plans = new Map<string, SourcePlan>();
  for (const caseNumber of targets) {
    plans.set(caseNumber, planFor(caseNumber, byCase.get(caseNumber) ?? []));
  }
  save(config, "coverage.md", renderCoverage(coverageProgression(targets, documents), plans));
}

async function style(config: Config): Promise<void> {
  const loaded = await loadWorkbook(config.workbookPath, workbookOptions(config));
  const survey = surveyHouseStyle(loaded.rows);
  log(`${survey.approvedRows} approved row(s), ${survey.settlementRows} about a settlement`);
  if (survey.dominantSettlementForm) {
    log(`dominant settlement wording: "${survey.dominantSettlementForm}" (${survey.dominancePct}%)`);
  }
  log(`${survey.unrecognised.count} approved row(s) match no accepted opening`);
  save(config, "house-style.md", renderStyleSurvey(survey));
}

const STAGES = [
  "extract",
  "map-submit",
  "map-collect",
  "structure-submit",
  "structure-collect",
  "audit",
  "write",
] as const;
type Stage = (typeof STAGES)[number];

async function stage(config: Config, name: Stage, limit?: number): Promise<void> {
  const runner = makeRunner(config);
  const outputPath = join(config.outDir, "delivered.xlsx");
  switch (name) {
    case "extract": {
      const report = await extract(runner, limit);
      log(
        `${report.extracted} extracted, ${report.alreadyDone} already done, ` +
          `${report.noSource} without usable source, ${report.failed.length} failed`,
      );
      for (const f of report.failed) log(`  ${f.caseNumber}: ${f.error}`);
      return;
    }
    case "map-submit":
      await submitMaps(runner);
      return;
    case "map-collect": {
      const report = await collectMaps(runner);
      log(
        `${report.collected} map(s), ${report.failed} failed` +
          (report.skipped ? `, ${report.skipped} already collected` : "") +
          `, ${formatUsage(report.usage)}`,
      );
      if (report.pending.length) log(`${report.pending.length} batch(es) still processing`);
      return;
    }
    case "structure-submit":
      await submitStructuring(runner);
      return;
    case "structure-collect": {
      const report = await collectStructuring(runner);
      log(
        `${report.collected} result(s): ${report.writeable} writeable, ${report.needsReview} ` +
          `for review, ${report.invalid} invalid, ${formatUsage(report.usage)}`,
      );
      if (report.pending.length) log(`${report.pending.length} batch(es) still processing`);
      return;
    }
    case "audit": {
      const report = await audit(runner);
      log(`${report.kept} kept, ${report.demoted} demoted, ${report.failed} call(s) failed`);
      return;
    }
    case "write": {
      const report = await deliver(runner, outputPath);
      log(`${report.write.written} written, ${report.write.flagged} flagged → ${outputPath}`);
      if (report.write.skippedApproved) {
        log(`${report.write.skippedApproved} row(s) refused at the cell: a reviewer had signed them`);
      }
      log(`verification: ${report.verify.ok ? "clean" : "FAILED"}`);
      return;
    }
  }
}

async function run(config: Config, limit?: number): Promise<void> {
  const runner = makeRunner(config);
  const outputPath = join(config.outDir, "delivered.xlsx");
  const summary = await runAll(runner, { outputPath, limit });

  const loaded = await loadWorkbook(config.workbookPath, workbookOptions(config));
  save(
    config,
    "approval-pack.md",
    renderApprovalPack({
      records: runner.state.cases(),
      write: summary.delivery.write,
      verify: summary.delivery.verify,
      approvedRows: loaded.rows.filter((r) => r.approved).length,
      model: config.model,
    }),
  );
  log("");
  log(`total model cost: ${formatUsage(summary.usage)}`);
  if (!summary.delivery.verify.ok) process.exitCode = 1;
}

/** Both measurement harnesses, over whatever the last run produced. */
async function evaluate(config: Config, size: number): Promise<void> {
  const parts = build(config);
  log(parts.banner);
  const state = new RunState(config.outDir);
  const records = state.cases();
  if (!records.length) {
    log(`no case records in ${config.outDir}: run the pipeline first`);
    process.exitCode = 1;
    return;
  }

  const delivered = deliveredCases(records);
  const fidelity = await measureFidelity(
    parts.auditor,
    delivered
      .map((r) => {
        const id = toCustomId(r.caseNumber);
        return {
          caseNumber: r.caseNumber,
          summary: r.summary,
          sourceText: state.hasText(id) ? segmentDecision(state.readText(id)).segmented : "",
        };
      })
      .filter((c) => c.sourceText),
    { size, concurrency: config.concurrency, population: delivered.length },
  );
  log(
    `fidelity: ${fidelity.sampled} sampled of ${fidelity.population} delivered — ` +
      `${fidelity.severe} severe, ${fidelity.minor} minor`,
  );
  save(config, "fidelity.md", renderFidelity(fidelity));

  // Parity needs summaries the pipeline is forbidden to produce: an approved row is excluded
  // from the target set, so the harness generates its own, reads them once, and throws them
  // away. Nothing here goes near the workbook.
  const loaded = await loadWorkbook(config.workbookPath, workbookOptions(config));
  const approved = goldStandardRows(loaded.rows);
  // Filtered before sampling, not after: an approved row with no document on disk cannot be
  // measured, and letting it into the sample would quietly shrink the sample size.
  const byCase = indexByCase(
    parts.store.list(),
    approved.map((row) => row.caseNumber),
  );
  const measurable = approved.filter((row) => (byCase.get(row.caseNumber) ?? []).length > 0);
  if (approved.length > measurable.length) {
    log(
      `parity: ${approved.length - measurable.length} of ${approved.length} approved row(s) ` +
        "have no document on disk and cannot be measured",
    );
  }
  const gold = uniformStride(measurable, size);
  if (!gold.length) {
    log("parity: no approved row in house style has a document to read");
    return;
  }
  log(`parity: generating summaries for ${gold.length} approved case(s)`);
  const generated = await generateForCases(
    parts.analyser,
    parts.store,
    gold.map((row) => ({
      caseNumber: row.caseNumber,
      documents: byCase.get(row.caseNumber) ?? [],
    })),
    { maxDocumentMB: config.maxDocumentMB, concurrency: config.concurrency },
  );
  const generatedByCase = new Map(generated.map((g) => [g.caseNumber, g]));
  const skipped = generated.filter((g) => !g.summary);
  if (skipped.length) {
    log(`  ${skipped.length} approved case(s) could not be generated and are excluded`);
    for (const g of skipped) log(`    ${g.caseNumber}: ${g.error ?? "no summary"}`);
  }

  const pairs: ParityCase[] = gold
    .map((row) => ({
      caseNumber: row.caseNumber,
      reference: row.existing,
      generated: generatedByCase.get(row.caseNumber)?.summary ?? "",
    }))
    .filter((p) => p.generated);

  if (!pairs.length) {
    log("parity: no approved case produced a summary to compare with");
    return;
  }
  const parity = await measureParity(parts.judge, pairs, {
    size: pairs.length,
    concurrency: config.concurrency,
    // What it cost to produce the generated side. The bench throws these summaries away
    // after scoring, and the cost used to go with them.
    generationUsage: sumUsage(...generated.map((g) => g.usage)),
  });
  log(
    `parity: ${parity.sampled} sampled of ${parity.population} approved — ` +
      `${parity.equivalent} equivalent, ${parity.moreComplete} more complete, ${parity.worse} worse`,
  );
  save(config, "parity.md", renderParity(parity));
}

const USAGE = `judgment-summary-pipeline

  inspect                  what is in the workbook: columns, row states, how much is already done
  coverage                 which target rows have a document to read, by three join keys
  style                    recount the house style off the approved rows
  run [--limit N]          the whole chain, extract through write
  stage <name> [--limit N] one stage: ${STAGES.join(" | ")}
  eval [--size N]          fidelity and parity over the last run's records

Environment: DEMO_MODE, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, WORKBOOK_PATH, SOURCE_DIR,
OUT_DIR, SUMMARY_HEADER, SUMMARY_COLUMN, CASE_COLUMN, CONCURRENCY, BATCH_CHUNK_SIZE,
POLL_SECONDS, RETRY_ATTEMPTS, RETRY_MAX_MS, MAX_DOCUMENT_MB.
`;

function flag(argv: string[], name: string): number | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = Number(argv[i + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function main(argv: string[]): Promise<void> {
  const config = loadConfig();
  const command = argv[0];
  switch (command) {
    case "inspect":
      return inspect(config);
    case "coverage":
      return coverage(config);
    case "style":
      return style(config);
    case "run":
      return run(config, flag(argv, "limit"));
    case "stage": {
      const name = argv[1] as Stage | undefined;
      if (!name || !STAGES.includes(name)) {
        log(`unknown stage "${name ?? ""}". One of: ${STAGES.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      return stage(config, name, flag(argv, "limit"));
    }
    case "eval":
      return evaluate(config, flag(argv, "size") ?? 25);
    default:
      log(USAGE);
      if (command) process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
