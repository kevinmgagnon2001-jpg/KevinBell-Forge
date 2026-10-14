// The next release tag, from the tags that exist and how big the change is.
//
//   git tag -l | node scripts/next-version.mjs patch   ->  v0.6.2   (after v0.6.1)
//   ... minor -> v0.7.0      ... major -> v1.0.0
//
// Only tags that look like v1.2.3 count (a stray "Forgereleasetag" or "V0.6.1" is ignored).
// .github/workflows/release.yml uses this when a pull request labelled "release" is merged.

/** @param {string[]} tags @param {string} bump @returns {string} */
export function nextVersion(tags, bump = "patch") {
  let best = [0, 0, 0];
  for (const tag of tags) {
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
    if (!m) continue;
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (v[0] > best[0] || (v[0] === best[0] && (v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])))) best = v;
  }
  const [major, minor, patch] = best;
  if (bump === "major") return `v${major + 1}.0.0`;
  if (bump === "minor") return `v${major}.${minor + 1}.0`;
  if (bump === "patch") return `v${major}.${minor}.${patch + 1}`;
  throw new Error(`bump must be patch, minor or major (got "${bump}")`);
}

if (process.argv[1]?.endsWith("next-version.mjs")) {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => console.log(nextVersion(input.split("\n"), process.argv[2] ?? "patch")));
}
