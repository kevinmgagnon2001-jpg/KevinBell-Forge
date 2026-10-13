import { createServerFn } from "@tanstack/react-start";

type ModuleInput = { tool: string; arguments: Record<string, string> };

const TOOLS = new Set(["sandbox_list", "sandbox_read", "sandbox_write", "search_web_clean"]);

export const runModuleD = createServerFn({ method: "POST" })
  .validator((input: unknown): ModuleInput => {
    if (!input || typeof input !== "object") throw new Error("bad input");
    const raw = input as { tool?: unknown; arguments?: unknown };
    const tool = typeof raw.tool === "string" ? raw.tool : "";
    if (!TOOLS.has(tool)) throw new Error("tool not allowed");
    const source = raw.arguments && typeof raw.arguments === "object" ? (raw.arguments as Record<string, unknown>) : {};
    const args: Record<string, string> = {};
    for (const key of ["path", "text", "query"]) {
      const value = source[key];
      if (typeof value === "string") args[key] = value.slice(0, key === "text" ? 4000 : 300);
    }
    return { tool, arguments: args };
  })
  .handler(async ({ data }) => {
    const { performModuleD } = await import("./loopback.server.ts");
    return performModuleD(data);
  });
