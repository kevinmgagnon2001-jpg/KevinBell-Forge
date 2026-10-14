//#region node_modules/.nitro/vite/services/ssr/assets/research-pk8zIg5V.js
var HOSTS = /* @__PURE__ */ new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
/** Wikimedia image hosts only. The page proxy refuses every other host. */
function allowedAssetUrl(url) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && HOSTS.has(parsed.hostname) && parsed.pathname.length > 1;
	} catch {
		return false;
	}
}
/** Lab textures painted in the page. They are not remote URLs. */
var TEXTURE_PACKS = [
	"marble",
	"circuit",
	"clay",
	"paper",
	"steel",
	"brick",
	"grain",
	"night"
];
function localTexture(src) {
	return new RegExp(`^tex:(${TEXTURE_PACKS.join("|")})$`).exec(src.trim())?.[1] ?? null;
}
function wantsWeb(intent) {
	return /\b(research|look up|lookup|search the web|search for|wikipedia|wikimedia|on the web|browse|surf the)\b/i.test(intent);
}
function wantsAsset(intent) {
	if (/\b(splat|neural|gaussian)\b/i.test(intent)) return true;
	return /\b(texture|photo|picture|image)\b/i.test(intent) && /\b(pull|download|place|onto|apply|wrap)\b/i.test(intent);
}
function isLearning(intent) {
	return /\b(learn|improve|teach yourself|from now on|add a skill|iterate)\b/i.test(intent);
}
function isRefusal(result) {
	return /your body and stays/i.test(result);
}
function fieldQuery(intent) {
	return (intent.replace(/\b(please|pull|download|research|look up|lookup|search(?: the web| for)?|find(?: me| a| an)?|a|an|the|onto|on|avatar|architect|yourself|texture|photo|picture|image|asset|reference|of|me|my|and|put|it|learn|to|how|do|i|what|is|improve|teach|yourself)\b/gi, " ").replace(/[^a-z0-9\s-]/gi, " ").replace(/\s+/g, " ").trim() || intent).slice(0, 140);
}
var HARNESS_TOOLS = /* @__PURE__ */ new Set([
	"spawn_entity",
	"set_transform",
	"set_color",
	"edit_entity",
	"delete_entity",
	"control_avatar",
	"place_neural",
	"spawn_agent",
	"set_asset",
	"build_play",
	"play_move",
	"apply_method",
	"query_scene",
	"undo",
	"apply_force"
]);
/** A tool call written as JSON, from the model or from a page. Unknown tools are ignored. */
function codeFromText(text) {
	const match = text.match(/\{[\s\S]{0,500}\}/);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[0]);
		const tool = String(parsed.tool || parsed.toolName || parsed.name || "");
		if (!HARNESS_TOOLS.has(tool)) return null;
		const raw = parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {};
		const args = {};
		for (const [key, value] of Object.entries(raw)) if (typeof value === "string" || typeof value === "number") args[key] = String(value).slice(0, 80);
		return {
			tool,
			arguments: args
		};
	} catch {
		return null;
	}
}
//#endregion
export { isLearning as a, wantsAsset as c, fieldQuery as i, wantsWeb as l, allowedAssetUrl as n, isRefusal as o, codeFromText as r, localTexture as s, TEXTURE_PACKS as t };
