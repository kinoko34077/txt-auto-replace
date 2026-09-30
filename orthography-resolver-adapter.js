(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OrthographyResolverAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const requireFn = (value, label) => {
    if (typeof value !== "function") throw new TypeError(`Missing ${label}`);
    return value;
  };

  const classify = ({ sourceText, legacyOutput, coreUnit, coreOutput }) => {
    const legacyChanged = legacyOutput !== sourceText;
    const kind = coreUnit?.kind ?? "unresolved";
    if (kind === "candidates") return legacyChanged ? "legacy-changed/core-candidates" : "legacy-unchanged/core-candidates";
    if (kind === "unresolved") return legacyChanged ? "legacy-changed/core-unresolved" : "legacy-unchanged/core-unresolved";
    if (kind === "protected") return legacyChanged ? "legacy-changed/core-protected" : "legacy-unchanged/core-protected";
    const coreResolved = typeof coreOutput === "string";
    if (!coreResolved) return legacyChanged ? "legacy-changed/core-unresolved" : "legacy-unchanged/core-unresolved";
    if (legacyOutput !== coreOutput) return "legacy-output!=core-output";
    return legacyChanged ? "legacy-changed/core-resolved" : "legacy-unchanged/core-resolved";
  };

  const createAdapter = ({ resolverBundle, legacyTransform }) => {
    if (!resolverBundle || typeof resolverBundle !== "object") throw new TypeError("Missing resolver bundle");
    const resolveUnit = requireFn(resolverBundle.resolveUnit, "resolverBundle.resolveUnit").bind(resolverBundle);
    const render = requireFn(resolverBundle.render, "resolverBundle.render").bind(resolverBundle);
    const runLegacy = requireFn(legacyTransform, "legacyTransform");

    const evaluate = (sourceText, options = {}) => {
      const source = `${sourceText ?? ""}`;
      const legacyOutput = runLegacy(source);
      let coreUnit = null;
      let coreOutput = null;
      let coreError = null;
      try {
        coreUnit = resolveUnit(source, options.resolveOptions);
        if (coreUnit && !["unresolved", "candidates", "protected"].includes(coreUnit.kind)) {
          coreOutput = render(coreUnit, options.renderOptions ?? { mode: "plain" });
        }
      } catch (error) {
        coreError = error instanceof Error ? error.message : String(error);
      }
      const classification = coreError
        ? "core-error"
        : classify({ sourceText: source, legacyOutput, coreUnit, coreOutput });
      return Object.freeze({
        sourceText: source,
        authoritativeOutput: legacyOutput,
        legacyOutput,
        core: Object.freeze({
          kind: coreUnit?.kind ?? (coreError ? "error" : "unresolved"),
          output: coreOutput,
          trace: coreUnit,
          error: coreError
        }),
        classification
      });
    };

    return Object.freeze({
      bundleContentId: resolverBundle.bundleContentId ?? null,
      evaluate
    });
  };

  return { createAdapter };
});
