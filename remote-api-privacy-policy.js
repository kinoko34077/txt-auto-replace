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
  const api = Object.freeze({ normalize, normalizeHostname, permits, preserveConsentOnImport });
  globalThis.RemotePrivacyPolicy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
