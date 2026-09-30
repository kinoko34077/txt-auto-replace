(function (root, factory) {
  const api = factory(root.KinotchTokenStyleArtifact);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KinotchProfileStyleRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (PackagedArtifact) {
  "use strict";

  const EXPECTED = Object.freeze({
    artifactSchemaVersion: "1",
    profileId: "kinotch-authoring",
    authority: "project_profile",
    responsibility: "style_render",
    genericSafety: "not_implied",
    packId: "token-style",
    buildSourceIdentity: "canonical-content-addressed",
    artifactGeneration: "574f0deeface6dcf8348ef57d42c38a2c2323bce421992676aad2058bb7c6cd1",
    canonicalSourceDigest: "0f0d2b4699ad040977fcaf47d528bb5b387515a42edd77e07bad8ebb53b7f877",
    adoptedSource: Object.freeze({
      repository: "kinoko34077/txt-auto-replace",
      commit: "48ceade01db46af3fad7acfb8743c3d841885c33",
      path: "transforms/20-lexical-replacements.json5",
      blobSha: "32d4acff7532b5dd21d0bab1d1ba414298f27687"
    }),
    payloadPath: "20-kinotch-token-style.json5",
    payloadDigest: "c3d1f58309b2060d37591ece438fdc3d047025b03d4398ca4f219737b7f424d1",
    payloadByteLength: 214
  });

  const exactObject = (actual, expected) => {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(expected).every(([key, value]) => actual[key] === value);
  };

  const validateArtifact = (artifact) => {
    if (!artifact || typeof artifact !== "object") throw new TypeError("KiNoTch profile artifact is missing");
    const manifest = artifact.manifest;
    const bundle = artifact.bundle;
    if (!manifest || typeof manifest !== "object") throw new TypeError("KiNoTch profile manifest is missing");

    for (const key of [
      "artifactSchemaVersion",
      "profileId",
      "authority",
      "responsibility",
      "genericSafety",
      "packId",
      "buildSourceIdentity",
      "artifactGeneration",
      "canonicalSourceDigest"
    ]) {
      if (manifest[key] !== EXPECTED[key]) throw new Error(`KiNoTch profile ${key} mismatch`);
    }
    if (!exactObject(manifest.adoptedSource, EXPECTED.adoptedSource)) {
      throw new Error("KiNoTch profile adopted source identity mismatch");
    }
    if (!Array.isArray(manifest.files) || manifest.files.length !== 1) {
      throw new Error("KiNoTch profile manifest files mismatch");
    }
    const file = manifest.files[0];
    if (file.path !== EXPECTED.payloadPath || file.payloadDigest !== EXPECTED.payloadDigest || file.byteLength !== EXPECTED.payloadByteLength) {
      throw new Error("KiNoTch profile payload identity mismatch");
    }
    if (!bundle || bundle.id !== "kinotch-token-style" || bundle.kind !== "token-rules" || !Array.isArray(bundle.rules)) {
      throw new Error("KiNoTch profile bundle is malformed");
    }
    if (bundle.rules.length !== 1) throw new Error("KiNoTch profile rule count mismatch");
    const rule = bundle.rules[0];
    if (rule.from !== "こと" || rule.to !== "ヿ" || rule.type !== "literal" || rule.priority !== 100) {
      throw new Error("KiNoTch profile rule identity mismatch");
    }
    return Object.freeze({ manifest, bundle });
  };

  const createProfileStyleRuntime = (options = {}) => {
    const loadArtifact = typeof options.loadArtifact === "function"
      ? options.loadArtifact
      : async () => options.artifact ?? PackagedArtifact;
    let active = null;
    let initPromise = null;
    let lastError = null;
    let delegated = 0;

    const activate = (artifact) => {
      active = validateArtifact(artifact);
      lastError = null;
      return active;
    };

    const initialize = async () => {
      if (active) return active;
      if (initPromise) return initPromise;
      initPromise = Promise.resolve()
        .then(() => loadArtifact())
        .then(activate)
        .catch((error) => {
          active = null;
          lastError = error instanceof Error ? error.message : String(error);
          throw error;
        })
        .finally(() => {
          initPromise = null;
        });
      return initPromise;
    };

    const status = () => Object.freeze({
      ready: active !== null,
      error: lastError,
      artifactGeneration: active?.manifest?.artifactGeneration ?? null,
      canonicalSourceDigest: active?.manifest?.canonicalSourceDigest ?? null
    });

    const metrics = () => Object.freeze({ delegated });

    const preprocess = (sourceValue, tokenizer) => {
      const source = `${sourceValue ?? ""}`;
      if (!active || !tokenizer || typeof tokenizer.tokenize !== "function") return source;
      try {
        const tokens = tokenizer.tokenize(source);
        if (!Array.isArray(tokens)) return source;
        let cursor = 0;
        let output = "";
        let localDelegated = 0;
        const rule = active.bundle.rules[0];
        for (const token of tokens) {
          const surface = `${token?.surface_form ?? ""}`;
          if (!surface) continue;
          const index = source.indexOf(surface, cursor);
          if (index < cursor) return source;
          output += source.slice(cursor, index);
          if (surface === rule.from) {
            output += rule.to;
            localDelegated += 1;
          } else {
            output += surface;
          }
          cursor = index + surface.length;
        }
        output += source.slice(cursor);
        delegated += localDelegated;
        return output;
      } catch {
        return source;
      }
    };

    const composeStages = (stages) => {
      if (!active || !Array.isArray(stages)) return stages;
      const lexicalIndex = stages.findIndex((stage) => stage?.id === "lexical-replacements");
      if (lexicalIndex < 0) return stages;

      const lexical = stages[lexicalIndex];
      const originalRules = Array.isArray(lexical.rules) ? lexical.rules : [];
      const filteredRules = originalRules.filter((rule) => !(
        rule?.from === "こと" &&
        rule?.to === "ヿ" &&
        (rule?.type === undefined || rule?.type === "literal")
      ));
      const profileRules = active.bundle.rules.map((rule) => ({ ...rule }));
      const profileStage = {
        ...lexical,
        id: active.bundle.id,
        label: active.bundle.label,
        kind: active.bundle.kind,
        rules: profileRules
      };
      const composed = stages.slice();
      composed.splice(lexicalIndex, 1, { ...lexical, rules: filteredRules }, profileStage);
      return composed;
    };

    const clear = () => {
      delegated = 0;
    };

    return Object.freeze({ initialize, activate, preprocess, composeStages, status, metrics, clear });
  };

  const runtime = createProfileStyleRuntime({ artifact: PackagedArtifact });
  if (PackagedArtifact) {
    try {
      runtime.activate(PackagedArtifact);
    } catch {
      // Keep the accepted local lexical stage authoritative when packaged profile verification fails.
    }
  }

  return Object.freeze({
    createProfileStyleRuntime,
    initialize: runtime.initialize,
    preprocess: runtime.preprocess,
    composeStages: runtime.composeStages,
    status: runtime.status,
    metrics: runtime.metrics,
    clear: runtime.clear
  });
});
