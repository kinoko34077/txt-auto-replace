(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }
  root.RemoteApiCompatibility = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const EXPECTED_RULE_SET_VERSION = "rules-v1";
  const EXPECTED_RULE_SET_HASH = "081844df462343ce413d7e293be8ab7c12db4986fcea57d6d212704ea91111be";

  const sameProfiles = (actual, expected) => (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );

  const validateRemoteBatchResponse = (payload, {
    requestedProfiles,
    expectedTextCount,
  } = {}) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Text transform API returned an invalid batch result");
    }
    if (!Array.isArray(payload.texts) || payload.texts.length !== expectedTextCount) {
      throw new Error("Text transform API returned an invalid text batch");
    }
    if (!sameProfiles(payload.profile, requestedProfiles)) {
      throw new Error("Text transform API returned an incompatible profile");
    }
    if (payload.ruleSetVersion !== EXPECTED_RULE_SET_VERSION) {
      throw new Error("Text transform API returned an incompatible rule-set version");
    }
    if (payload.ruleSetHash !== EXPECTED_RULE_SET_HASH) {
      throw new Error("Text transform API returned an incompatible rule-set hash");
    }
    return payload.texts;
  };

  return Object.freeze({
    EXPECTED_RULE_SET_VERSION,
    EXPECTED_RULE_SET_HASH,
    validateRemoteBatchResponse,
  });
});
