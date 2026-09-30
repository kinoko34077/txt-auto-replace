(function (root, factory) {
  const api = factory(root.OrthographyAuthorityRuntime, root.TransformEngine);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuthoringPlaygroundRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (DefaultAuthorityRuntime, DefaultTransformEngine) {
  "use strict";

  const normalizeNewlines = (value) => `${value ?? ""}`.replace(/\r\n?/g, "\n");

  const codePoints = (value) => Array.from(normalizeNewlines(value));

  const compareText = (actualValue, expectedValue) => {
    const actual = normalizeNewlines(actualValue);
    const expected = normalizeNewlines(expectedValue);
    const actualChars = codePoints(actual);
    const expectedChars = codePoints(expected);
    const limit = Math.max(actualChars.length, expectedChars.length);
    let line = 1;
    let column = 1;

    for (let index = 0; index < limit; index += 1) {
      const actualChar = actualChars[index] ?? null;
      const expectedChar = expectedChars[index] ?? null;
      if (actualChar !== expectedChar) {
        return Object.freeze({
          matches: false,
          actualLength: actualChars.length,
          expectedLength: expectedChars.length,
          firstDifference: Object.freeze({
            index,
            line,
            column,
            actual: actualChar,
            expected: expectedChar
          })
        });
      }
      if (actualChar === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }

    return Object.freeze({
      matches: true,
      actualLength: actualChars.length,
      expectedLength: expectedChars.length,
      firstDifference: null
    });
  };

  const cloneMetrics = (value) => {
    const source = value && typeof value === "object" ? value : {};
    return {
      delegated: Number(source.delegated) || 0,
      fallbacks: Number(source.fallbacks) || 0,
      byIdentity: { ...(source.byIdentity && typeof source.byIdentity === "object" ? source.byIdentity : {}) }
    };
  };

  const subtractMetrics = (before, after) => {
    const identities = new Set([
      ...Object.keys(before.byIdentity ?? {}),
      ...Object.keys(after.byIdentity ?? {})
    ]);
    const byIdentity = {};
    for (const identity of identities) {
      const delta = (Number(after.byIdentity?.[identity]) || 0) - (Number(before.byIdentity?.[identity]) || 0);
      if (delta !== 0) byIdentity[identity] = delta;
    }
    return Object.freeze({
      delegated: after.delegated - before.delegated,
      fallbacks: after.fallbacks - before.fallbacks,
      byIdentity: Object.freeze(byIdentity)
    });
  };

  const createAuthoringRuntime = (options = {}) => {
    const authority = options.authorityRuntime ?? DefaultAuthorityRuntime;
    const engine = options.transformEngine ?? DefaultTransformEngine;
    const stages = Array.isArray(options.stages) ? options.stages : [];
    const tokenizer = options.tokenizer ?? null;

    if (typeof engine?.compileRuntimePlan !== "function" || typeof engine?.transformTextWithPlan !== "function") {
      throw new TypeError("TransformEngine compile/transform APIs are unavailable");
    }

    const plan = engine.compileRuntimePlan(stages, { revision: options.revision ?? 1 });
    let resolverReady = false;
    let resolverError = null;

    const authorityStatus = () => {
      try {
        return typeof authority?.status === "function"
          ? authority.status()
          : { ready: false, loader: { status: "unavailable" } };
      } catch {
        return { ready: false, loader: { status: "error" } };
      }
    };

    const authorityMetrics = () => {
      try {
        return cloneMetrics(typeof authority?.metrics === "function" ? authority.metrics() : null);
      } catch {
        return cloneMetrics(null);
      }
    };

    const initialize = async () => {
      resolverError = null;
      resolverReady = false;
      if (typeof authority?.initialize !== "function") {
        resolverError = "resolver authority runtime unavailable";
        return Object.freeze({ resolverReady, resolverError, resolverStatus: authorityStatus() });
      }
      try {
        await authority.initialize(options.authorityOptions ?? {});
        resolverReady = authorityStatus().ready === true;
        if (!resolverReady) resolverError = "resolver authority initialized without a ready bundle";
      } catch (error) {
        resolverError = error instanceof Error ? error.message : String(error);
        resolverReady = false;
      }
      return Object.freeze({ resolverReady, resolverError, resolverStatus: authorityStatus() });
    };

    const transform = (sourceValue, transformOptions = {}) => {
      const source = `${sourceValue ?? ""}`;
      const beforeMetrics = authorityMetrics();
      let coreOutput = source;
      let localResolverError = resolverError;

      if (resolverReady && typeof authority?.preprocess === "function") {
        try {
          coreOutput = authority.preprocess(source, tokenizer);
        } catch (error) {
          coreOutput = source;
          localResolverError = error instanceof Error ? error.message : String(error);
        }
      }

      const debugEvents = [];
      const output = engine.transformTextWithPlan(coreOutput, plan, tokenizer, {
        debugCollector(event) {
          if (event && typeof event === "object") debugEvents.push(event);
        }
      });
      const afterMetrics = authorityMetrics();
      const stageTrace = debugEvents
        .filter((event) => event.phase === "stage-result")
        .map((event) => Object.freeze({
          stageId: event.stageId ?? null,
          stageKind: event.stageKind ?? null,
          before: `${event.before ?? ""}`,
          after: `${event.after ?? ""}`
        }));

      const hasExpected = Object.prototype.hasOwnProperty.call(transformOptions, "expected") && transformOptions.expected !== null;
      return Object.freeze({
        source,
        coreOutput,
        output,
        stageTrace: Object.freeze(stageTrace),
        comparison: hasExpected ? compareText(output, transformOptions.expected) : null,
        resolver: Object.freeze({
          ready: resolverReady,
          error: localResolverError,
          status: authorityStatus(),
          metrics: Object.freeze({
            before: Object.freeze(beforeMetrics),
            after: Object.freeze(afterMetrics),
            delta: subtractMetrics(beforeMetrics, afterMetrics)
          })
        })
      });
    };

    const snapshot = () => Object.freeze({
      resolverReady,
      resolverError,
      resolverStatus: authorityStatus(),
      stageCount: plan?.stages?.length ?? stages.length
    });

    return Object.freeze({ initialize, transform, snapshot });
  };

  return Object.freeze({ createAuthoringRuntime, compareText });
});
