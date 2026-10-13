import { createServerFn } from "@tanstack/react-start";
import { allowedAssetUrl } from "./asset-url";
import { fieldQuery, type FieldNote } from "./research";

const UA = "AetherForge/0.1 (educational scene forge)";

type ResearchInput = { query: string; failure: string };

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`lookup ${response.status}`);
  return response.json();
}

async function wikiSummary(query: string): Promise<{ title: string; summary: string; source: string }> {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`;
  const found = (await getJson(searchUrl)) as { query?: { search?: { title?: string }[] } };
  const title = found.query?.search?.[0]?.title?.trim() ?? "";
  if (!title) return { title: "", summary: "", source: "" };
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const page = (await getJson(summaryUrl)) as { extract?: string; content_urls?: { desktop?: { page?: string } } };
  return {
    title,
    summary: (page.extract ?? "").replace(/\s+/g, " ").trim().slice(0, 420),
    source: page.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  };
}

async function wikiBest(query: string): Promise<{ title: string; summary: string; source: string }> {
  const first = await wikiSummary(query);
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
  const title = first.title.toLowerCase();
  if (!first.title || words.some((word) => title.includes(word))) return first;
  const closer = await wikiSummary(`${query} material`).catch(() => first);
  return closer.summary ? closer : first;
}

async function duckSummary(query: string): Promise<{ title: string; summary: string; source: string }> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const data = (await getJson(url)) as { AbstractText?: string; Abstract?: string; AbstractURL?: string; Heading?: string };
  const summary = (data.AbstractText || data.Abstract || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 420);
  return { title: (data.Heading || "").trim(), summary, source: data.AbstractURL || "" };
}

async function commonsImage(query: string): Promise<string> {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=512&format=json&gsrsearch=" +
    encodeURIComponent(`${query} filetype:bitmap`);
  const found = (await getJson(url)) as {
    query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; mime?: string; url?: string }[] }> };
  };
  const pages = Object.values(found.query?.pages ?? {});
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const thumb = info?.thumburl || info?.url || "";
    const mime = info?.mime ?? "";
    if ((mime.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(thumb)) && allowedAssetUrl(thumb)) return thumb;
  }
  return "";
}

async function arxivNote(query: string): Promise<{ title: string; summary: string; source: string }> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=1`;
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/atom+xml" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return { title: "", summary: "", source: "" };
  const xml = await response.text();
  const titles = [...xml.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((match) => match[1].replace(/\s+/g, " ").trim());
  const title = titles.find((item) => item && !/^arxiv query/i.test(item)) ?? "";
  const summary = (xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 420);
  const ids = [...xml.matchAll(/<id>([^<]+)<\/id>/g)].map((match) => match[1].trim());
  const source = ids.find((item) => item.includes("arxiv.org")) ?? "";
  return { title, summary, source };
}

export const researchTask = createServerFn({ method: "POST" })
  .validator((input: unknown): ResearchInput => {
    if (!input || typeof input !== "object") throw new Error("bad input");
    const raw = input as Record<string, unknown>;
    const query = typeof raw.query === "string" ? raw.query.trim().slice(0, 400) : "";
    if (!query) throw new Error("query required");
    const failure = typeof raw.failure === "string" ? raw.failure.trim().slice(0, 400) : "";
    return { query, failure };
  })
  .handler(async ({ data }): Promise<FieldNote> => {
    const query = fieldQuery(`${data.query} ${data.failure}`);
    try {
      const [web, wiki, imageUrl, paper] = await Promise.all([
        duckSummary(query).catch(() => ({ title: "", summary: "", source: "" })),
        wikiBest(query).catch(() => ({ title: "", summary: "", source: "" })),
        commonsImage(query).catch(() => ""),
        arxivNote(query).catch(() => ({ title: "", summary: "", source: "" })),
      ]);
      const wantPaper = /\b(paper|arxiv|research|method|algorithm)\b/i.test(`${data.query} ${data.failure}`);
      const picked = wantPaper && paper.summary ? paper : web.summary ? web : paper.summary ? paper : wiki;
      const ok = Boolean(picked.summary || picked.title || imageUrl);
      return {
        ok,
        query,
        summary: (picked.summary || wiki.summary || web.summary).slice(0, 420),
        title: picked.title || wiki.title || web.title || query,
        source: picked.source || wiki.source || web.source,
        imageUrl,
        error: ok ? undefined : "No web page matched.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "lookup failed";
      return { ok: false, query, summary: "", title: "", source: "", imageUrl: "", error: message };
    }
  });

export const fetchAsset = createServerFn({ method: "POST" })
  .validator((input: unknown): { url: string } => {
    if (!input || typeof input !== "object") throw new Error("bad input");
    const url = typeof (input as { url?: unknown }).url === "string" ? (input as { url: string }).url.trim() : "";
    if (!allowedAssetUrl(url)) throw new Error("url not allowed");
    return { url };
  })
  .handler(async ({ data }): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> => {
    try {
      const response = await fetch(data.url, {
        headers: { "User-Agent": UA, Accept: "image/*" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { ok: false, error: `asset ${response.status}` };
      const type = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
      if (!type.startsWith("image/")) return { ok: false, error: "not an image" };
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 32 || bytes.byteLength > 900_000) return { ok: false, error: "image is the wrong size" };
      const dataUrl = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
      return { ok: true, dataUrl };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "asset failed" };
    }
  });
