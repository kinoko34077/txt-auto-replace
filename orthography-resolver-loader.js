(function (root, factory) {
  const api = factory(root, root.ResolverBundleRuntime);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OrthographyResolverLoader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, ResolverBundleRuntime) {
  "use strict";

  const ARTIFACT_PATH = "orthography-core/resolver-bundle.json";
  let state = Object.freeze({ status: "idle", bundle: null, error: null });
  let pending = null;

  const snapshot = () => state;
  const resolveUrl = (options) => {
    if (typeof options?.url === "string" && options.url) return options.url;
    const getURL = root?.chrome?.runtime?.getURL;
    return typeof getURL === "function" ? getURL(ARTIFACT_PATH) : ARTIFACT_PATH;
  };

  const load = async (options = {}) => {
    if (state.status === "ready") return state.bundle;
    if (pending) return pending;
    if (typeof ResolverBundleRuntime?.createResolverBundle !== "function") {
      const error = new TypeError("Resolver bundle runtime is unavailable");
      state = Object.freeze({ status: "error", bundle: null, error: error.message });
      throw error;
    }
    const fetchImpl = options.fetchImpl ?? root?.fetch;
    if (typeof fetchImpl !== "function") {
      const error = new TypeError("Resolver artifact fetch is unavailable");
      state = Object.freeze({ status: "error", bundle: null, error: error.message });
      throw error;
    }

    state = Object.freeze({ status: "loading", bundle: null, error: null });
    pending = (async () => {
      try {
        const response = await fetchImpl(resolveUrl(options));
        if (!response || response.ok !== true) throw new Error(`Resolver artifact fetch failed: ${response?.status ?? "unknown"}`);
        const artifact = await response.json();
        const bundle = ResolverBundleRuntime.createResolverBundle(artifact);
        state = Object.freeze({ status: "ready", bundle, error: null });
        return bundle;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state = Object.freeze({ status: "error", bundle: null, error: message });
        throw error;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  const resetForTest = () => {
    state = Object.freeze({ status: "idle", bundle: null, error: null });
    pending = null;
  };

  return Object.freeze({ ARTIFACT_PATH, load, snapshot, resetForTest });
});
