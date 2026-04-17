import { ZIZMOR_AUDITS_URL } from "./constants.js";

/**
 * Descriptions and remediation guidance for each zizmor audit, sourced from
 * https://docs.zizmor.sh/audits/.
 *
 * Each entry maps the audit id (used as the `title` in zizmor's GitHub output
 * format) to a short `description` and a concise `fix` hint.
 */
const AUDIT_METADATA = {
  "anonymous-definition": {
    description:
      "Workflows or actions without a `name:` field are rendered anonymously in the GitHub Actions UI, making it harder to understand which definition is running.",
    fix: "Add a `name:` field to your workflow or action definition.",
  },
  "archived-uses": {
    description:
      "This action references an archived (read-only) repository. Archived repositories are no longer maintained and may accumulate unpatched vulnerabilities.",
    fix: "Remove the action or replace it with a maintained alternative. Many archived actions can be replaced by invoking the equivalent CLI tool directly in a `run:` step.",
  },
  artipacked: {
    description:
      "By default, `actions/checkout` persists credentials on disk. Subsequent steps may accidentally expose them, e.g. via a publicly accessible artifact.",
    fix: "Use `actions/checkout` with `persist-credentials: false` unless your workflow explicitly needs git credentials. If the persisted credential is needed, it should be made explicit with `persist-credentials: true`.",
  },
  "bot-conditions": {
    description:
      "`github.actor` can be spoofed because it refers to the last actor to modify the triggering context, not the actor that created it. This allows an attacker to bypass bot-gating conditions.",
    fix: "Use `github.event.pull_request.user.login` instead of `github.actor` to check the original author of the pull request.",
  },
  "cache-poisoning": {
    description:
      "Release workflows that restore cached build state are vulnerable to cache-poisoning attacks, where an attacker injects malicious payloads into CI caches.",
    fix: "Avoid using cached CI state in workflows that publish build artifacts. Remove or conditionally disable cache-aware actions in release workflows.",
  },
  "concurrency-limits": {
    description:
      "Without concurrency limits, multiple instances of the same workflow can run in parallel — wasting resources and enabling potential race conditions.",
    fix: "Add a `concurrency` block with `cancel-in-progress: true` to your workflow.",
  },
  "dangerous-triggers": {
    description:
      "Triggers like `pull_request_target` and `workflow_run` run in the context of the target repository while being triggerable by forks, creating a code-execution risk.",
    fix: "Replace `pull_request_target` with `pull_request` where possible. Replace `workflow_run` with `workflow_call` (reusable workflow). Never run PR-controlled code in a `pull_request_target` workflow.",
  },
  "dependabot-cooldown": {
    description:
      "Without a cooldown, Dependabot may update to a dependency version released moments ago — increasing the risk of pulling in compromised or buggy packages.",
    fix: "Add a `cooldown` setting (e.g. `default-days: 30`) to each updater in your Dependabot configuration.",
  },
  "dependabot-execution": {
    description:
      "Allowing `insecure-external-code-execution` lets Dependabot execute code from dependency manifests during updates, which may expose credentials to compromised packages.",
    fix: "Set `insecure-external-code-execution: deny` or omit the field entirely (the default is `deny`).",
  },
  "excessive-permissions": {
    description:
      "Overly broad permissions on the `GITHUB_TOKEN` give every job in the workflow more access than it needs, increasing the blast radius of a compromise.",
    fix: "Set `permissions: {}` at the workflow level to disable all permissions by default, then add minimal job-level permissions as needed.",
  },
  "forbidden-uses": {
    description:
      "This `uses:` clause matches an explicitly configured deny list (or is absent from the allow list) in the zizmor configuration.",
    fix: "Remove or replace the offending `uses:` clause, or update your zizmor configuration to allow it.",
  },
  "github-env": {
    description:
      "Writing to `GITHUB_ENV` or `GITHUB_PATH` in workflows with attacker-triggerable contexts can lead to arbitrary code execution via environment injection.",
    fix: "Avoid writing to `GITHUB_ENV`/`GITHUB_PATH` in sensitive workflows. Use `GITHUB_OUTPUT` to pass state between steps instead.",
  },
  "hardcoded-container-credentials": {
    description:
      "Docker credentials (usernames/passwords) are hardcoded directly in the workflow, making them visible to anyone with read access to the repository.",
    fix: "Move credentials to encrypted secrets and reference them as `${{ secrets.REGISTRY_PASSWORD }}`.",
  },
  "impostor-commit": {
    description:
      "A commit referenced in a `uses:` clause exists in the repository's fork network but not in the repository itself. This can be used to inject a backdoored action.",
    fix: "Verify the commit exists in the claimed repository and replace impostor commits with authentic ones from the correct repository.",
  },
  "insecure-commands": {
    description:
      "The deprecated `::set-env` and `::add-path` workflow commands are re-enabled via `ACTIONS_ALLOW_UNSECURE_COMMANDS`. These commands allow any process that can write to stdout to inject environment variables.",
    fix: "Use GitHub Actions environment files (`GITHUB_PATH`, `GITHUB_OUTPUT`) instead of the deprecated workflow commands, and remove the `ACTIONS_ALLOW_UNSECURE_COMMANDS` variable.",
  },
  "known-vulnerable-actions": {
    description: "This action has a known, publicly disclosed vulnerability tracked in the GitHub Advisories database.",
    fix: "Upgrade to a fixed version of the action, or remove its usage entirely if no fix is available.",
  },
  misfeature: {
    description:
      "This workflow uses a GitHub Actions feature considered a misfeature, such as the `pip-install` input on `actions/setup-python`, or the Windows CMD shell.",
    fix: "Remove or replace the misfeature usage. For example, install Python packages in a virtual environment via a `run:` step instead of using `pip-install`.",
  },
  obfuscation: {
    description:
      "Obfuscated `uses:` clauses or expressions (e.g. redundant path separators, no-op `fromJSON(toJSON(...))` calls) may hide the true behavior from security analysis.",
    fix: "Simplify the expression or `uses:` clause to remove the obfuscation.",
  },
  "overprovisioned-secrets": {
    description:
      "The entire `secrets` context is exposed (e.g. via `toJSON(secrets)`), giving the runner access to every secret even if only one is needed.",
    fix: "Access secrets individually by name (e.g. `${{ secrets.MY_SECRET }}`) instead of dumping the entire context.",
  },
  "ref-confusion": {
    description:
      "This action is pinned to a symbolic ref (branch or tag) that could be ambiguous. An attacker could publish a conflicting ref that takes precedence.",
    fix: "Pin the action to a full SHA commit hash instead of a branch or tag name.",
  },
  "ref-version-mismatch": {
    description:
      "The version comment on this hash-pinned action is either missing or does not match the actual pinned commit.",
    fix: "Update or add the version comment so it matches the pinned commit (e.g. `# v4.2.2`). Tools like `pinact` can do this automatically.",
  },
  "secrets-inherit": {
    description:
      "Using `secrets: inherit` forwards every secret to the reusable workflow, violating the principle of least privilege.",
    fix: "Replace `secrets: inherit` with an explicit `secrets:` block that forwards only the secrets the reusable workflow needs.",
  },
  "secrets-outside-env": {
    description:
      "Secrets are used in a job without a dedicated GitHub environment, bypassing environment protection rules that could restrict access.",
    fix: "Configure an environment (e.g. `environment: production`) with protection rules and move secrets to environment-level storage.",
  },
  "self-hosted-runner": {
    description:
      "Self-hosted runners are difficult to secure and GitHub recommends against using them in public repositories, as they can enable persistent attacker access.",
    fix: "Prefer GitHub-hosted runners. If self-hosted runners are required, use ephemeral (just-in-time) runners and require manual approval for external contributors.",
  },
  "stale-action-refs": {
    description:
      "This action is pinned to a SHA that does not correspond to a Git tag. The pinned commit may contain unreleased bugs or vulnerabilities.",
    fix: "Change the `uses:` clause to pin to a SHA that corresponds to an official Git tag/release.",
  },
  "superfluous-actions": {
    description:
      "This action performs an operation already provided by pre-installed tools on GitHub-hosted runners, adding unnecessary supply-chain risk.",
    fix: "Replace the action with the equivalent pre-installed tool (e.g. use `gh release create` instead of a third-party release action).",
  },
  "template-injection": {
    description:
      "Template expressions (`${{ ... }}`) in code contexts expand before execution and are not syntax-aware, allowing attacker-controlled inputs to inject arbitrary commands.",
    fix: "Move the expression into an `env:` block and reference it as a shell variable (e.g. `${VARNAME}`) instead of using inline `${{ }}` in `run:` blocks.",
  },
  "undocumented-permissions": {
    description:
      "Explicit permission blocks lack explanatory comments, making it harder to audit whether each permission is truly needed.",
    fix: "Add inline comments explaining why each permission is required (e.g. `id-token: write # trusted publishing`).",
  },
  "unpinned-images": {
    description:
      "Container images without a tag or pinned to `latest` can change unpredictably, as registries may not enforce immutable tags.",
    fix: "Pin the container image to a specific SHA256 digest (e.g. `image: foo/bar@sha256:...`).",
  },
  "unpinned-uses": {
    description:
      "Unpinned or symbolically-pinned actions can change without notice. Tag- or branch-pinned actions can be overwritten by the upstream repository.",
    fix: "Pin the action to a full SHA commit hash. Use Dependabot or Renovate to keep pinned actions up to date. You can also use `zizmor --fix` to auto-pin.",
  },
  "unredacted-secrets": {
    description:
      "Treating secrets as structured values (e.g. `fromJSON(secrets.X).field`) can bypass the runner's log redaction, since it only redacts the full secret string.",
    fix: "Store individual fields as separate secrets instead of using structured (e.g. JSON) secret values.",
  },
  "unsound-condition": {
    description:
      "An `if:` condition is inadvertently always true due to an interaction between multi-line YAML strings and fenced `${{ }}` expressions (trailing newline makes it truthy).",
    fix: 'Use a "bare" expression without `${{ }}` fences in `if:` conditions, or use the `|-` block scalar to strip the trailing newline.',
  },
  "unsound-contains": {
    description:
      "Using `contains()` with a string instead of an array allows substring matches, which can be exploited to bypass branch or condition checks.",
    fix: "Pass an array to `contains()` using `fromJSON()` (e.g. `contains(fromJSON('[\"refs/heads/main\"]'), github.ref)`), or use explicit `==` comparisons.",
  },
  "use-trusted-publishing": {
    description:
      "This packaging workflow uses a manual API token instead of Trusted Publishing (OIDC-based tokenless auth), which has stronger security properties.",
    fix: "Configure Trusted Publishing for your package index (PyPI, RubyGems, crates.io, npm, etc.) and remove the manual API token.",
  },
};

/**
 * Build an enriched annotation message that includes the audit description,
 * remediation guidance, and a link to the full documentation.
 */
export function buildAnnotationMessage(auditId, cleanMessage) {
  const meta = AUDIT_METADATA[auditId];
  const docUrl = `${ZIZMOR_AUDITS_URL}/#${auditId}`;

  if (!meta) {
    return `${cleanMessage}\n\nSee ${docUrl} for more information.`;
  }

  return [
    cleanMessage,
    "",
    meta.description,
    "",
    `How to fix: ${meta.fix}`,
    "",
    `See ${docUrl} for more information.`,
  ].join("\n");
}
