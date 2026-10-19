// Remote text transmission requires two positive user decisions:
// global opt-in AND an exact HTTPS hostname allowlist entry (#23).
// This module never makes network requests.
(() => {
  "use strict";
  const normalizeHostname = (value) => {
    if (typeof value !== "string") return "";
    const hostname = value.trim().toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname.length > 253 || hostname.includes("..")) return "";
    if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.startsWith("-") || hostname.endsWith("-")) return "";
    return hostname;
  };
  const normalize = (value) => {
    const allowedDomains = Array.isArray(value?.allowedDomains)
      ? [...new Set(value.allowedDomains.map(normalizeHostname).filter(Boolean))].slice(0, 128)
      : [];
    return { enabled: value?.enabled === true, allowedDomains };
  };
  const permits = (value, protocol, hostname) => {
    const policy = normalize(value);
    const domain = normalizeHostname(hostname);
    return policy.enabled && protocol === "https:" && domain.length > 0 &&
      policy.allowedDomains.includes(domain);
  };
  // Importing a configuration file cannot authorize transmission.
  const preserveConsentOnImport = (importedRuntime, currentRemotePolicy) => ({
    ...(importedRuntime && typeof importedRuntime === "object" ? importedRuntime : {}),
    remoteProcessing: normalize(currentRemotePolicy)
  });
  const same = (left, right) => {
    const a = normalize(left), b = normalize(right);
    return a.enabled === b.enabled &&
      a.allowedDomains.length === b.allowedDomains.length &&
      a.allowedDomains.every((domain, i) => b.allowedDomains[i] === domain);
  };
  // Used on every Options save, never trust an old tab's untouched copy.
  // Not an atomic storage CAS: concurrent writers still need versioned storage
  // isolation if strict cross-context serialization becomes a product gate.
  const reconcileForSave = (baseline, draft, latest) => {
    const current = normalize(latest);
    const proposed = normalize(draft);
    if (same(baseline, proposed)) return { ok: true, policy: current, reason: "PRESERVE_LATEST" };
    if (!same(baseline, current)) return { ok: false, policy: current, reason: "CONCURRENT_CONSENT_CHANGE" };
    return { ok: true, policy: proposed, reason: "EXPLICIT_CONSENT_EDIT" };
  };
  const api = Object.freeze({ normalize, normalizeHostname, permits, preserveConsentOnImport, same, reconcileForSave });
  globalThis.RemotePrivacyPolicy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
