import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/module-d-call-v2BOci7x.js
var TOOLS = /* @__PURE__ */ new Set([
	"sandbox_list",
	"sandbox_read",
	"sandbox_write",
	"search_web_clean"
]);
var runModuleD_createServerFn_handler = createServerRpc({
	id: "8beb6ce27e04aed979a6761d867897517b0c9bf8256367b942c8d11bcb83fa82",
	name: "runModuleD",
	filename: "src/engine/module-d-call.ts"
}, (opts) => runModuleD.__executeServer(opts));
var runModuleD = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("bad input");
	const raw = input;
	const tool = typeof raw.tool === "string" ? raw.tool : "";
	if (!TOOLS.has(tool)) throw new Error("tool not allowed");
	const source = raw.arguments && typeof raw.arguments === "object" ? raw.arguments : {};
	const args = {};
	for (const key of [
		"path",
		"text",
		"query"
	]) {
		const value = source[key];
		if (typeof value === "string") args[key] = value.slice(0, key === "text" ? 4e3 : 300);
	}
	return {
		tool,
		arguments: args
	};
}).handler(runModuleD_createServerFn_handler, async ({ data }) => {
	const { performModuleD } = await import("./loopback.server-BmPN8_rk.mjs");
	return performModuleD(data);
});
//#endregion
export { runModuleD_createServerFn_handler };
