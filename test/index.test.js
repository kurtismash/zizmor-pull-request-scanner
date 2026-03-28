import nock from "nock";
import myProbotApp from "../index.js";
import { Probot, ProbotOctokit } from "probot";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(path.join(__dirname, "fixtures/mock-cert.pem"), "utf-8");

const pullRequestPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/pull_request.opened.json"), "utf-8"),
);

const sampleOutput = fs.readFileSync(path.join(__dirname, "fixtures/sample.github-output.txt"), "utf-8");

const emptyOutput = "";

// ---------------------------------------------------------------------------
// Integration tests (with injected zizmor runner)
// ---------------------------------------------------------------------------

describe("zizmor status check app", () => {
  let probot;

  beforeEach(() => {
    nock.disableNetConnect();
    probot = new Probot({
      appId: 123,
      privateKey,
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test("creates a passing check when zizmor finds nothing", async () => {
    const mockRunZizmor = async () => emptyOutput;
    probot.load((app) => myProbotApp(app, { runZizmor: mockRunZizmor }));

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { checks: "write" } })

      // list PR files
      .get("/repos/hiimbex/testing-things/pulls/121/files?per_page=100")
      .reply(200, [
        {
          filename: ".github/workflows/ci.yml",
          status: "modified",
          patch: "@@ -1,3 +1,4 @@\n+new line\n context\n context\n context",
        },
      ])

      // create check run (in_progress)
      .post("/repos/hiimbex/testing-things/check-runs", (body) => {
        assert.strictEqual(body.name, "zizmor \u{1F308}");
        assert.strictEqual(body.status, "in_progress");
        return true;
      })
      .reply(200, { id: 1 })

      // update check run (completed, success)
      .patch("/repos/hiimbex/testing-things/check-runs/1", (body) => {
        assert.strictEqual(body.status, "completed");
        assert.strictEqual(body.conclusion, "success");
        assert.ok(body.output.title.includes("No findings"));
        return true;
      })
      .reply(200);

    await probot.receive({ name: "pull_request", payload: pullRequestPayload });
    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  test("reports findings on changed lines and comments on PR", async () => {
    const mockRunZizmor = async () => sampleOutput;
    probot.load((app) => myProbotApp(app, { runZizmor: mockRunZizmor }));

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { checks: "write" } })

      // list PR files — diff covers lines 14-15
      .get("/repos/hiimbex/testing-things/pulls/121/files?per_page=100")
      .reply(200, [
        {
          filename: ".github/workflows/ci.yml",
          status: "modified",
          patch:
            "@@ -12,6 +12,8 @@\n context\n context\n+    uses: actions/checkout@v1\n+    with:\n context\n context",
        },
      ])

      // create check run (in_progress)
      .post("/repos/hiimbex/testing-things/check-runs", (body) => {
        assert.strictEqual(body.status, "in_progress");
        return true;
      })
      .reply(200, { id: 1 })

      // update check run (completed, action_required, with annotations)
      .patch("/repos/hiimbex/testing-things/check-runs/1", (body) => {
        assert.strictEqual(body.status, "completed");
        assert.strictEqual(body.conclusion, "action_required");
        assert.strictEqual(body.output.annotations.length, 2);
        return true;
      })
      .reply(200)

      // create PR review with inline comments
      .post("/repos/hiimbex/testing-things/pulls/121/reviews", (body) => {
        assert.strictEqual(body.event, "COMMENT");
        assert.ok(body.comments.length > 0);
        return true;
      })
      .reply(200);

    await probot.receive({ name: "pull_request", payload: pullRequestPayload });
    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  test("excludes findings on lines not in the PR diff", async () => {
    const mockRunZizmor = async () => sampleOutput;
    probot.load((app) => myProbotApp(app, { runZizmor: mockRunZizmor }));

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { checks: "write" } })

      // PR files — patch only covers line 1, so findings at 14-15 are excluded
      .get("/repos/hiimbex/testing-things/pulls/121/files?per_page=100")
      .reply(200, [
        {
          filename: ".github/workflows/ci.yml",
          status: "modified",
          patch: "@@ -1,3 +1,4 @@\n+new line\n context\n context\n context",
        },
      ])

      .post("/repos/hiimbex/testing-things/check-runs")
      .reply(200, { id: 1 })

      // update check run — no findings left after filtering, so success
      .patch("/repos/hiimbex/testing-things/check-runs/1", (body) => {
        assert.strictEqual(body.status, "completed");
        assert.strictEqual(body.conclusion, "success");
        assert.ok(body.output.title.includes("No findings"));
        return true;
      })
      .reply(200);

    await probot.receive({ name: "pull_request", payload: pullRequestPayload });
    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  test("reports error when zizmor fails", async () => {
    const mockRunZizmor = async () => {
      throw new Error("zizmor not found");
    };
    probot.load((app) => myProbotApp(app, { runZizmor: mockRunZizmor }));

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { checks: "write" } })

      .get("/repos/hiimbex/testing-things/pulls/121/files?per_page=100")
      .reply(200, [
        {
          filename: ".github/workflows/ci.yml",
          status: "modified",
          patch: "@@ -1,3 +1,4 @@\n+new line\n context\n context\n context",
        },
      ])

      .post("/repos/hiimbex/testing-things/check-runs")
      .reply(200, { id: 1 })

      // update check run (completed, failure)
      .patch("/repos/hiimbex/testing-things/check-runs/1", (body) => {
        assert.strictEqual(body.conclusion, "failure");
        assert.ok(body.output.summary.includes("zizmor not found"));
        return true;
      })
      .reply(200);

    await probot.receive({ name: "pull_request", payload: pullRequestPayload });
    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  test("skips annotations when ANNOTATE=false", async () => {
    const originalEnv = process.env.ANNOTATE;
    process.env.ANNOTATE = "false";

    try {
      const mockRunZizmor = async () => sampleOutput;
      probot.load((app) => myProbotApp(app, { runZizmor: mockRunZizmor }));

      const mock = nock("https://api.github.com")
        .post("/app/installations/2/access_tokens")
        .reply(200, { token: "test", permissions: { checks: "write" } })

        .get("/repos/hiimbex/testing-things/pulls/121/files?per_page=100")
        .reply(200, [
          {
            filename: ".github/workflows/ci.yml",
            status: "modified",
            patch:
              "@@ -12,6 +12,8 @@\n context\n context\n+    uses: actions/checkout@v1\n+    with:\n context\n context",
          },
        ])

        .post("/repos/hiimbex/testing-things/check-runs")
        .reply(200, { id: 1 })

        // update check run — conclusion reflects findings but no annotations attached
        .patch("/repos/hiimbex/testing-things/check-runs/1", (body) => {
          assert.strictEqual(body.conclusion, "action_required");
          assert.strictEqual(body.output.annotations, undefined);
          return true;
        })
        .reply(200)

        // PR comments still posted by default
        .post("/repos/hiimbex/testing-things/pulls/121/reviews")
        .reply(200);

      await probot.receive({ name: "pull_request", payload: pullRequestPayload });
      assert.deepStrictEqual(mock.pendingMocks(), []);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ANNOTATE;
      } else {
        process.env.ANNOTATE = originalEnv;
      }
    }
  });

  test("skips PR comments when COMMENT_ON_PR=false", async () => {
    const originalEnv = process.env.COMMENT_ON_PR;
    process.env.COMMENT_ON_PR = "false";

    try {
      const mockRunZizmor = async () => sampleOutput;
      probot.load((app) => myProbotApp(app, { runZizmor: mockRunZizmor }));

      const mock = nock("https://api.github.com")
        .post("/app/installations/2/access_tokens")
        .reply(200, { token: "test", permissions: { checks: "write" } })

        .get("/repos/hiimbex/testing-things/pulls/121/files?per_page=100")
        .reply(200, [
          {
            filename: ".github/workflows/ci.yml",
            status: "modified",
            patch:
              "@@ -12,6 +12,8 @@\n context\n context\n+    uses: actions/checkout@v1\n+    with:\n context\n context",
          },
        ])

        .post("/repos/hiimbex/testing-things/check-runs")
        .reply(200, { id: 1 })

        // annotations still present
        .patch("/repos/hiimbex/testing-things/check-runs/1", (body) => {
          assert.strictEqual(body.output.annotations.length, 2);
          return true;
        })
        .reply(200);

      // No PR review mock — if commentOnPR were called, nock would fail

      await probot.receive({ name: "pull_request", payload: pullRequestPayload });
      assert.deepStrictEqual(mock.pendingMocks(), []);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.COMMENT_ON_PR;
      } else {
        process.env.COMMENT_ON_PR = originalEnv;
      }
    }
  });
});
