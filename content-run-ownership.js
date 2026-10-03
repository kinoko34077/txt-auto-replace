// content-run-ownership.js
// Plain-text DOM ownership guard shared by content.js and deterministic Node tests.
(() => {
  "use strict";

  const normalizeOwnership = (ownership) => {
    if (!ownership || typeof ownership !== "object") {
      return null;
    }
    if (typeof ownership.sourceText !== "string" ||
        typeof ownership.transformedText !== "string") {
      return null;
    }
    return {
      sourceText: ownership.sourceText,
      transformedText: ownership.transformedText,
      revision: ownership.revision
    };
  };

  const evaluateRestore = (ownership, currentText) => {
    const record = normalizeOwnership(ownership);
    if (!record) {
      return {
        decision: "unowned",
        sourceText: typeof currentText === "string" ? currentText : ""
      };
    }

    if (currentText === record.sourceText) {
      return {
        decision: "already-source",
        sourceText: record.sourceText
      };
    }

    if (currentText !== record.transformedText) {
      return {
        decision: "external-change",
        sourceText: typeof currentText === "string" ? currentText : ""
      };
    }

    return {
      decision: "restore",
      sourceText: record.sourceText
    };
  };

  const resolveTransformSource = (ownership, currentText) => {
    const record = normalizeOwnership(ownership);
    if (!record) {
      return {
        sourceText: typeof currentText === "string" ? currentText : "",
        clearOwnership: false,
        owned: false
      };
    }
    if (currentText === record.transformedText) {
      return {
        sourceText: record.sourceText,
        clearOwnership: false,
        owned: true
      };
    }
    return {
      sourceText: typeof currentText === "string" ? currentText : "",
      clearOwnership: true,
      owned: false
    };
  };

  const restoreOwnedTextRun = (textNodes, ownership, adapters = {}) => {
    if (!Array.isArray(textNodes) || textNodes.length === 0) {
      return {
        restored: false,
        clearOwnership: false,
        decision: "invalid-run"
      };
    }

    const connectedNodes = textNodes.filter((node) => node?.isConnected);
    if (connectedNodes.length === 0) {
      return {
        restored: false,
        clearOwnership: false,
        decision: "disconnected"
      };
    }

    const readNodeValue = adapters.readNodeValue;
    const redistribute = adapters.redistribute;
    if (typeof readNodeValue !== "function" || typeof redistribute !== "function") {
      throw new TypeError("restoreOwnedTextRun requires readNodeValue and redistribute adapters");
    }

    const currentParts = connectedNodes.map((node) => readNodeValue(node));
    const currentText = currentParts.join("");
    const decision = evaluateRestore(ownership, currentText);

    if (decision.decision === "restore") {
      redistribute(connectedNodes, currentParts, decision.sourceText);
      return {
        restored: true,
        clearOwnership: true,
        decision: decision.decision,
        currentText,
        sourceText: decision.sourceText
      };
    }

    return {
      restored: false,
      clearOwnership: decision.decision !== "unowned",
      decision: decision.decision,
      currentText,
      sourceText: decision.sourceText
    };
  };

  const api = Object.freeze({
    evaluateRestore,
    resolveTransformSource,
    restoreOwnedTextRun
  });

  globalThis.ContentRunOwnership = api;
  if (typeof module !== "undefined" && module?.exports) {
    module.exports = api;
  }
})();
