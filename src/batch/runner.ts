/** The pipeline, as the Message Batches API forces it to be shaped.
 *
 * Synchronously this is two dependent calls per case: a map, then a structured result built
 * from that map. A batch cannot express a dependency inside itself, so the two calls become
 * two full rounds with a local collection step between them:
 *
 *   extract → map-submit → (wait) → map-collect → structure-submit → (wait) → structure-collect
 *           → audit → write
 *
 * Extraction and the audit stay synchronous: extraction is local work, and the audit is
 * small, late and needs to be read before anything is written.
 *
 * Every stage is separately runnable and every stage is resumable, because the waits are
 * measured in hours and a laptop lid closes. */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { toCustomId } from "../domain/case-number.ts";
import { gateRow } from "../gate/row-status.ts";
import { auditRows, type AuditReport } from "../gate/auditor.ts";
import { repairClaimNames } from "../extract/catalogue.ts";
import { readCaseText } from "../extract/case-text.ts";
import { segmentDecision } from "../extract/segment.ts";
import { BATCH_DISCOUNT, emptyUsage, fromUsage, sumUsage, type Usage } from "../model/cost.ts";
import { CaseResult } from "../model/schema.ts";
import {
  MAPPING_SYSTEM,
  buildStructuringSystem,
  mappingUserMessage,
  structuringUserMessage,
} from "../model/prompts.ts";
import type { Auditor } from "../model/analyser/types.ts";
import { indexByCase, planFor, type SourcePlan } from "../sources/plan.ts";
import type { SourceStore } from "../sources/store.ts";
import { loadWorkbook, targetRows } from "../workbook/read.ts";
import { writeSummaries, type WriteReport } from "../workbook/write.ts";
import { verifyOutput, type VerifyReport } from "../workbook/verify.ts";
import type { Config } from "../config.ts";
import type { BatchClient } from "./client.ts";
import { chunk, mapLimit, withRetry } from "./retry.ts";
import { RunState, type CaseRecord, type StoredPlan, type TargetRow } from "./state.ts";

const MAP_MAX_TOKENS = 32_000;
const STRUCTURE_MAX_TOKENS = 16_000;

export interface Runner {
  config: Config;
  state: RunState;
  store: SourceStore;
  mapBatches: BatchClient;
  structureBatches: BatchClient;
  auditor: Auditor;
  log: (line: string) => void;
}

export interface ExtractReport {
  targets: number;
  extracted: number;
  alreadyDone: number;
  noSource: number;
  failed: { caseNumber: string; error: string }[];
  plans: Map<string, SourcePlan>;
}

/** Stage 1 — local, heavy, resumable: find each case's documents and get their text. */
export async function extract(runner: Runner, limit?: number): Promise<ExtractReport> {
  const { config, state, store, log } = runner;
  const loaded = await loadWorkbook(config.workbookPath, {
    summaryHeader: config.summaryHeader,
    summaryColumn: config.summaryColumn,
    caseColumn: config.caseColumn,
  });
  const rows = targetRows(loaded.rows);
  const targets: TargetRow[] = rows.map((r) => ({
    caseNumber: r.caseNumber,
    row: r.row,
    previousText: r.existing,
  }));
  state.saveTargets(targets);

  const documents = store.list();
  const byCase = indexByCase(
    documents,
    targets.map((t) => t.caseNumber),
  );
  const report: ExtractReport = {
    targets: targets.length,
    extracted: 0,
    alreadyDone: 0,
    noSource: 0,
    failed: [],
    plans: new Map(),
  };

  const selected = limit ? targets.slice(0, limit) : targets;
  const plans: Record<string, StoredPlan> = state.plans();
  log(`${targets.length} target row(s); extracting ${selected.length}`);

  await mapLimit(selected, config.concurrency, async (target) => {
    const id = toCustomId(target.caseNumber);
    // Money rule first: a case already accepted is never paid for again.
    if (state.isAccepted(id) || state.hasText(id)) {
      report.alreadyDone++;
      return;
    }
    const plan = planFor(target.caseNumber, byCase.get(target.caseNumber) ?? []);
    report.plans.set(target.caseNumber, plan);
    plans[id] = { strategy: plan.strategy, documents: plan.documents.map((d) => d.name) };
    if (!plan.documents.length) {
      report.noSource++;
      return;
    }
    try {
      const { text, used } = await readCaseText(store, plan, {
        maxDocumentMB: config.maxDocumentMB,
        onSkip: (name, why) => {
          log(`  ${target.caseNumber}: skipped ${name} (${why.replace("_", " ")})`);
        },
      });
      if (!text.trim()) {
        report.noSource++;
        return;
      }
      state.saveText(id, text);
      // Only the documents that actually contributed text, not the ones the plan hoped for.
      plans[id] = { strategy: plan.strategy, documents: used };
      report.extracted++;
    } catch (err) {
      report.failed.push({
        caseNumber: target.caseNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  state.savePlans(plans);
  return report;
}

function retryOptions(runner: Runner, label: string) {
  return {
    attempts: runner.config.retryAttempts,
    maxMs: runner.config.retryMaxMs,
    onAttempt: (attempt: number, attempts: number, error: string, waitMs: number) =>
      runner.log(
        `  [${label}] attempt ${attempt}/${attempts} failed: ${error.slice(0, 120)} — retrying in ${waitMs / 1000}s`,
      ),
  };
}

/** Stage 2 — submit round A: one map request per extracted case, chunked. */
export async function submitMaps(runner: Runner): Promise<string[]> {
  const { config, state, log } = runner;
  // Anything already mapped is skipped, not re-read. Re-running a case through the same
  // prompt over the same documents buys the same answer at full price; an operator who
  // wants a genuine retry deletes the map and runs the stage again.
  const ids = state.textIds().filter((id) => !state.hasMap(id));
  if (!ids.length) {
    log("  nothing to map: every extracted case already has one");
    return [];
  }
  const requests = ids.map((id) => ({
    customId: id,
    params: {
      model: config.model,
      max_tokens: MAP_MAX_TOKENS,
      thinking: { type: "adaptive" as const },
      system: [
        { type: "text" as const, text: MAPPING_SYSTEM, cache_control: { type: "ephemeral" as const } },
      ],
      messages: [
        {
          role: "user" as const,
          // Segmented client-side, exactly as the synchronous path does it.
          content: mappingUserMessage(segmentDecision(state.readText(id)).segmented),
        },
      ],
    },
  }));

  const batchIds: string[] = [];
  for (const [i, part] of chunk(requests, config.batchChunkSize).entries()) {
    const id = await withRetry(
      "map-submit",
      () => runner.mapBatches.create(part),
      retryOptions(runner, "map-submit"),
    );
    batchIds.push(id);
    // Persisted after every chunk: an interrupted submission never loses a batch id.
    state.saveBatchIds("map", batchIds);
    log(`  batch ${i + 1}: ${part.length} request(s) → ${id}`);
  }
  return batchIds;
}

export interface CollectReport {
  collected: number;
  failed: number;
  /** Results whose output was already on disk from an earlier collection of the same batch. */
  skipped: number;
  usage: Usage;
  pending: string[];
}

/** Stage 3 — collect round A. */
export async function collectMaps(runner: Runner): Promise<CollectReport> {
  const { config, state, log } = runner;
  const report: CollectReport = {
    collected: 0,
    failed: 0,
    skipped: 0,
    usage: emptyUsage(),
    pending: [],
  };
  const usages: Usage[] = [];

  for (const batchId of state.batchIds("map")) {
    const status = await withRetry(
      "map-status",
      () => runner.mapBatches.status(batchId),
      retryOptions(runner, "map-status"),
    );
    if (!status.ended) {
      report.pending.push(batchId);
      continue;
    }
    for await (const item of runner.mapBatches.results(batchId)) {
      // A batch can be collected more than once — a resume after an interrupted collection
      // walks the same ids again. Counting its usage twice would inflate the bill this run
      // reports, so a result already on disk is skipped rather than re-priced.
      if (state.hasMap(item.customId)) {
        report.skipped++;
        continue;
      }
      if (!item.ok) {
        report.failed++;
        log(`  ${item.customId}: ${item.reason}`);
        continue;
      }
      state.saveMap(item.customId, item.text);
      usages.push(fromUsage(item.usage, config.model, BATCH_DISCOUNT));
      report.collected++;
    }
  }
  report.usage = sumUsage(...usages);
  return report;
}

/** Stage 4 — submit round B: one structuring request per collected map, chunked. */
export async function submitStructuring(runner: Runner): Promise<string[]> {
  const { config, state, log } = runner;
  const ids = state.mapIds().filter((id) => !state.readCase(id));
  if (!ids.length) {
    log("  nothing to structure: every map already has a result");
    return [];
  }
  const system = buildStructuringSystem();
  const requests = ids.map((id) => ({
    customId: id,
    params: {
      model: config.model,
      max_tokens: STRUCTURE_MAX_TOKENS,
      system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: structuringUserMessage(state.readMap(id)) }],
      output_config: { format: zodOutputFormat(CaseResult) },
    },
  }));

  const batchIds: string[] = [];
  for (const [i, part] of chunk(requests, config.batchChunkSize).entries()) {
    const id = await withRetry(
      "structure-submit",
      () => runner.structureBatches.create(part),
      retryOptions(runner, "structure-submit"),
    );
    batchIds.push(id);
    state.saveBatchIds("structure", batchIds);
    log(`  batch ${i + 1}: ${part.length} request(s) → ${id}`);
  }
  return batchIds;
}

export interface StructureReport extends CollectReport {
  writeable: number;
  needsReview: number;
  invalid: number;
}

/** Stage 5 — collect round B, validate, normalise, and run the first gate. */
export async function collectStructuring(runner: Runner): Promise<StructureReport> {
  const { config, state, log } = runner;
  const report: StructureReport = {
    collected: 0,
    failed: 0,
    skipped: 0,
    invalid: 0,
    writeable: 0,
    needsReview: 0,
    usage: emptyUsage(),
    pending: [],
  };
  const usages: Usage[] = [];
  const targets = state.targets();
  const plans = state.plans();

  for (const batchId of state.batchIds("structure")) {
    const status = await withRetry(
      "structure-status",
      () => runner.structureBatches.status(batchId),
      retryOptions(runner, "structure-status"),
    );
    if (!status.ended) {
      report.pending.push(batchId);
      continue;
    }
    for await (const item of runner.structureBatches.results(batchId)) {
      if (state.readCase(item.customId)) {
        report.skipped++;
        continue;
      }
      if (!item.ok) {
        report.failed++;
        log(`  ${item.customId}: ${item.reason}`);
        continue;
      }
      const target = targets[item.customId];
      if (!target) {
        report.invalid++;
        log(`  ${item.customId}: no target row for this result`);
        continue;
      }
      let result: CaseResult;
      try {
        result = repairClaimNames(CaseResult.parse(JSON.parse(item.text)));
      } catch (err) {
        report.invalid++;
        log(`  ${target.caseNumber}: invalid structured result — ${err instanceof Error ? err.message : err}`);
        continue;
      }
      const usage = fromUsage(item.usage, config.model, BATCH_DISCOUNT);
      usages.push(usage);
      const summary = result.summary.trim();
      const gate = gateRow(summary);
      const plan = plans[item.customId];
      const record: CaseRecord = {
        caseNumber: target.caseNumber,
        row: target.row,
        previousText: target.previousText,
        strategy: plan?.strategy ?? "none",
        documentsUsed: plan?.documents ?? [],
        summary,
        status: gate.status,
        gateReason: gate.reason,
        gateDetail: gate.detail,
        auditReason: null,
        auditSeverity: null,
        result,
        usage,
      };
      state.saveCase(record);
      report.collected++;
      if (gate.status === "writeable") report.writeable++;
      else report.needsReview++;
    }
  }
  report.usage = sumUsage(...usages);
  return report;
}

/** Stage 6 — the second gate, over the rows the first gate passed. */
export async function audit(runner: Runner): Promise<AuditReport> {
  const { config, state, log } = runner;
  // A row that already carries a verdict is not audited again: the summary has not changed,
  // so neither would the answer.
  const all = state.cases().filter((c) => c.status === "writeable" && c.summary);
  const writeable = all.filter((c) => c.auditSeverity === null);
  if (all.length > writeable.length) {
    log(`  ${all.length - writeable.length} summar${all.length - writeable.length === 1 ? "y" : "ies"} already audited`);
  }
  log(`  ${writeable.length} summar${writeable.length === 1 ? "y" : "ies"} to audit`);

  const rows = writeable.map((c) => {
    const id = toCustomId(c.caseNumber);
    // The auditor sees exactly the evidence the generator saw, never the raw file.
    const sourceText = state.hasText(id) ? segmentDecision(state.readText(id)).segmented : "";
    return { caseNumber: c.caseNumber, summary: c.summary, sourceText };
  });

  const withSource = rows.filter((r) => r.sourceText);
  if (withSource.length < rows.length) {
    // Said out loud rather than swallowed: an unaudited row is still delivered, and the
    // reader of the run log is entitled to know how many passed only one of the two gates.
    log(`  ${rows.length - withSource.length} row(s) have no source text on disk and were not audited`);
  }
  const report = await auditRows(runner.auditor, withSource, config.concurrency);

  for (const outcome of report.outcomes) {
    const record = state.readCase(toCustomId(outcome.caseNumber));
    if (!record) continue;
    // The verdict is recorded whether or not it demoted, so a later run knows this row has
    // been through the second gate. An errored call records nothing and is tried again.
    record.auditSeverity = outcome.verdict?.severity ?? null;
    if (!outcome.kept) {
      record.status = "needs_review";
      record.auditReason = outcome.reason;
      log(`  refused: ${outcome.caseNumber} — ${outcome.reason}`);
    }
    state.saveCase(record);
  }
  return report;
}

export interface DeliveryReport {
  write: WriteReport;
  verify: VerifyReport;
}

/** Stage 7 — write the copy and then prove it is safe. */
export async function deliver(runner: Runner, outputPath: string): Promise<DeliveryReport> {
  const { config, state } = runner;
  const loaded = await loadWorkbook(config.workbookPath, {
    summaryHeader: config.summaryHeader,
    summaryColumn: config.summaryColumn,
    caseColumn: config.caseColumn,
  });
  const summaries = state.cases().map((c) => ({
    caseNumber: c.caseNumber,
    row: c.row,
    status: c.status,
    summary: c.summary,
    reason: c.auditReason ?? c.gateDetail,
  }));
  const write = await writeSummaries(config.workbookPath, outputPath, summaries, {
    summaryColumn: loaded.summaryColumn,
  });
  const verify = await verifyOutput(config.workbookPath, outputPath, loaded.summaryColumn);
  return { write, verify };
}


/** Waits for a round's batches, polling at the configured interval.
 *
 *  Collection is attempted on every poll rather than only at the end, so a run that is
 *  interrupted mid-wait has already banked whatever finished. */
async function waitAndCollect<T extends CollectReport>(
  runner: Runner,
  round: string,
  collect: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  const intervalMs = runner.config.pollSeconds * 1000;
  for (;;) {
    const report = await collect();
    if (!report.pending.length) return report;
    runner.log(
      `  ${round}: ${report.pending.length} batch(es) still processing — next check in ${runner.config.pollSeconds}s`,
    );
    await sleep(intervalMs);
  }
}

export interface RunOptions {
  outputPath: string;
  /** Extract at most this many cases: how a first run is kept cheap. */
  limit?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunSummary {
  extract: ExtractReport;
  maps: CollectReport;
  structure: StructureReport;
  audit: AuditReport;
  delivery: DeliveryReport;
  usage: Usage;
}

/** The whole chain, end to end. Each stage is also exported on its own, because in
 *  production the waits are long enough that the stages are run by hand over two days. */
export async function runAll(runner: Runner, options: RunOptions): Promise<RunSummary> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  runner.log("stage 1/7 — extract");
  const extracted = await extract(runner, options.limit);
  runner.log(
    `  ${extracted.extracted} extracted, ${extracted.alreadyDone} already done, ` +
      `${extracted.noSource} without usable source, ${extracted.failed.length} failed`,
  );

  runner.log("stage 2/7 — submit maps");
  await submitMaps(runner);
  runner.log("stage 3/7 — collect maps");
  const maps = await waitAndCollect(runner, "maps", () => collectMaps(runner), sleep);
  runner.log(
    `  ${maps.collected} map(s), ${maps.failed} failed` +
      (maps.skipped ? `, ${maps.skipped} already collected` : ""),
  );

  runner.log("stage 4/7 — submit structuring");
  await submitStructuring(runner);
  runner.log("stage 5/7 — collect structuring");
  const structure = await waitAndCollect(runner, "structuring", () => collectStructuring(runner), sleep);
  runner.log(
    `  ${structure.collected} result(s): ${structure.writeable} writeable, ` +
      `${structure.needsReview} for review, ${structure.invalid} invalid, ${structure.failed} failed`,
  );

  runner.log("stage 6/7 — audit");
  const audited = await audit(runner);
  runner.log(`  ${audited.kept} kept, ${audited.demoted} demoted, ${audited.failed} audit call(s) failed`);

  runner.log("stage 7/7 — write");
  const delivery = await deliver(runner, options.outputPath);
  runner.log(
    `  ${delivery.write.written} written, ${delivery.write.flagged} flagged` +
      (delivery.write.skippedApproved
        ? `, ${delivery.write.skippedApproved} refused at the cell because a reviewer had signed it`
        : ""),
  );
  runner.log(`  verification: ${delivery.verify.ok ? "clean" : "FAILED"}`);

  return {
    extract: extracted,
    maps,
    structure,
    audit: audited,
    delivery,
    usage: sumUsage(maps.usage, structure.usage, audited.usage),
  };
}
