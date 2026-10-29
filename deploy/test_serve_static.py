import functools
from contextlib import closing
import http.client
import http.server
import tempfile
import threading
import unittest
from pathlib import Path

from serve_static import PublicHandler


class QuietHandler(PublicHandler):
    def log_message(self, *args):
        pass


class PublicFilesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ['index.html', 'cabinet/index.html', 'assets/app.js', 'assets/photo.webp', '.env.web', '.git/config', 'start_web.sh', 'cmd/main.go', 'assets/.env', 'assets/settings.json']:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('fixture', encoding='utf-8')
        handler = functools.partial(QuietHandler, directory=str(self.root))
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path):
        with closing(http.client.HTTPConnection('127.0.0.1', self.server.server_port)) as client:
            client.request('GET', path)
            response = client.getresponse()
            response.read()
            return response.status, response.getheaders()

    def test_public_routes(self):
        for path in ['/', '/cabinet/', '/assets/app.js?v=123', '/assets/photo.webp']:
            status, headers = self.request(path)
            self.assertEqual(status, 200, path)
            self.assertIn(('Referrer-Policy', 'no-referrer'), headers)

    def test_secrets_traversal_and_listing(self):
        for path in ['/.env.web', '/.git/config', '/start_web.sh', '/cmd/main.go', '/assets/', '/assets/.env', '/assets/settings.json', '/assets/../.env.web', '/assets/%2e%2e/.env.web', '/assets/%2eenv', '/assets%5c..%5c.env.web', '/%2eenv.web', '/assets/%252e%252e/.env.web']:
            self.assertEqual(self.request(path)[0], 404, path)

    def test_symlink_to_secret_is_not_public(self):
        try:
            (self.root / 'assets/leak.js').symlink_to(self.root / '.env.web')
        except OSError:
            self.skipTest('symlink permission unavailable on this host')
        self.assertEqual(self.request('/assets/leak.js')[0], 404)


if __name__ == '__main__':
    unittest.main()
