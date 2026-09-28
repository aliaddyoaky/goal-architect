import { z } from "zod";

export const GoalStateSchema = z.object({
  goal: z.string().default(""),
  purpose: z.string().default(""),
  deadline: z.string().default(""),
  currentLevel: z.string().default(""),
  weeklyTime: z.string().default(""),
  preferences: z.string().default(""),
  constraints: z.string().default(""),
  successCriteria: z.string().default(""),
});
export type GoalState = z.infer<typeof GoalStateSchema>;

const goalStateKeys = ["goal", "purpose", "deadline", "currentLevel", "weeklyTime", "preferences", "constraints", "successCriteria"] as const;

/** Convert legacy persisted values and model nulls into the string-only state used by the agent. */
export function normalizeGoalState(value: unknown): GoalState {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(goalStateKeys.map((key) => [key, typeof raw[key] === "string" ? raw[key] : ""])) as GoalState;
}

const QuestionOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

const QuestionTypeSchema = z.enum(["single", "multi", "ranking", "text"]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const GoalQuestionSchema = z.object({
  id: z.string().default("question-1"),
  text: z.string(),
  type: QuestionTypeSchema.default("text"),
  options: z.array(QuestionOptionSchema).default([]),
  placeholder: z.string().optional(),
});
export type GoalQuestion = z.infer<typeof GoalQuestionSchema>;

function normalizeQuestions(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1).map((item, index) => {
    if (typeof item === "string") return { id: `question-${index + 1}`, text: item, type: "text", options: [] };
    if (!item || typeof item !== "object") return item;
    const raw = item as { id?: unknown; text?: unknown; question?: unknown; type?: unknown; options?: unknown; placeholder?: unknown };
    const options = Array.isArray(raw.options)
      ? raw.options.map((option) => {
        if (typeof option === "string") return { value: option, label: option };
        if (option && typeof option === "object") {
          const candidate = option as { value?: unknown; label?: unknown };
          const label = typeof candidate.label === "string" ? candidate.label : typeof candidate.value === "string" ? candidate.value : "";
          return { value: typeof candidate.value === "string" ? candidate.value : label, label };
        }
        return { value: "", label: "" };
      }).filter((option) => option.value && option.label)
      : [];
    const type = raw.type === "multi" || raw.type === "ranking" || raw.type === "single" || raw.type === "text"
      ? raw.type
      : options.length > 0 ? "single" : "text";
    return {
      id: typeof raw.id === "string" ? raw.id : `question-${index + 1}`,
      text: typeof raw.text === "string" ? raw.text : typeof raw.question === "string" ? raw.question : "",
      type,
      options,
      ...(typeof raw.placeholder === "string" ? { placeholder: raw.placeholder } : {}),
    };
  });
}

const sourceTypes = ["official", "book", "course", "workshop", "event", "video", "tutorial", "article", "creator", "community", "practice", "template", "tool", "other"] as const;

function normalizeSourceType(value: unknown) {
  if (typeof value !== "string") return value;
  const text = value.replace(/\\"/g, '"').trim().toLowerCase();
  if (sourceTypes.includes(text as (typeof sourceTypes)[number])) return text;
  // DeepSeek occasionally emits the enum declaration itself as a string,
  // e.g. `"official"|"course"|...`. Keep the resource usable by selecting
  // the first recognized category instead of rejecting the whole roadmap.
  const matches = text.match(/official|book|course|workshop|event|video|tutorial|article|creator|community|practice|template|tool|other/g) || [];
  return matches.length === 1 ? matches[0] : "other";
}

export const RoadmapResourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  sourceType: z.preprocess(normalizeSourceType, z.enum(sourceTypes)),
  provider: z.string(),
  access: z.string(),
  whyRecommended: z.string(),
  howToUse: z.string(),
});
export type RoadmapResource = z.infer<typeof RoadmapResourceSchema>;

const RoadmapToolSchema = z.object({
  name: z.string(),
  url: z.string().default(""),
  provider: z.string().default(""),
  whyRecommended: z.string().default(""),
  howToUse: z.string().default(""),
});
export type RoadmapTool = z.infer<typeof RoadmapToolSchema>;

function normalizeTools(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return { name: item };
    if (!item || typeof item !== "object") return item;
    const raw = item as Record<string, unknown>;
    return {
      name: typeof raw.name === "string" ? raw.name : typeof raw.title === "string" ? raw.title : "",
      url: typeof raw.url === "string" ? raw.url : "",
      provider: typeof raw.provider === "string" ? raw.provider : "",
      whyRecommended: typeof raw.whyRecommended === "string" ? raw.whyRecommended : typeof raw.purpose === "string" ? raw.purpose : "",
      howToUse: typeof raw.howToUse === "string" ? raw.howToUse : "",
    };
  }).filter((item) => item && typeof item === "object" && "name" in item && Boolean((item as { name?: unknown }).name));
}

export const RoadmapStepSchema = z.object({
  title: z.string(),
  duration: z.string(),
  why: z.string().default(""),
  what: z.string(),
  how: z.string(),
  // Kept for persisted V0 roadmaps; new plans should use resources instead.
  resource: z.string().default(""),
  resources: z.array(RoadmapResourceSchema).default([]),
  tools: z.preprocess(normalizeTools, z.array(RoadmapToolSchema).default([])),
  // Kept as a text fallback for older model responses and saved projects.
  tool: z.string().default(""),
  estimatedTime: z.string(),
  input: z.string().default(""),
  output: z.string().default(""),
  acceptanceCriteria: z.string().default(""),
  dependencies: z.array(z.string()).default([]),
});
export type RoadmapStep = z.infer<typeof RoadmapStepSchema>;

const AgentPhaseSchema = z.enum(["discovery", "research", "plan"]);

function normalizeAgentPhase(value: unknown, roadmap: unknown): "discovery" | "research" | "plan" {
  if (typeof value === "string") {
    const phase = value.replace(/\\"/g, '"').trim().replace(/^['"\s]+|['"\s]+$/g, "").toLowerCase();
    if (phase === "discovery" || phase === "research" || phase === "plan") return phase;
    const declaredPhases = phase.replace(/[\\"'\s]/g, "").split("|");
    if (declaredPhases.includes("plan") && Array.isArray(roadmap) && roadmap.length > 0) return "plan";
    if (declaredPhases.includes("research") && !declaredPhases.includes("discovery")) return "research";
    if (declaredPhases.includes("discovery")) return "discovery";
    if (["planning", "roadmap", "route"].includes(phase)) return "plan";
    if (["search", "searching", "researching"].includes(phase)) return "research";
    if (["discover", "exploring", "exploration"].includes(phase)) return "discovery";
  }
  // Preserve a completed, validated route if the model only misspelled its
  // phase label. Without a route, recover to discovery so the user can retry.
  return Array.isArray(roadmap) && roadmap.length > 0 ? "plan" : "discovery";
}

const AgentReplyObjectSchema = z.object({
  assistantMessage: z.string(),
  goalState: GoalStateSchema,
  questions: z.preprocess(normalizeQuestions, z.array(GoalQuestionSchema).max(1).default([])),
  roadmap: z.array(RoadmapStepSchema).optional(),
  phase: AgentPhaseSchema,
});
export const AgentReplySchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const reply = value as Record<string, unknown>;
  return { ...reply, phase: normalizeAgentPhase(reply.phase, reply.roadmap) };
}, AgentReplyObjectSchema);
export type AgentReply = z.infer<typeof AgentReplySchema>;

export function normalizeRoadmap(reply: AgentReply): AgentReply {
  if (!reply.roadmap) return reply;
  return {
    ...reply,
    roadmap: reply.roadmap.map((step) => ({
      ...step,
      resources: step.resources.length > 0 ? step.resources : [],
    })),
  };
}

export const fields = [
  { key: "purpose", label: "最终目的", weight: 20 },
  { key: "deadline", label: "时间节点", weight: 15 },
  { key: "currentLevel", label: "当前基础", weight: 20 },
  { key: "weeklyTime", label: "可投入时间", weight: 15 },
  { key: "preferences", label: "学习偏好", weight: 10 },
  { key: "constraints", label: "资源与限制", weight: 8 },
  { key: "successCriteria", label: "验收标准", weight: 12 },
] as const;

export function readiness(state: GoalState) {
  const known = fields.filter(({ key }) => Boolean(state[key].trim()));
  const score = Math.min(100, known.reduce((sum, { weight }) => sum + weight, 0) + (state.goal ? 12 : 0));
  return { score, known: known.length, total: fields.length, missing: fields.filter(({ key }) => !state[key].trim()) };
}

export const emptyGoalState = (): GoalState => ({
  goal: "", purpose: "", deadline: "", currentLevel: "", weeklyTime: "", preferences: "", constraints: "", successCriteria: "",
});
