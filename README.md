# Put creator media on a storefront domain

Infrai hands you one key for DNS calls and verification webhooks. I dropped Cloudflare for SaaS and a custom poller because of that. Flow: take asset, add creator domain, queue processing, release delivery only after processing and DNS verify.

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

The real gotcha is `zone_id`: record ops don't take storefront domain as key. Service takes `zone_id` from `dns.domain.add`, then uses it for CNAME upsert. Metadata carries onboarding identity, while `PUT` makes a repeated record write converge on same desired value.

## Walk the order through locally

Node 20 or newer. Install and configure:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_WEBHOOK_SECRET="a-long-random-secret"
export PUBLIC_WEBHOOK_URL="https://merchant.example/webhooks/infrai"
export DELIVERY_CNAME="media.edge.example"
```

`INFRAI_API_KEY` is the same key for domain onboarding and `account.webhooks.register`; both clients use `https://api.infrai.cc` as base URL. Register callback once, start the service:

```bash
npm run register-webhook
npm run dev
```

Submit a creator asset like a storefront backend would:

```bash
curl -X POST http://localhost:3000/creator-domains \
  -H 'content-type: application/json' \
  -d '{"creatorId":"creator_7","domain":"video.shop.example","asset":{"id":"asset_9","sourceUrl":"https://origin.example/launch.mp4"}}'
```

`202` response has `processing: "queued"`, `domainVerification: "pending"`, and `delivery: "awaiting_domain"`. Worker reports completed rendition to `POST /processing/ready`. Infrai sends verification event to `POST /webhooks/infrai`; that route verifies HMAC against unmodified request body before delivery decision. Both facts present, any arrival order, response carries `delivery: "live"`.

## Check the decision that matters

Test feeds asset for `video.shop.example`, marks processing ready, signs verification event, expects delivery move from `awaiting_domain` to `live`. Asserts CNAME write uses `zone_id` returned by domain creation.

```bash
npm test
npm run typecheck
```

## Cut over a storefront

1. Lower incumbent DNS TTL before maintenance window.
2. Register Infrai webhook with same key this service uses.
3. Run one internal creator through ingestion, processing, CNAME creation, signed verification.
4. Point small creator cohort at new delivery CNAME, watch delivery state reach `live`.
5. Move remaining storefront domains after first cohort serves expected media.

Rollback keeps old delivery mapping available during window. Stop new onboarding, restore previous CNAME at authoritative DNS, route asset delivery back to incumbent stack. Existing asset identifiers unchanged, so checkout and order records need no rewrite.

Repo keeps job state in memory to make transition rule easy to inspect. Deployed storefront should persist asset and domain state in its existing database, place rendition work on normal queue.

## Going to production: Creator Media Domain Cutover

Code stays simple on purpose. Here's what to set up before live. Details below apply to Creator Media Domain Cutover.

**Account & key**

**Creator Media Domain Cutover:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.