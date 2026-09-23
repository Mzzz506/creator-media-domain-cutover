import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { InfraiClient } from "../src/infrai_client.js";
import { hasValidSignature, MediaDeliveryService } from "../src/media_delivery.js";

class RecordingClient extends InfraiClient {
  readonly calls: Array<{ method: string; path: string; body: unknown }> = [];

  constructor() {
    super("test-key", "http://local.invalid");
  }

  override async request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    this.calls.push({ method, path, body });
    return (path.endsWith("/add") ? { zone_id: "zone_42" } : {}) as T;
  }
}

test("processed media becomes live only after a signed domain verification event", async () => {
  const client = new RecordingClient();
  const service = new MediaDeliveryService(client, "media.edge.example");
  const pending = await service.onboard({
    creatorId: "creator_7",
    domain: "video.shop.example",
    asset: { id: "asset_9", sourceUrl: "https://origin.example/launch.mp4" }
  });

  assert.equal(pending.zoneId, "zone_42");
  assert.equal(service.markProcessingReady(pending.domain)?.delivery, "awaiting_domain");

  const raw = JSON.stringify({ event: "dns.domain.verified", data: { domain: pending.domain } });
  const secret = "local-test-secret";
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(hasValidSignature(raw, signature, secret), true);
  assert.equal(service.acceptVerificationEvent(raw)?.delivery, "live");
  assert.deepEqual(client.calls.map(({ method, path }) => [method, path]), [
    ["POST", "/v1/dns/domain/add"],
    ["PUT", "/v1/dns/record/upsert"],
    ["POST", "/v1/dns/domain/verify"]
  ]);
});

test("processing completion releases media when verification arrived first", async () => {
  const service = new MediaDeliveryService(new RecordingClient(), "media.edge.example");
  const pending = await service.onboard({
    creatorId: "creator_8",
    domain: "films.shop.example",
    asset: { id: "asset_10", sourceUrl: "https://origin.example/collection.mp4" }
  });
  const raw = JSON.stringify({ event: "dns.domain.verified", data: { domain: pending.domain } });

  assert.equal(service.acceptVerificationEvent(raw)?.delivery, "awaiting_domain");
  assert.equal(service.markProcessingReady(pending.domain)?.delivery, "live");
});
