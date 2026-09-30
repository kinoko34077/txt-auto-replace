(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.HistoricalNativeRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const requireGitSha = (value, label) => {
    if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const validateSource = (source) => {
    requireNonEmptyString(source?.repository, "historical native source repository");
    requireGitSha(source?.commit, "historical native source commit SHA");
    requireNonEmptyString(source?.license, "historical native source license");
    requireNonEmptyString(source?.status, "historical native source status");
    if (!Array.isArray(source?.files) || source.files.length === 0) {
      throw new TypeError("Historical native source requires files");
    }
    for (const file of source.files) {
      requireNonEmptyString(file?.path, "historical native source file path");
      requireGitSha(file?.blobSha, "historical native source file blob SHA");
    }
  };

  const buildEvidenceIndex = (slice) => {
    const sourceFiles = new Set(slice.source.files.map((file) => file.path));
    if (!Array.isArray(slice.sourceRecords) || slice.sourceRecords.length === 0) {
      throw new TypeError("Historical native slice requires source records");
    }
    const evidenceIds = new Set();
    for (const record of slice.sourceRecords) {
      requireNonEmptyString(record?.id, "historical native source record id");
      if (evidenceIds.has(record.id)) {
        throw new Error(`Duplicate historical native evidence id: ${record.id}`);
      }
      evidenceIds.add(record.id);
      requireNonEmptyString(record?.file, "historical native source record file");
      if (!sourceFiles.has(record.file)) {
        throw new Error(`Unknown historical native source record file: ${record.file}`);
      }
    }
    return evidenceIds;
  };

  const normalizeEvidenceRefs = (value, evidenceIds) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new TypeError("Historical native relation requires evidence refs");
    }
    const refs = [];
    for (const ref of value) {
      requireNonEmptyString(ref, "historical native evidence ref");
      if (!evidenceIds.has(ref)) {
        throw new Error(`Unknown historical native evidence ref: ${ref}`);
      }
      if (!refs.includes(ref)) refs.push(ref);
    }
    return refs;
  };

  const morphologyMatches = (required, actual) => {
    if (!required) return true;
    if (!actual) return false;
    if (required.conjugationType && required.conjugationType !== actual.conjugationType) return false;
    if (required.conjugationForm && required.conjugationForm !== actual.conjugationForm) return false;
    return true;
  };

  const createHistoricalNativeRuntime = (slice, options = {}) => {
    if (slice?.schemaVersion !== "1" || slice?.kind !== "japanese-orthography-historical-native-slice") {
      throw new TypeError("Unsupported historical native slice");
    }
    requireNonEmptyString(slice.lexicalNamespaceId, "historical native lexical namespace");
    validateSource(slice.source);
    const evidenceIds = buildEvidenceIndex(slice);
    const expectedNamespace = options.lexicalNamespaceId ?? slice.lexicalNamespaceId;
    if (slice.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical native lexical namespace mismatch");
    }

    const relationByIdentity = new Map();
    for (const relation of Array.isArray(slice.relations) ? slice.relations : []) {
      requireNonEmptyString(relation?.lexicalIdentity, "historical native lexical identity");
      requireNonEmptyString(relation?.surface, "historical native surface");
      requireNonEmptyString(relation?.historicalSurface, "historical native historical surface");
      if (relationByIdentity.has(relation.lexicalIdentity)) {
        throw new Error(`Duplicate historical native relation: ${relation.lexicalIdentity}`);
      }
      relationByIdentity.set(relation.lexicalIdentity, {
        route: "native",
        reading: null,
        surface: relation.historicalSurface,
        requiresMorphology: Boolean(relation.requiredMorphology),
        requiredMorphology: relation.requiredMorphology ?? null,
        evidenceRefs: normalizeEvidenceRefs(relation.evidenceRefs, evidenceIds)
      });
    }

    const lookup = (candidate) => {
      if (candidate?.lexicalOrigin !== "native") return null;
      requireNonEmptyString(candidate?.lexicalIdentity, "candidate lexical identity");
      const relation = relationByIdentity.get(candidate.lexicalIdentity) ?? null;
      if (!relation) return null;
      if (!morphologyMatches(relation.requiredMorphology, candidate.morphology)) return null;
      return relation;
    };

    return {
      lexicalNamespaceId: slice.lexicalNamespaceId,
      source: slice.source,
      lookup
    };
  };

  return { createHistoricalNativeRuntime };
});
