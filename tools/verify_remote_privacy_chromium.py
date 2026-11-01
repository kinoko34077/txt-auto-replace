#!/usr/bin/env python3
"""Real MV3 Chromium negative-egress test for the accepted local-only policy (#23).

All pages and the remote transform endpoint are synthetic/intercepted. No user
content or real remote API traffic is generated during the test.
"""
import json
import shutil
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_HOST = "privacy-fixture.test"
OTHER_HOST = "other-privacy-fixture.test"
API_URL = "https://api.kinotch.workers.dev/v1/transform/batch"
CONSENT_KEY = "remoteProcessingConsentV1"
SENTINEL = "学校の台風。それをやっぱり分かることは奇跡だ。"
PAGE = (
    '<!doctype html><html lang="ja"><meta charset="utf-8">'
    '<title>synthetic privacy fixture</title><body>'
    '<main><p id="target">' + SENTINEL + '</p></main>'
    '</body></html>'
)


def main():
    with tempfile.TemporaryDirectory(prefix="tar-privacy-chromium-") as scratch:
        # Test-only manifest variant removes the optional *local-only*
        # KiNoTch token-style bridge, making the stock remote API stages
        # eligible. Production source and the accepted profile remain intact.
        # This is a positive-control fixture, not a release manifest.
        extension_root = Path(scratch) / "extension"
        shutil.copytree(ROOT, extension_root, ignore=shutil.ignore_patterns(
            ".git", "node_modules", ".phase4-upstream", ".phase45b-upstream",
            "phase4-generated", "phase45b-generated", "__pycache__"
        ))
        manifest_file = extension_root / "manifest.json"
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        js = manifest["content_scripts"][0]["js"]
        assert "kinotch-profile-style-bridge.js" in js
        manifest["content_scripts"][0]["js"] = [
            name for name in js if name != "kinotch-profile-style-bridge.js"
        ]
        manifest_file.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        print("REMOTE_ELIGIBLE_TEST_MANIFEST_VARIANT", flush=True)
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(Path(scratch) / "profile"),
                channel="chromium",
                headless=True,
                args=[
                    f"--disable-extensions-except={extension_root}",
                    f"--load-extension={extension_root}",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
                ignore_https_errors=True,
                service_workers="allow",
            )
            requests = []
            try:
                def fixture(route):
                    route.fulfill(status=200, content_type="text/html; charset=utf-8", body=PAGE)

                def remote(route):
                    request = route.request
                    if request.method.upper() == "POST" and request.url.startswith(API_URL):
                        # Never include actual bodies in diagnostics.
                        requests.append({"method": request.method, "url": request.url})
                    route.fulfill(status=503, content_type="application/json",
                                  body='{"error":"synthetic positive-control response"}')

                # Playwright runs the most recently registered matching route
                # first. Keep the catch-all below the synthetic allowlist.
                context.route("https://**/*", lambda route: route.abort())
                context.route(f"https://{FIXTURE_HOST}/**", fixture)
                context.route(f"https://{OTHER_HOST}/**", fixture)
                context.route("https://api.kinotch.workers.dev/**", remote)

                service_worker = (
                    context.service_workers[0] if context.service_workers
                    else context.wait_for_event("serviceworker", timeout=30000)
                )
                extension_id = service_worker.url.split("/")[2]
                assert extension_id, "MV3 extension did not register"

                def set_consent(value):
                    service_worker.evaluate("""({key, value}) => new Promise((ok, fail) => {
                      chrome.storage.local.set({[key]:value}, () => {
                        const error=chrome.runtime.lastError;
                        if(error)fail(Error(error.message)); else ok(true);
                      });
                    })""", {"key": CONSENT_KEY, "value": value})

                def get_consent():
                    return service_worker.evaluate("""key => new Promise((ok, fail) => {
                      chrome.storage.local.get([key], obj => {
                        const error=chrome.runtime.lastError;
                        if(error)fail(Error(error.message)); else ok(obj[key]??null);
                      });
                    })""", CONSENT_KEY)

                assert get_consent() is None, "fresh profile must not inherit consent"
                # A standard, content-transformable synthetic page is required
                # so zero remote requests cannot merely mean a disabled extension.
                page = context.new_page()
                page.goto(f"https://{FIXTURE_HOST}/default", wait_until="domcontentloaded")
                page.wait_for_function(
                    "() => /學校|颱風|奇蹟/.test(document.querySelector('#target')?.textContent||'')",
                    timeout=30000,
                )
                assert len(requests) == 0, "default local-only emitted remote API request"
                print("DEFAULT_LOCAL_ONLY_ZERO_POST_PASS", flush=True)

                # The installed project profile includes a local-only virtual
                # 'kinotch-token-style' stage, which rightly makes remote
                # profiles ineligible regardless of consent. For the positive
                # control use only the stock manifest bundles, not that local
                # virtual stage, and confirm OFF still sends nothing.
                service_worker.evaluate("""() => new Promise((ok, fail) => {
                  chrome.storage.local.set({bundleOverrideSettingsV1:{}}, () => {
                    const error=chrome.runtime.lastError;
                    if(error)fail(Error(error.message)); else ok(true);
                  });
                })""")
                standard = context.new_page()
                standard.goto(f"https://{FIXTURE_HOST}/standard-off",
                              wait_until="domcontentloaded")
                standard.wait_for_function(
                    "() => /學校|颱風|奇蹟/.test(document.querySelector('#target')?.textContent||'')",
                    timeout=30000,
                )
                assert len(requests) == 0, "stock remote-eligible bundle transmitted without consent"
                print("STANDARD_BUNDLE_LOCAL_ONLY_ZERO_POST_PASS", flush=True)

                # Positive control: with both decisions authorized, the same
                # site/standard fixture must be eligible for an attempted POST.
                set_consent({"enabled": True, "allowedDomains": [FIXTURE_HOST]})
                assert get_consent() == {"enabled": True, "allowedDomains": [FIXTURE_HOST]}
                allowed = context.new_page()
                allowed.goto(f"https://{FIXTURE_HOST}/allowed", wait_until="domcontentloaded")
                allowed.wait_for_timeout(6500)
                if not requests:
                    # Browser-owned diagnostics, no user text or URL payload.
                    diagnostic = service_worker.evaluate("""async () => {
                      const tabs=await chrome.tabs.query({url:'https://privacy-fixture.test/allowed*'});
                      if(!tabs.length)return {error:'test tab not found'};
                      const result=await new Promise(resolve=>{
                        chrome.tabs.sendMessage(tabs[0].id,
                          {type:'GET_RUNTIME_DEBUG_SNAPSHOT'},response=>
                            resolve(chrome.runtime.lastError?{error:chrome.runtime.lastError.message}:response));
                      });
                      const state=result?.snapshot;
                      return {
                        error:result?.error,
                        enabled:state?.remoteApi?.enabled,
                        profiles:state?.remoteApi?.profiles,
                        remoteFailed:state?.remoteApi?.failed,
                        runtimeEnabled:state?.runtimeEnabled,
                        consent:state?.runtimeSettings?.remoteProcessing,
                        stageIds:state?.stages?.map(s=>s.id),
                        workerEnabled:state?.worker?.enabled,
                      };
                    }""")
                    raise AssertionError(
                        "positive control produced no remote request; "
                        + "zero-POST assertions would be vacuous: "
                        + json.dumps(diagnostic, ensure_ascii=False)
                    )
                print("OPTIN_EXACT_HOST_POST_INTERCEPTED_PASS", len(requests), flush=True)
                first_count = len(requests)

                # Another HTTPS hostname does not inherit permission.
                other = context.new_page()
                other.goto(f"https://{OTHER_HOST}/not-listed", wait_until="domcontentloaded")
                other.wait_for_function(
                    "() => /學校|颱風|奇蹟/.test(document.querySelector('#target')?.textContent||'')",
                    timeout=30000,
                )
                assert len(requests) == first_count, "unlisted hostname emitted remote POST"
                print("UNLISTED_HOST_ZERO_POST_PASS", flush=True)

                # Revoke remotely while both authorized/unauthorized tabs exist.
                set_consent({"enabled": False, "allowedDomains": [FIXTURE_HOST]})
                after_revoke = context.new_page()
                after_revoke.goto(f"https://{FIXTURE_HOST}/revoked", wait_until="domcontentloaded")
                after_revoke.wait_for_function(
                    "() => /學校|颱風|奇蹟/.test(document.querySelector('#target')?.textContent||'')",
                    timeout=30000,
                )
                assert len(requests) == first_count, "revoked permission emitted remote POST"
                print("REVOKED_NEW_TAB_ZERO_POST_PASS", flush=True)
            finally:
                context.close()


if __name__ == "__main__":
    main()
