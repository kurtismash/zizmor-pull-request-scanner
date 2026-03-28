export function getDiffLines(patch) {
  if (!patch) return new Set();

  const lines = new Set();
  let rightLine = 0;

  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      rightLine = parseInt(hunk[1], 10);
      continue;
    }
    if (line.startsWith("-")) continue;
    lines.add(rightLine);
    rightLine++;
  }

  return lines;
}

export function filterAnnotationsToChangedLines(annotations, changedFileMap) {
  return annotations
    .filter((a) => {
      const file = changedFileMap.get(a.path);
      if (!file) return false;
      const diffLines = getDiffLines(file.patch);
      for (let line = a.start_line; line <= a.end_line; line++) {
        if (diffLines.has(line)) return true;
      }
      return false;
    })
    .map((a) => {
      const file = changedFileMap.get(a.path);
      const diffLines = getDiffLines(file.patch);
      if (!diffLines.has(a.end_line)) {
        return { ...a, end_line: a.start_line };
      }
      return a;
    });
}

export async function getChangedFileMap(context, prNumber) {
  const files = await context.octokit.paginate(
    context.octokit.pulls.listFiles,
    context.repo({ pull_number: prNumber, per_page: 100 }),
  );

  return new Map(files.map((f) => [f.filename, f]));
}

export async function commentOnPR(context, prNumber, headSha, annotations, changedFileMap, log) {
  const comments = [];

  for (const a of annotations) {
    const file = changedFileMap.get(a.path);
    if (!file) continue;

    const diffLines = getDiffLines(file.patch);

    // Find the last line in the annotation range that is in the diff.
    // GitHub requires the comment to be placed on a line visible in the diff.
    let commentLine = null;
    for (let line = a.end_line; line >= a.start_line; line--) {
      if (diffLines.has(line)) {
        commentLine = line;
        break;
      }
    }
    if (commentLine === null) continue;

    comments.push({
      path: a.path,
      line: commentLine,
      side: "RIGHT",
      body: `**${a.title}**\n\n${a.message}`,
    });
  }

  if (comments.length === 0) return;

  try {
    await context.octokit.pulls.createReview(
      context.repo({
        pull_number: prNumber,
        commit_id: headSha,
        event: "COMMENT",
        body: `zizmor found ${annotations.length} finding(s) in changed workflow files.`,
        comments,
      }),
    );
  } catch (err) {
    log.warn(`Failed to create PR review: ${err.message}`);
    // Fall back to a single summary comment
    const body = annotations
      .filter((a) => changedFileMap.has(a.path))
      .map((a) => `- **${a.path}:${a.start_line}** — ${a.message}`)
      .join("\n");
    if (body) {
      await context.octokit.issues.createComment(
        context.repo({
          issue_number: prNumber,
          body: `## zizmor findings\n\n${body}`,
        }),
      );
    }
  }
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function updateCheckRun(context, checkRunId, annotations, title, summary, conclusion) {
  const batches = chunk(annotations, 50);

  if (batches.length > 0) {
    for (let i = 0; i < batches.length - 1; i++) {
      await context.octokit.checks.update(
        context.repo({
          check_run_id: checkRunId,
          output: { title, summary, annotations: batches[i] },
        }),
      );
    }
    // Final batch — mark as completed
    await context.octokit.checks.update(
      context.repo({
        check_run_id: checkRunId,
        details_url: "https://docs.zizmor.sh/audits",
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output: { title, summary, annotations: batches.at(-1) },
      }),
    );
  } else {
    await context.octokit.checks.update(
      context.repo({
        check_run_id: checkRunId,
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output: { title, summary },
      }),
    );
  }
}
