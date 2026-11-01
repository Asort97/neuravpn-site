"""Serve only the site's public files, never the repository or environment."""
import argparse
import functools
import http.server
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlsplit

PUBLIC_DIRS = {"assets", "cabinet", "instructions", "open"}
PUBLIC_FILES = {"index.html", "google85f383bcf0c57a91.html"}
PUBLIC_SUFFIXES = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".mp4", ".woff", ".woff2"}


class PublicHandler(http.server.SimpleHTTPRequestHandler):
    def allowed(self):
        path = unquote(urlsplit(self.path).path)
        parts = PurePosixPath(path).parts[1:]
        if "\\" in path or any(part.startswith(".") for part in parts):
            return False
        root = Path(self.directory).resolve()
        current = root
        for part in parts:
            current = current / part
            if current.is_symlink():
                return False
        target = root.joinpath(*parts).resolve()
        if not target.is_relative_to(root):
            return False
        if parts and parts[0] not in PUBLIC_DIRS and path.lstrip("/") not in PUBLIC_FILES:
            return False
        if target.is_dir():
            index = target / "index.html"
            return index.is_file() and not index.is_symlink()
        return target.suffix.lower() in PUBLIC_SUFFIXES

    def send_head(self):
        if not self.allowed():
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def send_response(self, code, message=None):
        self.response_status = code
        super().send_response(code, message)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        url = urlsplit(self.path)
        suffix = PurePosixPath(url.path).suffix.lower()
        if getattr(self, "response_status", 0) in (200, 304) and url.path.startswith("/assets/") and suffix in PUBLIC_SUFFIXES and suffix != ".html":
            version = parse_qs(url.query).get("v", [""])[0]
            policy = "public, max-age=31536000, immutable" if version else "public, max-age=86400"
        else:
            policy = "no-cache"
        self.send_header("Cache-Control", policy)
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8085)
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    handler = functools.partial(PublicHandler, directory=args.directory)
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()
