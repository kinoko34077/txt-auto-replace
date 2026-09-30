(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.HistoricalSinoRuntime = api;
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
    requireNonEmptyString(source?.repository, "historical Sino source repository");
    requireGitSha(source?.commit, "historical Sino source commit SHA");
    requireNonEmptyString(source?.license, "historical Sino source license");
    requireNonEmptyString(source?.status, "historical Sino source status");
    if (!Array.isArray(source?.files) || source.files.length === 0) {
      throw new TypeError("Historical Sino source requires files");
    }
    for (const file of source.files) {
      requireNonEmptyString(file?.path, "historical Sino source file path");
      requireGitSha(file?.blobSha, "historical Sino source file blob SHA");
    }
  };

  const buildEvidenceIndex = (slice) => {
    const sourceFiles = new Set(slice.source.files.map((file) => file.path));
    if (!Array.isArray(slice.sourceRecords) || slice.sourceRecords.length === 0) {
      throw new TypeError("Historical Sino slice requires source records");
    }

    const evidenceIds = new Set();
    const addId = (record, label) => {
      requireNonEmptyString(record?.id, label);
      if (evidenceIds.has(record.id)) {
        throw new Error(`Duplicate historical Sino evidence id: ${record.id}`);
      }
      evidenceIds.add(record.id);
    };

    for (const record of slice.sourceRecords) {
      addId(record, "historical Sino source record id");
      requireNonEmptyString(record?.file, "historical Sino source record file");
      if (!sourceFiles.has(record.file)) {
        throw new Error(`Unknown historical Sino source record file: ${record.file}`);
      }
    }

    for (const record of Array.isArray(slice.projectEvidenceRecords) ? slice.projectEvidenceRecords : []) {
      addId(record, "historical Sino project evidence id");
    }

    return evidenceIds;
  };

  const normalizeEvidenceRefs = (value, evidenceIds, label) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new TypeError(`${label} requires evidence refs`);
    }
    const refs = [];
    for (const ref of value) {
      requireNonEmptyString(ref, `${label} evidence ref`);
      if (!evidenceIds.has(ref)) {
        throw new Error(`Unknown historical Sino evidence ref: ${ref}`);
      }
      if (!refs.includes(ref)) {
        refs.push(ref);
      }
    }
    return refs;
  };

  const normalizeComponent = (component, evidenceIds) => {
    requireNonEmptyString(component?.surface, "historical Sino component surface");
    requireNonEmptyString(component?.modernReading, "historical Sino component modern reading");
    requireNonEmptyString(component?.historicalReading, "historical Sino component historical reading");
    return {
      lexicalIdentity: null,
      surface: component.surface,
      lexicalReading: component.modernReading,
      lexicalOrigin: "sino",
      readingClass: component.readingClass ?? "on",
      historicalKana: component.historicalReading,
      evidenceRefs: normalizeEvidenceRefs(component.evidenceRefs, evidenceIds, "Historical Sino component")
    };
  };

  const normalizeRelation = (relation, evidenceIds) => {
    requireNonEmptyString(relation?.lexicalIdentity, "historical Sino lexical identity");
    requireNonEmptyString(relation?.surface, "historical Sino surface");
    requireNonEmptyString(relation?.modernReading, "historical Sino modern reading");
    requireNonEmptyString(relation?.historicalReading, "historical Sino historical reading");
    return {
      route: "sino",
      reading: relation.historicalReading,
      surface: relation.surface,
      components: Array.isArray(relation.components)
        ? relation.components.map((component) => normalizeComponent(component, evidenceIds))
        : [],
      evidenceRefs: normalizeEvidenceRefs(relation.evidenceRefs, evidenceIds, "Historical Sino relation")
    };
  };

  const createHistoricalSinoRuntime = (slice, options = {}) => {
    if (slice?.schemaVersion !== "1" || slice?.kind !== "japanese-orthography-historical-sino-slice") {
      throw new TypeError("Unsupported historical Sino slice");
    }
    requireNonEmptyString(slice.lexicalNamespaceId, "historical Sino lexical namespace");
    validateSource(slice.source);
    const evidenceIds = buildEvidenceIndex(slice);
    const expectedNamespace = options.lexicalNamespaceId ?? slice.lexicalNamespaceId;
    if (slice.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical Sino lexical namespace mismatch");
    }

    const relationByIdentity = new Map();
    for (const relation of Array.isArray(slice.relations) ? slice.relations : []) {
      if (relationByIdentity.has(relation?.lexicalIdentity)) {
        throw new Error(`Duplicate historical Sino relation: ${relation.lexicalIdentity}`);
      }
      relationByIdentity.set(relation.lexicalIdentity, normalizeRelation(relation, evidenceIds));
    }

    const lookup = (candidate) => {
      if (candidate?.lexicalOrigin !== "sino") {
        return null;
      }
      requireNonEmptyString(candidate?.lexicalIdentity, "candidate lexical identity");
      return relationByIdentity.get(candidate.lexicalIdentity) ?? null;
    };

    return {
      lexicalNamespaceId: slice.lexicalNamespaceId,
      source: slice.source,
      lookup
    };
  };

  return { createHistoricalSinoRuntime };
});
