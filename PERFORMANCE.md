# UI Performance Pass - 2026-11-02

## Scope

- Existing parchment identity and account/payment behavior retained.
- Self-hosted Inter and JetBrains Mono subsets; no Google Fonts stylesheet dependency.
- Smaller paper texture (293,374 -> 41,176 bytes) and 128px display icons.
- Mobile cards/dialogs no longer stack large backdrop blurs. No fixed texture repaint.
- Instruction videos load on intersection, pause offscreen/when hidden, and expose
  manual controls for reduced motion, data saving, or blocked autoplay. Their
  intrinsic dimensions reserve space before loading.
- Initial pageshow no longer immediately reloads a freshly verified profile.
  Unknown status still retries; hidden pages do not redraw the subscription timer.
- Versioned public assets cache for a year; unversioned assets for a day. HTML,
  blocked files and error responses continue to revalidate. No API cache changes.
- Short ripple and panel transitions adapt Magic UI patterns without importing
  React/Motion into the existing vanilla frontend. Reduced motion disables them.

When changing a versioned asset in future, bump its HTML query version. New
unversioned images/fonts should use new filenames. Deploy HTML and assets together.

## Lab Results

Chrome headless, 390x844 DPR 2, CPU 4x throttling, 150ms latency, 200,000 B/s
download, cold cache, three runs per route. Account APIs used synthetic data with
200ms artificial response latency, not real users or production payments.

| Measurement | Before | After |
| --- | ---: | ---: |
| Mini-app resource body bytes, median | 736,599 | about 445,100 (-40%) |
| Landing resource body bytes, median | 355,365 | about 212,300 (-40%) |
| Landing LCP, median | 1,068ms | 756ms (-29%) |
| Mini-app dashboard visible, median | 3,500ms | 3,469ms (essentially unchanged) |
| Initial profile fetches | 2 | 1 |
| Visible mobile mini-app backdrop-filter elements | 5 | 0 |

Resource bytes exclude response headers and document HTML. These figures are not
production RUM, network-transfer guarantees, or a measurement of real phone FPS.
Mini-app authentication/API readiness remains the dominant initial wait. Its
auth-to-dashboard layout transition still measures about 0.16 CLS. One landing
sample had a 0.263 CLS outlier; three follow-up samples with shift attribution had
zero CLS. Real-device and field monitoring remain necessary.

## Checks

```sh
node --test tests/auth-ui.test.cjs tests/cabinet-features.test.cjs tests/ui-motion.test.cjs assets/js/subscription-state.test.cjs
python -m unittest discover -s deploy -p 'test_*.py'
python tests/performance-browser.py
go test ./...
go vet ./cmd/web
```

The browser test requires Python Playwright and Chrome; it serves local public
files and mocks APIs, rejecting external network requests. It checks 320, 390,
768 and 1440px layouts, profile request count, device/payment dialogs, video
visibility lifecycle, and reduced-motion behavior. Separate visual checks covered
the website, mini-app, confirmations, long device names and payment forms.

## Impeccable Review

Used the supplied Impeccable context, optimize, animate and polish instructions
and detector. Corrected contrast on device buttons, secondary buttons and promo
placeholders, clipped profile text, oversized media and mobile rendering costs.
Preserved existing fonts, parchment cards and borders rather than treating
generic aesthetic warnings as permission to redesign the product. The detector's
white-on-light primary-button warning was checked against rendered styles:
enabled payment buttons have a dark brown background, not the modal background.

No production deployment or real account mutations were performed in this pass.
