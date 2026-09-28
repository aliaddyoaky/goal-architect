import type { AgentReply, GoalState, RoadmapStep } from "@/lib/schema";
import { demoReply } from "@/lib/demo-agent";
import { callDshAgent } from "@/lib/dsh-agent";
import { makeTraceSink, type TraceSink } from "@/lib/trace";

type ChatMessage = { role: "user" | "assistant"; content: string };

export type RespondResult = {
  reply: AgentReply;
  mode: "dsh" | "demo";
  diagnostic?: string;
};

function lastText(messages: ChatMessage[]) {
  return messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
}

function summarizeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const token = process.env.DEEPSEEK_API_KEY;
  const safe = token ? raw.replaceAll(token, "[key redacted]") : raw;
  return safe.replace(/\s+/g, " ").trim().slice(0, 320) || "未知运行时错误";
}

function dshUnavailableReply(state: GoalState, action: "message" | "plan" | "revise", roadmap: RoadmapStep[] | null): AgentReply {
  return {
    assistantMessage: action === "revise"
      ? "DeepSeek Harness 这次没有完成路线调整，所以我没有覆盖现有路线。请展开上方运行记录查看具体错误，修复后重试；当前路线和目标信息会保留。"
      : "DeepSeek Harness 这次没有完成请求，所以我没有把未验证的内容冒充成你的路线。请展开上方运行记录查看具体错误，修复后重试；当前目标信息会保留。",
    goalState: state,
    questions: [],
    ...(action === "revise" && roadmap?.length ? { roadmap } : {}),
    // Research did not complete, so the UI should expose the planning action
    // again instead of leaving the user stuck in an in-progress phase.
    phase: action === "revise" ? "plan" : "discovery",
  };
}

export async function respond(state: GoalState, messages: ChatMessage[], action: "message" | "plan" | "revise" = "message", roadmap: RoadmapStep[] | null = null, trace?: TraceSink, signal?: AbortSignal): Promise<RespondResult> {
  const emit = makeTraceSink(trace);
  if (!process.env.DEEPSEEK_API_KEY) {
    emit("status", "未配置 DeepSeek API Key", "使用本地演示引擎；不会联网搜索", "done", "runtime");
    return { reply: demoReply(state, lastText(messages), action, roadmap), mode: "demo" };
  }
  try {
    emit("stage", "选择 DeepSeek Harness", "仅使用 dsh 运行时（不启用 Claude 备用链路）", "running", "runtime");
    return { reply: await callDshAgent(state, messages, action, roadmap, trace, signal), mode: "dsh" };
  } catch (error) {
    const diagnostic = `DeepSeek Harness: ${summarizeError(error)}`;
    emit("error", "DeepSeek Harness 未完成", diagnostic, "failed", "runtime");
    console.error("DeepSeek Harness request failed:", error);
    return { reply: dshUnavailableReply(state, action, roadmap), mode: "demo", diagnostic };
  }
}
