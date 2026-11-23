"""Validate the production baseline and independently observe its cache policy."""
import json
import re
import sys
from html.parser import HTMLParser
from http.client import HTTPSConnection
from pathlib import Path

HOST = "xn----9sbphbgks4a4a.xn--p1ai"
ORIGIN = "https://" + HOST
DISCOVERY = ("/robots.txt", "/sitemap.xml")
REDIRECTS = ("/api/listings/*/photos/", "/api/work-publications/*/photos/")


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def verify_scan(report, log, code):
    require(code in (0, 2) and report["@programName"] == "ZAP", "Unexpected scan result")
    site, = report["site"]
    require((site["@name"], site["@host"], site["@port"], site["@ssl"]) ==
            (ORIGIN, HOST, "443", "true"), "Unexpected scan target")
    expected_warnings = int(code == 2)
    summary = (rf"^FAIL-NEW: 0\s+FAIL-INPROG: 0\s+WARN-NEW: {expected_warnings}\s+"
               r"WARN-INPROG: 0\s+INFO: 0\s+IGNORE: 0\s+PASS: [1-9]\d*[ \t]*$")
    summaries = [line for line in log.splitlines() if line.startswith("FAIL-NEW:")]
    require(len(summaries) == 1 and re.fullmatch(summary, summaries[0]), "Baseline summary mismatch")
    require(re.search(r"^Total of [1-9]\d* URLs\s*$", log, re.M), "Missing scan coverage")
    warnings = [line.strip() for line in log.splitlines() if line.startswith("WARN-NEW:")]
    require(len(warnings) == expected_warnings, "Unexpected baseline warning")
    if code == 0:
        require(site["alerts"] == [], "Clean exit with findings")
        return
    alert, = site["alerts"]
    require((alert["pluginid"], alert["alertRef"], alert["riskcode"]) ==
            ("10049", "10049-1", "0"), "Unreviewed ZAP finding")
    instances = alert["instances"]
    expected = {ORIGIN + path: "no-store" for path in ("", *DISCOVERY)}
    expected.update({ORIGIN + path: "308" for path in REDIRECTS})
    require(len(instances) == len(expected) and int(alert["count"]) == len(expected),
            "Unexpected or missing cache observations")
    require(warnings == [f"WARN-NEW: Non-Storable Content [10049] x {len(expected)}"],
            "Baseline warning does not match the report")
    for item in instances:
        uri = ORIGIN if item["uri"] == ORIGIN + "/" else item["uri"]
        require(item["method"] == "GET" and uri in expected and item["evidence"] == expected[uri],
                "Unreviewed method, URL or evidence")
        del expected[uri]


class Document(HTMLParser):
    def __init__(self):
        super().__init__()
        self.nonces = []
        self.styles = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script":
            self.nonces.append(attrs.get("nonce"))
        if tag == "link" and "stylesheet" in (attrs.get("rel") or "").split():
            self.styles.append(attrs.get("href") or "")


def fetch(path, headers=None):
    connection = HTTPSConnection(HOST, timeout=12)
    try:
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        body = response.read(4 * 1024 * 1024 + 1)
        require(len(body) <= 4 * 1024 * 1024, "Oversize response: " + path)
        for field in ("Cache-Control", "Content-Security-Policy", "ETag", "Location", "Content-Type"):
            require(len(response.headers.get_all(field, [])) <= 1, "Repeated " + field + ": " + path)
        return response.status, response.headers, body
    finally:
        connection.close()


def directives(headers):
    return [part.strip().lower() for part in headers.get("Cache-Control", "").split(",")]


def check_policy(get=fetch):
    nonces = set()
    for path in ("/", "/admin", "/cabinet"):
        for _ in range(2):
            status, headers, body = get(path)
            require(status == 200 and sorted(directives(headers)) ==
                    ["max-age=0", "must-revalidate", "no-cache", "no-store", "private"], path)
            rules = [rule.split()[1:] for rule in headers.get("Content-Security-Policy", "").split(";")
                     if rule.split()[:1] == ["script-src"]]
            require(len(rules) == 1 and "'strict-dynamic'" in rules[0], "Missing script policy: " + path)
            nonce, = [s[7:-1] for s in rules[0] if re.fullmatch(r"'nonce-[A-Za-z0-9+/=_-]+'", s)]
            doc = Document()
            doc.feed(body.decode())
            require(nonce not in nonces and set(doc.nonces) == {nonce}, "Reused or mismatched nonce: " + path)
            nonces.add(nonce)
            if path == "/":
                css = next(href for href in doc.styles if re.fullmatch(r"/_next/static/css/[\da-f]+\.css", href))
    for path, mime in zip(DISCOVERY, ("text/plain", "application/xml")):
        status, headers, body = get(path)
        require(status == 200 and body and headers.get("Content-Type", "").split(";")[0] == mime and
                "Set-Cookie" not in headers and sorted(directives(headers)) ==
                ["must-revalidate", "no-cache", "no-store"], path)
    for path in REDIRECTS:
        status, headers, _ = get(path)
        require(status == 308 and headers.get("Location") == path[:-1] and
                "Set-Cookie" not in headers and "Cache-Control" not in headers, path)
    status, headers, body = get(css)
    static_cache = ["immutable", "max-age=31536000", "public"]
    require(status == 200 and body and sorted(directives(headers)) == static_cache and
            headers.get("Content-Type", "").split(";")[0] == "text/css" and "Set-Cookie" not in headers, css)
    etag = headers.get("ETag")
    require(etag and re.fullmatch(r'"[^"\r\n]+"', etag), "Missing strong CSS ETag")
    status, headers, body = get(css, {"If-None-Match": etag})
    require(status == 304 and not body and headers.get("ETag") == etag and
            sorted(directives(headers)) == static_cache and "Set-Cookie" not in headers,
            "CSS revalidation failed")


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    verify_scan(json.loads((directory / "zap-report.json").read_text()),
                (directory / "zap-baseline.log").read_text(), int(sys.argv[2]))
    check_policy()
    print("Production scan and live cache policy verified. Full ZAP reports retained.")
