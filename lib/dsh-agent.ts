import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AgentReplySchema, type AgentReply, type GoalState, type RoadmapStep } from "@/lib/schema";
import { makeTraceSink, type TraceSink } from "@/lib/trace";

type ChatMessage = { role: "user" | "assistant"; content: string };
type JsonRpcMessage = { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown> };
type FailureDetail = { message?: string; code?: string; status?: number };

const systemPrompt = `You are Goal Architect, a professional learning and goal-planning researcher. Your job is to turn a vague goal into a personalized, verifiable learning plan — not a generic list of advice.

DISCOVERY: Maintain the structured goal state across turns. Never ask again for known information. Ask exactly ONE high-information question per turn. Prefer a quick interaction: use type "single" for one choice, "multi" for multiple choices, and "ranking" when the user needs to order priorities. Use type "text" only when the answer cannot be represented by options. For choice questions, provide 3–6 concise options with stable value and readable label. Do not plan until readiness is at least 72 and purpose, currentLevel, and weeklyTime are known.

RESEARCH: When asked to plan, use the available web search/fetch tools before drafting the route. Search for resources that match the user's exact goal, current step, level, language, time budget, and constraints. Research is step-specific: a step about networking should receive networking, communication, or relationship-building material; a step about implementation should receive implementation material. Do not fill every step with resources about the final goal in general. Cover useful source types whenever they exist: books, official documentation, structured courses, workshops or events that can be registered for, focused tutorials, exercises, high-quality videos, practitioner blogs, respected creators/KOLs, communities, and templates. Include direct pages rather than platform homepages, search-result pages, SEO listicles, or generic recommendation lists. Never invent, infer, or repair a URL. Every URL must be copied from a search result or fetched page. Continue searching until every step has enough relevant, actionable material; there is no fixed total search or resource-count limit, and do not pad the route with weak links. If a source cannot be verified, leave it out and clearly mark the uncovered area.

ROADMAP: Produce 5–8 sequenced steps fitted to the user's available calendar. Before returning JSON, perform a final deep planning pass: check the dependency between steps, ensure each resource teaches or enables that exact step, remove duplicated fields and generic tools, and make the outputs observable. Do not expose private chain-of-thought; only return the checked result. Each step must follow this order: WHAT to do, HOW to do it, RESOURCES, TOOLS, and the RESULT this step should achieve. Resources are a flexible list and may include books, courses, videos, events, communities, articles, exercises, or practitioners; include as many strong matches as useful. For every resource provide exact title, direct URL, source type, provider, access/language if visible, why it fits this step, and the exact chapter, lesson, exercise, event, or section to use. Tools must be concrete and step-specific; include a direct URL when one exists. Keep legacy fields empty when they would only repeat another field.

Return ONLY valid JSON matching this shape: {assistantMessage:string,goalState:{goal,purpose,deadline,currentLevel,weeklyTime,preferences,constraints,successCriteria},questions:[{id:string,text:string,type:"single"|"multi"|"ranking"|"text",options?:[{value:string,label:string}],placeholder?:string}],roadmap?:[{title,duration,why,what,how,resources:[{title,url,sourceType,provider,access,whyRecommended,howToUse}],tools:[{name,url,provider,whyRecommended,howToUse}],tool,estimatedTime,output,resource,input,acceptanceCriteria,dependencies:string[]}],phase:"discovery"|"research"|"plan"}. During discovery, questions must contain at most one item. For a completed plan, phase must be "plan" and the research-backed roadmap must be present. Do not return JSON inside markdown fences.`;

function extractJson(output: string): unknown {
  const cleaned = output.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}

  // Harness notifications can prepend a short explanation. Extract the first
  // balanced object while respecting braces inside quoted strings, then allow
  // the common trailing-comma mistake. We still fail loudly if the structure
  // is genuinely truncated instead of inventing roadmap data.
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("DeepSeek Harness response was not valid JSON (no object found)");
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) { end = index; break; }
    }
  }
  if (end < 0) throw new Error(`DeepSeek Harness response was truncated while parsing JSON (length ${cleaned.length})`);
  const candidate = cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(candidate); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = /position (\d+)/i.exec(message)?.[1];
    const offset = position ? Number(position) : 0;
    const context = candidate.slice(Math.max(0, offset - 100), offset + 140).replace(/\s+/g, " ");
    throw new Error(`DeepSeek Harness returned malformed JSON: ${message}; near: ${context}`);
  }
}

function argsFromEnvironment() {
  const command = process.env.DSH_COMMAND || "dsh";
  const args = process.env.DSH_ARGS?.trim()
    ? process.env.DSH_ARGS.trim().split(/\s+/)
    : ["--profile", process.env.DSH_PROFILE || "sdk"];
  return { command, args };
}

function promptFor(state: GoalState, messages: ChatMessage[], action: "message" | "plan" | "revise", roadmap: RoadmapStep[] | null) {
  const planningProtocol = action === "plan" || action === "revise"
    ? "The user explicitly requested their roadmap. Research each step and gather as many strong, step-specific resources as needed, including books, events, courses, videos, practitioners, communities, and tools. Do not impose a total search or resource limit. Then perform a final deep planning and relevance pass before returning a complete 5–8 step route. Do not stop after saying you will research. If essential profile information is missing, ask for it rather than fabricate a personal plan."
    : "Update the goal state from the conversation and ask the next most useful questions. Do not generate a generic roadmap yet.";
  const revisionProtocol = action === "revise" ? "The user is revising an existing roadmap. Preserve steps they did not ask to change, apply the requested edits precisely, and return the complete updated roadmap. Re-research only affected steps when resources or tools need to change. Keep phase as plan." : "";
  return `${systemPrompt}\n\nCurrent goal state:\n${JSON.stringify(state)}\n\nCurrent roadmap:\n${JSON.stringify(roadmap || [])}\n\nConversation so far:\n${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nAction: ${planningProtocol}\n${revisionProtocol}\nReturn only JSON.`;
}

// When the upstream model call fails, dsh hides the reason inside the attempt
// stream: data.stream[].chunk.type === "finish" with reason.kind === "error".
// Reading it out keeps an HTTP failure from collapsing into a meaningless
// "empty response" later on.
function failureFromAttempt(data: any): FailureDetail | null {
  const stream = Array.isArray(data?.stream) ? data.stream : [];
  for (const entry of stream) {
    const chunk = entry?.chunk;
    if (chunk?.type !== "finish") continue;
    const reason = chunk.reason;
    if (reason?.kind !== "error") continue;
    const detail = reason.failure || reason.error;
    return detail ? { message: detail.message, code: detail.code, status: detail.status } : { message: "unknown error" };
  }
  return null;
}

function failureFromReason(reason: any): FailureDetail | null {
  if (reason?.kind !== "error") return null;
  const detail = reason.failure || reason.error;
  return detail ? { message: detail.message, code: detail.code, status: detail.status } : { message: "unknown error" };
}

function describeFailure(failure: FailureDetail): string {
  const parts = [failure.message, failure.code, failure.status ? `HTTP ${failure.status}` : undefined].filter(Boolean);
  return parts.join(" · ") || "未知上游错误";
}

export async function callDshAgent(state: GoalState, messages: ChatMessage[], action: "message" | "plan" | "revise", roadmap: RoadmapStep[] | null = null, trace?: TraceSink, signal?: AbortSignal): Promise<AgentReply> {
  const { command, args } = argsFromEnvironment();
  const emit = makeTraceSink(trace);
  const sessionId = `goal-${randomUUID()}`;
  let lastFailure: FailureDetail | null = null;
  let cancelled = false;
  emit("stage", "启动 DeepSeek Harness", `${command} ${args.join(" ")}`, "running", "launch");
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      DSH_HOME: process.env.DSH_HOME || `${process.cwd()}/work/dsh-home`,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      DSH_SYSTEM_PROMPT: process.env.DSH_SYSTEM_PROMPT || systemPrompt,
    },
  });
  const abortChild = () => {
    cancelled = true;
    emit("status", "已停止本次运行", "收到取消请求，正在结束 DeepSeek Harness", "failed", "cancel");
    child.kill("SIGTERM");
  };
  if (signal?.aborted) abortChild();
  else signal?.addEventListener("abort", abortChild, { once: true });

  const output = createInterface({ input: child.stdout });
  const pending: JsonRpcMessage[] = [];
  const waiters: Array<(message: JsonRpcMessage) => void> = [];
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-6000); });
  output.on("line", (line) => {
    try {
      const message = JSON.parse(line) as JsonRpcMessage;
      const params = message.params;
      if (message.method === "session.status" && params?.sessionId === sessionId) {
        const status = String(params.status || "");
        emit("status", status === "running" ? "Agent 正在运行" : "Agent 已进入空闲", undefined, status === "running" ? "running" : "done", "agent");
      }
      if (message.method === "session.event" && params?.sessionId === sessionId) {
        const event = params.event as { type?: string; data?: Record<string, unknown> } | undefined;
        const eventType = String(event?.type || "");
        const data = event?.data || {};
        if (eventType === "turn/start") emit("stage", "开始一轮任务", `第 ${String(data.turn || "")} 轮`, "running", `turn-${String(data.turn || "")}`);
        else if (eventType === "step/start") emit("model", "模型开始判断", `第 ${String(data.turn || "")} 轮 · 第 ${String(data.step || "")} 步`, "running", `step-${String(data.turn || "")}-${String(data.step || "")}`);
        else if (eventType === "tool/call") {
          const name = typeof data.name === "string" ? data.name : "未知工具";
          emit("tool", `调用工具：${name}`, "已发送工具请求，等待结果", "running", `tool-${String(data.callId || name)}`);

        } else if (eventType === "tool/result") {
          const failed = Boolean(data.error) || Boolean((data.message as { content?: Array<{ isError?: boolean }> } | undefined)?.content?.some((block) => block.isError));
          const resultCallId = data.callId || (data.message as { callId?: string } | undefined)?.callId || "result";
          emit("tool", failed ? "工具返回错误" : "工具返回结果", failed ? "工具调用未成功" : "结果已回传给模型", failed ? "failed" : "done", `tool-${String(resultCallId)}`);
        } else if (eventType === "assistant/message") emit("model", "模型完成一轮输出", "已收到模型公开输出，继续检查后续步骤", "done", `step-${String(data.turn || "")}-${String(data.step || "")}`);
        else if (eventType === "assistant/attempt") {
          const failure = failureFromAttempt(data);
          if (failure) {
            lastFailure = failure;
            emit("error", "模型请求失败", describeFailure(failure), "failed", `attempt-${String(data.turn || "")}-${String(data.step || "")}`);
          } else emit("model", "模型尝试结束", "记录了一次模型请求结果", "done", `attempt-${String(data.turn || "")}-${String(data.step || "")}`);
        }
        else if (eventType === "turn/end") {
          const reason = data.reason as { kind?: string } | undefined;
          lastFailure = lastFailure || failureFromReason(reason);
          emit("stage", reason?.kind === "completed" ? "任务轮次完成" : "任务轮次结束", reason?.kind === "error" && lastFailure ? describeFailure(lastFailure) : reason?.kind ? `状态：${reason.kind}` : undefined, reason?.kind === "completed" ? "done" : "failed", `turn-${String(data.turn || "")}`);
        } else if (eventType === "request/header") {
          const header = data.header as { tools?: Array<{ name?: string }> } | undefined;
          const count = header?.tools?.length;
          emit("status", "运行时工具已装载", count ? `${count} 个工具可用` : "已完成运行时配置", "done", "tools");
        }
      }
      const waiter = waiters.shift();
      if (waiter) waiter(message); else pending.push(message);
    } catch {
      stderr = `${stderr}\nNon-JSON dsh output: ${line}`.slice(-6000);
    }
  });

  const nextMessage = (predicate: (message: JsonRpcMessage) => boolean) => new Promise<JsonRpcMessage>((resolve, reject) => {
    const index = pending.findIndex(predicate);
    if (index >= 0) return resolve(pending.splice(index, 1)[0]);
    const onMessage = (message: JsonRpcMessage) => predicate(message) ? resolve(message) : waiters.push(onMessage);
    waiters.push(onMessage);
    child.once("exit", (code) => reject(new Error(cancelled
      ? "DeepSeek Harness request was cancelled"
      : `DeepSeek Harness exited (${code}): ${stderr}`)));
  });
  const request = async (id: number, method: string, params: Record<string, unknown>) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const response = await nextMessage((message) => message.id === id);
    if (response.error) throw new Error(response.error.message || `DeepSeek Harness ${method} failed`);
    return response.result;
  };

  let finalText = "";
  const assistantTexts: string[] = [];
  const extractAssistantText = (data?: { message?: any; content?: any }): string => {
    const candidates: unknown[] = [data?.message?.content, data?.content];
    for (const c of candidates) {
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        const t = c.filter((b: any) => b?.type === "text" || b?.type === undefined).map((b: any) => b?.text || "").join("");
        if (t) return t;
      }
    }
    return "";
  };
  const captureAssistantMessage = (message: JsonRpcMessage) => {
    if (message.method !== "session.event" || message.params?.sessionId !== sessionId) return;
    const event = message.params.event as { type?: string; data?: { message?: any; content?: any } } | undefined;
    const eventType = event?.type;
    // dsh surfaces the final answer via `assistant/message` (most versions) and
    // sometimes only via `assistant/attempt`. Capture both so we never report an
    // empty response when the model actually produced text.
    if (eventType !== "assistant/message" && eventType !== "assistant/attempt") return;
    const text = extractAssistantText(event?.data);
    if (text) {
      assistantTexts.push(text);
      finalText = text;
    }
  };
  const waitForIdle = () => new Promise<void>((resolve, reject) => {
    let settled = false;
    const consume = (message: JsonRpcMessage) => {
      captureAssistantMessage(message);
      if (message.method === "session.status" && message.params?.sessionId === sessionId && message.params.status === "idle") {
        settled = true;
        resolve();
        return true;
      }
      return false;
    };
    const onMessage = (message: JsonRpcMessage) => {
      if (!settled && !consume(message)) waiters.push(onMessage);
    };
    while (pending.length > 0 && !settled) consume(pending.shift()!);
    if (settled) return;
    waiters.push(onMessage);
    child.once("exit", (code) => {
      if (!settled) reject(new Error(cancelled
        ? "DeepSeek Harness request was cancelled"
        : `DeepSeek Harness exited (${code}): ${stderr}`));
    });
  });
  try {
    await request(1, "initialize", {
      cwd: process.cwd(),
      provider: process.env.DSH_PROVIDER || "deepseek-official",
      // Use the current Flash model by default. Older `deepseek-chat` aliases
      // can behave differently across accounts and are no longer the preferred
      // model for new API integrations.
      model: process.env.DSH_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-flash",
      maxTokens: 20_000,
    });
    emit("stage", "DeepSeek Harness 已就绪", "JSON-RPC 握手完成", "done", "launch");
    emit("stage", "创建研究会话", "正在建立本次目标的独立会话", "running", "session");
    await request(2, "session/prompt", {
      sessionId,
      contentBlocks: [{ type: "text", text: promptFor(state, messages, action, roadmap) }],
    });
    emit("stage", action === "plan" || action === "revise" ? "进入 Research 阶段" : "处理 Discovery 对话", action === "plan" || action === "revise" ? "将按路线步骤搜索并核验公开资源" : "正在提取 Goal State", "done", "session");

    await waitForIdle();
    if (!finalText) {
      throw new Error(lastFailure
        ? `DeepSeek 请求失败：${describeFailure(lastFailure)}`
        : "DeepSeek Harness returned an empty response");
    }
    if (action === "plan" || action === "revise") emit("model", "Thinking · 深度规划", "正在综合用户约束，检查每个步骤的任务、资源和工具是否一一对应", "running", "deep-planning");
    const parseCandidates = () => {
      let parsed: AgentReply | undefined;
      let parseError = "";
      // dsh can emit several assistant messages during one tool loop. The last
      // message is sometimes a plain-language closing note, while an earlier
      // message contains the requested JSON. Try every candidate from newest to
      // oldest instead of blindly parsing only the last one.
      for (const candidate of [...assistantTexts].reverse()) {
        try {
          parsed = AgentReplySchema.parse(extractJson(candidate));
          break;
        } catch (error) {
          parseError = error instanceof Error ? error.message : String(error);
        }
      }
      return { parsed, parseError };
    };
    let { parsed: reply, parseError } = parseCandidates();
    if (!reply && (action === "plan" || action === "revise")) {
      emit("model", "修复结构化输出", "首次输出不是完整 JSON，要求 Harness 只返回可解析的路线结果", "running", "json-repair");
      assistantTexts.length = 0;
      finalText = "";
      await request(3, "session/prompt", {
        sessionId,
        contentBlocks: [{ type: "text", text: "Your previous response was not machine-readable. Do not call any tools now. Return ONLY one complete JSON object matching the exact schema in your system prompt. Use the verified URLs already collected; if a complete plan is impossible, return a valid discovery response with one question. Do not add markdown or explanation." }],
      });
      await waitForIdle();
      ({ parsed: reply, parseError } = parseCandidates());
      if (reply) emit("model", "修复结构化输出完成", "已将路线结果恢复为可解析 JSON", "done", "json-repair");
    }
    if (!reply) throw new Error(parseError || "DeepSeek Harness returned no valid JSON response");
    if (action === "plan" || action === "revise") emit("model", "Thinking · 规划完成", "已完成步骤顺序、资源相关性和结果可执行性检查", "done", "deep-planning");
    emit("stage", reply.phase === "plan" ? "路线生成完成" : "结构化状态更新完成", reply.phase === "plan" ? `${reply.roadmap?.length || 0} 个路线阶段` : "已返回下一轮问题", "done", "complete");
    return reply;
  } catch (error) {
    emit("error", "DeepSeek Harness 未完成", error instanceof Error ? error.message.slice(0, 260) : "未知错误", "failed", "complete");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortChild);
    try { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "shutdown", params: {} })}\n`); } catch {}
    setTimeout(() => child.kill("SIGKILL"), 500).unref();
    output.close();
  }
}
