"""Serve a site directory the way GitHub Pages does — max-age=600 on every file — for run.sh.

    python3 server.py SITE_DIR PORT

SITE_DIR is a symlink that /__switch?to=NAME repoints at a sibling `snap-NAME`, which is how a check
"deploys" a second build mid-session. /__delay?ms=N holds its response N ms, so a page's load event
(and with it Chrome's --dump-dom) waits in REAL time while the page's script works: service-worker
install is real-time work, and the virtual-time recipe the other probes use races it.
"""
import http.server
import os
import sys
import time
import urllib.parse

SITE = os.path.abspath(sys.argv[1])
GIF = (b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00"
       b",\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel = urllib.parse.urlparse(path).path.lstrip("/")
        return os.path.join(os.path.realpath(SITE), rel)

    def end_headers(self):
        if not self.path.startswith("/__"):
            self.send_header("Cache-Control", "max-age=600")   # what Pages sends
        super().end_headers()

    def tiny(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)
        if url.path == "/__switch":
            tmp = SITE + ".tmp"
            if os.path.lexists(tmp):
                os.remove(tmp)
            os.symlink("snap-" + query["to"][0], tmp)
            os.replace(tmp, SITE)
            return self.tiny(b"ok", "text/plain")
        if url.path == "/__delay":
            time.sleep(int(query.get("ms", ["5000"])[0]) / 1000)
            return self.tiny(GIF, "image/gif")
        return super().do_GET()

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("0.0.0.0", int(sys.argv[2])), Handler).serve_forever()
