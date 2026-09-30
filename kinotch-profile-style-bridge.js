(function (root) {
  "use strict";

  const engine = root.TransformEngine;
  const profile = root.KinotchProfileStyleRuntime;
  if (!engine || !profile || typeof engine.loadStagesFromDefinitions !== "function") return;

  const originalLoadStagesFromDefinitions = engine.loadStagesFromDefinitions;
  engine.loadStagesFromDefinitions = function (...args) {
    const loaded = originalLoadStagesFromDefinitions.apply(this, args);
    if (!loaded || !Array.isArray(loaded.stages) || typeof profile.composeStages !== "function") return loaded;
    try {
      const stages = profile.composeStages(loaded.stages);
      if (stages === loaded.stages) return loaded;
      return { ...loaded, stages };
    } catch {
      // Fail closed: retain the accepted local stage set unchanged.
      return loaded;
    }
  };

  if (typeof profile.initialize === "function") {
    Promise.resolve()
      .then(() => profile.initialize())
      .catch(() => {
        // Packaged profile verification failure leaves the accepted local lexical rule active.
      });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
