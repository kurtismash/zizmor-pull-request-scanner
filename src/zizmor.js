import { execFile } from "child_process";
import { promisify } from "util";
import { ZIZMOR_AUDITS_URL } from "./constants.js";

const execFileAsync = promisify(execFile);

const ZIZMOR_TIMEOUT_MS = 180_000;
const ZIZMOR_MAX_BUFFER = 10 * 1024 * 1024;
const GITHUB_ANNOTATION_PATTERN = /^::(error|warning|notice)\s+(.*?)::(.*)/;

export async function runZizmor(repo, headSha, token, log, configPath) {
  const target = `${repo}@${headSha}`;
  log.info(`Running zizmor on ${target}`);

  const args = ["--cache-dir", "/tmp/zizmor", "--format", "github"];
  if (configPath) {
    args.push("--config", configPath);
  }
  args.push(target);

  try {
    const { stdout } = await execFileAsync("./zizmor", args, {
      timeout: ZIZMOR_TIMEOUT_MS,
      maxBuffer: ZIZMOR_MAX_BUFFER,
      env: {
        GH_TOKEN: token,
      },
    });
    return stdout ?? "";
  } catch (err) {
    // zizmor exits non-zero when findings are present but still writes output
    if (err.stdout) return err.stdout;
    throw err;
  }
}

function parseAnnotationParams(paramString) {
  return Object.fromEntries(
    paramString.split(",").map((pair) => {
      const sep = pair.indexOf("=");
      return [pair.slice(0, sep), pair.slice(sep + 1)];
    }),
  );
}

export function githubOutputToAnnotations(output) {
  const annotations = [];

  for (const line of output.split("\n")) {
    const match = line.match(GITHUB_ANNOTATION_PATTERN);
    if (!match) continue;

    const [, level, params, message] = match;
    const props = parseAnnotationParams(params);
    const startLine = parseInt(props.line ?? "1", 10);
    const cleanMessage = message.replace(/^[^:]+:\d+:\s*/, "");

    annotations.push({
      path: props.file ?? "",
      start_line: startLine,
      end_line: parseInt(props.endLine ?? String(startLine), 10),
      annotation_level: level === "error" ? "failure" : level,
      message: `${cleanMessage}\n\nSee ${ZIZMOR_AUDITS_URL}/#${props.title} for more information.`,
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
