import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { InfraiClient } from "./infrai_client.js";

export const onboardingSchema = z.object({
  creatorId: z.string().min(1),
  domain: z.string().min(3),
  asset: z.object({
    id: z.string().min(1),
    sourceUrl: z.string().url()
  })
});

const verificationEventSchema = z.object({
  event: z.literal("dns.domain.verified"),
  data: z.object({ domain: z.string().min(3) })
});

const zoneSchema = z.object({ zone_id: z.string().min(1) });

export type Onboarding = z.infer<typeof onboardingSchema>;
export type DeliveryState = {
  creatorId: string;
  domain: string;
  zoneId: string;
  assetId: string;
  processing: "queued" | "ready";
  domainVerification: "pending" | "verified";
  delivery: "awaiting_domain" | "live";
};

export class MediaDeliveryService {
  private readonly states = new Map<string, DeliveryState>();
  private readonly infrai: InfraiClient;
  private readonly deliveryCname: string;

  constructor(
    infrai: InfraiClient,
    deliveryCname: string
  ) {
    this.infrai = infrai;
    this.deliveryCname = deliveryCname;
  }

  async onboard(input: Onboarding): Promise<DeliveryState> {
    const onboardingId = `${input.creatorId}:${input.asset.id}`;
    const zone = zoneSchema.parse(await this.infrai.request(
      "POST",
      "/v1/dns/domain/add",
      { domain: input.domain, metadata: { onboarding_id: onboardingId } }
    ));

    await this.infrai.request("PUT", "/v1/dns/record/upsert", {
      zone_id: zone.zone_id,
      record_type: "CNAME",
      name: input.domain,
      content: this.deliveryCname,
      ttl: 300,
      proxied: true,
      metadata: { onboarding_id: onboardingId }
    });
    await this.infrai.request("POST", "/v1/dns/domain/verify", {
      domain: input.domain
    });

    const state: DeliveryState = {
      creatorId: input.creatorId,
      domain: input.domain,
      zoneId: zone.zone_id,
      assetId: input.asset.id,
      processing: "queued",
      domainVerification: "pending",
      delivery: "awaiting_domain"
    };
    this.states.set(input.domain, state);
    return state;
  }

  markProcessingReady(domain: string): DeliveryState | undefined {
    const state = this.states.get(domain);
    if (!state) return undefined;
    state.processing = "ready";
    this.releaseWhenReady(state);
    return state;
  }

  acceptVerificationEvent(rawBody: string): DeliveryState | undefined {
    const event = verificationEventSchema.parse(JSON.parse(rawBody));
    const state = this.states.get(event.data.domain);
    if (!state) return undefined;
    state.domainVerification = "verified";
    this.releaseWhenReady(state);
    return state;
  }

  private releaseWhenReady(state: DeliveryState): void {
    state.delivery = state.processing === "ready" && state.domainVerification === "verified"
      ? "live"
      : "awaiting_domain";
  }
}

export function hasValidSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const supplied = Buffer.from(signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}
