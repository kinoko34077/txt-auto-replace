(function (root, factory) {
  const api = factory(root.OrthographyResolverLoader, root.OrthographyResolverAdapter);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OrthographyShadowRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Loader, Adapter) {
  "use strict";

  let adapter = null;
  let initPromise = null;
  let observationCount = 0;
  let classifications = Object.create(null);

  const metrics = () => Object.freeze({
    total: observationCount,
    classifications: Object.freeze({ ...classifications })
  });

  const status = () => Object.freeze({
    loader: typeof Loader?.snapshot === "function" ? Loader.snapshot() : { status: "unavailable" },
    ready: adapter !== null,
    observations: observationCount
  });

  const initialize = async (options = {}) => {
    if (adapter) return adapter;
    if (initPromise) return initPromise;
    if (typeof Loader?.load !== "function" || typeof Adapter?.createAdapter !== "function") {
      throw new TypeError("Orthography shadow dependencies are unavailable");
    }
    initPromise = (async () => {
      try {
        const resolverBundle = await Loader.load(options.loaderOptions ?? {});
        adapter = Adapter.createAdapter({ resolverBundle });
        return adapter;
      } finally {
        initPromise = null;
      }
    })();
    return initPromise;
  };

  const observe = (sourceText, legacyOutput, options = {}) => {
    if (!adapter) return null;
    const result = adapter.evaluateWithLegacyOutput(sourceText, legacyOutput, options);
    observationCount += 1;
    const key = `${result.classification ?? "unknown"}`;
    classifications[key] = (classifications[key] ?? 0) + 1;
    return result;
  };

  const clear = () => {
    observationCount = 0;
    classifications = Object.create(null);
  };

  return Object.freeze({ initialize, observe, metrics, status, clear });
});
