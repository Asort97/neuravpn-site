# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/vanilla JS served by `deploy/serve_static.py` behind nginx (neuravpn.ru); Go web API (`cmd/web`) on `/api/`. No build step. The owner chose to keep the landing page build-free; shadcn/ui and Magic UI patterns are ported by hand rather than imported as React.

## Users

Russian-speaking people who need a VPN that keeps working under internet blocking, mostly arriving from Telegram on a phone. They want to get connected fast, trust that the service is real and paid for properly, and choose a subscription term.

## Product Purpose

NeuraVPN sells VPN subscriptions. A visitor signs up through the Telegram bot (`@neuravpn_bot`) or by email in the web cabinet, gets a trial or buys a term, receives a key, and pastes it into the NeuraVPN app. Success: the visitor understands the offer in seconds, trusts it, and starts in the bot or buys a plan.

## Positioning

- Works through blocking (bypasses censorship).
- Own client apps for Android and Windows; iOS connects through V2RayTun (App Store, may need a region change).

## Operating Context

- Signup: Telegram bot (trial check, channel check, plan, key) or email in `cabinet/`.
- Personal cabinet and Telegram Mini App at `cabinet/`; setup guides at `instructions/` (Android, iOS, iOS region, macOS, Windows).
- Payment by bank card (YooKassa) or Telegram Stars. Autopay available.
- Referral bonus: +15 days per invited friend. Trial access exists.

## Capabilities and Constraints

- Plans (RUB): 30 days 149, 60 days 289, 90 days 419, 365 days 1499. Extra device slots cost 50 ₽. Traffic packs: 50 GB 119, 150 GB 349, 250 GB 549.
- A global sale (percent + end date) can be active; site prices must reflect it.
- Download links and counts come from GitHub releases of `Asort97/neuravpn-client`.
- `index.html` also hosts the `?v=`/open-mode profile import flow (`site.js`); it must keep working.
- Undecided / not to be stated: server locations, device limit of the base plan.

## Brand Commitments

- Name written lowercase `neuravpn` in the wordmark ("neura" + accent "vpn").
- Keep the existing warm palette (parchment/cream with deep brown–copper accents).
- Brand art in `assets/brand/` (cat mascot, shield, network, sync, money, tools, brain icons; paper texture).

## Evidence on Hand

- Real prices, real download counts (GitHub API), real referral and trial mechanics.
- No testimonials, user counts, reviews, uptime figures, speed benchmarks or press. Do not fabricate them.
- Do not claim "no logs" or "everything only through Telegram".

## Product Principles

1. Get the visitor to a working connection with the fewest steps.
2. Trust through honesty: real prices, real mechanics, no invented proof.
3. Phone first; Telegram in-app browser is a primary environment.
4. Fast and calm: performance and motion that never jitters.

## Accessibility & Inclusion

Respect `prefers-reduced-motion`; readable contrast on the warm palette; touch targets sized for phones.
