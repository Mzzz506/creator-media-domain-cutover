import { createServer } from "node:http";
import { z } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import {
  hasValidSignature,
  MediaDeliveryService,
  onboardingSchema
} from "./media_delivery.js";

const envSchema = z.object({
  INFRAI_API_KEY: z.string().min(1),
  INFRAI_WEBHOOK_SECRET: z.string().min(1),
  DELIVERY_CNAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000)
});
const env = envSchema.parse(process.env);
const infrai = new InfraiClient(env.INFRAI_API_KEY);
const service = new MediaDeliveryService(infrai, env.DELIVERY_CNAME);

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/creator-domains") {
      const input = onboardingSchema.parse(JSON.parse(await readBody(request)));
      send(response, 202, await service.onboard(input));
      return;
    }
    if (request.method === "POST" && request.url === "/processing/ready") {
      const body = z.object({ domain: z.string().min(3) }).parse(JSON.parse(await readBody(request)));
      const state = service.markProcessingReady(body.domain);
      send(response, state ? 200 : 404, state ?? { message: "Domain not found" });
      return;
    }
    if (request.method === "POST" && request.url === "/webhooks/infrai") {
      const rawBody = await readBody(request);
      const signature = request.headers["x-infrai-signature"];
      if (typeof signature !== "string" || !hasValidSignature(rawBody, signature, env.INFRAI_WEBHOOK_SECRET)) {
        send(response, 401, { message: "Invalid signature" });
        return;
      }
      send(response, 200, service.acceptVerificationEvent(rawBody) ?? { received: true });
      return;
    }
    send(response, 404, { message: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { message: "Invalid request", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      send(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        message: error.message,
        code: error.code
      });
      return;
    }
    send(response, 500, { message: "Request could not be completed" });
  }
}).listen(env.PORT, () => {
  console.log(`Creator delivery service listening on http://localhost:${env.PORT}`);
});
