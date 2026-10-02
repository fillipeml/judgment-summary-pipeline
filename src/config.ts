/** Settings from the environment. The only module that knows the variable names. */
import { DEFAULT_MODEL } from "./model/cost.ts";

export interface Config {
  /** No API key, no network: recorded readings, the sample workbook, the sample case files. */
  demoMode: boolean;
  anthropicApiKey: string;
  model: string;
  /** The client's workbook. Never written to: every run writes a copy. */
  workbookPath: string;
  /** The header of the column holding the decision summary. */
  summaryHeader: string;
  /** Used only when the header is not found. */
  summaryColumn?: number;
  caseColumn: number;
  /** Where the case files are. */
  sourceDir: string;
  /** Run state and deliverables. */
  outDir: string;
  /** How many model calls at once, outside the Batch API. */
  concurrency: number;
  /** Requests per batch. Ours, not the API's limit: it bounds what one interrupted
   *  submission can cost. */
  batchChunkSize: number;
  /** Seconds between polls of a batch. */
  pollSeconds: number;
  /** Attempts for a transient network failure, and the cap on the backoff. */
  retryAttempts: number;
  retryMaxMs: number;
  /** A docket larger than this is skipped rather than read: it is a scanning artefact. */
  maxDocumentMB: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.ANTHROPIC_API_KEY ?? "";
  const demoMode = env.DEMO_MODE !== undefined ? env.DEMO_MODE === "true" : apiKey === "";
  return {
    demoMode,
    anthropicApiKey: apiKey,
    model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    workbookPath: env.WORKBOOK_PATH || (demoMode ? "fixtures/workbook/caseload.xlsx" : "cases/caseload.xlsx"),
    summaryHeader: env.SUMMARY_HEADER || "Resumo Decisão",
    summaryColumn: env.SUMMARY_COLUMN ? Number(env.SUMMARY_COLUMN) : undefined,
    caseColumn: num(env.CASE_COLUMN, 1),
    sourceDir: env.SOURCE_DIR || (demoMode ? "fixtures/sources" : "cases/documents"),
    outDir: env.OUT_DIR || (demoMode ? ".demo" : "out"),
    concurrency: num(env.CONCURRENCY, 2),
    batchChunkSize: num(env.BATCH_CHUNK_SIZE, 100),
    pollSeconds: num(env.POLL_SECONDS, 120),
    retryAttempts: num(env.RETRY_ATTEMPTS, 20),
    retryMaxMs: num(env.RETRY_MAX_MS, 60_000),
    maxDocumentMB: num(env.MAX_DOCUMENT_MB, 120),
  };
}
