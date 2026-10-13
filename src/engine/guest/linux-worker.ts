/// <reference lib="webworker" />
/** Runs a Linux program off the main thread so the 3D view never stalls. */
import { runLinux, type LinuxOptions } from "./linux.ts";

self.onmessage = (event: MessageEvent<{ bytes: Uint8Array; options: LinuxOptions }>) => {
  const report = runLinux(event.data.bytes, event.data.options);
  (self as unknown as { postMessage: (value: unknown) => void }).postMessage(report);
};
