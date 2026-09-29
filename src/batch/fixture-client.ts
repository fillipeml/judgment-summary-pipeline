/** A batch client that answers from recorded readings.
 *
 * It exists so the demo exercises the real chain — chunking, persisting the ids, polling,
 * collecting, matching results back by custom id — rather than a shortcut around it. The
 * only thing it removes is the wait and the bill. A request whose case has no recording
 * comes back as an errored result, which is exactly how the runner is told to leave that
 * case alone. */
import { fromCustomId } from "../domain/case-number.ts";
import type { Recording, RecordingFile } from "../model/analyser/fixture.ts";
import type { BatchClient, BatchRequest, BatchResultItem, BatchStatus } from "./client.ts";

export type Round = "map" | "structure";

export class FixtureBatchClient implements BatchClient {
  readonly kind = "fixture";
  private readonly byCase = new Map<string, Recording>();
  private readonly batches = new Map<string, BatchRequest[]>();
  private counter = 0;

  private readonly round: Round;

  constructor(file: RecordingFile, round: Round) {
    this.round = round;
    for (const r of file.recordings) this.byCase.set(r.caseNumber, r);
  }

  async create(requests: BatchRequest[]): Promise<string> {
    const id = `msgbatch_fixture_${this.round}_${String(++this.counter).padStart(3, "0")}`;
    this.batches.set(id, requests);
    return id;
  }

  async status(id: string): Promise<BatchStatus> {
    const requests = this.batches.get(id) ?? [];
    const known = [...this.byCase.keys()];
    const succeeded = requests.filter((r) => fromCustomId(r.customId, known)).length;
    return {
      id,
      // A recorded batch is always already finished: the demo must not sleep.
      ended: true,
      counts: {
        processing: 0,
        succeeded,
        errored: requests.length - succeeded,
        canceled: 0,
        expired: 0,
      },
      createdAt: null,
    };
  }

  async *results(id: string): AsyncIterable<BatchResultItem> {
    const known = [...this.byCase.keys()];
    for (const request of this.batches.get(id) ?? []) {
      const caseNumber = fromCustomId(request.customId, known);
      const recording = caseNumber ? this.byCase.get(caseNumber) : undefined;
      if (!recording) {
        yield { customId: request.customId, ok: false, reason: "no recorded reading" };
        continue;
      }
      if (this.round === "map") {
        yield {
          customId: request.customId,
          ok: true,
          text: recording.map,
          usage: recording.usage.map,
        };
      } else {
        yield {
          customId: request.customId,
          ok: true,
          text: JSON.stringify(recording.result),
          usage: recording.usage.structure,
        };
      }
    }
  }
}
