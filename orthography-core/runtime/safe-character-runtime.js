(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SafeCharacterRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const requireOneCodePoint = (value, label) => {
    requireNonEmptyString(value, label);
    if (Array.from(value).length !== 1) {
      throw new TypeError(`${label} must be one code point`);
    }
  };

  const createSafeCharacterRuntime = (slice) => {
    if (slice?.schemaVersion !== "1" || slice?.kind !== "japanese-orthography-safe-character-slice") {
      throw new TypeError("Unsupported safe-character slice");
    }

    const sourceIds = new Set();
    for (const source of Array.isArray(slice.sources) ? slice.sources : []) {
      requireNonEmptyString(source?.id, "safe-character source id");
      sourceIds.add(source.id);
    }

    const evidenceIds = new Set();
    for (const evidence of Array.isArray(slice.evidenceRecords) ? slice.evidenceRecords : []) {
      requireNonEmptyString(evidence?.id, "safe-character evidence id");
      requireNonEmptyString(evidence?.sourceRef, "safe-character evidence source ref");
      if (!sourceIds.has(evidence.sourceRef)) {
        throw new Error(`Unknown safe-character source ref: ${evidence.sourceRef}`);
      }
      evidenceIds.add(evidence.id);
    }

    const validateEvidenceRefs = (refs, label, required) => {
      if (refs == null && !required) return;
      if (!Array.isArray(refs) || (required && refs.length === 0)) {
        throw new TypeError(`${label} requires evidence refs`);
      }
      for (const evidenceRef of refs) {
        requireNonEmptyString(evidenceRef, "safe-character evidence ref");
        if (!evidenceIds.has(evidenceRef)) {
          throw new Error(`Unknown safe-character evidence ref: ${evidenceRef}`);
        }
      }
    };

    const excluded = new Set();
    for (const modern of Array.isArray(slice.excludedModernCharacters) ? slice.excludedModernCharacters : []) {
      requireOneCodePoint(modern, "safe-character excluded modern character");
      excluded.add(modern);
    }

    const exclusionRecordModern = new Set();
    for (const exclusion of Array.isArray(slice.exclusionRecords) ? slice.exclusionRecords : []) {
      requireOneCodePoint(exclusion?.modern, "safe-character exclusion modern character");
      requireNonEmptyString(exclusion?.reason, "safe-character exclusion reason");
      if (!excluded.has(exclusion.modern)) {
        throw new Error(`Safe-character exclusion record is not declared excluded: ${exclusion.modern}`);
      }
      if (exclusionRecordModern.has(exclusion.modern)) {
        throw new Error(`Duplicate safe-character exclusion record: ${exclusion.modern}`);
      }
      exclusionRecordModern.add(exclusion.modern);
      validateEvidenceRefs(exclusion.evidenceRefs, "Safe-character exclusion", true);
    }
    for (const modern of excluded) {
      if (!exclusionRecordModern.has(modern)) {
        throw new Error(`Missing safe-character exclusion record: ${modern}`);
      }
    }

    const map = {};
    const seenModern = new Set();
    for (const mapping of Array.isArray(slice.mappings) ? slice.mappings : []) {
      requireOneCodePoint(mapping?.modern, "safe-character modern source");
      requireOneCodePoint(mapping?.historical, "safe-character historical target");
      if (excluded.has(mapping.modern)) {
        throw new Error(`Modern character ${mapping.modern} is excluded from unconditional safe-character mapping`);
      }
      if (seenModern.has(mapping.modern)) {
        throw new Error(`Duplicate safe-character modern source: ${mapping.modern}`);
      }
      seenModern.add(mapping.modern);
      validateEvidenceRefs(mapping.evidenceRefs, "Safe-character mapping", true);
      validateEvidenceRefs(mapping.regressionEvidenceRefs, "Safe-character mapping regression", false);
      map[mapping.modern] = mapping.historical;
    }

    const characterMap = Object.freeze({ ...map });
    const apply = (value) => Array.from(`${value ?? ""}`).map((char) => (
      Object.prototype.hasOwnProperty.call(characterMap, char) ? characterMap[char] : char
    )).join("");

    return { characterMap, apply };
  };

  return { createSafeCharacterRuntime };
});
