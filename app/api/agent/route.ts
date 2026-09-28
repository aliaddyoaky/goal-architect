import { NextResponse } from "next/server";
import { respond } from "@/lib/agent";
import { normalizeGoalState } from "@/lib/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const state = normalizeGoalState(body.goalState);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const action = body.action === "plan" ? "plan" : body.action === "revise" ? "revise" : "message";
    if (messages.length > 40) return NextResponse.json({ error: "Conversation is too long. Start a new goal." }, { status: 400 });
    const result = await respond(state, messages, action, Array.isArray(body.roadmap) ? body.roadmap : null);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Goal Architect API error:", error);
    return NextResponse.json({ error: "这次没有顺利完成。你的状态已保留，请重试，或继续描述目标。" }, { status: 500 });
  }
}
