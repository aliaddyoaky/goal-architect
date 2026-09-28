import { NextResponse } from "next/server";

export const runtime = "nodejs";

function stripMarkup(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url");
  if (!rawUrl) return NextResponse.json({ error: "缺少资源地址" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(rawUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    return NextResponse.json({ error: "资源地址无效" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "GoalArchitectPreview/1.0 (+resource preview)" },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) return NextResponse.json({ error: `原页面返回 ${response.status}` }, { status: 502 });
    if (!contentType.includes("text/html")) {
      return NextResponse.json({ title: target.hostname, excerpt: "这是一个非 HTML 资源，请打开原页面查看。", finalUrl: response.url });
    }
    const html = (await response.text()).slice(0, 800_000);
    const title = stripMarkup(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || target.hostname;
    const description = stripMarkup(html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i)?.[1] || "");
    const excerpt = description || stripMarkup(html).slice(0, 900);
    return NextResponse.json({ title, excerpt: excerpt || "页面没有提供可提取的文字摘要。", finalUrl: response.url });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.name === "AbortError" ? "原页面响应较慢" : "无法读取原页面" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
