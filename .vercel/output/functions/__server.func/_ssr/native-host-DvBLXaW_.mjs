import { a as runLinux, c as lowerProgram, i as relift, l as Stop, n as finishReport, o as sparseChunks, r as prepareLinux, s as stopDetail, t as LinuxShim } from "./linux-client-DOYGoW8S.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/native-host-DvBLXaW_.js
function tauri() {
	const internals = globalThis.__TAURI_INTERNALS__;
	return internals && typeof internals.invoke === "function" ? internals : null;
}
/**
* Run a static Linux program. In the desktop app the lowered module runs natively in wasmtime and
* the Rust shim answers system calls (src-tauri/src/guest.rs); when the program reaches code that
* has not been lifted yet, this side lifts it and swaps in a new module. In a browser tab it runs
* in the page (runLinux). Same report either way.
*/
async function runLinuxHosted(bytes, options = {}) {
	const native = tauri();
	if (!native) return {
		...runLinux(bytes, options),
		host: "browser"
	};
	const prepared = prepareLinux(bytes, options);
	if (!prepared.ok) return {
		...runLinux(bytes, options),
		host: "desktop"
	};
	const { program, fetch, memBytes } = prepared;
	const shimView = new LinuxShim(prepared.arch, prepared.brkBase, prepared.mmapTop);
	const lower = () => Array.from(lowerProgram(program, memBytes).bytes);
	const stdin = typeof options.stdin === "string" ? new TextEncoder().encode(options.stdin) : options.stdin ?? /* @__PURE__ */ new Uint8Array();
	const id = await native.invoke("guest_start", {
		module: lower(),
		arch: prepared.arch,
		chunks: sparseChunks(prepared.memory).map((c) => [c.addr, Array.from(c.bytes)]),
		brkBase: Number(prepared.brkBase),
		mmapTop: Number(prepared.mmapTop),
		stdin: Array.from(stdin),
		fuel: options.fuel ?? 2e9
	});
	let relifts = 0;
	let stop = Stop.running;
	let detail = "";
	let used = 0;
	try {
		for (let round = 0; round < 1e5; round += 1) {
			const r = await native.invoke("guest_resume", {
				id,
				maxEvents: 1e4
			});
			if (r.stdout.length) shimView.stdout.push(Uint8Array.from(r.stdout));
			if (r.stderr.length) shimView.stderr.push(Uint8Array.from(r.stderr));
			Object.assign(shimView.counts, r.syscalls);
			for (const u of r.unsupported) shimView.unsupported.add(u);
			used = r.fuelUsed;
			if (r.status === "exit") {
				shimView.exitCode = r.exitCode;
				break;
			}
			if (r.status === "running") continue;
			if (r.status === "needs-code") {
				const again = relift(program, fetch, BigInt(r.pc), relifts);
				relifts += 1;
				if (!again.ok) {
					stop = again.stop;
					detail = again.detail;
					break;
				}
				await native.invoke("guest_swap", {
					id,
					module: lower()
				});
				continue;
			}
			if (r.status === "trap") {
				stop = Stop.unsupported;
				detail = `native engine stopped: ${r.detail}`;
				break;
			}
			stop = r.code;
			detail = stopDetail(stop, BigInt(r.pc), BigInt(r.fault));
			break;
		}
	} finally {
		await native.invoke("guest_end", { id });
	}
	return {
		...finishReport(shimView, program, "wasm", stop, detail, used, relifts),
		host: "desktop"
	};
}
//#endregion
export { runLinuxHosted };
