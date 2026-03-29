import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { writeFile } from "fs/promises";
import { createProbot } from "probot";
import pino from "pino";
import appFn from "./index.js";

const ssm = new SSMClient();
let probot;

const ZIZMOR_CONFIG_PATH = "/tmp/zizmor.yml";

async function fetchSSMParameter(arn) {
  console.log(`Fetching SSM parameter: ${arn}`);
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: arn, WithDecryption: true }),
  );
  return Parameter.Value;
}

async function init() {
  if (probot) return;

  const { CREDENTIALS_SSM_PARAMETER_ARN, CONFIG_SSM_PARAMETER_ARN } = process.env;

  if (CREDENTIALS_SSM_PARAMETER_ARN) {
    const credentials = JSON.parse(await fetchSSMParameter(CREDENTIALS_SSM_PARAMETER_ARN));
    for (const [key, value] of Object.entries(credentials)) {
      process.env[key] = String(value);
    }
  }

  let configPath;
  if (CONFIG_SSM_PARAMETER_ARN) {
    const configValue = await fetchSSMParameter(CONFIG_SSM_PARAMETER_ARN);
    // Replace literal \n sequences with actual newlines (common when the
    // Terraform variable is set via a shell environment variable).
    await writeFile(ZIZMOR_CONFIG_PATH, configValue.replace(/\\n/g, "\n"));
    configPath = ZIZMOR_CONFIG_PATH;
  }

  probot = createProbot({
    overrides: {
      log: pino({ level: process.env.LOG_LEVEL || "info" }, pino.destination({ fd: 1, sync: true })),
    },
  });
  await probot.load((app) => appFn(app, { configPath }));
}

export async function handler(event) {
  console.log(JSON.stringify(event, null, 2));
  await init();

  const { headers = {}, body = "", isBase64Encoded = false } = event;
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );

  const id = normalizedHeaders["x-github-delivery"];
  const name = normalizedHeaders["x-github-event"];
  const signature = normalizedHeaders["x-hub-signature-256"];
  const payload = isBase64Encoded ? Buffer.from(body, "base64").toString() : body;

  if (!id || !name || !signature) {
    return { statusCode: 400, body: "Missing GitHub webhook headers" };
  }

  try {
    await probot.webhooks.verifyAndReceive({ id, name, signature, payload });
    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("Webhook processing failed:", err);
    if (err.message?.includes("signature")) {
      return { statusCode: 401, body: "Invalid signature" };
    }
    return { statusCode: 500, body: "Internal server error" };
  }
}
