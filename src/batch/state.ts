/** The run's state on disk.
 *
 * Every stage reads what the previous one wrote and writes what the next one needs, so a
 * run that dies at hour three resumes at hour three. It also means the expensive stages can
 * be re-run independently, and that a case whose summary was already accepted is never paid
 * for twice. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { toCustomId } from "../domain/case-number.ts";
import type { CaseResult } from "../model/schema.ts";
import type { Usage } from "../model/cost.ts";
import type { PlanStrategy } from "../sources/plan.ts";
import type { RefusalReason, RowStatus } from "../gate/row-status.ts";

/** What the discovery step decided for one case: kept so a summary can always be traced
 *  back to the documents it was built from, months later, without re-running anything. */
export interface StoredPlan {
  strategy: PlanStrategy;
  documents: string[];
}

export interface TargetRow {
  caseNumber: string;
  row: number;
  previousText: string;
}

/** One case, as the gates and the writer see it. */
export interface CaseRecord {
  caseNumber: string;
  row: number;
  previousText: string;
  strategy: PlanStrategy;
  documentsUsed: string[];
  summary: string;
  status: RowStatus;
  gateReason: RefusalReason | null;
  gateDetail: string;
  auditReason: string | null;
  auditSeverity: string | null;
  result: CaseResult;
  usage: Usage;
}

export class RunState {
  readonly dirs: Record<"text" | "maps" | "cases" | "batch" | "reports", string>;

  readonly root: string;

  constructor(root: string) {
    this.root = root;
    this.dirs = {
      text: join(root, "text"),
      maps: join(root, "maps"),
      cases: join(root, "cases"),
      batch: join(root, "batch"),
      reports: join(root, "reports"),
    };
    for (const dir of Object.values(this.dirs)) mkdirSync(dir, { recursive: true });
  }

  // --- the target list, written once by extract and read by every later stage ---------
  saveTargets(targets: TargetRow[]): void {
    const byId: Record<string, TargetRow> = {};
    for (const t of targets) byId[toCustomId(t.caseNumber)] = t;
    writeFileSync(join(this.dirs.batch, "targets.json"), JSON.stringify(byId, null, 2));
  }

  targets(): Record<string, TargetRow> {
    const path = join(this.dirs.batch, "targets.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }

  // --- how each case's text was found, so the record can say so -----------------------
  savePlans(plans: Record<string, StoredPlan>): void {
    writeFileSync(join(this.dirs.batch, "plans.json"), JSON.stringify(plans, null, 2));
  }

  plans(): Record<string, StoredPlan> {
    const path = join(this.dirs.batch, "plans.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }

  // --- extracted text ----------------------------------------------------------------
  hasText(customId: string): boolean {
    return existsSync(join(this.dirs.text, `${customId}.txt`));
  }

  saveText(customId: string, text: string): void {
    // Only if non-empty: an empty file would become a batch request with no input.
    if (text.trim()) writeFileSync(join(this.dirs.text, `${customId}.txt`), text);
  }

  readText(customId: string): string {
    return readFileSync(join(this.dirs.text, `${customId}.txt`), "utf8");
  }

  textIds(): string[] {
    return readdirSync(this.dirs.text)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => basename(f, ".txt"));
  }

  // --- maps ---------------------------------------------------------------------------
  saveMap(customId: string, map: string): void {
    writeFileSync(join(this.dirs.maps, `${customId}.txt`), map);
  }

  hasMap(customId: string): boolean {
    return existsSync(join(this.dirs.maps, `${customId}.txt`));
  }

  readMap(customId: string): string {
    return readFileSync(join(this.dirs.maps, `${customId}.txt`), "utf8");
  }

  mapIds(): string[] {
    return readdirSync(this.dirs.maps)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => basename(f, ".txt"));
  }

  // --- per-case records ---------------------------------------------------------------
  saveCase(record: CaseRecord): void {
    writeFileSync(
      join(this.dirs.cases, `${toCustomId(record.caseNumber)}.json`),
      JSON.stringify(record, null, 2),
    );
  }

  readCase(customId: string): CaseRecord | null {
    const path = join(this.dirs.cases, `${customId}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as CaseRecord) : null;
  }

  cases(): CaseRecord[] {
    return readdirSync(this.dirs.cases)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dirs.cases, f), "utf8")) as CaseRecord)
      .sort((a, b) => a.row - b.row);
  }

  /** True when this case already has an accepted summary: do not pay for it again. */
  isAccepted(customId: string): boolean {
    return this.readCase(customId)?.status === "writeable";
  }

  // --- batch ids ----------------------------------------------------------------------
  saveBatchIds(round: string, ids: string[]): void {
    writeFileSync(join(this.dirs.batch, `${round}.json`), JSON.stringify({ ids }, null, 2));
  }

  batchIds(round: string): string[] {
    const path = join(this.dirs.batch, `${round}.json`);
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { ids?: string[]; id?: string };
    return parsed.ids ?? (parsed.id ? [parsed.id] : []);
  }

  saveReport(name: string, content: string): string {
    const path = join(this.dirs.reports, name);
    writeFileSync(path, content, "utf8");
    return path;
  }
}
