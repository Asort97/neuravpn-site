# Cabinet devices and promotions

The web API and Telegram bot must share `TG_BOT_TOKEN` and the existing PostgreSQL database. No panel credentials reach the browser.

Deploy the bot device endpoint before the website. The bot launcher must run `go run .` (or build the entire package with `go build .`), not `go run main.go`.

`BOT_WEB_DEVICES_URL` defaults to `http://127.0.0.1:8080/internal/web/devices`. Only literal loopback addresses are allowed. Requests use purpose-separated HMAC signatures, a 60-second timestamp window, and single-use nonces. Keep this route inaccessible in the public reverse proxy as additional defense.

Device IDs are opaque and user-bound. Ownership is re-read before deletion, including merged panels. Removing an HWID registration does not revoke the VPN credential; subscription refresh can register it again. Partial panel failures are shown explicitly.

Promo activation uses the bot's `promocodes` and `user_promocodes` tables. The bot's existing selection rule (latest `discount_until`) is preserved; discounts do not stack. The payment endpoint requires a signed, user/plan-bound quote and rechecks the active discount before requesting payment. Expired or changed quotes return 409, never a silent full-price payment. A 100% code requires support fulfillment: the site does not create zero-value YooKassa payments or invent a new free-plan grant workflow.

Checks: `go test ./cmd/web`, `node --test tests/*.test.cjs assets/js/subscription-state.test.cjs`, and `python -m unittest discover -s deploy`. Database tests require an isolated database named `neuravpn_auth_test*` through `AUTH_TEST_DATABASE_DSN`; never use the production database.
