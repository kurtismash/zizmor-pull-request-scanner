import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function runZizmor(repo, headSha, token, log) {
  const target = `${repo}@${headSha}`;

  log.info(`Running zizmor on ${target}`);

  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "./zizmor",
      ["--cache-dir", "/tmp/zizmor", "--format", "github", "--gh-token", token, target],
      {
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ));
  } catch (err) {
    // zizmor exits non-zero when findings are present but still writes output
    if (err.stdout) {
      stdout = err.stdout;
    } else {
      throw err;
    }
  }

  return stdout ?? "";
}

export function githubOutputToAnnotations(output) {
  const annotations = [];
  const pattern = /^::(error|warning|notice)\s+(.*?)::(.*)/;

  for (const line of output.split("\n")) {
    const match = line.match(pattern);
    if (!match) continue;

    const [, level, params, message] = match;
    const props = Object.fromEntries(
      params.split(",").map((p) => {
        const idx = p.indexOf("=");
        return [p.slice(0, idx), p.slice(idx + 1)];
      }),
    );

    const startLine = parseInt(props.line ?? "1", 10);
    const cleanMessage = message.replace(/^[^:]+:\d+:\s*/, "");

    annotations.push({
      path: props.file ?? "",
      start_line: startLine,
      end_line: parseInt(props.endLine ?? String(startLine), 10),
      annotation_level: level === "error" ? "failure" : level,
      message: `${cleanMessage}\n\nSee https://docs.zizmor.sh/audits/${props.title} for more information.`,
      title: props.title ?? "",
    });
  }

  return annotations;
}

export function buildSummary(annotations) {
  if (annotations.length === 0) {
    return "zizmor 🌈 found no issues in your GitHub Actions workflows.";
  }

  const counts = { failure: 0, warning: 0, notice: 0 };
  for (const a of annotations) counts[a.annotation_level]++;

  const parts = [];
  if (counts.failure) parts.push(`${counts.failure} error(s)`);
  if (counts.warning) parts.push(`${counts.warning} warning(s)`);
  if (counts.notice) parts.push(`${counts.notice} notice(s)`);

  return `zizmor 🌈 found ${parts.join(", ")} in your GitHub Actions workflows.\n\nSee the annotations for details.`;
}
