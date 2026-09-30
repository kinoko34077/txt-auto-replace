(function (root) {
  "use strict";

  const engine = root.TransformEngine;
  const shadow = root.OrthographyShadowRuntime;
  if (!engine || !shadow) return;

  let nesting = 0;
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

  Promise.resolve()
    .then(() => shadow.initialize())
    .catch(() => {
      // Fail closed: legacy TransformEngine remains authoritative and unchanged.
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
