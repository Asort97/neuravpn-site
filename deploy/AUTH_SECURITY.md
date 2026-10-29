# Authentication deployment

- Start the site with `start_web.sh`, not `python -m http.server` from the
  repository root. The public-file server and API bind to loopback by default.
- Keep `.env.web` outside the public document surface and readable only by the
  service account. Nginx must deny dotfiles and nonpublic repository paths.
- Proxy `/api/` to `127.0.0.1:8090`, setting `X-Real-IP` from the connection
  address. Proxy the public site to `127.0.0.1:8085`. Do not expose either port
  to the Internet. Preserve the existing TLS and domain configuration.
- Mini Apps authenticate with signed Telegram initData, independently of
  email verification and browser cookie support. Never trust initDataUnsafe
  or a client-supplied Telegram ID as proof of identity.
- Website email login requires `verified_email`. Receipt email is not proof
  of ownership. Website Telegram login uses the existing bot confirmation
  flow; no bot protocol or database schema migration is required.
- SMTP errors must return an error, not a successful "code sent" response.
  OTPs, initData and authentication tokens must never be logged.

## Tests

```sh
go test ./...
node --test tests/auth-ui.test.cjs assets/js/subscription-state.test.cjs
python3 -m unittest discover -s deploy -p 'test_*.py' -v
```

PostgreSQL integration tests require `AUTH_TEST_DATABASE_DSN` pointing to a
separate database whose name begins with `neuravpn_auth_test`. Each test
creates and removes its own schema. Never point this at the application DB.

After deployment, verify `/cabinet/`, its assets and `/healthz` succeed;
`/.env.web`, `/.git/config`, `/start_web.sh` and `/cmd/web/main.go` return 404;
unauthenticated `/api/me` returns 401, and both application listeners remain
on loopback. Preserve the containment configuration during any rollback.

If an environment file was publicly exposed, blocking it is containment,
not credential rotation. Replace exposed provider credentials in coordination
with all consumers, including the bot, website, payments and VPN panel APIs.
