(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LexicalRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  const findEntry = (index, key, value) => {
    let low = 0;
    let high = index.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const entry = index[mid];
      const cmp = compareText(entry[key], value);
      if (cmp === 0) return entry;
      if (cmp < 0) low = mid + 1;
      else high = mid - 1;
    }
    return null;
  };

  const chooseReading = (lemma, modernReadings) => {
    if (modernReadings.length === 0) return lemma.lexicalReading ?? null;
    if (modernReadings.length === 1) return modernReadings[0];
    if (modernReadings.includes(lemma.lexicalReading)) return lemma.lexicalReading;
    return null;
  };

  const createLexicalRuntime = (artifact) => {
    if (artifact?.schemaVersion !== "1" || artifact?.kind !== "japanese-orthography-lexical-artifact") {
      throw new TypeError("Unsupported lexical artifact");
    }
    const lemmas = Array.isArray(artifact.lemmas) ? artifact.lemmas : [];
    const morphologies = Array.isArray(artifact.morphologies) ? artifact.morphologies : [];
    const candidates = Array.isArray(artifact.candidates) ? artifact.candidates : [];
    const surfaceIndex = Array.isArray(artifact.surfaceIndex) ? artifact.surfaceIndex : [];
    const readingIndex = Array.isArray(artifact.readingIndex) ? artifact.readingIndex : [];

    const decodeCandidate = (record) => {
      const lemma = lemmas[record.lemmaIndex];
      const morphology = morphologies[record.morphologyId];
      if (!lemma || lemma.lemmaIndex !== record.lemmaIndex || !morphology || morphology.morphologyId !== record.morphologyId) {
        throw new Error("Lexical artifact candidate references an invalid table entry");
      }
      const modernReadings = Array.isArray(record.modernReadings) ? [...record.modernReadings] : [];
      return {
        lexicalIdentity: lemma.lexicalIdentity,
        lemma: lemma.lemma,
        reading: chooseReading(lemma, modernReadings),
        lexicalReading: lemma.lexicalReading,
        modernReadings,
        lexicalOrigin: lemma.lexicalOrigin,
        morphology: {
          partOfSpeech: Array.isArray(morphology.pos) ? [...morphology.pos] : [],
          conjugationType: morphology.cType === "*" ? null : morphology.cType,
          conjugationForm: morphology.cForm === "*" ? null : morphology.cForm
        },
        components: [],
        viableBindingIds: [lemma.lexicalIdentity],
        evidenceRefs: [lemma.lexicalIdentity]
      };
    };

    const lookup = (surface) => {
      const entry = findEntry(surfaceIndex, "surface", `${surface ?? ""}`);
      if (!entry) return [];
      const start = entry.candidateOffset;
      const end = start + entry.candidateCount;
      if (!Number.isInteger(start) || !Number.isInteger(entry.candidateCount) || start < 0 || end > candidates.length) {
        throw new Error("Lexical artifact surface index is out of bounds");
      }
      return candidates.slice(start, end).map(decodeCandidate);
    };

    let surfaceByCandidate = null;
    const candidateSurface = (candidateIndex) => {
      if (surfaceByCandidate === null) {
        surfaceByCandidate = new Array(candidates.length).fill(null);
        for (const entry of surfaceIndex) {
          for (let offset = 0; offset < entry.candidateCount; offset += 1) {
            surfaceByCandidate[entry.candidateOffset + offset] = entry.surface;
          }
        }
      }
      return surfaceByCandidate[candidateIndex] ?? null;
    };

    // Reading evidence resolves to the same candidate records as surface lookup;
    // every match is returned so callers never pick a winner by storage order.
    const lookupReading = (reading) => {
      const entry = findEntry(readingIndex, "reading", `${reading ?? ""}`);
      if (!entry) return [];
      const indexes = Array.isArray(entry.candidateIndexes) ? entry.candidateIndexes : [];
      return indexes.map((candidateIndex) => {
        if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= candidates.length) {
          throw new Error("Lexical artifact reading index is out of bounds");
        }
        return { ...decodeCandidate(candidates[candidateIndex]), surface: candidateSurface(candidateIndex) };
      });
    };

    return {
      lexicalNamespaceId: artifact.lexicalNamespaceId,
      artifactContentId: artifact.artifactContentId,
      lookup,
      lookupReading
    };
  };

  return { createLexicalRuntime };
});
