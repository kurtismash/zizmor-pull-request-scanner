# zizmor Pull Request Scanner

A GitHub App that runs [zizmor](https://github.com/zizmorcore/zizmor) on pull requests to audit GitHub Actions workflow files for security issues. Only findings on lines changed in the PR are reported, keeping the signal focused and actionable.

When a PR is opened, reopened, or updated, the app:

1. Identifies changed GitHub Actions workflow files (`.github/workflows/*.yml`, `action.yml`, `dependabot.yml`)
2. Runs zizmor against the head commit
3. Filters findings to only lines changed in the PR diff
4. Reports results as a [check run](https://docs.github.com/en/rest/checks) with inline annotations

## GitHub App Setup

Before running the app in any mode you need a GitHub App. Create one at **Settings → Developer settings → GitHub Apps → New GitHub App** with the following configuration:

**Permissions:**

| Permission | Access |
|---|---|
| Checks | Read & write |
| Contents | Read-only |
| Metadata | Read-only |
| Pull requests | Read-only |

**Events to subscribe to:**

- `Check run`
- `Check suite`
- `Pull request`

Set the **Webhook URL** to wherever the app is running (see sections below for each deployment method). Set a **Webhook secret** and note it down.

After creating the app, note the **App ID** and generate a **private key** — you'll need both.

## Running as a Probot Server

Use this method for local development or to self-host the app on your own server.

### Prerequisites

- Node.js >= 18
- [zizmor](https://docs.zizmor.sh/installation/) binary named `zizmor` in the working directory
- A GitHub App (see [GitHub App Setup](#github-app-setup))
- A webhook proxy for local development (e.g. [smee.io](https://smee.io))

### Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the example environment file and fill in your values:

   ```sh
   cp .env.example .env
   ```

   Edit `.env`:

   ```sh
   # From your GitHub App settings page
   APP_ID=123456

   # Paste the contents of the private key .pem file
   PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."

   # Must match the webhook secret set in your GitHub App
   WEBHOOK_SECRET=your-webhook-secret

   # For local development: go to https://smee.io/new and paste the URL here
   WEBHOOK_PROXY_URL=https://smee.io/your-channel

   # Optional: set to "trace" or "debug" for more verbose output
   LOG_LEVEL=info
   ```

3. Start the server:

   ```sh
   npm start
   ```

4. Set the webhook URL in your GitHub App settings to the smee.io channel URL (for local dev), or to your server's public URL.

### Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `AUDIT_ONLY` | `false` | Set to `true` to report findings as `neutral` instead of `action_required`. Useful for informational-only mode. |
| `ANNOTATE` | `true` | Set to `false` to suppress inline annotations on the check run. |
| `LOG_LEVEL` | `info` | Logging verbosity. Use `debug` or `trace` for more output. |

## Running with Docker

The Docker image packages the app and installs zizmor via pip.

```sh
# Build the image
docker build -t zizmor-status-check-app .

# Run the container
docker run \
  -e APP_ID=<app-id> \
  -e PRIVATE_KEY=<pem-value> \
  -e WEBHOOK_SECRET=<webhook-secret> \
  zizmor-status-check-app
```

Set the webhook URL in your GitHub App settings to the public URL where the container is accessible.

## Deploying to AWS with Terraform

The `infrastructure/` directory contains a Terraform module that deploys the app as an AWS Lambda function. GitHub webhooks are delivered directly to a Lambda function URL.

### AWS Resources Created

- **Lambda function** — Node.js 24.x, 10-minute timeout, bundled with the zizmor binary
- **Lambda function URL** — Public HTTPS endpoint for GitHub webhook delivery
- **SSM Parameter Store** — Two `SecureString` parameters: one for GitHub App credentials, one for the optional zizmor config
- **IAM role** — Lambda execution role with `ssm:GetParameter` access to both parameters
- **CloudWatch log group** — Lambda logs with 30-day retention

### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.0
- AWS credentials configured (e.g. `aws configure` or environment variables)
- A GitHub App (see [GitHub App Setup](#github-app-setup))

### Deploy

1. Navigate to the infrastructure directory:

   ```sh
   cd infrastructure
   ```

2. Initialise Terraform:

   ```sh
   terraform init
   ```

3. Apply (this builds the Lambda package locally, so Node.js must be installed):

   ```sh
   terraform apply
   ```

4. Note the webhook URL from the output:

   ```sh
   terraform output webhook_url
   ```

5. Set the webhook URL in your GitHub App settings to this URL.

6. Populate the credentials SSM parameter. After the first `apply`, the credentials parameter is created with placeholder values. Update it with your real GitHub App credentials:

   ```sh
   aws ssm put-parameter \
     --name "zizmor-pull-request-scanner-credentials" \
     --type SecureString \
     --overwrite \
     --value '{
       "APP_ID": "123456",
       "PRIVATE_KEY": "-----BEGIN RSA PRIVATE KEY-----\n...",
       "WEBHOOK_SECRET": "your-webhook-secret"
     }'
   ```

   > **Note:** The credentials parameter has `ignore_changes` set in Terraform, so subsequent `terraform apply` runs will not overwrite the values you set here.

### Terraform Variables

| Variable | Default | Description |
|---|---|---|
| `resource_name_prefix` | `zizmor-pull-request-scanner` | Prefix applied to all AWS resource names. |
| `zizmor_config` | `""` | YAML contents of a [zizmor configuration file](#zizmor-configuration-file). Stored in SSM and passed to zizmor via `--config` on each scan. |
| `zizmor_installation.download_url` | zizmor v1.23.1 (linux x86_64) | Download URL for the zizmor binary. |
| `zizmor_installation.checksum` | SHA256 of v1.23.1 | SHA256 checksum used to verify the downloaded binary. |

### zizmor Configuration File

Pass a [zizmor config](https://docs.zizmor.sh/configuration/) to customise audit behaviour — for example, to ignore specific rules or set severity thresholds.

In your `terraform.tfvars` (or equivalent):

```hcl
zizmor_config = <<-EOT
  rules:
    template-injection:
      ignore: true
    unpinned-uses:
      config:
        enforcement: audit
EOT
```

The contents are stored in SSM Parameter Store and written to a temporary file before each Lambda invocation.

## Development

### Running Tests

```sh
npm test
```

Tests use Node's built-in test runner with [nock](https://github.com/nock/nock) for HTTP mocking. No network calls are made.

