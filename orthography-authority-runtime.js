(function (root, factory) {
  const api = factory(root.OrthographyResolverLoader);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OrthographyAuthorityRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Loader) {
  "use strict";

  const ADMISSIONS = Object.freeze({
    "学校": "unidic-cwj:2025.12:lemma:8098",
    "台風": "unidic-cwj:2025.12:lemma:21903"
  });

  let resolverBundle = null;
  let initPromise = null;

  const status = () => Object.freeze({
    ready: resolverBundle !== null,
    admittedSurfaces: Object.freeze(Object.keys(ADMISSIONS))
  });

  const initialize = async (options = {}) => {
    if (resolverBundle) return resolverBundle;
    if (initPromise) return initPromise;
    if (typeof Loader?.load !== "function") throw new TypeError("Orthography authority loader is unavailable");
    initPromise = (async () => {
      try {
        resolverBundle = await Loader.load(options.loaderOptions ?? {});
        return resolverBundle;
      } finally {
        initPromise = null;
      }
    })();
    return initPromise;
  };

  const resolve = (sourceText) => {
    if (!resolverBundle) return null;
    const source = `${sourceText ?? ""}`;
    const expectedIdentity = ADMISSIONS[source];
    if (!expectedIdentity) return null;
    try {
      const unit = resolverBundle.resolveUnit(source);
      if (unit?.kind !== "resolved" || unit.lexicalIdentity !== expectedIdentity) return null;
      const output = resolverBundle.render(unit, { mode: "plain" });
      if (typeof output !== "string") return null;
      return Object.freeze({
        sourceText: source,
        lexicalIdentity: unit.lexicalIdentity,
        output,
        authority: "japanese-orthography-resolver"
      });
    } catch {
      return null;
    }
  };

  return Object.freeze({ ADMISSIONS, initialize, resolve, status });
});
