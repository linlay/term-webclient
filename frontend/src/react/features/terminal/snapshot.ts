import type { TerminalOutputChunk } from "../../shared/api/types";

export function replaySnapshotChunks(
  chunks: TerminalOutputChunk[],
  lastSeenSeq: number,
  onWrite: (data: string) => void
): number {
  let nextSeq = lastSeenSeq;
  chunks.forEach((chunk) => {
    if (chunk.seq > nextSeq) {
      onWrite(chunk.data);
      nextSeq = chunk.seq;
    }
  });
  return nextSeq;
}
