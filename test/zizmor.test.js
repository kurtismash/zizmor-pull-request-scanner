import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { githubOutputToAnnotations, buildSummary } from "../zizmor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sampleOutput = fs.readFileSync(path.join(__dirname, "fixtures/sample.github-output.txt"), "utf-8");

const emptyOutput = "";

describe("githubOutputToAnnotations", () => {
  test("converts github output to GitHub annotations", () => {
    const annotations = githubOutputToAnnotations(sampleOutput);
    assert.strictEqual(annotations.length, 2);

    assert.deepStrictEqual(annotations[0], {
      path: ".github/workflows/ci.yml",
      start_line: 15,
      end_line: 15,
      annotation_level: "warning",
      message: "actions/checkout with persist-credentials enabled",
      title: "artipacked",
    });

    assert.deepStrictEqual(annotations[1], {
      path: ".github/workflows/ci.yml",
      start_line: 14,
      end_line: 14,
      annotation_level: "failure",
      message: "ci.yml uses a known-vulnerable action (actions/checkout@v1)",
      title: "known-vulnerable-actions",
    });
  });

  test("returns empty array for empty output", () => {
    assert.deepStrictEqual(githubOutputToAnnotations(emptyOutput), []);
  });
});

describe("buildSummary", () => {
  test("returns clean message for no annotations", () => {
    assert.strictEqual(buildSummary([]), "zizmor found no issues in your GitHub Actions workflows.");
  });

  test("summarises mixed annotation levels", () => {
    const annotations = githubOutputToAnnotations(sampleOutput);
    const summary = buildSummary(annotations);
    assert.ok(summary.includes("1 error(s)"));
    assert.ok(summary.includes("1 warning(s)"));
  });
});
