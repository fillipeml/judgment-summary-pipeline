/** The one place that decides whether this run talks to the network.
 *
 * Every other module takes its collaborators as arguments and cannot tell the difference.
 * That is the point: the demo exercises the same code as production, including the batch
 * chunking, the polling and the two gates, and the only thing it substitutes is where the
 * readings and the case files come from. A reviewer can check the claim by reading this
 * file alone: it is the only module that branches on demo mode. The environment variable
 * itself is read in one place, config.ts. */
import { readFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";

import { ClaudeBatchClient } from "./batch/client.ts";
import { FixtureBatchClient } from "./batch/fixture-client.ts";
import type { BatchClient } from "./batch/client.ts";
import { ClaudeAnalyser } from "./model/analyser/claude.ts";
import { FixtureAnalyser } from "./model/analyser/fixture.ts";
import type { Analyser, Auditor, ParityJudge } from "./model/analyser/types.ts";
import type { RecordingFile } from "./model/analyser/fixture.ts";
import { FolderStore } from "./sources/store.ts";
import type { SourceStore } from "./sources/store.ts";
import type { Config } from "./config.ts";

export const RECORDINGS_PATH = "fixtures/recordings.json";

function recordings(path = RECORDINGS_PATH): RecordingFile {
  return JSON.parse(readFileSync(path, "utf8")) as RecordingFile;
}

export interface Collaborators {
  analyser: Analyser;
  auditor: Auditor;
  judge: ParityJudge;
  mapBatches: BatchClient;
  structureBatches: BatchClient;
  store: SourceStore;
  /** Printed once at startup so nobody mistakes a demo run for a real one. */
  banner: string;
}

export function build(config: Config, recordingsPath = RECORDINGS_PATH): Collaborators {
  if (config.demoMode) {
    const file = recordings(recordingsPath);
    const analyser = new FixtureAnalyser(file);
    return {
      analyser,
      auditor: analyser,
      judge: analyser,
      mapBatches: new FixtureBatchClient(file, "map"),
      structureBatches: new FixtureBatchClient(file, "structure"),
      store: new FolderStore(config.sourceDir),
      banner:
        `DEMO MODE — recorded readings from ${recordingsPath}, sample case files from ` +
        `${config.sourceDir}. No network call is made and nothing is billed.`,
    };
  }

  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set, and DEMO_MODE is false");
  }
  const analyser = new ClaudeAnalyser(config.anthropicApiKey, config.model);
  // A fresh client per batch call, not a shared one. A batch run polls every couple of
  // minutes for hours; a pooled socket that has been idle that long is a real failure mode,
  // and constructing a client is cheap next to the wait it sits inside.
  const newClient = (): Anthropic => new Anthropic({ apiKey: config.anthropicApiKey });
  return {
    analyser,
    auditor: analyser,
    judge: analyser,
    mapBatches: new ClaudeBatchClient(newClient),
    structureBatches: new ClaudeBatchClient(newClient),
    store: new FolderStore(config.sourceDir),
    banner: `LIVE — ${config.model} via the Message Batches API. This run is billed.`,
  };
}
