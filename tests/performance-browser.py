"""Browser regression checks with synthetic accounts; never contacts production.

Requires Python Playwright and Chrome. Run: python tests/performance-browser.py
"""
import functools
import http.server
import json
from pathlib import Path
import sys
import threading
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "deploy"))
from serve_static import PublicHandler


class QuietHandler(PublicHandler):
    def log_message(self, *args):
        pass


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome", headless=True)
            for width in (320, 390, 768, 1440):
                context = browser.new_context(viewport={"width": width, "height": 900}, has_touch=width < 800)
                calls, errors = [], []

                def route_request(route):
                    url = urlsplit(route.request.url)
                    if url.netloc != urlsplit(base).netloc:
                        return route.abort()
                    if not url.path.startswith("/api/"):
                        return route.continue_()
                    calls.append(url.path)
                    data = {
                        "/api/me": {"user_id": "42", "email": "preview@example.invalid", "subscription_verified": True, "active": True, "days": 5, "subscription_url": "https://example.invalid/test"},
                        "/api/plans": {"plans": [{"id": "30d", "title": "30 дней", "days": 30, "amount": 149}]},
                        "/api/devices": {"devices": [{"id": "a" * 64, "name": "Test phone", "last_seen": 0}]},
                        "/api/payments/quote": {"quote": {"amount": 149, "base_amount": 149, "quote": "test"}},
                    }.get(url.path, {"ok": True})
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(data))

                context.route("**/*", route_request)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(base + "/cabinet/?mini_app=1#tgWebAppData=test-only")
                page.locator("#dashboardView").wait_for(state="visible")
                page.wait_for_timeout(200)
                assert calls.count("/api/me") == 1, calls
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                page.locator("#devicesBtn").click()
                page.locator(".delete-device").first.wait_for()
                page.locator("#closeDevicesBtn").click()
                page.locator(".plan-card").first.click()
                page.locator("#payAnyMethodBtn").wait_for()
                page.locator("#closePaymentModalBtn").click()
                for platform in ("android", "ios", "windows"):
                    page.goto(base + f"/instructions/{platform}/?mini_app=1")
                    videos = page.locator("video")
                    assert videos.last.locator("source").get_attribute("src") is None
                    videos.first.scroll_into_view_if_needed()
                    page.wait_for_function("document.querySelector('video').readyState >= 2")
                    page.wait_for_timeout(200)
                    assert videos.first.evaluate("v => !v.paused")
                    videos.last.scroll_into_view_if_needed()
                    page.wait_for_timeout(300)
                    if videos.first.evaluate("v => v.getBoundingClientRect().bottom > 0 && v.getBoundingClientRect().top < innerHeight"):
                        page.evaluate("scrollTo(0, 0)")
                        page.wait_for_timeout(300)
                    assert videos.first.evaluate("v => v.paused")
                    videos.last.scroll_into_view_if_needed()
                    page.emulate_media(reduced_motion="reduce")
                    page.wait_for_timeout(100)
                    assert videos.last.evaluate("v => v.paused && v.controls")
                    page.emulate_media(reduced_motion="no-preference")
                page.emulate_media(reduced_motion="reduce")
                page.goto(base + "/cabinet/?mini_app=1#tgWebAppData=test-only")
                page.locator("#devicesBtn").click()
                assert page.locator(".ui-ripple-layer").count() == 0
                assert page.locator("#devicesDialog").evaluate("e => getComputedStyle(e).animationName") == "none"
                assert not errors, errors
                context.close()
                print(f"PASS {width}px: profile, dialogs, video lifecycle, reduced motion")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
