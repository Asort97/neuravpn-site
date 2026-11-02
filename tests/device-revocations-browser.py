"""Synthetic-device UI regression checks. No production requests or accounts.

python tests/device-revocations-browser.py [screenshot-directory]
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
sys.path.insert(0, str(ROOT / 'deploy'))
from serve_static import PublicHandler


class QuietHandler(PublicHandler):
    def log_message(self, *args):
        pass


def main():
    screenshots = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if screenshots:
        screenshots.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            for mini in (False, True):
                for width in (320, 390, 768, 1440):
                    context = browser.new_context(viewport={'width': width, 'height': 900}, has_touch=width < 800)
                    devices = [{'id': 'a' * 64, 'name': 'Samsung Galaxy S24 Ultra · Android', 'last_seen': 1793620800000}]
                    deleted, calls, errors = [], [], []

                    def route_request(route):
                        url = urlsplit(route.request.url)
                        if url.netloc != urlsplit(base).netloc:
                            return route.abort()
                        if not url.path.startswith('/api/'):
                            return route.continue_()
                        calls.append(url.path)
                        if url.path == '/api/devices/delete':
                            assert route.request.post_data_json == {'id': 'a' * 64}
                            deleted.extend(devices)
                            devices.clear()
                            data = {'devices': devices, 'result': 'queued'}
                        elif url.path == '/api/devices/restore':
                            assert route.request.post_data_json == {'id': 'a' * 64}
                            deleted.clear()
                            data = {'devices': deleted, 'result': 'restored'}
                        else:
                            data = {
                                '/api/me': {'user_id': '42', 'email': 'preview@example.invalid', 'subscription_verified': True, 'active': True, 'days': 5},
                                '/api/plans': {'plans': []},
                                '/api/devices': {'devices': devices, 'device_plan': {'enabled': True, 'extra_slots': 0}},
                                '/api/devices/deleted': {'devices': deleted},
                            }.get(url.path, {'ok': True})
                        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

                    context.route('**/*', route_request)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(base + '/cabinet/' + ('?mini_app=1#tgWebAppData=test-only' if mini else ''))
                    page.locator('#dashboardView').wait_for(state='visible')
                    page.locator('#devicesBtn').click()
                    page.locator('.delete-device').wait_for()

                    def snapshot(stage):
                        page.wait_for_timeout(200)
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                        for dialog in page.locator('dialog[open]').all():
                            assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
                        if screenshots:
                            page.screenshot(path=str(screenshots / f'{"mini" if mini else "web"}-{width}-{stage}.png'))

                    snapshot('active')
                    page.locator('.delete-device').click()
                    page.locator('#confirmDeleteDeviceBtn').click()
                    page.locator('#deleteDeviceDialog').wait_for(state='hidden')
                    page.locator('#removedDevicesBtn').click()
                    page.locator('.restore-device').wait_for()
                    assert page.locator('#devicePlanSection').is_hidden()
                    snapshot('deleted')
                    page.locator('.restore-device').click()
                    snapshot('confirm')
                    assert page.locator('#confirmDeleteDeviceBtn').evaluate('e => { const r = document.createRange(); r.selectNodeContents(e); return r.getClientRects().length === 1; }')
                    page.locator('#cancelDeleteDeviceBtn').click()
                    assert '/api/devices/restore' not in calls
                    page.locator('.restore-device').click()
                    page.locator('#confirmDeleteDeviceBtn').click()
                    page.locator('#deleteDeviceDialog').wait_for(state='hidden')
                    assert page.locator('#deviceList > li').count() == 0
                    assert 'разблокировано' in page.locator('#devicesStatus').inner_text()
                    snapshot('restored')
                    page.locator('#activeDevicesBtn').click()
                    page.wait_for_function("document.querySelector('#deviceList').getAttribute('aria-busy') === 'false'")
                    assert page.locator('#devicePlanSection').is_visible()
                    assert calls.count('/api/devices/delete') == calls.count('/api/devices/restore') == 1
                    assert not errors, errors
                    context.close()
                    print(f'PASS {"mini" if mini else "web"} {width}px: delete, list, confirm, restore, layout')
            browser.close()
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


if __name__ == '__main__':
    main()
