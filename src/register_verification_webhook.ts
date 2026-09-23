import { z } from "zod";
import { InfraiClient } from "./infrai_client.js";

const env = z.object({
  INFRAI_API_KEY: z.string().min(1),
  INFRAI_WEBHOOK_SECRET: z.string().min(1),
  PUBLIC_WEBHOOK_URL: z.string().url()
}).parse(process.env);

const infrai = new InfraiClient(env.INFRAI_API_KEY);
const webhook = await infrai.request("POST", "/v1/account/webhooks/register", {
  url: env.PUBLIC_WEBHOOK_URL,
  events: ["dns.domain.verified"],
  description: "Release processed creator media after domain verification",
  secret: env.INFRAI_WEBHOOK_SECRET,
  retry_policy: { max_attempts: 4 }
});

console.log(JSON.stringify(webhook, null, 2));
