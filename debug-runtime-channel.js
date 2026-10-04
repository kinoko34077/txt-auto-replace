(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }
  root.DebugRuntimeChannel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const LEGACY_DEBUG_ATTRIBUTES = Object.freeze([
    "data-jpn-transform-debug-targets",
    "data-jpn-transform-last-debug",
    "data-jpn-transform-debug-history",
    "data-jpn-transform-runtime-snapshot",
  ]);

  const normalizeTargets = (targets) => {
    if (!Array.isArray(targets)) return [];
    return [...new Set(
      targets
        .map((target) => `${target ?? ""}`.trim())
        .filter(Boolean),
    )];
  };

  const createDebugAuthority = (document) => {
    let targets = [];

    return Object.freeze({
      getTargets() {
        return [...targets];
      },
      hasTargets() {
        return targets.length > 0;
      },
      setTargets(nextTargets) {
        targets = normalizeTargets(nextTargets);
        return [...targets];
      },
      clearLegacyDomState() {
        const element = document?.documentElement;
        if (!element) return;
        for (const attribute of LEGACY_DEBUG_ATTRIBUTES) {
          element.removeAttribute(attribute);
        }
      },
    });
  };

  return Object.freeze({
    LEGACY_DEBUG_ATTRIBUTES,
    normalizeTargets,
    createDebugAuthority,
  });
});
