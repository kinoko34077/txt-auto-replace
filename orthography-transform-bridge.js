(function (root) {
  "use strict";

  const engine = root.TransformEngine;
  const shadow = root.OrthographyShadowRuntime;
  const authority = root.OrthographyAuthorityRuntime;
  if (!engine || !shadow) return;

  let nesting = 0;

  const delegatedOutput = (sourceText) => {
    try {
      const decision = authority?.resolve?.(`${sourceText ?? ""}`);
      return typeof decision?.output === "string" ? decision.output : null;
    } catch {
      return null;
    }
  };

  const observe = (sourceText, legacyOutput) => {
    try {
      shadow.observe(`${sourceText ?? ""}`, `${legacyOutput ?? ""}`);
    } catch {
      // Shadow evaluation is observational only. Never alter or fail legacy output.
    }
  };

  const wrap = (name) => {
    const original = engine[name];
    if (typeof original !== "function") return;
    engine[name] = function (...args) {
      const outermost = nesting === 0;
      if (outermost) {
        const coreOutput = delegatedOutput(args[0]);
        if (coreOutput !== null) return coreOutput;
      }

      nesting += 1;
      try {
        const legacyOutput = original.apply(this, args);
        if (outermost && typeof legacyOutput === "string") observe(args[0], legacyOutput);
        return legacyOutput;
      } finally {
        nesting -= 1;
      }
    };
  };

  wrap("transformTextWithPlan");
  wrap("transformTextWithStages");

  Promise.allSettled([
    Promise.resolve().then(() => shadow.initialize()),
    Promise.resolve().then(() => authority?.initialize?.())
  ]).catch(() => {
    // Defensive only. Individual initialization failures already fall back to legacy.
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
