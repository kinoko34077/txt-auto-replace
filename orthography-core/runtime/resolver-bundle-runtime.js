(function (root, factory) {
  const api = factory(
    root.LexicalRuntime,
    root.HistoricalNativeRuntime,
    root.HistoricalSinoRuntime,
    root.SafeCharacterRuntime,
    root.OrthographyResolver
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ResolverBundleRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  LexicalRuntime,
  HistoricalNativeRuntime,
  HistoricalSinoRuntime,
  SafeCharacterRuntime,
  OrthographyResolver
) {
  "use strict";

  const REQUIRED_CAPABILITIES = [
    "lexical",
    "historical-native",
    "historical-sino",
    "contextual-kanji",
    "safe-character",
    "late-rendering"
  ];
  const REQUIRED_SECTIONS = [
    "lexical",
    "historical-native",
    "historical-sino",
    "contextual-kanji",
    "safe-character"
  ];
  const CONTEXTUAL_BINDING_NAMESPACE = "pmin-current";
  const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") throw new TypeError(`Invalid ${label}`);
  };
  const requireSha256 = (value, label) => {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`Invalid ${label}`);
  };
  const requireApi = (owner, key, label) => {
    if (typeof owner?.[key] !== "function") throw new TypeError(`Missing resolver bundle runtime dependency: ${label}`);
  };
  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const canonicalize = (value) => {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value === "object") {
      const output = {};
      for (const key of Object.keys(value).sort(compareText)) {
        const child = value[key];
        if (child !== undefined) output[key] = canonicalize(child);
      }
      return output;
    }
    throw new TypeError(`Unsupported resolver bundle value: ${typeof value}`);
  };
  const serialize = (value) => JSON.stringify(canonicalize(value));
  const utf8Bytes = (value) => {
    const bytes = [];
    for (const char of value) {
      const code = char.codePointAt(0);
      if (code <= 0x7f) bytes.push(code);
      else if (code <= 0x7ff) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
      else if (code <= 0xffff) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
      else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3f), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return bytes;
  };
  const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));
  const sha256Text = (text) => {
    const bytes = utf8Bytes(text);
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const words = new Array(64);

    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        const pos = offset + index * 4;
        words[index] = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const w15 = words[index - 15];
        const w2 = words[index - 2];
        const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
        const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }

      let a = h0; let b = h1; let c = h2; let d = h3;
      let e = h4; let f = h5; let g = h6; let h = h7;
      for (let index = 0; index < 64; index += 1) {
        const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ ((~e) & g);
        const temp1 = (h + s1 + choice + SHA256_K[index] + words[index]) >>> 0;
        const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((value) => value.toString(16).padStart(8, "0"))
      .join("");
  };
  const sha256 = (value) => sha256Text(serialize(value));

  const validateLexicalArtifactIdentity = (artifact) => {
    if (!Array.isArray(artifact?.sections)) throw new Error("Resolver bundle lexical artifact requires sections");
    const lexicalSectionValues = {
      lemmas: artifact.lemmas,
      morphologies: artifact.morphologies,
      candidates: artifact.candidates,
      surfaceIndex: artifact.surfaceIndex,
      readingIndex: artifact.readingIndex
    };
    const declared = new Set(artifact.sections.map((section) => section?.id));
    for (const id of Object.keys(lexicalSectionValues)) {
      if (!declared.has(id)) throw new Error(`Missing resolver bundle lexical artifact section: ${id}`);
    }
    for (const section of artifact.sections) {
      const value = lexicalSectionValues[section.id];
      if (value === undefined) throw new Error(`Unknown resolver bundle lexical artifact section: ${section.id}`);
      const text = `${serialize(value)}\n`;
      if (sha256Text(text) !== section.sha256 || utf8Bytes(text).length !== section.byteLength) {
        throw new Error(`Resolver bundle lexical artifact section identity mismatch: ${section.id}`);
      }
    }
    const expectedArtifactContentId = sha256({ compilerSemantics: artifact.compilerSemantics, source: artifact.source, lexicalNamespaceId: artifact.lexicalNamespaceId, sections: artifact.sections });
    if (expectedArtifactContentId !== artifact.artifactContentId) throw new Error("Resolver bundle lexical artifact content identity mismatch");
  };

  const validateArtifact = (artifact) => {
    if (artifact?.schemaVersion !== "1" || artifact?.kind !== "japanese-orthography-resolver-bundle-artifact") throw new TypeError("Unsupported resolver bundle artifact");
    if (artifact.bundleSemantics !== "phase3-first-slice-v1") throw new TypeError("Unsupported resolver bundle semantics");
    requireSha256(artifact.bundleContentId, "resolver bundle content id");
    if (!Array.isArray(artifact.capabilities) || artifact.capabilities.length !== REQUIRED_CAPABILITIES.length || !REQUIRED_CAPABILITIES.every((value, index) => artifact.capabilities[index] === value)) throw new Error("Resolver bundle capability declaration mismatch");
    if (!Array.isArray(artifact.sections)) throw new TypeError("Resolver bundle requires sections");
    const sectionIds = new Set();
    for (const section of artifact.sections) { requireNonEmptyString(section?.id, "resolver bundle section id"); requireSha256(section?.contentId, "resolver bundle section content id"); if (sectionIds.has(section.id)) throw new Error(`Duplicate resolver bundle section: ${section.id}`); sectionIds.add(section.id); }
    for (const id of REQUIRED_SECTIONS) if (!sectionIds.has(id)) throw new Error(`Missing resolver bundle section: ${id}`);
    if (artifact.sections.length !== REQUIRED_SECTIONS.length || !REQUIRED_SECTIONS.every((id, index) => artifact.sections[index]?.id === id)) throw new Error("Resolver bundle section declaration mismatch");
    const lexicalNamespaceId = artifact.lexicalArtifact?.lexicalNamespaceId;
    requireNonEmptyString(lexicalNamespaceId, "resolver bundle lexical namespace");
    validateLexicalArtifactIdentity(artifact.lexicalArtifact);
    const sectionById = new Map(artifact.sections.map((section) => [section.id, section]));
    if (sectionById.get("lexical").contentId !== artifact.lexicalArtifact?.artifactContentId) throw new Error("Resolver bundle lexical section identity mismatch");
    if (sectionById.get("historical-native").contentId !== sha256(artifact.historicalNativeSlice)) throw new Error("Resolver bundle historical-native section identity mismatch");
    if (sectionById.get("historical-sino").contentId !== sha256(artifact.historicalSinoSlice)) throw new Error("Resolver bundle historical-sino section identity mismatch");
    if (sectionById.get("contextual-kanji").contentId !== sha256(artifact.contextual)) throw new Error("Resolver bundle contextual-kanji section identity mismatch");
    if (sectionById.get("safe-character").contentId !== sha256(artifact.safeCharacterSlice)) throw new Error("Resolver bundle safe-character section identity mismatch");
    if (artifact.historicalNativeSlice?.lexicalNamespaceId !== lexicalNamespaceId) throw new Error("Resolver bundle native lexical namespace mismatch");
    if (artifact.historicalSinoSlice?.lexicalNamespaceId !== lexicalNamespaceId) throw new Error("Resolver bundle Sino lexical namespace mismatch");
    if (artifact.contextual?.sourceLexicalNamespaceId !== lexicalNamespaceId) throw new Error("Resolver bundle contextual source lexical namespace mismatch");
    requireNonEmptyString(artifact.contextual?.bindingNamespaceId, "resolver bundle contextual binding namespace");
    if (artifact.contextual.bindingNamespaceId !== CONTEXTUAL_BINDING_NAMESPACE) throw new Error("Resolver bundle contextual binding namespace mismatch");
    if (!Array.isArray(artifact.contextual?.relations) || artifact.contextual.relations.length === 0) throw new Error("Resolver bundle requires contextual relations");
    if (!Array.isArray(artifact.contextual?.safety)) throw new Error("Resolver bundle requires contextual safety section");
    if (!artifact.safeCharacterSlice) throw new Error("Resolver bundle requires safe-character slice");
    const expectedBundleContentId = sha256({ bundleSemantics: artifact.bundleSemantics, lexicalNamespaceId, capabilities: artifact.capabilities, sections: artifact.sections });
    if (expectedBundleContentId !== artifact.bundleContentId) throw new Error("Resolver bundle content identity mismatch");
    return lexicalNamespaceId;
  };

  const createResolverBundle = (artifact) => {
    requireApi(LexicalRuntime, "createLexicalRuntime", "LexicalRuntime.createLexicalRuntime");
    requireApi(HistoricalNativeRuntime, "createHistoricalNativeRuntime", "HistoricalNativeRuntime.createHistoricalNativeRuntime");
    requireApi(HistoricalSinoRuntime, "createHistoricalSinoRuntime", "HistoricalSinoRuntime.createHistoricalSinoRuntime");
    requireApi(SafeCharacterRuntime, "createSafeCharacterRuntime", "SafeCharacterRuntime.createSafeCharacterRuntime");
    requireApi(OrthographyResolver, "createResolver", "OrthographyResolver.createResolver");
    const lexicalNamespaceId = validateArtifact(artifact);
    const lexical = LexicalRuntime.createLexicalRuntime(artifact.lexicalArtifact);
    if (lexical.lexicalNamespaceId !== lexicalNamespaceId) throw new Error("Resolver bundle lexical runtime namespace mismatch");
    const historicalNative = HistoricalNativeRuntime.createHistoricalNativeRuntime(artifact.historicalNativeSlice, { lexicalNamespaceId });
    const historicalSino = HistoricalSinoRuntime.createHistoricalSinoRuntime(artifact.historicalSinoSlice, { lexicalNamespaceId });
    const safeCharacter = SafeCharacterRuntime.createSafeCharacterRuntime(artifact.safeCharacterSlice);
    const historicalLookup = (candidate) => { const nativeRelation = historicalNative.lookup(candidate); const sinoRelation = historicalSino.lookup(candidate); if (nativeRelation && sinoRelation) throw new Error("Resolver bundle historical route collision"); return nativeRelation ?? sinoRelation ?? null; };
    const resolver = OrthographyResolver.createResolver({ lexicalLookup(surface) { return lexical.lookup(surface); }, readingLookup(reading) { return lexical.lookupReading(reading); }, historicalLookup, contextualRelations: artifact.contextual.relations, contextualSafety: artifact.contextual.safety, safeKanjiMap: safeCharacter.characterMap });
    const capabilities = Object.freeze([...artifact.capabilities]);
    return Object.freeze({ bundleContentId: artifact.bundleContentId, lexicalNamespaceId, capabilities, resolveUnit(input, options) { return resolver.resolveUnit(input, options); }, resolveReading(input, options) { return resolver.resolveReading(input, options); }, render(unit, options) { return resolver.render(unit, options); } });
  };

  return { createResolverBundle };
});
