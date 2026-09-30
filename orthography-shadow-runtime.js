(function (root, factory) {
  const api = factory(root.OrthographyResolverLoader, root.OrthographyResolverAdapter);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OrthographyShadowRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Loader, Adapter) {
  "use strict";

  const HISTORY_LIMIT = 32;
  let adapter = null;
  let initPromise = null;
  const history = [];

  const status = () => Object.freeze({
    loader: typeof Loader?.snapshot === "function" ? Loader.snapshot() : { status: "unavailable" },
    ready: adapter !== null,
    observations: history.length
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
    history.push(result);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    return result;
  };

  const observations = () => history.slice();
  const clear = () => { history.length = 0; };

  return Object.freeze({ HISTORY_LIMIT, initialize, observe, observations, status, clear });
});
