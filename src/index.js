import { runZizmor as defaultRunZizmor, githubOutputToAnnotations, buildSummary } from "./zizmor.js";
import { getChangedFileMap, filterAnnotationsToChangedLines, completeCheckRun, updateCheckRun } from "./github.js";
import { CHECK_NAME } from "./constants.js";

const WORKFLOW_FILE_PATTERN =
  /(?:\.github\/workflows\/[^/]+\.(yml|yaml)$|(?:^|\/)(?:action|dependabot)\.(yml|yaml)$)/;

function isWorkflowFile(filename) {
  return WORKFLOW_FILE_PATTERN.test(filename);
}

/**
 * Main entrypoint to the zizmor status-check Probot app.
 *
 * @param {import('probot').Probot} app
 * @param {object} [deps] — injectable dependencies (used in tests)
 * @param {Function} [deps.runZizmor] — async (repo, sha, token, log, configPath) => github output string
 * @param {string|undefined} [deps.configPath] — optional path to a zizmor configuration file
 */
export default (app, { runZizmor = defaultRunZizmor, configPath } = {}) => {
  async function scan(context, sha, prNumber) {
    const repo = `${context.repo().owner}/${context.repo().repo}`;

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
    const workflowFiles = [...changedFileMap.entries()].filter(([filename]) => isWorkflowFile(filename));

    if (workflowFiles.length === 0) {
      await completeCheckRun(
        context,
        checkRunId,
        "skipped",
        "No workflow changes",
        "No GitHub Actions workflow or action files were changed in this PR.",
      );
      return;
    }

    if (workflowFiles.every(([, file]) => file.status === "removed")) {
      await completeCheckRun(
        context,
        checkRunId,
        "success",
        "No findings",
        "All workflow files in this PR were deleted. Nothing to scan.",
      );
      return;
    }

    try {
      const { token } = await context.octokit.auth({ type: "installation" });
      const output = await runZizmor(repo, sha, token, app.log, configPath);
      const annotations = githubOutputToAnnotations(output);
      const reportedAnnotations = filterAnnotationsToChangedLines(annotations, changedFileMap);

      const hasFindings = reportedAnnotations.length > 0;
      const conclusion = hasFindings ? (process.env.AUDIT_ONLY === "true" ? "neutral" : "action_required") : "success";
      const title = hasFindings ? `zizmor found ${reportedAnnotations.length} finding(s)` : "No findings";
      const summary = buildSummary(reportedAnnotations);
      const includeAnnotations = process.env.ANNOTATE !== "false";

      await updateCheckRun(context, checkRunId, includeAnnotations ? reportedAnnotations : [], title, summary, conclusion);
    } catch (error) {
      app.log.error(error);
      await completeCheckRun(
        context,
        checkRunId,
        "failure",
        "zizmor error",
        `An error occurred:\n\n\`\`\`\n${error.message}\n\`\`\``,
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
