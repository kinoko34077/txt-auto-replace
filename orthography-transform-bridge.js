(function (root) {
  "use strict";

  const engine = root.TransformEngine;
  const shadow = root.OrthographyShadowRuntime;
  const authority = root.OrthographyAuthorityRuntime;
  if (!engine || !shadow) return;

  let nesting = 0;
  const observe = (sourceText, legacyOutput) => {
    try {
      shadow.observe(`${sourceText ?? ""}`, `${legacyOutput ?? ""}`);
    } catch {
      // Shadow evaluation is observational only. Never alter or fail output.
    }
  };

  const preprocess = (sourceText, tokenizer) => {
    if (typeof authority?.preprocess !== "function") return sourceText;
    try {
      return authority.preprocess(sourceText, tokenizer);
    } catch {
      // Fail closed: preserve source and fall through to the accepted legacy pipeline.
      return sourceText;
    }
  };

  const wrap = (name) => {
    const original = engine[name];
    if (typeof original !== "function") return;
    engine[name] = function (...args) {
      const outermost = nesting === 0;
      const originalSource = args[0];
      nesting += 1;
      try {
        if (outermost) args[0] = preprocess(originalSource, args[2]);
        const legacyOutput = original.apply(this, args);
        if (outermost && typeof legacyOutput === "string") observe(originalSource, legacyOutput);
        return legacyOutput;
      } finally {
        nesting -= 1;
      }
    };
  };

  wrap("transformTextWithPlan");
  wrap("transformTextWithStages");

  if (typeof authority?.initialize === "function") {
    Promise.resolve()
      .then(() => authority.initialize())
      .catch(() => {
        // Fail closed: legacy TransformEngine remains available unchanged.
      });
  }

  Promise.resolve()
    .then(() => shadow.initialize())
    .catch(() => {
      // Shadow failure never affects authoritative or legacy transformation.
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
