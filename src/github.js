import { ZIZMOR_AUDITS_URL } from "./constants.js";

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
  const result = [];

  for (const annotation of annotations) {
    const file = changedFileMap.get(annotation.path);
    if (!file) continue;

    const diffLines = getDiffLines(file.patch);
    let touchesDiff = false;
    for (let line = annotation.start_line; line <= annotation.end_line; line++) {
      if (diffLines.has(line)) {
        touchesDiff = true;
        break;
      }
    }
    if (!touchesDiff) continue;

    // Clamp end_line to diff range so GitHub renders the annotation correctly
    if (!diffLines.has(annotation.end_line)) {
      result.push({ ...annotation, end_line: annotation.start_line });
    } else {
      result.push(annotation);
    }
  }

  return result;
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

const MAX_ANNOTATIONS_PER_BATCH = 50;

export async function completeCheckRun(context, checkRunId, conclusion, title, summary) {
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

export async function updateCheckRun(context, checkRunId, annotations, title, summary, conclusion) {
  const batches = chunk(annotations, MAX_ANNOTATIONS_PER_BATCH);

  for (const batch of batches.slice(0, -1)) {
    await context.octokit.checks.update(
      context.repo({
        check_run_id: checkRunId,
        output: { title, summary, annotations: batch },
      }),
    );
  }

  const lastBatch = batches.at(-1);
  await context.octokit.checks.update(
    context.repo({
      check_run_id: checkRunId,
      ...(lastBatch && { details_url: ZIZMOR_AUDITS_URL }),
      status: "completed",
      conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title,
        summary,
        ...(lastBatch && { annotations: lastBatch }),
      },
    }),
  );
}
