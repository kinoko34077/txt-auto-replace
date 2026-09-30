(() => {
  "use strict";

  const sourceText = document.getElementById("sourceText");
  const outputText = document.getElementById("outputText");
  const expectedText = document.getElementById("expectedText");
  const transformBtn = document.getElementById("transformBtn");
  const copyBtn = document.getElementById("copyBtn");
  const sampleBtn = document.getElementById("sampleBtn");
  const runtimeStatus = document.getElementById("runtimeStatus");
  const comparisonStatus = document.getElementById("comparisonStatus");
  const traceOutput = document.getElementById("traceOutput");

  let runtime = null;

  const setStatus = (message, kind = "") => {
    runtimeStatus.textContent = message;
    runtimeStatus.dataset.kind = kind;
  };

  const fetchJson5 = async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
    return JSON5.parse(await response.text());
  };

  const loadStages = async () => {
    const manifest = await fetchJson5("transform-bundles.json5");
    const bundleFiles = {};
    await Promise.all((manifest.bundles ?? []).map(async (bundle) => {
      if (!bundle?.id || !bundle?.path) return;
      bundleFiles[bundle.id] = await fetchJson5(bundle.path);
    }));
    return TransformEngine.loadStagesFromDefinitions(manifest, bundleFiles, {}).stages;
  };

  const buildTokenizer = () => new Promise((resolve, reject) => {
    if (!globalThis.kuromoji?.builder) {
      reject(new Error("Kuromoji runtime is unavailable"));
      return;
    }
    globalThis.kuromoji.builder({ dicPath: "dict/" }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });

  const renderComparison = (comparison) => {
    if (!comparison) {
      comparisonStatus.textContent = "期待値は未入力です。";
      comparisonStatus.dataset.kind = "";
      return;
    }
    if (comparison.matches) {
      comparisonStatus.textContent = `期待値と一致しました（${comparison.actualLength}文字）。`;
      comparisonStatus.dataset.kind = "ok";
      return;
    }
    const diff = comparison.firstDifference;
    const actual = diff.actual === null ? "∅" : JSON.stringify(diff.actual);
    const expected = diff.expected === null ? "∅" : JSON.stringify(diff.expected);
    comparisonStatus.textContent = `不一致: ${diff.line}行 ${diff.column}文字目 / actual=${actual} expected=${expected} / 長さ ${comparison.actualLength}:${comparison.expectedLength}`;
    comparisonStatus.dataset.kind = "warn";
  };

  const renderTrace = (result) => {
    const resolver = result.resolver;
    const lines = [];
    lines.push(`[resolver] ready=${resolver.ready} delegated=${resolver.metrics.delta.delegated} fallback=${resolver.metrics.delta.fallbacks}`);
    if (resolver.error) lines.push(`[resolver-error] ${resolver.error}`);
    if (result.source !== result.coreOutput) {
      lines.push("[generic-authority] changed");
      lines.push(`  before: ${result.source}`);
      lines.push(`  after : ${result.coreOutput}`);
    } else {
      lines.push("[generic-authority] no change");
    }
    for (const item of result.stageTrace) {
      lines.push(`[${item.stageId}] ${item.stageKind}`);
      lines.push(`  before: ${item.before}`);
      lines.push(`  after : ${item.after}`);
    }
    if (result.stageTrace.length === 0) lines.push("[legacy/profile stages] no change");
    traceOutput.textContent = lines.join("\n");
  };

  const runTransform = () => {
    if (!runtime) return;
    const options = expectedText.value === "" ? {} : { expected: expectedText.value };
    const result = runtime.transform(sourceText.value, options);
    outputText.value = result.output;
    renderComparison(result.comparison);
    renderTrace(result);
  };

  const boot = async () => {
    transformBtn.disabled = true;
    copyBtn.disabled = true;
    setStatus("ローカル辞書・変換規則を読込中…");
    try {
      const [stages, tokenizer] = await Promise.all([loadStages(), buildTokenizer()]);
      runtime = AuthoringPlaygroundRuntime.createAuthoringRuntime({ stages, tokenizer });
      const init = await runtime.initialize();
      transformBtn.disabled = false;
      copyBtn.disabled = false;
      if (init.resolverReady) {
        setStatus(`準備完了: ${stages.length} stages / generic resolver ready`, "ok");
      } else {
        setStatus(`準備完了: ${stages.length} stages / generic resolver unavailable → legacy/profile fallback (${init.resolverError ?? "unknown"})`, "warn");
      }
      runTransform();
    } catch (error) {
      setStatus(`初期化失敗: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  transformBtn.addEventListener("click", runTransform);
  sourceText.addEventListener("input", () => {
    if (runtime) runTransform();
  });
  expectedText.addEventListener("input", () => {
    if (runtime) runTransform();
  });
  sampleBtn.addEventListener("click", () => {
    sourceText.value = "学校の台風。それをやっぱり分かることは奇跡だ。";
    expectedText.value = "學校の颱風｡其を矢ッ張分るヿは奇蹟だ｡";
    if (runtime) runTransform();
  });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(outputText.value);
      const original = copyBtn.textContent;
      copyBtn.textContent = "コピー済み";
      setTimeout(() => { copyBtn.textContent = original; }, 900);
    } catch (error) {
      setStatus(`コピー失敗: ${error instanceof Error ? error.message : String(error)}`, "warn");
    }
  });

  boot();
})();
