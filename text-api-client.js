// Shared Text Transform API adapter for the non-module Chrome extension runtime.
(() => {
  "use strict";

  const DEFAULT_BASE_URL = "https://api.kinotch.workers.dev";

  class TextTransformApiError extends Error {
    constructor(message, { status = 0, code = "request_failed", details } = {}) {
      super(message);
      this.name = "TextTransformApiError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  const createTextTransformClient = ({
    baseUrl = DEFAULT_BASE_URL,
    fetchImpl = globalThis.fetch,
  } = {}) => {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("fetchImpl must be a function");
    }

    const normalizedBaseUrl = `${baseUrl}`.replace(/\/+$/, "");

    const request = async (path, body) => {
      let response;
      try {
        response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new TextTransformApiError("Text transform API request failed", { details: error });
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new TextTransformApiError("Text transform API returned invalid JSON", {
          status: response.status,
          details: error,
        });
      }

      if (!response.ok) {
        throw new TextTransformApiError(
          payload?.message || "Text transform API request failed",
          {
            status: response.status,
            code: payload?.error,
            details: payload?.details,
          },
        );
      }

      return payload;
    };

    return Object.freeze({
      transformBatch(texts, options = {}) {
        return request("/v1/transform/batch", { texts, ...options });
      },
    });
  };

  globalThis.TextTransformApiClient = Object.freeze({
    DEFAULT_BASE_URL,
    TextTransformApiError,
    createTextTransformClient,
  });
})();
