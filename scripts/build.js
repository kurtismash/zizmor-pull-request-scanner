import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const buildDir = resolve(rootDir, "build");

const target = process.argv[2];

if (target === "lambda") {
  const downloadUrl = process.argv[3];
  const checksum = process.argv[4];

  if (!downloadUrl || !checksum) {
    console.error("Usage: npm run build -- lambda <download_url> <checksum>");
    process.exit(1);
  }

  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });

  cpSync(resolve(rootDir, "src"), buildDir, { recursive: true });
  cpSync(resolve(rootDir, "package.json"), resolve(buildDir, "package.json"));
  cpSync(resolve(rootDir, "package-lock.json"), resolve(buildDir, "package-lock.json"));

  execSync("npm ci --production --ignore-scripts", {
    cwd: buildDir,
    stdio: "inherit",
  });

  execSync(
    `curl -sL "${downloadUrl}" -o zizmor.tar.gz && echo "${checksum}  zizmor.tar.gz" | sha256sum -c - && tar -xzf zizmor.tar.gz && chmod +x zizmor && rm zizmor.tar.gz`,
    { cwd: buildDir, stdio: "inherit" },
  );

  console.log("Lambda build complete.");
} else {
  console.error(`Unknown build target: ${target ?? "(none)"}`);
  console.error("Usage: npm run build -- lambda <download_url> <checksum>");
  process.exit(1);
}
