import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Goal Architect — Turn a goal into a path",
  description: "A thoughtful agent that turns vague goals into plans you can act on.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
