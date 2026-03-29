import { runZizmor as defaultRunZizmor, githubOutputToAnnotations, buildSummary } from "./zizmor.js";
import { getChangedFileMap, filterAnnotationsToChangedLines, updateCheckRun } from "./github.js";
import { CHECK_NAME } from "./constants.js";

/**
 * Main entrypoint to the zizmor status-check Probot app.
 *
 * @param {import('probot').Probot} app
 * @param {object} [deps] — injectable dependencies (used in tests)
 * @param {Function} [deps.runZizmor] — async (repo, sha, token, log) => github output string
 */
export default (app, { runZizmor = defaultRunZizmor } = {}) => {
  async function scan(context, sha, prNumber) {
    const repo = `${context.repo().owner}/${context.repo().repo}`;

    // Create the check run immediately so the PR shows "in progress"
    const {
      data: { id: checkRunId },
    } = await context.octokit.checks.create(
      context.repo({
        name: CHECK_NAME,
        head_sha: sha,
        status: "in_progress",
        started_at: new Date().toISOString(),
      }),
    );

    const changedFileMap = await getChangedFileMap(context, prNumber);

    // Exit early if no workflow files were touched
    const workflowPattern = /(?:\.github\/workflows\/[^/]+\.(yml|yaml)$|(?:^|\/)(?:action|dependabot)\.(yml|yaml)$)/;
    const relevantFiles = [...changedFileMap.entries()].filter(([f]) => workflowPattern.test(f));
    if (relevantFiles.length === 0) {
      await context.octokit.checks.update(
        context.repo({
          check_run_id: checkRunId,
          status: "completed",
          conclusion: "skipped",
          completed_at: new Date().toISOString(),
          output: {
            title: "No workflow changes",
            summary: "No GitHub Actions workflow or action files were changed in this PR.",
          },
        }),
      );
      return;
    }

    // Exit early if all workflow files were deleted — nothing to scan
    const allDeleted = relevantFiles.every(([, f]) => f.status === "removed");
    if (allDeleted) {
      await context.octokit.checks.update(
        context.repo({
          check_run_id: checkRunId,
          status: "completed",
          conclusion: "success",
          completed_at: new Date().toISOString(),
          output: {
            title: "No findings",
            summary: "All workflow files in this PR were deleted. Nothing to scan.",
          },
        }),
      );
      return;
    }

    try {
      const { token } = await context.octokit.auth({ type: "installation" });
      const output = await runZizmor(repo, sha, token, app.log);
      const annotations = githubOutputToAnnotations(output);

      // Only report findings on lines changed in this PR
      const reportedAnnotations = filterAnnotationsToChangedLines(annotations, changedFileMap);

      const auditOnly = process.env.AUDIT_ONLY === "true";
      const hasFindings = reportedAnnotations.length > 0;
      const conclusion = hasFindings ? (auditOnly ? "neutral" : "action_required") : "success";
      const title = hasFindings ? `zizmor found ${reportedAnnotations.length} finding(s)` : "No findings";
      const summary = buildSummary(reportedAnnotations);

      const annotate = process.env.ANNOTATE !== "false";
      await updateCheckRun(context, checkRunId, annotate ? reportedAnnotations : [], title, summary, conclusion);
    } catch (error) {
      app.log.error(error);
      await context.octokit.checks.update(
        context.repo({
          check_run_id: checkRunId,
          status: "completed",
          conclusion: "failure",
          completed_at: new Date().toISOString(),
          output: {
            title: "zizmor error",
            summary: `An error occurred:\n\n\`\`\`\n${error.message}\n\`\`\``,
          },
        }),
      );
    }
  }

  app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"], async (context) => {
    const { pull_request } = context.payload;
    await scan(context, pull_request.head.sha, pull_request.number);
  });

  app.on("check_run.rerequested", async (context) => {
    const { check_run } = context.payload;
    if (check_run.name !== CHECK_NAME) return;
    const pr = check_run.check_suite?.pull_requests?.[0];
    if (!pr) return;
    await scan(context, check_run.head_sha, pr.number);
  });

  app.on("check_suite.rerequested", async (context) => {
    const { check_suite } = context.payload;
    if (check_suite.app?.id !== parseInt(process.env.APP_ID, 10)) return;
    const pr = check_suite.pull_requests?.[0];
    if (!pr) return;
    await scan(context, check_suite.head_sha, pr.number);
  });
};
