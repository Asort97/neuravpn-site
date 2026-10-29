# Telegram Mini App SDK

`telegram-web-app.js` is an unmodified local copy of the official SDK from
https://telegram.org/js/telegram-web-app.js, retrieved on 2026-10-29.

Serving this file locally avoids making cabinet initialization depend on a
second origin being reachable. Update it from the official source and rerun
the authentication regression tests when updating the SDK.

The SDK does not establish trust: the API verifies Telegram's signed initData.
