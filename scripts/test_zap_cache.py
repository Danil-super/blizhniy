import copy
import unittest
from itertools import count

from check_zap_cache import DISCOVERY, ORIGIN, HOST, REDIRECTS, SERVICE_REDIRECT, check_policy, verify_scan

PATHS = ("", *DISCOVERY, *REDIRECTS)
ITEMS = [dict(uri=ORIGIN + p, method="GET", evidence="308" if p in REDIRECTS else "no-store") for p in PATHS]
ALERT = dict(pluginid="10049", alertRef="10049-1", riskcode="0", count="5", instances=ITEMS)
SITE = {"@name": ORIGIN, "@host": HOST, "@port": "443", "@ssl": "true", "alerts": [ALERT]}
SUMMARY = "FAIL-NEW: 0 FAIL-INPROG: 0 WARN-NEW: 1 WARN-INPROG: 0 INFO: 0 IGNORE: 0 PASS: 67"
LOG = "Total of 495 URLs\nWARN-NEW: Non-Storable Content [10049] x 5\n" + SUMMARY
CSS = "/_next/static/css/ab01.css"


def responses():
    serial = count()
    def get(path, headers=None):
        if path == CSS:
            static = {"Content-Type": "text/css", "Cache-Control": "public, immutable, max-age=31536000", "ETag": '"123"'}
            if headers == {"If-None-Match": '"123"'}:
                return 304, static, b""
            return 200, static, b"body{}"
        if path in DISCOVERY:
            mime = "text/plain" if path == "/robots.txt" else "application/xml"
            return 200, {"Cache-Control": "no-store, no-cache, must-revalidate", "Content-Type": mime}, b"document"
        if path in (*REDIRECTS, SERVICE_REDIRECT):
            return 308, {"Location": path[:-1]}, b""
        nonce = f"n{next(serial)}"
        body = f'<link rel="stylesheet" href="{CSS}"><script nonce="{nonce}"></script>'.encode()
        return 200, {"Cache-Control": "private, no-store, max-age=0, must-revalidate, no-cache",
                     "Content-Security-Policy": f"script-src 'strict-dynamic' 'nonce-{nonce}'"}, body
    return get


class CacheTests(unittest.TestCase):
    def report(self, alerts):
        return {"@programName": "ZAP", "site": [{**SITE, "alerts": alerts}]}

    def test_reviewed_and_clean(self):
        verify_scan(self.report([ALERT]), LOG, 2)
        verify_scan(self.report([]), "Total of 20 URLs\n" + SUMMARY.replace("WARN-NEW: 1", "WARN-NEW: 0"), 0)
        check_policy(responses())

    def test_service_redirect_report(self):
        alert = copy.deepcopy(ALERT)
        alert["instances"][-1]["uri"] = ORIGIN + SERVICE_REDIRECT
        verify_scan(self.report([alert]), LOG, 2)
        for replacement in (ORIGIN + REDIRECTS[1], ORIGIN + SERVICE_REDIRECT, ORIGIN + "/unknown/"):
            alert["instances"][-2]["uri"] = replacement
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                verify_scan(self.report([alert]), LOG, 2)

    def test_unreviewed_report(self):
        for field, value in [("pluginid", "10015"), ("riskcode", "1"), ("alertRef", "10049-3"), ("count", "6"),
                             ("instances", ITEMS[:-1]), ("instances", ITEMS + ITEMS[:1]),
                             ("instances", ITEMS[1:] + ITEMS[1:2])]:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                verify_scan(self.report([{**ALERT, field: value}]), LOG, 2)
        for edit in [dict(uri=ORIGIN+"/cabinet"), dict(uri=ORIGIN+"/?x=1"), dict(uri="https://example.org/"),
                     dict(method="POST"), dict(evidence="private")]:
            alert = copy.deepcopy(ALERT)
            alert["instances"][0].update(edit)
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                verify_scan(self.report([alert]), LOG, 2)
        for alerts, code in [([ALERT, ALERT], 2), ([], 2), ([ALERT], 0), ([ALERT], 1), ([ALERT], 3)]:
            with self.subTest(code=code), self.assertRaises(ValueError):
                verify_scan(self.report(alerts), LOG, code)

    def test_report_provenance(self):
        for bad_log in ["", SUMMARY, LOG.replace("x 5", "x 6"), LOG.replace("IGNORE: 0", "IGNORE: 1"),
                        LOG.replace("FAIL-NEW: 0", "FAIL-NEW: 1"), LOG + "\n" + SUMMARY]:
            with self.subTest(log=bad_log), self.assertRaises(ValueError):
                verify_scan(self.report([ALERT]), bad_log, 2)
        report = self.report([ALERT])
        report["site"][0]["@name"] = "https://example.org"
        with self.assertRaises(ValueError):
            verify_scan(report, LOG, 2)

    def test_live_policy_changes(self):
        cases = [
            ("/", 200, {"Cache-Control": "public, max-age=60"}), ("/admin", 200, {"Content-Security-Policy": ""}),
            ("/cabinet", 503, {}), ("/robots.txt", 200, {"Cache-Control": "public"}),
            ("/sitemap.xml", 200, {"Content-Type": "text/html"}), (REDIRECTS[0], 302, {}),
            (REDIRECTS[0], 308, {"Location": "https://example.org/"}), (REDIRECTS[1], 308, {"Set-Cookie": "x=1"}),
            (SERVICE_REDIRECT, 308, {"Location": "/other"}), (SERVICE_REDIRECT, 308, {"Set-Cookie": "x=1"}),
            (CSS, 200, {"Cache-Control": "no-store"}), (CSS, 200, {"ETag": ""}),
        ]
        for target, status, override in cases:
            original = responses()
            def changed(path, headers=None):
                code, fields, body = original(path, headers)
                return (status, fields | override, body) if path == target else (code, fields, body)
            with self.subTest(target=target, override=override), self.assertRaises(ValueError):
                check_policy(changed)

    def test_nonce_reuse(self):
        def repeat_first_response(path, headers=None):
            return responses()(path, headers)
        with self.assertRaisesRegex(ValueError, "nonce"):
            check_policy(repeat_first_response)

    def test_wrong_nonce_in_document(self):
        original = responses()
        def changed(path, headers=None):
            code, fields, body = original(path, headers)
            return code, fields, body.replace(b'nonce="n', b'nonce="other')
        with self.assertRaisesRegex(ValueError, "nonce"):
            check_policy(changed)

    def test_conditional_request_returns_full_body(self):
        original = responses()
        def ignores_condition(path, headers=None):
            return original(path)
        with self.assertRaisesRegex(ValueError, "revalidation"):
            check_policy(ignores_condition)


if __name__ == "__main__":
    unittest.main()
