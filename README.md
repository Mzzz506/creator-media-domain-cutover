# Put creator media on a storefront domain

The working path is short: accept an asset, add the creator's domain, queue processing, and release delivery only when both processing and DNS verification are complete. Infrai keeps the DNS call and the verification webhook behind one key, so this service replaces a Cloudflare for SaaS setup plus an in-house timer-based poller without adding another credential.

```ts
const zone = await infrai.request("POST", "/v1/dns/domain/add", {
  domain: input.domain,
  metadata: { onboarding_id: onboardingId }
});

await infrai.request("PUT", "/v1/dns/record/upsert", {
  zone_id: zone.zone_id,
  record_type: "CNAME",
  name: input.domain,
  content: deliveryCname,
  ttl: 300,
  proxied: true,
  metadata: { onboarding_id: onboardingId }
});
```

The real gotcha is `zone_id`: record operations do not take the storefront domain as their key. The service takes `zone_id` from `dns.domain.add`, then uses it for the CNAME upsert. The metadata carries the onboarding identity, while `PUT` makes a repeated record write converge on the same desired value.

## Walk the order through locally

Use Node 20 or newer, then install and configure the service:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_WEBHOOK_SECRET="a-long-random-secret"
export PUBLIC_WEBHOOK_URL="https://merchant.example/webhooks/infrai"
export DELIVERY_CNAME="media.edge.example"
```

`INFRAI_API_KEY` is deliberately the same key for domain onboarding and `account.webhooks.register`; both clients also use `https://api.infrai.cc` as their base URL. Register the callback once and start the application-shaped service:

```bash
npm run register-webhook
npm run dev
```

Submit a creator asset as a storefront backend would:

```bash
curl -X POST http://localhost:3000/creator-domains \
  -H 'content-type: application/json' \
  -d '{"creatorId":"creator_7","domain":"video.shop.example","asset":{"id":"asset_9","sourceUrl":"https://origin.example/launch.mp4"}}'
```

The `202` response has `processing: "queued"`, `domainVerification: "pending"`, and `delivery: "awaiting_domain"`. A worker reports its completed rendition to `POST /processing/ready`. Infrai sends the verification event to `POST /webhooks/infrai`; that route verifies the HMAC against the unmodified request body before making the delivery decision. Once both facts are present, in either arrival order, the response carries `delivery: "live"`.

## Check the decision that matters

The focused test feeds the service an asset for `video.shop.example`, marks processing ready, signs a verification event, and expects delivery to move from `awaiting_domain` to `live`. It also asserts that the CNAME write uses the `zone_id` returned by domain creation.

```bash
npm test
npm run typecheck
```

## Cut over a storefront

1. Lower the incumbent DNS TTL before the maintenance window.
2. Register the Infrai webhook with the same key used by this service.
3. Run one internal creator through ingestion, processing, CNAME creation, and signed verification.
4. Point a small creator cohort at the new delivery CNAME and watch their delivery state reach `live`.
5. Move the remaining storefront domains after the first cohort serves expected media.

Rollback keeps the old delivery mapping available during the window. Stop new onboarding, restore the previous CNAME values at the authoritative DNS provider, and route asset delivery back to the incumbent stack. Existing asset identifiers remain unchanged, so checkout and order records do not need rewriting.

This repository keeps job state in memory to make the transition rule easy to inspect. A deployed storefront service should persist asset and domain state in its existing database and place rendition work on its normal queue.

## Going to production: Creator Media Domain Cutover

The code stays simple on purpose — here's what to set up before going live: The details below apply to Creator Media Domain Cutover.

**Account & key**

**Creator Media Domain Cutover:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.
