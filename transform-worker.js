/* global importScripts, kuromoji, TransformEngine */
(() => {
  "use strict";

  const resolveWorkerResource = (path) => {
    const baseUrl = typeof self.__jpnTransformExtensionBase === "string"
      ? self.__jpnTransformExtensionBase
      : "";
    return baseUrl ? new URL(path, baseUrl).href : path;
  };

  try {
    importScripts(
      resolveWorkerResource("lib/kuromoji.js"),
      resolveWorkerResource("transform-shared.js"),
      resolveWorkerResource("transform-engine.js")
    );
  } catch (error) {
    self.postMessage({
      type: "INIT_ERROR",
      message: error?.message ?? `${error}`
    });
    return;
  }

  let activeStages = [];
  let activePlan = null;
  let activeRevision = 0;
  let dictPath = "";
  let tokenizerPromise = null;
  let tokenizer = null;
  const RUNTIME_METRIC_COUNTER_FIELDS = Object.freeze([
    "tokenizeCalls",
    "tokenizeSkipped",
    "textCacheHits",
    "textCacheMisses",
    "textCacheBypasses",
    "tokenCacheHits",
    "tokenCacheMisses",
    "tokenCacheBypasses",
    "processingMsTotal",
    "dictionaryMatches",
    "regexMatches",
    "wildcardMatches",
    "changedRuns",
    "queuedRoots",
    "mutationBatches"
  ]);

  const createMetricsRecord = (planVersion) => {
    const metrics = {
      planVersion: planVersion ?? null,
      compileMs: Number(activePlan?.compileMs) || 0,
      stageTimings: {}
    };
    for (const field of RUNTIME_METRIC_COUNTER_FIELDS) {
      metrics[field] = 0;
    }
    return metrics;
  };

  const stageRequiresTokenizer = (stage) => {
    return stage?.kind === "token-rules" &&
      stage.runtime_mode !== "katakana-long-vowel-abbreviation" &&
      (
        (Array.isArray(stage.rules) && stage.rules.length > 0) ||
        (typeof stage.runtime_mode === "string" && stage.runtime_mode.trim() !== "")
      );
  };

  const runtimeRequiresTokenizer = () => {
    return activeStages.some(stageRequiresTokenizer);
  };

  const buildTokenizer = () => {
    return new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji is not loaded in transform worker."));
        return;
      }

      kuromoji.builder({ dicPath: dictPath }).build((error, builtTokenizer) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(builtTokenizer);
      });
    });
  };

  const getTokenizer = async () => {
    if (!runtimeRequiresTokenizer()) {
      return null;
    }

    if (tokenizer) {
      return tokenizer;
    }

    if (!tokenizerPromise) {
      tokenizerPromise = buildTokenizer()
        .then((builtTokenizer) => {
          tokenizer = builtTokenizer;
          return builtTokenizer;
        })
        .catch((error) => {
          tokenizerPromise = null;
          throw error;
        });
    }

    return tokenizerPromise;
  };

  const configure = (message) => {
    activeStages = Array.isArray(message.stages) ? message.stages : [];
    activeRevision = Number(message.revision) || 0;
    dictPath = `${message.dictPath ?? ""}`;
    activePlan = TransformEngine.compileRuntimePlan(activeStages, {
      revision: activeRevision
    });
    tokenizer = null;
    tokenizerPromise = null;

    if (runtimeRequiresTokenizer()) {
      getTokenizer().catch((error) => {
        self.postMessage({
          type: "TOKENIZER_ERROR",
          revision: activeRevision,
          message: error?.message ?? `${error}`
        });
      });
    }

    self.postMessage({
      type: "CONFIGURED",
      revision: activeRevision,
      requiresTokenizer: runtimeRequiresTokenizer(),
      planVersion: activePlan?.planVersion ?? null
    });
  };

  const transformBatch = async (message) => {
    const revision = Number(message.revision) || 0;
    if (revision !== activeRevision) {
      self.postMessage({
        type: "RESULTS",
        jobId: message.jobId,
        revision,
        stale: true,
        results: []
      });
      return;
    }

    const tokenizerForRun = await getTokenizer();
    const results = [];

    for (const run of Array.isArray(message.runs) ? message.runs : []) {
      const text = `${run.text ?? ""}`;
      const metrics = createMetricsRecord(activePlan?.planVersion ?? null);
      results.push({
        runId: run.runId,
        transformedText: TransformEngine.transformTextWithPlan(text, activePlan, tokenizerForRun, { metrics }),
        metrics
      });
    }

    self.postMessage({
      type: "RESULTS",
      jobId: message.jobId,
      revision,
      results
    });
  };

  self.onmessage = (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "CONFIGURE") {
      configure(message);
      return;
    }

    if (message.type === "TRANSFORM_BATCH") {
      transformBatch(message).catch((error) => {
        self.postMessage({
          type: "BATCH_ERROR",
          jobId: message.jobId,
          revision: message.revision,
          message: error?.message ?? `${error}`
        });
      });
    }
  };
})();
