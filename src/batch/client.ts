/** The Message Batches API, behind an interface.
 *
 * Batch halves the price for work that does not need an answer now, which is the whole
 * economics of a few hundred case files. The cost is that a batch is asynchronous and
 * opaque: submit, wait hours, collect.
 *
 * One decision shapes the runner: submissions are chunked at a hundred requests, and every
 * chunk id is persisted before anything is awaited.
 *
 * The chunk size is ours, not the API's. A Message Batch is limited to 100,000 requests or
 * 256 MB, whichever comes first, so a two-thousand-row run would fit in one submission. It is
 * split anyway because the unit of loss on an interrupted submit is one chunk: a hundred cases
 * to re-submit rather than the whole backlog, and a hundred ids to reconcile rather than one
 * batch whose contents nobody recorded. */
import type Anthropic from "@anthropic-ai/sdk";

import type { UsageRaw } from "../model/cost.ts";

export interface BatchRequest {
  customId: string;
  params: Record<string, unknown>;
}

export interface BatchCounts {
  processing: number;
  succeeded: number;
  errored: number;
  canceled: number;
  expired: number;
}

export interface BatchStatus {
  id: string;
  ended: boolean;
  counts: BatchCounts;
  createdAt: string | null;
}

export type BatchResultItem =
  | { customId: string; ok: true; text: string; usage: UsageRaw }
  | { customId: string; ok: false; reason: string };

export interface BatchClient {
  readonly kind: string;
  create(requests: BatchRequest[]): Promise<string>;
  status(id: string): Promise<BatchStatus>;
  results(id: string): AsyncIterable<BatchResultItem>;
}

function textOf(content: unknown): string {
  const blocks = (content ?? []) as { type: string; text?: string }[];
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

export class ClaudeBatchClient implements BatchClient {
  readonly kind = "claude";

  /** A factory, not a singleton: a client whose connection was torn down mid-run is a real
   *  failure mode on a job that waits hours between calls. */
  private readonly newClient: () => Anthropic;

  constructor(newClient: () => Anthropic) {
    this.newClient = newClient;
  }

  async create(requests: BatchRequest[]): Promise<string> {
    const batch = await this.newClient().messages.batches.create({
      requests: requests.map((r) => ({
        custom_id: r.customId,
        params: r.params as never,
      })),
    });
    return batch.id;
  }

  async status(id: string): Promise<BatchStatus> {
    const batch = await this.newClient().messages.batches.retrieve(id);
    const counts = batch.request_counts as unknown as BatchCounts;
    return {
      id,
      ended: batch.processing_status === "ended",
      counts,
      createdAt: (batch.created_at as unknown as string) ?? null,
    };
  }

  async *results(id: string): AsyncIterable<BatchResultItem> {
    // The iterator streams: a few hundred results are never held in memory at once.
    for await (const item of await this.newClient().messages.batches.results(id)) {
      const result = item.result as { type: string; message?: { content: unknown; usage: unknown } };
      if (result.type === "succeeded" && result.message) {
        yield {
          customId: item.custom_id,
          ok: true,
          text: textOf(result.message.content),
          usage: result.message.usage as UsageRaw,
        };
      } else {
        yield { customId: item.custom_id, ok: false, reason: result.type };
      }
    }
  }
}
