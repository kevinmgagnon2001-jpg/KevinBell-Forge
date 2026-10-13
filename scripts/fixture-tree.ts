/**
 * Reads a file tree recorded by fixtures/linux/build.sh on the real machine: "d /path" lines for
 * directories, and "f /path <size>" followed by the contents and a newline for files. Returns it in
 * the shape a Linux run report uses: directories as "/path/" with no contents.
 */
export function parseRecordedTree(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < raw.length) {
    const eol = raw.indexOf("\n", at);
    const [kind, path, size] = raw.slice(at, eol).split(" ");
    at = eol + 1;
    if (kind === "d") out[`${path}/`] = "";
    else {
      out[path] = raw.slice(at, at + Number(size));
      at += Number(size) + 1;
    }
  }
  return out;
}
