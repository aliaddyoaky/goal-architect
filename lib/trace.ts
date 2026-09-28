export type TraceKind = "stage" | "model" | "tool" | "status" | "error";
export type TraceStatus = "running" | "done" | "failed" | "info";

/**
 * A safe, user-facing execution record. This intentionally contains phases,
 * tool names, statuses and summaries rather than hidden chain-of-thought.
 */
export type TraceEvent = {
  id: string;
  at: number;
  kind: TraceKind;
  status: TraceStatus;
  title: string;
  detail?: string;
  durationMs?: number;
};

export type TraceSink = (event: TraceEvent) => void;

export function makeTraceSink(sink?: TraceSink) {
  const starts = new Map<string, number>();
  return (kind: TraceKind, title: string, detail?: string, status: TraceStatus = "info", key = title): TraceEvent | undefined => {
    if (!sink) return undefined;
    const now = Date.now();
    const started = starts.get(key);
    const event: TraceEvent = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      at: now,
      kind,
      status,
      title,
      ...(detail ? { detail } : {}),
      ...(started ? { durationMs: now - started } : {}),
    };
    if (status === "running") starts.set(key, now);
    if (status === "done" || status === "failed") starts.delete(key);
    sink(event);
    return event;
  };
}
