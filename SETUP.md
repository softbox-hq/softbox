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
