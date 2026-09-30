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

  let bundle = null;
  let initPromise = null;
  let delegated = 0;
  let fallbacks = 0;
  let byIdentity = Object.create(null);

  const metrics = () => Object.freeze({
    delegated,
    fallbacks,
    byIdentity: Object.freeze({ ...byIdentity })
  });

  const status = () => Object.freeze({
    loader: typeof Loader?.snapshot === "function" ? Loader.snapshot() : { status: "unavailable" },
    ready: bundle !== null
  });

  const initialize = async (options = {}) => {
    if (bundle) return bundle;
    if (initPromise) return initPromise;
    if (typeof Loader?.load !== "function") throw new TypeError("Orthography resolver loader is unavailable");
    initPromise = (async () => {
      try {
        bundle = await Loader.load(options.loaderOptions ?? {});
        if (typeof bundle?.resolveUnit !== "function" || typeof bundle?.render !== "function") {
          bundle = null;
          throw new TypeError("Loaded resolver bundle is incomplete");
        }
        return bundle;
      } catch (error) {
        bundle = null;
        throw error;
      } finally {
        initPromise = null;
      }
    })();
    return initPromise;
  };

  const resolveAdmitted = (surface) => {
    const expectedIdentity = ADMISSIONS[surface];
    if (!expectedIdentity || !bundle) return null;
    try {
      const unit = bundle.resolveUnit(surface);
      if (!unit || ["candidates", "unresolved", "protected"].includes(unit.kind)) return null;
      if (unit.lexicalIdentity !== expectedIdentity) return null;
      const rendered = bundle.render(unit, { mode: "plain" });
      if (typeof rendered !== "string" || rendered === "") return null;
      return { rendered, lexicalIdentity: expectedIdentity };
    } catch {
      return null;
    }
  };

  const preprocess = (sourceText, tokenizer) => {
    const source = `${sourceText ?? ""}`;
    if (!bundle || !tokenizer || typeof tokenizer.tokenize !== "function") return source;

    try {
      const tokens = tokenizer.tokenize(source);
      if (!Array.isArray(tokens)) return source;

      let cursor = 0;
      let output = "";
      let localDelegated = 0;
      let localFallbacks = 0;
      const localByIdentity = Object.create(null);

      for (const token of tokens) {
        const surface = `${token?.surface_form ?? ""}`;
        if (!surface) continue;
        const index = source.indexOf(surface, cursor);
        if (index < cursor) return source;
        output += source.slice(cursor, index);

        const admitted = resolveAdmitted(surface);
        if (admitted) {
          output += admitted.rendered;
          localDelegated += 1;
          localByIdentity[admitted.lexicalIdentity] = (localByIdentity[admitted.lexicalIdentity] ?? 0) + 1;
        } else {
          output += surface;
          if (Object.prototype.hasOwnProperty.call(ADMISSIONS, surface)) localFallbacks += 1;
        }
        cursor = index + surface.length;
      }

      output += source.slice(cursor);
      delegated += localDelegated;
      fallbacks += localFallbacks;
      for (const [identity, count] of Object.entries(localByIdentity)) {
        byIdentity[identity] = (byIdentity[identity] ?? 0) + count;
      }
      return output;
    } catch {
      return source;
    }
  };

  const clear = () => {
    delegated = 0;
    fallbacks = 0;
    byIdentity = Object.create(null);
  };

  return Object.freeze({ initialize, preprocess, metrics, status, clear });
});
