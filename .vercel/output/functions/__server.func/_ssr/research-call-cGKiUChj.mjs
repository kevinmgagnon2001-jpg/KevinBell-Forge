import { i as fieldQuery, n as allowedAssetUrl } from "./research-pk8zIg5V.mjs";
import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/research-call-cGKiUChj.js
var UA = "AetherForge/0.1 (educational scene forge)";
async function getJson(url) {
	const response = await fetch(url, {
		headers: {
			"User-Agent": UA,
			Accept: "application/json"
		},
		signal: AbortSignal.timeout(8e3)
	});
	if (!response.ok) throw new Error(`lookup ${response.status}`);
	return response.json();
}
async function wikiSummary(query) {
	const title = (await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`)).query?.search?.[0]?.title?.trim() ?? "";
	if (!title) return {
		title: "",
		summary: "",
		source: ""
	};
	const page = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
	return {
		title,
		summary: (page.extract ?? "").replace(/\s+/g, " ").trim().slice(0, 420),
		source: page.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
	};
}
async function wikiBest(query) {
	const first = await wikiSummary(query);
	const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
	const title = first.title.toLowerCase();
	if (!first.title || words.some((word) => title.includes(word))) return first;
	const closer = await wikiSummary(`${query} material`).catch(() => first);
	return closer.summary ? closer : first;
}
async function duckSummary(query) {
	const data = await getJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`);
	const summary = (data.AbstractText || data.Abstract || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 420);
	return {
		title: (data.Heading || "").trim(),
		summary,
		source: data.AbstractURL || ""
	};
}
async function commonsImage(query) {
	const found = await getJson("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=512&format=json&gsrsearch=" + encodeURIComponent(`${query} filetype:bitmap`));
	const pages = Object.values(found.query?.pages ?? {});
	for (const page of pages) {
		const info = page.imageinfo?.[0];
		const thumb = info?.thumburl || info?.url || "";
		if (((info?.mime ?? "").startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(thumb)) && allowedAssetUrl(thumb)) return thumb;
	}
	return "";
}
async function arxivNote(query) {
	const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=1`;
	const response = await fetch(url, {
		headers: {
			"User-Agent": UA,
			Accept: "application/atom+xml"
		},
		signal: AbortSignal.timeout(8e3)
	});
	if (!response.ok) return {
		title: "",
		summary: "",
		source: ""
	};
	const xml = await response.text();
	return {
		title: [...xml.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((match) => match[1].replace(/\s+/g, " ").trim()).find((item) => item && !/^arxiv query/i.test(item)) ?? "",
		summary: (xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 420),
		source: [...xml.matchAll(/<id>([^<]+)<\/id>/g)].map((match) => match[1].trim()).find((item) => item.includes("arxiv.org")) ?? ""
	};
}
var researchTask_createServerFn_handler = createServerRpc({
	id: "2b00fd7dca651977a83da2bc1f00ed207038cc02f725231a47cd03b14b473166",
	name: "researchTask",
	filename: "src/engine/research-call.ts"
}, (opts) => researchTask.__executeServer(opts));
var researchTask = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("bad input");
	const raw = input;
	const query = typeof raw.query === "string" ? raw.query.trim().slice(0, 400) : "";
	if (!query) throw new Error("query required");
	return {
		query,
		failure: typeof raw.failure === "string" ? raw.failure.trim().slice(0, 400) : ""
	};
}).handler(researchTask_createServerFn_handler, async ({ data }) => {
	const query = fieldQuery(`${data.query} ${data.failure}`);
	try {
		const [web, wiki, imageUrl, paper] = await Promise.all([
			duckSummary(query).catch(() => ({
				title: "",
				summary: "",
				source: ""
			})),
			wikiBest(query).catch(() => ({
				title: "",
				summary: "",
				source: ""
			})),
			commonsImage(query).catch(() => ""),
			arxivNote(query).catch(() => ({
				title: "",
				summary: "",
				source: ""
			}))
		]);
		const picked = /\b(paper|arxiv|research|method|algorithm)\b/i.test(`${data.query} ${data.failure}`) && paper.summary ? paper : web.summary ? web : paper.summary ? paper : wiki;
		const ok = Boolean(picked.summary || picked.title || imageUrl);
		return {
			ok,
			query,
			summary: (picked.summary || wiki.summary || web.summary).slice(0, 420),
			title: picked.title || wiki.title || web.title || query,
			source: picked.source || wiki.source || web.source,
			imageUrl,
			error: ok ? void 0 : "No web page matched."
		};
	} catch (error) {
		return {
			ok: false,
			query,
			summary: "",
			title: "",
			source: "",
			imageUrl: "",
			error: error instanceof Error ? error.message : "lookup failed"
		};
	}
});
var fetchAsset_createServerFn_handler = createServerRpc({
	id: "178dddf1976314abd569e78348a53987a33a8fa85ff528baf6ff780d3ce87a94",
	name: "fetchAsset",
	filename: "src/engine/research-call.ts"
}, (opts) => fetchAsset.__executeServer(opts));
var fetchAsset = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("bad input");
	const url = typeof input.url === "string" ? input.url.trim() : "";
	if (!allowedAssetUrl(url)) throw new Error("url not allowed");
	return { url };
}).handler(fetchAsset_createServerFn_handler, async ({ data }) => {
	try {
		const response = await fetch(data.url, {
			headers: {
				"User-Agent": UA,
				Accept: "image/*"
			},
			signal: AbortSignal.timeout(8e3)
		});
		if (!response.ok) return {
			ok: false,
			error: `asset ${response.status}`
		};
		const type = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
		if (!type.startsWith("image/")) return {
			ok: false,
			error: "not an image"
		};
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength < 32 || bytes.byteLength > 9e5) return {
			ok: false,
			error: "image is the wrong size"
		};
		return {
			ok: true,
			dataUrl: `data:${type};base64,${Buffer.from(bytes).toString("base64")}`
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "asset failed"
		};
	}
});
//#endregion
export { fetchAsset_createServerFn_handler, researchTask_createServerFn_handler };
