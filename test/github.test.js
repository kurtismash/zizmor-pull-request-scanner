import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { githubOutputToAnnotations } from "../src/zizmor.js";
import { getDiffLines, filterAnnotationsToChangedLines } from "../src/github.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sampleOutput = fs.readFileSync(path.join(__dirname, "fixtures/sample.github-output.txt"), "utf-8");

describe("getDiffLines", () => {
  test("parses added and context lines from a unified diff", () => {
    const patch = "@@ -10,6 +10,8 @@\n context\n+added1\n+added2\n context\n context\n context";
    const lines = getDiffLines(patch);
    assert.ok(lines.has(10)); // context
    assert.ok(lines.has(11)); // added1
    assert.ok(lines.has(12)); // added2
    assert.ok(lines.has(13)); // context
  });

  test("returns empty set for null/undefined patch", () => {
    assert.strictEqual(getDiffLines(null).size, 0);
    assert.strictEqual(getDiffLines(undefined).size, 0);
  });
});

describe("filterAnnotationsToChangedLines", () => {
  test("keeps only annotations on changed lines", () => {
    const annotations = githubOutputToAnnotations(sampleOutput);
    const changedFileMap = new Map([
      [
        ".github/workflows/ci.yml",
        {
          filename: ".github/workflows/ci.yml",
          patch:
            "@@ -12,6 +12,8 @@\n context\n context\n+    uses: actions/checkout@v1\n+    with:\n context\n context",
        },
      ],
    ]);
    const filtered = filterAnnotationsToChangedLines(annotations, changedFileMap);
    assert.strictEqual(filtered.length, 2);
  });

  test("excludes annotations on unchanged lines", () => {
    const annotations = githubOutputToAnnotations(sampleOutput);
    const changedFileMap = new Map([
      [
        ".github/workflows/ci.yml",
        {
          filename: ".github/workflows/ci.yml",
          patch: "@@ -1,3 +1,4 @@\n+new line\n context\n context\n context",
        },
      ],
    ]);
    const filtered = filterAnnotationsToChangedLines(annotations, changedFileMap);
    assert.strictEqual(filtered.length, 0);
  });

  test("includes multi-line annotation when start_line is in diff but end_line is not", () => {
    const annotations = [
      {
        path: ".github/workflows/ci.yml",
        start_line: 8,
        end_line: 25,
        annotation_level: "warning",
        message: "multi-line finding",
        title: "test",
      },
    ];
    // Diff covers lines 5-15, so start_line (8) is in diff but end_line (25) is not
    const changedFileMap = new Map([
      [
        ".github/workflows/ci.yml",
        {
          filename: ".github/workflows/ci.yml",
          patch:
            "@@ -5,6 +5,11 @@\n context\n context\n context\n+added1\n+added2\n+added3\n+added4\n+added5\n context\n context\n context",
        },
      ],
    ]);
    const filtered = filterAnnotationsToChangedLines(annotations, changedFileMap);
    assert.strictEqual(filtered.length, 1);
  });

  test("excludes annotations for files not in diff", () => {
    const annotations = githubOutputToAnnotations(sampleOutput);
    const changedFileMap = new Map();
    const filtered = filterAnnotationsToChangedLines(annotations, changedFileMap);
    assert.strictEqual(filtered.length, 0);
  });
});
