import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { createProbot } from "probot";
import pino from "pino";
import appFn from "./index.js";

const ssm = new SSMClient();
let probot;

async function init() {
  if (probot) return;

  const { CREDENTIALS_SSM_PARAMETER_ARN } = process.env;
  if (CREDENTIALS_SSM_PARAMETER_ARN) {
    console.log(`Getting SSM param ${CREDENTIALS_SSM_PARAMETER_ARN}`);
    const { Parameter } = await ssm.send(
      new GetParameterCommand({ Name: CREDENTIALS_SSM_PARAMETER_ARN, WithDecryption: true }),
    );
    const config = JSON.parse(Parameter.Value);
    for (const [key, value] of Object.entries(config)) {
      process.env[key] = String(value);
    }
  }

  probot = createProbot({
    overrides: {
      log: pino({ level: process.env.LOG_LEVEL || "info" }, pino.destination({ fd: 1, sync: true })),
    },
  });
  await probot.load(appFn);
}

export async function handler(event) {
  console.log(JSON.stringify(event, null, 2));
  await init();

  const { headers = {}, body = "", isBase64Encoded = false } = event;

  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

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
