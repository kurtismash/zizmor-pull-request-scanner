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
      const diffLines = getDiffLines(changedFileMap.get(a.path).patch);
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
