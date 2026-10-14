import assert from "node:assert/strict";
import test from "node:test";
import { nextVersion } from "../../scripts/next-version.mjs";

test("the next release tag counts only v1.2.3 tags and bumps the right part", () => {
  const tags = ["Forgereleasetag", "V0.6.1", "v0.6.0", "v0.6.1", "v0.10.0-beta", "v0.9.0", "notes"];
  assert.equal(nextVersion(tags, "patch"), "v0.9.1");
  assert.equal(nextVersion(tags, "minor"), "v0.10.0");
  assert.equal(nextVersion(tags, "major"), "v1.0.0");
  assert.equal(nextVersion(["v0.6.1", "v0.6.10", "v0.6.9"]), "v0.6.11", "numbers compare as numbers");
  assert.equal(nextVersion([]), "v0.0.1");
  assert.throws(() => nextVersion(["v1.0.0"], "huge"), /bump must be/);
});
