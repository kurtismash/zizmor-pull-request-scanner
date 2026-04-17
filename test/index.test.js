import nock from "nock";
import myProbotApp from "../src/index.js";
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

const pullRequestReopenedPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/pull_request.reopened.json"), "utf-8"),
);

const sampleOutput = fs.readFileSync(path.join(__dirname, "fixtures/sample.github-output.txt"), "utf-8");

const checkRunRerequestedPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/check_run.rerequested.json"), "utf-8"),
);

const checkSuiteRerequestedPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/check_suite.rerequested.json"), "utf-8"),
);

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
        assert.ok(body.output.summary.includes("internal error"));
        return true;
      })
      .reply(200);

    await probot.receive({ name: "pull_request", payload: pullRequestPayload });
    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  test("succeeds when all workflow files are deleted", async () => {
    const mockRunZizmor = async () => {
      throw new Error("should not be called");
    };
    probot.load((app) => myProbotApp(app, { runZizmor: mockRunZizmor }));

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { checks: "write" } })

      // list PR files — all workflow files deleted
      .get("/repos/hiimbex/testing-things/pulls/121/files?per_page=100")
      .reply(200, [
        {
          filename: ".github/workflows/ci.yml",
          status: "removed",
          patch: "@@ -1,3 +0,0 @@\n-old line 1\n-old line 2\n-old line 3",
        },
      ])

      // create check run (in_progress)
      .post("/repos/hiimbex/testing-things/check-runs")
      .reply(200, { id: 1 })

      // update check run (completed, success)
      .patch("/repos/hiimbex/testing-things/check-runs/1", (body) => {
        assert.strictEqual(body.status, "completed");
        assert.strictEqual(body.conclusion, "success");
        assert.ok(body.output.summary.includes("deleted"));
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

  test("re-runs scan on pull_request.reopened", async () => {
    const mockRunZizmor = async () => emptyOutput;
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
      .reply(200, { id: 2 })

      .patch("/repos/hiimbex/testing-things/check-runs/2", (body) => {
        assert.strictEqual(body.status, "completed");
        assert.strictEqual(body.conclusion, "success");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "pull_request", payload: pullRequestReopenedPayload });
    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  test("re-runs scan on check_run.rerequested", async () => {
    const mockRunZizmor = async () => emptyOutput;
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
      .reply(200, { id: 2 })

      .patch("/repos/hiimbex/testing-things/check-runs/2", (body) => {
        assert.strictEqual(body.status, "completed");
        assert.strictEqual(body.conclusion, "success");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "check_run", payload: checkRunRerequestedPayload });
    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  test("re-runs scan on check_suite.rerequested", async () => {
    const originalAppId = process.env.APP_ID;
    process.env.APP_ID = "18586";

    try {
      const mockRunZizmor = async () => emptyOutput;
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
        .reply(200, { id: 3 })

        .patch("/repos/hiimbex/testing-things/check-runs/3", (body) => {
          assert.strictEqual(body.status, "completed");
          assert.strictEqual(body.conclusion, "success");
          return true;
        })
        .reply(200);

      await probot.receive({ name: "check_suite", payload: checkSuiteRerequestedPayload });
      assert.deepStrictEqual(mock.pendingMocks(), []);
    } finally {
      if (originalAppId === undefined) {
        delete process.env.APP_ID;
      } else {
        process.env.APP_ID = originalAppId;
      }
    }
  });
});
