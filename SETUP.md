---
name: setup
description: Install softbox and openclaw if not installed. During each step that are dealing with env vars, like convex or R2 tell user what to do where to go and what to click, write to user step by step what to do.
---

Git clone https://githib.com/softbox-hq/softbox
cd softbox


1. cp .env.example .env.local


2. set convex variables: 

VITE_CONVEX_URL= 
CONVEX_URL= 


run `npx covex dev` and select existing project taht you just created.

3. R2 setup
 a, go to Login to Cloudflare dash.cloudflare.com and go to /r2/overview
 b, click on create new bucket
 c, give it name for example `softbox-r2`; location Automatic, default storage class standard, and click on create bucket
 d, when the bucket is created, you should see 3 tabs: "Objects", "Metrics", and "Settings"
 e, go to Settings and copy the URL from "S3 API" in the format
 `https://some-number.r2.cloudflarestorage.com/softbox-r2`
 f, place that exact value into `.env.local` as the `S3_API` env var
 g, in the same settings, enable "Public Development URL" if it is not already enabled
 h, copy that exact value into `.env.local` as `PUBLIC_DEVELOPMENT_URL`
 i, go back to R2 Object Storage on route `/r2/overview` and on the right side of page is "Account Details" with API Tokens , click on button "{} Manage" and create Account API token:
  Provide name,
  And make it "Object Read & Write: Allows the ability to read, write, and list objects in specific buckets."
  Specify bucket(s): Apply to specific buckets only, and choose the name of bucketm `sogtbox-r2`
  Client IP Address Filtering: leave empty
  click on create ACCount api token
  It will give you : "Access Key ID" , paste to the .env.local as R2_ACCESS_KEY_ID= , aslo same for "Secret Access Key" as R2_SECRET_ACCESS_KEY=


4. BullMQ

run ` docker compose up -d redis`

5. openclaw
run `jq -r '.gateway.auth.token' ~/.openclaw/openclaw.json`
and save the token as OPENCLAW_GATEWAY_TOKEN=
leave `OPENCLAW_AGENT_ID_PREFIX` blank in `.env.local`
Softbox will generate a checkout-scoped prefix during `pnpm setup` or `pnpm start` so multiple local clones do not reuse the same OpenClaw agents
