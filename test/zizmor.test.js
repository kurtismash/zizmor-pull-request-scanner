import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { githubOutputToAnnotations, buildSummary } from "../src/zizmor.js";

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
      message: [
        "actions/checkout with persist-credentials enabled",
        "",
        "By default, `actions/checkout` persists credentials on disk. Subsequent steps may accidentally expose them, e.g. via a publicly accessible artifact.",
        "",
        "How to fix: Use `actions/checkout` with `persist-credentials: false` unless your workflow explicitly needs git credentials. If the persisted credential is needed, it should be made explicit with `persist-credentials: true`.",
        "",
        "See https://docs.zizmor.sh/audits/#artipacked for more information.",
      ].join("\n"),
      title: "artipacked",
    });

    assert.deepStrictEqual(annotations[1], {
      path: ".github/workflows/ci.yml",
      start_line: 14,
      end_line: 14,
      annotation_level: "failure",
      message: [
        "ci.yml uses a known-vulnerable action (actions/checkout@v1)",
        "",
        "This action has a known, publicly disclosed vulnerability tracked in the GitHub Advisories database.",
        "",
        "How to fix: Upgrade to a fixed version of the action, or remove its usage entirely if no fix is available.",
        "",
        "See https://docs.zizmor.sh/audits/#known-vulnerable-actions for more information.",
      ].join("\n"),
      title: "known-vulnerable-actions",
    });
  });

  test("returns empty array for empty output", () => {
    assert.deepStrictEqual(githubOutputToAnnotations(emptyOutput), []);
  });
});

describe("buildSummary", () => {
  test("returns clean message for no annotations", () => {
    assert.deepStrictEqual(buildSummary([]), {
      conclusion: "success",
      title: "No findings",
      summary: "zizmor \u{1F308} found no issues in your GitHub Actions workflows.",
    });
  });

  test("summarises mixed annotation levels", () => {
    const annotations = githubOutputToAnnotations(sampleOutput);
    const result = buildSummary(annotations);
    assert.strictEqual(result.conclusion, "action_required");
    assert.ok(result.title.includes("error(s)"));
    assert.ok(result.summary.includes("1 error(s)"));
    assert.ok(result.summary.includes("1 warning(s)"));
  });
});
