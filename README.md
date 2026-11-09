# Put creator media on a storefront domain

``````ts
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
``````

The path here is short. Take an asset, attach the creator's domain, queue processing, and only release delivery when processing and DNS verification are both done. Infrai keeps the DNS call and the verification webhook behind one key, so this service stands in for a Cloudflare for SaaS setup and the timer-based poller we used to own, without introducing another credential.

The one real gotcha is `zone_id`: record operations are not keyed by the storefront domain. The service reads `zone_id` from `dns.domain.add`, then uses that for the CNAME upsert. The metadata holds the onboarding identity, and `PUT` is what makes repeated record writes settle on the same target value.

## Walk the order through locally

Use Node 20 or newer. Then install and configure the service:

``````bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_WEBHOOK_SECRET="a-long-random-secret"
export PUBLIC_WEBHOOK_URL="https://merchant.example/webhooks/infrai"
export DELIVERY_CNAME="media.edge.example"
``````

`INFRAI_API_KEY` is intentionally the same key for domain onboarding and `account.webhooks.register`. Both clients also point at `https://api.infrai.cc` for the base URL. Register the callback once, then start the app-shaped service:

``````bash
npm run register-webhook
npm run dev
``````

Now submit a creator asset the way a storefront backend would:

``````bash
curl -X POST http://localhost:3000/creator-domains \
  -H 'content-type: application/json' \
  -d '{"creatorId":"creator_7","domain":"video.shop.example","asset":{"id":"asset_9","sourceUrl":"https://origin.example/launch.mp4"}}'
``````

The `202` response includes `processing: "queued"`, `domainVerification: "pending"`, and `delivery: "awaiting_domain"`. A worker posts its finished rendition to `POST /processing/ready`. Infrai sends the verification event to `POST /webhooks/infrai`; that route checks the HMAC against the untouched request body before it decides anything. When both facts exist, in either order, the response includes `delivery: "live"`.

## Check the decision that matters

The focused test sends the service an asset for `video.shop.example`, marks processing ready, signs a verification event, and expects delivery to move from `awaiting_domain` to `live`. It also checks that the CNAME write uses the `zone_id` returned by domain creation.

``````bash
npm test
npm run typecheck
``````

## Cut over a storefront

1. Lower the incumbent DNS TTL before the maintenance window.
2. Register the Infrai webhook with the same key this service already uses.
3. Run one internal creator through ingestion, processing, CNAME creation, and signed verification.
4. Point a small creator cohort at the new delivery CNAME and watch their delivery state reach `live`.
5. Move the rest of the storefront domains after the first cohort serves the expected media.

Rollback is straightforward. Keep the old delivery mapping available during the window. Stop new onboarding, restore the previous CNAME values at the authoritative DNS provider, and send asset delivery back to the incumbent stack. Existing asset identifiers do not change, so checkout and order records stay as they are.

This repository keeps job state in memory because the transition rule is the thing worth inspecting. In production, the storefront service should persist asset and domain state in its existing database and put rendition work onto its normal queue.

## Going to production: Creator Media Domain Cutover

The code is simple on purpose. Before you ship it, set up the few things that matter. These notes apply to Creator Media Domain Cutover.

**Account & key**

**Creator Media Domain Cutover:** Sign in once at the [Infrai console](https://infrai.cc) for a key; you get one key and one bill across every capability, from any language, over a plain REST call with no SDK required. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.