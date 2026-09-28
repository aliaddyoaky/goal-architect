import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { respond } from "@/lib/agent";
import { normalizeGoalState } from "@/lib/schema";
import type { TraceEvent } from "@/lib/trace";

export const runtime = "nodejs";

function sse(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: Request) {
  let body: { goalState?: unknown; roadmap?: unknown; messages?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确，请重试。" }, { status: 400 });
  }

  try {
    const state = normalizeGoalState(body.goalState);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const action = body.action === "plan" ? "plan" : body.action === "revise" ? "revise" : "message";
    if (messages.length > 40) return NextResponse.json({ error: "Conversation is too long. Start a new goal." }, { status: 400 });

    const requestAbort = new AbortController();
    request.signal.addEventListener("abort", () => requestAbort.abort(), { once: true });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const write = (event: string, payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(sse(event, payload)));
          } catch {
            // A browser can cancel the stream while the Agent is still finishing.
            // Treat that as a normal disconnect instead of enqueueing into a closed controller.
            closed = true;
            clearInterval(heartbeat);
            requestAbort.abort();
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          try { controller.close(); } catch {}
        };
        const heartbeat = setInterval(() => write("heartbeat", { at: Date.now() }), 8_000);
        write("trace", {
          id: `request-${randomUUID()}`,
          at: Date.now(),
          kind: "stage",
          status: "running",
          title: action === "plan" || action === "revise" ? "准备 Research 请求" : "准备 Discovery 请求",
          detail: "正在连接服务端运行时",
        } satisfies TraceEvent);

        void respond(state, messages as Array<{ role: "user" | "assistant"; content: string }>, action, Array.isArray(body.roadmap) ? body.roadmap : null, (event) => write("trace", event), requestAbort.signal)
          .then((result) => {
            write("result", result);
            close();
          })
          .catch((error) => {
            write("error", { error: error instanceof Error ? error.message : "请求失败，请重试。" });
            close();
          });
      },
      cancel() {
        requestAbort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Goal Architect streaming API error:", error);
    return NextResponse.json({ error: "这次没有顺利完成。你的状态已保留，请重试。" }, { status: 500 });
  }
}
