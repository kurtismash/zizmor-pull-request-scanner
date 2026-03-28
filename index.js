import { runZizmor as defaultRunZizmor, githubOutputToAnnotations, buildSummary } from "./zizmor.js";
import { getChangedFileMap, filterAnnotationsToChangedLines, updateCheckRun, commentOnPR } from "./github.js";

/**
 * Main entrypoint to the zizmor status-check Probot app.
 *
 * @param {import('probot').Probot} app
 * @param {object} [deps] — injectable dependencies (used in tests)
 * @param {Function} [deps.runZizmor] — async (repository, sha, token, log) => SARIF object
 */
export default (app, { runZizmor = defaultRunZizmor } = {}) => {
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    const { pull_request } = context.payload;
    const sha = pull_request.head.sha;
    const prNumber = pull_request.number;

    // Create the check run immediately so the PR shows "in progress"
    const {
      data: { id: checkRunId },
    } = await context.octokit.checks.create(
      context.repo({
        name: "zizmor 🌈",
        head_sha: sha,
        status: "in_progress",
        started_at: new Date().toISOString(),
      }),
    );

    const changedFileMap = await getChangedFileMap(context, prNumber);

    // Exit early if no workflow files were touched
    const workflowPattern = /(?:\.github\/workflows\/[^/]+\.(yml|yaml)$|(?:^|\/)(?:action|dependabot)\.(yml|yaml)$)/;
    const hasRelevantFiles = [...changedFileMap.keys()].some((f) => workflowPattern.test(f));
    if (!hasRelevantFiles) {
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

    try {
      const { token } = await context.octokit.auth({ type: "installation" });
      const output = await runZizmor(`${context.repo().owner}/${context.repo().repo}`, sha, token, app.log);
      const annotations = githubOutputToAnnotations(output);

      // Only report findings on lines changed in this PR
      const reportedAnnotations = filterAnnotationsToChangedLines(annotations, changedFileMap);

      const conclusion = reportedAnnotations.length > 0 ? "action_required" : "success";
      const title =
        reportedAnnotations.length > 0 ? `zizmor found ${reportedAnnotations.length} finding(s)` : "No findings";
      const summary = buildSummary(reportedAnnotations);

      const annotate = process.env.ANNOTATE !== "false";
      await updateCheckRun(context, checkRunId, annotate ? reportedAnnotations : [], title, summary, conclusion);

      // Post inline review comments for findings on changed lines
      const commentOnPREnabled = process.env.COMMENT_ON_PR !== "false";
      if (commentOnPREnabled && reportedAnnotations.length > 0) {
        await commentOnPR(context, prNumber, sha, reportedAnnotations, changedFileMap, app.log);
      }
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
  });
};
