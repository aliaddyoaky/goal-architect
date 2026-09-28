"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Clock3, Compass, ExternalLink, FolderOpen, LockKeyhole, MessageCircle, Moon, Plus, Send, Sparkles, Square, Sun, Target, WandSparkles, Wrench } from "lucide-react";
import { emptyGoalState, fields, normalizeGoalState, readiness, type AgentReply, type GoalQuestion, type GoalState, type RoadmapStep } from "@/lib/schema";
import type { TraceEvent } from "@/lib/trace";

type ChatMessage = { role: "user" | "assistant"; content: string; questions?: GoalQuestion[]; trace?: TraceEvent[]; traceOpen?: boolean };
type RuntimeMode = "idle" | "dsh" | "demo";
type PersistedProject = {
  id: string;
  createdAt: number;
  projectName: string;
  messages: ChatMessage[];
  goalState: GoalState;
  roadmap: RoadmapStep[] | null;
  phase: "discovery" | "research" | "plan";
  mode: RuntimeMode;
  diagnostic: string;
  trace: TraceEvent[];
  savedAt: number;
};
const PROJECT_STORAGE_KEY = "goal-architect-project-v1";
const PROJECTS_STORAGE_KEY = "goal-architect-projects-v1";
const CURRENT_PROJECT_KEY = "goal-architect-current-project";
const COLUMN_WIDTHS_KEY = "goal-architect-layout-v1";

// Keep implementation/provider names out of the product surface. Older
// projects may still contain the previous runtime label in saved messages or
// diagnostics, so sanitize at render time as well as updating new labels.
function cleanRuntimeBranding(value: string) {
  return value
    .replace(/DeepSeek\s+Harness/gi, "智能运行时")
    .replace(/\bDSH\b/gi, "LIVE");
}

function newProject(): PersistedProject {
  const now = Date.now();
  return { id: `project-${now}-${Math.random().toString(36).slice(2, 7)}`, createdAt: now, projectName: "新项目", messages: [greeting], goalState: emptyGoalState(), roadmap: null, phase: "discovery", mode: "idle", diagnostic: "", trace: [], savedAt: now };
}
const greeting: ChatMessage = {
  role: "assistant",
  content: "你好，我是你的目标规划搭档。先告诉我你最近想实现什么，哪怕现在只是一个模糊的念头也没关系。",
};

const fieldNames: Record<string, string> = {
  purpose: "最终目的", deadline: "时间节点", currentLevel: "当前基础", weeklyTime: "投入时间",
  preferences: "学习偏好", constraints: "资源与限制", successCriteria: "验收标准",
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);
  const [goalState, setGoalState] = useState<GoalState>(emptyGoalState());
  const [roadmap, setRoadmap] = useState<RoadmapStep[] | null>(null);
  const [phase, setPhase] = useState<"discovery" | "research" | "plan">("discovery");
  const [mode, setMode] = useState<RuntimeMode>("idle");
  const [diagnostic, setDiagnostic] = useState("");
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [traceOpen, setTraceOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [projectName, setProjectName] = useState("新项目");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [restoredProject, setRestoredProject] = useState(false);
  const [projects, setProjects] = useState<PersistedProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [openRoadmapStep, setOpenRoadmapStep] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ side: "chat" | "state"; startX: number; startWidth: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const projectsRef = useRef<PersistedProject[]>([]);
  const { score, known, total, missing } = readiness(goalState);
  const readyToPlan = score >= 72 && !missing.some(({ key }) => ["purpose", "currentLevel", "weeklyTime"].includes(key));
  const lastAssistantIndex = messages.reduce((latest, message, index) => message.role === "assistant" ? index : latest, -1);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    setOpenRoadmapStep(0);
  }, [roadmap]);

  useEffect(() => {
    const stored = window.localStorage.getItem("goal-architect-theme");
    const next = stored === "dark" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLUMN_WIDTHS_KEY);
      if (!saved || !shellRef.current) return;
      const widths = JSON.parse(saved) as { chat?: number; state?: number };
      if (Number.isFinite(widths.chat)) shellRef.current.style.setProperty("--chat-width", `${widths.chat}px`);
      if (Number.isFinite(widths.state)) shellRef.current.style.setProperty("--state-width", `${widths.state}px`);
    } catch {
      // Ignore malformed layout preferences and keep the default column sizes.
    }
  }, []);

  function setColumnWidth(side: "chat" | "state", width: number) {
    const shell = shellRef.current;
    if (!shell) return;
    const otherWidth = Number.parseFloat(getComputedStyle(shell).getPropertyValue(side === "chat" ? "--state-width" : "--chat-width")) || (side === "chat" ? 320 : 360);
    const usable = shell.clientWidth;
    const max = side === "chat" ? Math.max(300, Math.min(540, usable - otherWidth - 480)) : Math.max(270, Math.min(440, usable - otherWidth - 480));
    const min = side === "chat" ? 300 : 270;
    const next = Math.round(Math.max(min, Math.min(max, width)));
    shell.style.setProperty(side === "chat" ? "--chat-width" : "--state-width", `${next}px`);
  }

  function beginColumnResize(side: "chat" | "state", event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const shell = shellRef.current;
    if (!shell) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const variable = side === "chat" ? "--chat-width" : "--state-width";
    const fallback = side === "chat" ? 360 : 320;
    resizeRef.current = { side, startX: event.clientX, startWidth: Number.parseFloat(getComputedStyle(shell).getPropertyValue(variable)) || fallback };
    shell.dataset.resizing = side;
  }

  function moveColumnResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    setColumnWidth(drag.side, drag.startWidth + (drag.side === "chat" ? delta : -delta));
  }

  function finishColumnResize() {
    const shell = shellRef.current;
    if (!shell || !resizeRef.current) return;
    resizeRef.current = null;
    delete shell.dataset.resizing;
    const styles = getComputedStyle(shell);
    window.localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify({
      chat: Number.parseFloat(styles.getPropertyValue("--chat-width")) || 360,
      state: Number.parseFloat(styles.getPropertyValue("--state-width")) || 320,
    }));
  }

  function adjustColumnWidth(side: "chat" | "state", event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const shell = shellRef.current;
    if (!shell) return;
    const variable = side === "chat" ? "--chat-width" : "--state-width";
    const current = Number.parseFloat(getComputedStyle(shell).getPropertyValue(variable)) || (side === "chat" ? 360 : 320);
    const delta = event.key === "ArrowLeft" ? -24 : event.key === "ArrowRight" ? 24 : event.key === "Home" ? -1000 : 1000;
    setColumnWidth(side, current + delta);
    finishColumnResize();
  }

  useEffect(() => {
    try {
      const rawProjects = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
      const oldRaw = window.localStorage.getItem(PROJECT_STORAGE_KEY);
      let storedProjects: PersistedProject[] = rawProjects ? JSON.parse(rawProjects) as PersistedProject[] : [];
      if (!Array.isArray(storedProjects)) storedProjects = [];
      let keptBlankProject = false;
      storedProjects = storedProjects.filter((project) => {
        const isBlank = project.projectName === "新项目" && project.messages?.length === 1 && !project.goalState?.goal && !project.roadmap;
        if (!isBlank) return true;
        if (keptBlankProject) return false;
        keptBlankProject = true;
        return true;
      });
      if (storedProjects.length === 0 && oldRaw) {
        const saved = JSON.parse(oldRaw) as Partial<PersistedProject>;
        if (Array.isArray(saved.messages) && saved.goalState && (Array.isArray(saved.roadmap) || saved.roadmap === null)) {
          const migrated = newProject();
          storedProjects = [{ ...migrated, ...saved, id: migrated.id, createdAt: typeof saved.createdAt === "number" ? saved.createdAt : migrated.createdAt } as PersistedProject];
        }
      }
      if (storedProjects.length === 0) storedProjects = [newProject()];
      const hashProjectId = window.location.hash.startsWith("#project=") ? decodeURIComponent(window.location.hash.slice("#project=".length)) : "";
      const current = storedProjects.find((project) => project.id === hashProjectId) || [...storedProjects].sort((a, b) => (b.savedAt || b.createdAt || 0) - (a.savedAt || a.createdAt || 0))[0] || storedProjects[0];
      if (current) {
        const saved = current;
        const savedMessages = [...saved.messages];
        if (saved.goalState && (Array.isArray(saved.roadmap) || saved.roadmap === null)) {
          const hasLegacyNullError = typeof saved.diagnostic === "string" && saved.diagnostic.includes("goalState") && saved.diagnostic.includes("received null");
          if (hasLegacyNullError) {
            const lastAssistantIndex = savedMessages.reduce((latest, message, index) => message.role === "assistant" ? index : latest, -1);
            if (lastAssistantIndex >= 0 && savedMessages[lastAssistantIndex].content.includes("DeepSeek Harness 这次没有完成请求")) {
              savedMessages[lastAssistantIndex] = {
                ...savedMessages[lastAssistantIndex],
                content: "上次请求使用了旧版目标字段格式，已自动修复。你可以点击下方按钮重新生成路线，或继续补充目标信息。",
              };
            }
          }
          const legacyTrace = Array.isArray(saved.trace) ? saved.trace : [];
          const lastAssistantIndex = savedMessages.reduce((latest, message, index) => message.role === "assistant" ? index : latest, -1);
          if (legacyTrace.length > 0 && lastAssistantIndex >= 0 && !savedMessages[lastAssistantIndex].trace?.length) {
            savedMessages[lastAssistantIndex] = { ...savedMessages[lastAssistantIndex], trace: legacyTrace, traceOpen: false };
          }
          setMessages(savedMessages);
          setGoalState(normalizeGoalState(saved.goalState));
          setRoadmap(saved.roadmap);
          if (saved.phase === "discovery" || saved.phase === "research" || saved.phase === "plan") setPhase(saved.phase);
          if (saved.mode === "idle" || saved.mode === "dsh" || saved.mode === "demo") setMode(hasLegacyNullError ? "idle" : saved.mode);
          setDiagnostic(hasLegacyNullError ? "" : typeof saved.diagnostic === "string" ? saved.diagnostic : "");
          setTrace([]);
          setProjectName(typeof saved.projectName === "string" && saved.projectName ? saved.projectName : "新项目");
          setLastSavedAt(typeof saved.savedAt === "number" ? saved.savedAt : Date.now());
          setRestoredProject(Boolean(rawProjects || oldRaw));
        }
        setCurrentProjectId(current.id);
      }
      projectsRef.current = storedProjects;
      setProjects(storedProjects);
      window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(storedProjects));
      window.localStorage.setItem(CURRENT_PROJECT_KEY, current.id);
    } catch {
      window.localStorage.removeItem(PROJECT_STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const savedAt = Date.now();
    const snapshot: PersistedProject = { id: currentProjectId, createdAt: projectsRef.current.find((project) => project.id === currentProjectId)?.createdAt || savedAt, projectName, messages, goalState, roadmap, phase, mode, diagnostic, trace, savedAt };
    setProjects((current) => {
      const next = current.some((project) => project.id === currentProjectId) ? current.map((project) => project.id === currentProjectId ? snapshot : project) : [snapshot, ...current];
      projectsRef.current = next;
      window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(snapshot));
    setLastSavedAt(savedAt);
  }, [hydrated, currentProjectId, projectName, messages, goalState, roadmap, phase, mode, diagnostic, trace]);

  useEffect(() => {
    if (goalState.goal && projectName === "新项目") setProjectName(goalState.goal.slice(0, 28));
  }, [goalState.goal, projectName]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("goal-architect-theme", next);
  }

  async function submit(text: string, action: "message" | "plan" = "message") {
    if (busy || (!text.trim() && action !== "plan")) return;
    const effectiveAction = roadmap && action === "message" ? "revise" : action;
    const updated = effectiveAction !== "plan" ? [...messages, { role: "user" as const, content: text.trim() }] : messages;
    if (effectiveAction !== "plan") {
      setMessages(updated);
      if (effectiveAction === "message") {
        if (roadmap) setRoadmap(null);
        if (phase === "plan") setPhase("discovery");
      } else {
        setPhase("research");
      }
    }
    setInput(""); setBusy(true); setError(""); setDiagnostic(""); setTrace([]); setTraceOpen(true);
    if (action === "plan") { setPhase("research"); setRoadmap(null); }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const safeGoalState = normalizeGoalState(goalState);
      const response = await fetch("/api/agent/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalState: safeGoalState, roadmap, messages: updated.map(({ role, content }) => ({ role, content })), action: effectiveAction }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "请求失败，请重试");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("浏览器不支持实时运行记录，请刷新后重试。");
      const decoder = new TextDecoder();
      let buffer = "";
      let liveTrace: TraceEvent[] = [];
      let result: { reply: AgentReply; mode: Exclude<RuntimeMode, "idle">; diagnostic?: string } | undefined;
      const consume = (block: string) => {
        const eventName = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
        const payloadText = block.match(/^data:\s*(.+)$/m)?.[1];
        if (!eventName || !payloadText) return;
        const payload = JSON.parse(payloadText) as unknown;
        if (eventName === "trace") {
          liveTrace = [...liveTrace, payload as TraceEvent];
          setTrace(liveTrace);
        }
        if (eventName === "result") result = payload as typeof result;
        if (eventName === "error") throw new Error((payload as { error?: string }).error || "请求失败，请重试");
      };
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) if (block.trim()) consume(block);
        if (chunk.done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (!result) throw new Error("运行时没有返回最终结果，请查看运行记录后重试。");
      const finalResult = result;
      setGoalState(normalizeGoalState(finalResult.reply.goalState)); setPhase(finalResult.reply.phase); setMode(finalResult.mode);
      setDiagnostic(finalResult.diagnostic || "");
      setMessages((current) => [...current, { role: "assistant", content: finalResult.reply.assistantMessage, questions: finalResult.reply.questions, trace: liveTrace, traceOpen: false }]);
      if (finalResult.reply.roadmap?.length) setRoadmap(finalResult.reply.roadmap);
      else if (effectiveAction === "revise" && roadmap) setRoadmap(roadmap);
      setTrace([]); setTraceOpen(false);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") setError("本次运行已停止。已保留当前目标信息，可以继续补充或重新规划。");
      else setError(cause instanceof Error ? cause.message : "暂时无法连接，请重试。");
      if (effectiveAction === "plan") setPhase("discovery");
      if (effectiveAction === "revise" && roadmap) setPhase("plan");
      setTraceOpen(false);
    } finally { abortRef.current = null; setBusy(false); }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function toggleMessageTrace(index: number) {
    setMessages((current) => current.map((message, messageIndex) => messageIndex === index ? { ...message, traceOpen: !message.traceOpen } : message));
  }

  function selectProject(id: string) {
    const project = projectsRef.current.find((item) => item.id === id);
    if (!project || project.id === currentProjectId) {
      setProjectMenuOpen(false);
      return;
    }
    abortRef.current?.abort();
    const selectedAt = Date.now();
    const nextProjects = projectsRef.current.map((item) => item.id === project.id ? { ...item, savedAt: selectedAt } : item);
    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(nextProjects));
    window.localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#project=${encodeURIComponent(project.id)}`);
    setCurrentProjectId(project.id);
    setProjectName(project.projectName || "新项目");
    setMessages(project.messages?.length ? project.messages : [greeting]);
    setGoalState(normalizeGoalState(project.goalState));
    setRoadmap(project.roadmap || null);
    setPhase(project.phase || "discovery");
    setMode(project.mode || "idle");
    setDiagnostic(project.diagnostic || "");
    setTrace([]); setTraceOpen(false); setError(""); setInput(""); setBusy(false);
    setLastSavedAt(selectedAt); setRestoredProject(true); setProjectMenuOpen(false);
  }

  function startNewProject() {
    abortRef.current?.abort();
    const project = newProject();
    projectsRef.current = [project, ...projectsRef.current.filter((item) => item.id !== project.id)];
    setProjects(projectsRef.current);
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projectsRef.current));
    window.localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#project=${encodeURIComponent(project.id)}`);
    setCurrentProjectId(project.id); setProjectName(project.projectName); setMessages(project.messages); setGoalState(project.goalState); setRoadmap(null); setPhase("discovery"); setMode("idle"); setDiagnostic(""); setTrace([]); setTraceOpen(false); setError(""); setInput(""); setBusy(false); setLastSavedAt(project.savedAt); setRestoredProject(false); setProjectMenuOpen(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("message");
    const value = field instanceof HTMLTextAreaElement ? field.value : input;
    void submit(value);
  }

  function reset() {
    startNewProject();
  }

  return (
    <main className={`min-h-screen app-root ${roadmap ? "has-roadmap-root" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#" aria-label="Goal Architect 首页"><span className="brand-mark"><Compass size={18} strokeWidth={1.8} /></span><span>goal<span className="brand-light">architect</span></span></a>
        <div className="topbar-center"><span className="status-dot" /> {mode === "idle" ? "等待首次连接" : mode === "demo" ? "演示模式" : "智能运行已连接"}<span className="topbar-divider">/</span><button className="project-switcher" type="button" onClick={() => setProjectMenuOpen((open) => !open)} aria-expanded={projectMenuOpen}><FolderOpen size={12} /> <span className="project-chip">PROJECT · {projectName}</span><ChevronDown size={12} /></button>{lastSavedAt && <span className="save-state">{restoredProject ? "已恢复" : "已保存"} · {new Date(lastSavedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>}</div>
        {projectMenuOpen && <div className="project-menu"><div className="project-menu-head"><span>PROJECTS</span><button type="button" onClick={startNewProject}><Plus size={13} /> 新项目</button></div><div className="project-menu-list">{projects.map((project) => <button key={project.id} type="button" className={`project-menu-item ${project.id === currentProjectId ? "active" : ""}`} onClick={() => selectProject(project.id)}><span className="project-menu-mark">{project.id === currentProjectId ? "●" : "○"}</span><span className="project-menu-copy"><strong>{project.projectName || "新项目"}</strong><small>{project.roadmap?.length ? `${project.roadmap.length} 个阶段` : "探索中"} · {new Date(project.savedAt || project.createdAt).toLocaleDateString("zh-CN")}</small></span></button>)}</div></div>}
        <div className="topbar-actions"><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`切换到${theme === "light" ? "深色" : "浅色"}主题`}><span className={theme === "light" ? "active" : ""}><Sun size={13} /></span><span className={theme === "dark" ? "active" : ""}><Moon size={13} /></span></button><button className="new-project-button" type="button" onClick={startNewProject}><Plus size={13} /> 新项目</button></div>
      </header>

      <div ref={shellRef} className={`app-shell ${roadmap ? "has-roadmap" : ""}`}>
        <section className="chat-column">
          <div className="workspace-heading">
            <div className="eyebrow"><Sparkles size={13} /> YOUR PERSONAL PATHFINDER</div>
            <h1>把一个念头，变成一条<span>走得通的路。</span></h1>
            <p>先聊清楚你真正想实现什么，再一起把它拆成今天就能开始的行动。</p>
          </div>

          <div className="conversation-card">
            <div className="conversation-topline"><div className="agent-avatar"><WandSparkles size={16} /></div><div><strong>Goal Architect</strong><span>目标探索搭档</span></div><div className="session-tag"><span className="status-dot" /> {phase === "discovery" ? "正在了解你的目标" : phase === "research" ? "正在查找资源" : "路线已准备好"}</div></div>
            <div ref={scrollRef} className="conversation-scroll" aria-live="polite">
              {messages.map((message, index) => <div className={`message-row ${message.role} ${index === lastAssistantIndex ? "latest" : "history"}`} key={`${index}-${message.role}`}>
                {message.role === "assistant" && <div className="message-avatar"><WandSparkles size={13} /></div>}
                <div className="message-content">
                  {message.role === "assistant" && message.trace?.length ? <TracePanel events={message.trace} open={message.traceOpen === true} busy={false} onToggle={() => toggleMessageTrace(index)} /> : null}
                  <div className="bubble">{message.role === "assistant" ? cleanRuntimeBranding(message.content) : message.content}</div>
                  {message.questions?.map((question) => <QuestionCard key={question.id} question={question} disabled={busy} onAnswer={(answer) => void submit(`${question.text}\n我的选择：${answer}`)} />)}
                </div>
              </div>)}
              {trace.length > 0 && <TracePanel events={trace} open={traceOpen} busy={busy} onToggle={() => setTraceOpen((value) => !value)} />}
              {busy && <div className="message-row assistant"><div className="message-avatar"><WandSparkles size={13} /></div><div className="bubble typing"><span /><span /><span /></div></div>}
              {error && <div className="error-note"><CircleHelp size={15} /> {cleanRuntimeBranding(error)}</div>}
              {diagnostic && <div className="error-note"><CircleHelp size={15} /> 运行时诊断：{cleanRuntimeBranding(diagnostic)}</div>}
              {roadmap && <div className="roadmap-intro"><div className="roadmap-intro-icon"><Target size={18} /></div><div><strong>你的第一版路线已经就绪</strong><span>{roadmap.length} 个阶段 · 可随时根据新信息调整</span></div></div>}
            </div>
            <div className="composer-wrap">
              {readyToPlan && !roadmap && phase === "discovery" && <button className="plan-nudge" onClick={() => void submit("", "plan")} disabled={busy}><WandSparkles size={15} /> 信息已足够，生成我的路线 <ArrowRight size={14} /></button>}
              <form className="composer" onSubmit={onSubmit}>
                <textarea ref={inputRef} name="message" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(e.currentTarget.value); } }} placeholder={roadmap ? "告诉 Agent 要修改哪一步、周期、资源或验收标准…" : goalState.goal ? "分享一点背景，或回答上面的问题…" : "比如：我想学会算法、准备转行、完成一次长途徒步…"} rows={2} disabled={busy} aria-label={roadmap ? "修改行动路线" : "补充目标信息"} />
                <div className="composer-bottom"><span>{busy ? <span className="composer-running"><span className="running-dot" /> 正在运行 · 可随时停止</span> : <><kbd>↵</kbd> 发送 <span className="composer-hint">· Shift + ↵ 换行</span></>}</span>{busy ? <button className="send-button stop-button" type="button" onClick={stop} aria-label="停止运行"><Square size={13} fill="currentColor" /></button> : <button className="send-button" type="button" onClick={(event) => { const field = event.currentTarget.form?.elements.namedItem("message"); void submit(field instanceof HTMLTextAreaElement ? field.value : input); }} aria-label="发送" disabled={!input.trim()}><Send size={16} /></button>}</div>
              </form>
              <div className="privacy-note"><LockKeyhole size={11} /> 你的目标只用于生成本次路线</div>
            </div>
          </div>
          <div className="below-note"><span>从模糊开始也可以</span><ArrowDown size={14} /><span>逐步补齐关键信息</span><ArrowDown size={14} /><span>拿到可执行的下一步</span></div>
        </section>
        {roadmap && <div className="column-resizer chat-resizer" role="separator" aria-label="调整对话栏宽度" aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => beginColumnResize("chat", event)} onPointerMove={moveColumnResize} onPointerUp={finishColumnResize} onPointerCancel={finishColumnResize} onKeyDown={(event) => adjustColumnWidth("chat", event)} />}

        <aside className="state-column">
          <div className="state-header"><div><div className="eyebrow"><span className="live-pip" /> LIVE GOAL STATE</div><h2>目标档案</h2></div><button className="icon-button" title="目标状态会随对话更新"><CircleHelp size={16} /></button></div>
          <div className="readiness-card">
            <div className="readiness-label"><span>路线就绪度</span><span className="readiness-count">{known}<i> / {total} 项</i></span></div>
            <div className="readiness-number">{score}<small>%</small></div>
            <div className="progress-track" aria-label={`路线就绪度 ${score}%`}>{Array.from({ length: 10 }, (_, index) => <i key={index} className={index < Math.ceil(score / 10) ? "filled" : ""} />)}</div>
            <div className="readiness-caption">{roadmap ? "已生成路线 · 可以继续微调" : readyToPlan ? "信息足够 · 可以开始规划" : "继续对话，让路线更贴合你"}</div>
          </div>

          <div className="goal-card"><div className="goal-card-label"><Target size={14} /> 你想实现</div><div className={`goal-text ${!goalState.goal ? "muted" : ""}`}>{goalState.goal || "等你说出第一个念头…"}</div><div className="phase-track"><div className={`phase-item ${phase === "discovery" ? "active" : "done"}`}><span>{phase === "discovery" ? "01" : <Check size={12} />}</span>探索</div><i /><div className={`phase-item ${phase === "research" ? "active" : phase === "plan" ? "done" : ""}`}><span>{phase === "plan" ? <Check size={12} /> : "02"}</span>研究</div><i /><div className={`phase-item ${phase === "plan" ? "active" : ""}`}><span>03</span>规划</div></div></div>

          <div className="section-heading"><span>关键信息</span><span className="section-hint">对话中自动提取</span></div>
          <div className="state-list">{fields.map(({ key, label }) => {
            const value = goalState[key];
            return <div className={`state-row ${value ? "filled" : ""}`} key={key}><div className="state-icon">{value ? <Check size={13} /> : <span />}</div><div className="state-detail"><span>{label}</span><p>{value || "待了解"}</p></div>{value && <span className="captured">已记录</span>}</div>;
          })}</div>

          {!roadmap && <div className="next-step-card"><div className="next-icon"><MessageCircle size={16} /></div><div><strong>{readyToPlan ? "可以开始规划了" : "下一步"}</strong><p>{readyToPlan ? "点击聊天区的按钮，生成你的专属路线。" : missing[0] ? `了解「${fieldNames[missing[0].key]}」后，路线会更具体。` : "继续分享信息，路线会越来越清晰。"}</p></div><ArrowUpRight size={14} className="next-arrow" /></div>}
          <div className="mode-note">{mode === "idle" ? <><span className="mode-badge">READY</span> 已配置运行时 · 发送第一条消息后检测连接</> : mode === "demo" ? <><span className="mode-badge">DEMO</span> 未完成真实请求 · 当前内容不代表已联网研究</> : <><span className="mode-badge live">LIVE</span> 智能研究运行中 · 可扩展工具与运行循环</>}</div>
        </aside>
        {roadmap && <><section className="roadmap-section" aria-labelledby="roadmap-heading"><div className="roadmap-section-head"><div><div className="eyebrow"><Target size={13} /> EXECUTION BLUEPRINT</div><h2 id="roadmap-heading">你的行动路线</h2><p>左侧切换阶段，右侧查看当前阶段的完整执行细节。</p></div><span className="route-count">{roadmap.length} 个阶段</span></div><RoadmapOverview roadmap={roadmap} /><div className="roadmap-grid"><RoadmapDirectory roadmap={roadmap} selected={openRoadmapStep} onSelect={setOpenRoadmapStep} /><div className="roadmap-focus">{openRoadmapStep >= 0 && roadmap[openRoadmapStep] ? <RoadmapCard step={roadmap[openRoadmapStep]} index={openRoadmapStep} expanded onToggle={() => setOpenRoadmapStep(-1)} /> : <div className="roadmap-focus-empty">从左侧目录选择一个阶段，查看它的目标、方法、资源与验收标准。</div>}</div></div></section><div className="column-resizer state-resizer" role="separator" aria-label="调整目标档案栏宽度" aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => beginColumnResize("state", event)} onPointerMove={moveColumnResize} onPointerUp={finishColumnResize} onPointerCancel={finishColumnResize} onKeyDown={(event) => adjustColumnWidth("state", event)} /></>}
      </div>
      <footer className="page-footer"><span>GOAL ARCHITECT <i>·</i> V0.1</span><span>From intention to action, one conversation at a time.</span></footer>
    </main>
  );
}

function RoadmapCard({ step, index, expanded, onToggle }: { step: RoadmapStep; index: number; expanded: boolean; onToggle: () => void }) {
  const [hoveredResourceUrl, setHoveredResourceUrl] = useState<string | null>(null);
  const resources = Array.isArray(step.resources) ? step.resources : [];
  const tools = Array.isArray(step.tools) && step.tools.length > 0
    ? step.tools
    : step.tool
      ? [{ name: step.tool, url: "", provider: "", whyRecommended: "", howToUse: "" }]
      : [];
  return <article className={`roadmap-card ${expanded ? "is-expanded" : "is-collapsed"}`}>
    <button className="roadmap-card-top" onClick={onToggle} aria-expanded={expanded}>
      <span className="step-number">0{index + 1}</span>
      <span className="step-title-wrap"><strong>{step.title}</strong><small><Clock3 size={11} /> {step.duration} · {step.estimatedTime}</small></span>
      <ChevronDown size={15} className={expanded ? "chevron-open" : ""} />
    </button>
    {expanded && <div className="step-body">
      <RoadmapField label="做什么" value={step.what} />
      <RoadmapField label="怎么做" value={step.how} />
      <div className="resource-list">
        <div className="resource-list-title"><ExternalLink size={12} /> 资源 · {resources.length}</div>
        {resources.length > 0 ? resources.map((resource) => <div className="resource-item-wrap" key={`${resource.url}-${resource.title}`} onMouseEnter={() => setHoveredResourceUrl(resource.url)} onMouseLeave={() => setHoveredResourceUrl(null)}>
          <a className="resource-item" href={resource.url} target="_blank" rel="noreferrer">
            <div className="resource-item-top"><ResourceLogo url={resource.url} /><span className="resource-title-block"><strong>{resource.title}</strong><span>{domainOf(resource.url)} · {resource.sourceType} · {resource.access}</span></span><ArrowUpRight size={12} /></div>
          </a>
          {hoveredResourceUrl === resource.url && <div className="resource-hover-preview resource-hover-text" role="tooltip" aria-label={`查看 ${resource.title} 的详细说明`}><div className="resource-hover-head"><strong>{resource.title}</strong><span>{domainOf(resource.url)}</span></div><p>{resource.whyRecommended || "这项资源与当前步骤相关。"}</p><small><b>怎么用</b>：{resource.howToUse || "打开资源后，按当前步骤完成对应练习。"}</small><a href={resource.url} target="_blank" rel="noreferrer">打开原页面 <ArrowUpRight size={11} /></a></div>}
        </div>) : <div className="resource-empty">这一步暂时没有核验到直接资源，请重新研究后再执行。</div>}
      </div>
      <div className="tool-list">
        <div className="resource-list-title"><Wrench size={12} /> 工具 · {tools.length}</div>
        {tools.length > 0 ? tools.map((tool, toolIndex) => <div className="tool-item" key={`${tool.name}-${toolIndex}`}>
          {tool.url ? <a href={tool.url} target="_blank" rel="noreferrer"><strong>{tool.name}</strong><ArrowUpRight size={12} /></a> : <strong>{tool.name}</strong>}
          {tool.provider && <span>{tool.provider}</span>}
          {tool.whyRecommended && <p>{tool.whyRecommended}</p>}
          {tool.howToUse && <small>怎么用：{tool.howToUse}</small>}
        </div>) : <div className="tool-empty">这一步不需要额外工具，按上面的步骤和资源完成即可。</div>}
      </div>
      <RoadmapResult output={step.output || "完成这一步后，应能展示一个可复核的成果。"} acceptance={step.acceptanceCriteria} />
    </div>}
  </article>;
}

function ResourceLogo({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const domain = domainOf(url);
  return <span className="resource-logo" aria-hidden="true">{failed ? domain.slice(0, 1).toUpperCase() : <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`} alt="" loading="lazy" onError={() => setFailed(true)} />}</span>;
}

function domainOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "resource"; }
}

function RoadmapDirectory({ roadmap, selected, onSelect }: { roadmap: RoadmapStep[]; selected: number; onSelect: (index: number) => void }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = () => { cancelClose(); setOpen(true); };
  const hide = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return <nav className="step-directory" aria-label="路线阶段目录" data-open={open}
    onPointerEnter={show} onPointerLeave={hide} onFocus={show}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) hide(); }}
    onKeyDown={(event) => { if (event.key === "Escape") { cancelClose(); setOpen(false); } }}>
    <div className="step-rail">
      {roadmap.map((step, index) => <button key={index} type="button" className="step-rail-target"
        aria-label={`第 ${index + 1} 步：${step.title}`} aria-expanded={open} aria-controls="step-directory-panel"
        aria-current={selected === index ? "step" : undefined} onClick={() => { onSelect(index); show(); }}>
        <span className="step-rail-bar" aria-hidden="true" /><span className="step-rail-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      </button>)}
    </div>
    <div className="step-directory-panel" id="step-directory-panel" hidden={!open}>
      {roadmap.map((step, index) => <button key={index} type="button" className="step-directory-row"
        aria-current={selected === index ? "step" : undefined} onClick={() => onSelect(index)}>
        <span className="step-directory-number">{String(index + 1).padStart(2, "0")}</span>
        <span className="step-directory-copy"><strong>{step.title}</strong><small>{step.duration}</small></span>
        <ArrowRight size={13} aria-hidden="true" />
      </button>)}
    </div>
  </nav>;
}

function RoadmapOverview({ roadmap }: { roadmap: RoadmapStep[] }) {
  const resourceCount = roadmap.reduce((total, step) => total + (Array.isArray(step.resources) ? step.resources.length : 0), 0);
  const weekRanges = roadmap.flatMap((step) => [...(step.duration || "").matchAll(/第\s*(\d+)\s*[–—-]\s*(\d+)\s*周/g)].map((match) => ({ start: Number(match[1]), end: Number(match[2]) })));
  const cycle = weekRanges.length ? `${Math.min(...weekRanges.map((range) => range.start))}–${Math.max(...weekRanges.map((range) => range.end))}周` : "待定";
  return <div className="route-overview"><div><strong>{roadmap.length}</strong><span>阶段</span></div><div><strong>{resourceCount}</strong><span>已核验资源</span></div><div><strong>{cycle}</strong><span>完成周期</span></div></div>;
}

function RoadmapField({ label, value }: { label: string; value: string }) {
  const steps = label === "怎么做" ? splitActionSteps(value) : [];
  return <div className={`roadmap-field ${steps.length > 1 ? "roadmap-field-sequence" : ""}`}><span>{label}</span>{steps.length > 1 ? <div className="action-sequence">{steps.map((step, index) => <div className="action-step" key={`${index}-${step}`}><span className="action-step-index">{String(index + 1).padStart(2, "0")}</span><p>{step}</p></div>)}</div> : <p>{value}</p>}</div>;
}

function RoadmapResult({ output, acceptance }: { output: string; acceptance?: string }) {
  const criteria = splitActionSteps(acceptance || "");
  return <div className="roadmap-result-field"><span>应该实现的结果</span><div className="result-visual"><div className="result-output"><span className="result-output-icon"><Check size={13} /></span><div><small>交付结果</small><p>{output}</p></div></div>{criteria.length > 0 && <div className="result-checklist"><div className="result-checklist-head"><span>完成判定</span><em>{criteria.length} 项</em></div>{criteria.map((criterion, index) => <div className="result-check" key={`${index}-${criterion}`}><span><Check size={11} /></span><p>{criterion}</p></div>)}</div>}</div></div>;
}

function splitActionSteps(value: string) {
  const marker = /(?:^|[；;]\s*)\d+\s*[)）.、]\s*/g;
  const matches = [...value.matchAll(marker)];
  if (matches.length > 1) {
    return matches.map((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = index + 1 < matches.length ? (matches[index + 1].index || value.length) : value.length;
      return value.slice(start, end).replace(/^[；;]\s*/, "").replace(/[；;]\s*$/, "").trim();
    }).filter(Boolean);
  }
  return value.split(/[；;]\s*/).map((part) => part.trim()).filter(Boolean);
}

function QuestionCard({ question, disabled, onAnswer }: { question: GoalQuestion; disabled: boolean; onAnswer: (answer: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [ordered, setOrdered] = useState(question.options);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setSelected([]);
    setOrdered(question.options);
    setSubmitted(false);
  }, [question.id]);

  if (question.type === "text") {
    return <div className="question-card question-text"><span className="question-card-label">需要你补充</span><strong>{question.text}</strong><small>{question.placeholder || "可以直接在下方输入框回答"}</small></div>;
  }

  const chooseSingle = (option: string) => {
    if (disabled || submitted) return;
    setSubmitted(true);
    onAnswer(option);
  };
  const toggleMulti = (option: string) => {
    if (disabled) return;
    setSelected((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option]);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length || disabled) return;
    setOrdered((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return <div className="question-card">
    <div className="question-card-heading"><span className="question-card-label">下一步只确认一件事</span><span className="question-type">{question.type === "single" ? "单选" : question.type === "multi" ? "多选" : "排序"}</span></div>
    <strong className="question-card-text">{question.text}</strong>
    {question.type === "ranking" ? <div className="ranking-options">{ordered.map((option, index) => <div className="ranking-option" key={option.value}><span className="rank-index">{index + 1}</span><span>{option.label}</span><span className="rank-actions"><button type="button" onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label="上移">↑</button><button type="button" onClick={() => move(index, 1)} disabled={disabled || index === ordered.length - 1} aria-label="下移">↓</button></span></div>)}<button className="question-confirm" type="button" disabled={disabled || submitted} onClick={() => { setSubmitted(true); onAnswer(ordered.map((option, index) => `${index + 1}. ${option.label}`).join("；")); }}>确认顺序 <ArrowRight size={13} /></button></div> : <div className="choice-options">{question.options.map((option) => <button className={`choice-option ${selected.includes(option.value) ? "selected" : ""}`} type="button" key={option.value} disabled={disabled || submitted} onClick={() => question.type === "single" ? chooseSingle(option.label) : toggleMulti(option.value)}><span className="choice-mark">{question.type === "multi" ? selected.includes(option.value) ? <Check size={12} /> : "" : ""}</span><span>{option.label}</span>{question.type === "single" && <ArrowRight size={12} />}</button>)}</div>}
    {question.type === "multi" && <button className="question-confirm" type="button" disabled={disabled || submitted || selected.length === 0} onClick={() => { setSubmitted(true); onAnswer(selected.map((value) => question.options.find((option) => option.value === value)?.label || value).join("、")); }}>确认选择 <ArrowRight size={13} /></button>}
  </div>;
}

function TracePanel({ events, open, busy, onToggle }: { events: TraceEvent[]; open: boolean; busy: boolean; onToggle: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const firstAt = events[0]?.at || Date.now();
  const lastAt = busy ? now : events.at(-1)?.at || firstAt;
  const seconds = Math.max(0, Math.round((lastAt - firstAt) / 1000));
  return <section className={`trace-panel ${busy ? "trace-active" : "trace-settled"}`}>
    <button className="trace-summary" type="button" onClick={onToggle} aria-expanded={open}>
      <span className="trace-summary-icon"><Sparkles size={13} /></span>
      <span className="trace-summary-title"><strong className={busy ? "trace-running-label" : ""}>{busy ? "正在运行" : "运行记录"}</strong><small>{busy ? "实时阶段与工具调用" : `已完成 · ${seconds} 秒 · ${events.length} 条`}</small></span>
      <ChevronDown size={15} className={`trace-chevron ${open ? "chevron-open" : ""}`} />
    </button>
    <div className={`trace-body-wrap ${open ? "is-open" : ""}`} aria-hidden={!open}><div className="trace-body">
      <div className="trace-disclosure">这里展示阶段、工具、状态和耗时，不展示模型隐藏思维。</div>
      {events.map((event, index) => <div className={`trace-event trace-${event.status}`} key={event.id} style={{ animationDelay: `${index * 55}ms` }}>
        <span className="trace-event-mark">{event.kind === "tool" ? <ExternalLink size={11} /> : event.kind === "error" ? <CircleHelp size={11} /> : <span />}</span>
        <div className="trace-event-copy"><strong>{cleanRuntimeBranding(event.title)}</strong>{event.detail && <p>{cleanRuntimeBranding(event.detail)}</p>}</div>
        <span className="trace-event-time">{event.durationMs ? `${(event.durationMs / 1000).toFixed(1)}s` : event.status === "running" ? "进行中" : ""}</span>
      </div>)}
    </div></div>
  </section>;
}
