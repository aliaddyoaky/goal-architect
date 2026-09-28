import { fields, readiness, type AgentReply, type GoalQuestion, type GoalState, type RoadmapStep } from "@/lib/schema";

const questionSpecs: Record<string, GoalQuestion> = {
  purpose: { id: "purpose", text: "你最终想用这个目标完成什么？", type: "single", options: ["求职或升学", "工作能力提升", "完成一个项目", "比赛或证书", "兴趣与系统学习"].map((label) => ({ value: label, label })) },
  deadline: { id: "deadline", text: "你希望什么时候看到结果？", type: "single", options: ["1个月内", "3个月内", "6个月内", "一年内", "还没有明确时间"].map((label) => ({ value: label, label })) },
  currentLevel: { id: "currentLevel", text: "你现在大概处在哪个起点？", type: "single", options: ["完全零基础", "接触过，但没有系统学过", "能完成基础练习", "已经做过相关项目", "有工作或专业经验"].map((label) => ({ value: label, label })) },
  weeklyTime: { id: "weeklyTime", text: "每周能稳定投入多少时间？", type: "single", options: ["1–3小时", "4–7小时", "8–12小时", "13–20小时", "20小时以上"].map((label) => ({ value: label, label })) },
  preferences: { id: "preferences", text: "你更愿意用哪些方式推进？可多选。", type: "multi", options: ["视频课程", "书籍或文章", "动手项目", "刷题或练习", "有人带着做"].map((label) => ({ value: label, label })) },
  constraints: { id: "constraints", text: "哪些条件需要被纳入路线？可多选。", type: "multi", options: ["预算有限", "只能使用现有设备", "中文资源优先", "时间不固定", "技术栈不能更换"].map((label) => ({ value: label, label })) },
  successCriteria: { id: "successCriteria", text: "做到什么程度，你会认为这个目标达成？", type: "text", options: [], placeholder: "例如：能独立完成一个项目，或通过某类面试" },
};

function updateState(state: GoalState, answer: string): GoalState {
  const next = { ...state };
  const isInitialGoal = !next.goal;
  if (isInitialGoal) next.goal = answer.trim().slice(0, 90);
  const missing = fields.filter(({ key }) => !next[key].trim());
  const first = missing[0];
  if (first && !isInitialGoal) next[first.key] = answer.trim();
  // Allow users to volunteer details early; distribute by recognizable phrases.
  const lower = answer.toLowerCase();
  const assign = (key: keyof GoalState, patterns: RegExp[]) => {
    if (!next[key] && patterns.some((p) => p.test(lower))) next[key] = answer.trim();
  };
  assign("deadline", [/\b(month|week|year|day|by\s\d|deadline|within)\b/, /个月|周|年|截止|之前|以内/]);
  assign("weeklyTime", [/\b(hours?|hrs?)\b/, /每天|每周|小时|h\/day|h\/week/]);
  assign("currentLevel", [/\b(beginner|intermediate|advanced|experience|level|know|learned)\b/, /基础|学过|做过|不会|熟悉|入门/]);
  assign("preferences", [/\b(video|book|course|project|practice|chinese|english)\b/, /视频|书|课程|项目|练习|中文|英文/]);
  assign("constraints", [/\b(budget|laptop|computer|limited|free|paid)\b/, /预算|电脑|设备|限制|免费|付费/]);
  assign("successCriteria", [/\b(pass|finish|build|complete|score|achieve)\b/, /通过|完成|做出|达到|验收/]);
  return next;
}

function buildRoadmap(state: GoalState): RoadmapStep[] {
  const topic = state.goal || "这个目标";
  return [
    { title: "打好起点：建立可执行的基础", duration: "第 1–2 周", why: `先用小任务验证你对「${topic}」的当前理解，避免一上来就投入不合适的材料。`, what: "拆出 3 个最关键的基础能力，完成一次起点练习。", how: "选择一份入门材料；每次学习后用自己的话复述，并记录卡点。", resource: "优先使用官方文档或课程的入门章节；演示模式建议从免费公开资源开始。", resources: [], tools: [], tool: "笔记工具 + 日历；按你的偏好选择视频或文字材料。", estimatedTime: state.weeklyTime || "每周约 4–6 小时", input: "当前基础与每周可投入时间", output: "一份基础清单和起点记录", acceptanceCriteria: "能独立解释 3 个核心概念，并完成 1 个入门练习。", dependencies: [] },
    { title: "刻意练习：把知识变成能力", duration: "第 3–6 周", why: "稳定练习和及时反馈能暴露真正的薄弱点，让后续投入更有针对性。", what: "围绕最重要的子技能做 2–3 轮练习与复盘。", how: "每次练习先独立尝试；卡住后查资料；最后写下可复用的方法和错误原因。", resource: "对应领域的练习集、公开课程作业或真实案例。", resources: [], tools: [], tool: "任务清单、计时器、版本记录或错题/复盘笔记。", estimatedTime: state.weeklyTime || "每周约 5–7 小时", input: "基础清单与练习反馈", output: "可展示的练习成果和复盘记录", acceptanceCriteria: "连续完成至少 5 次练习；能说清每次的思路、结果与改进点。", dependencies: ["打好起点：建立可执行的基础"] },
    { title: "整合应用：完成一个真实成果", duration: "第 7 周起", why: "真实交付能检验知识是否迁移到独立解决问题，而不只是看懂材料。", what: `完成一个与「${topic}」直接相关的小型成果，并对照验收标准复盘。`, how: "把成果拆成一周内可完成的小任务；先交付最小版本，再根据反馈迭代。", resource: "选择一个和你的目标场景相近的公开案例作为参照。", resources: [], tools: [], tool: "与成果类型匹配的工具；用清单跟踪验收项。", estimatedTime: state.weeklyTime || "每周约 5–8 小时", input: "练习成果、真实场景或案例", output: "一个可演示、可复核的最终成果", acceptanceCriteria: state.successCriteria || "成果能独立完成，并由目标场景中的一位他人按标准复核。", dependencies: ["刻意练习：把知识变成能力"] },
  ];
}

export function demoReply(state: GoalState, message: string, action: "message" | "plan" | "revise" = "message", currentRoadmap: RoadmapStep[] | null = null): AgentReply {
  if (action === "revise" && currentRoadmap?.length) {
    return {
      assistantMessage: "演示引擎已保留现有路线。接入 DeepSeek Harness 后，会按你的修改要求重新研究受影响的步骤并返回完整路线。",
      goalState: state,
      questions: [],
      roadmap: currentRoadmap,
      phase: "plan",
    };
  }
  let nextState = action === "plan" ? state : updateState(state, message);
  if (action === "plan") nextState = { ...nextState, successCriteria: nextState.successCriteria || "完成一个可演示的成果，并由目标场景中的他人复核。" };
  const { score, missing } = readiness(nextState);
  const canPlan = score >= 72 && !missing.some(({ key }) => ["purpose", "currentLevel", "weeklyTime"].includes(key));
  if (action === "plan" || canPlan) {
    return {
      assistantMessage: "信息已经足够先做出一版路线。我会把你的时间、基础和偏好带入计划；每一步都可以继续调整。当前使用演示资源建议，接入实时研究后可替换为已核验链接。",
      goalState: nextState,
      questions: [],
      roadmap: buildRoadmap(nextState),
      phase: "plan",
    };
  }
  const ask = missing.length ? [questionSpecs[missing[0].key]] : [];
  const contextual = message.trim() ? "收到，我把这条信息记进你的目标档案了。" : "先从最影响路线的一件事开始。";
  return {
    assistantMessage: `${contextual} ${ask.length ? "接下来想确认：" : ""}`,
    goalState: nextState,
    questions: ask,
    phase: "discovery",
  };
}
