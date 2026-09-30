(function (root) {
  "use strict";

  root.KinotchTokenStyleArtifact = Object.freeze({
  "manifest": {
    "artifactSchemaVersion": "1",
    "profileId": "kinotch-authoring",
    "authority": "project_profile",
    "responsibility": "style_render",
    "genericSafety": "not_implied",
    "packId": "token-style",
    "buildSourceIdentity": "canonical-content-addressed",
    "artifactGeneration": "574f0deeface6dcf8348ef57d42c38a2c2323bce421992676aad2058bb7c6cd1",
    "canonicalSourceDigest": "0f0d2b4699ad040977fcaf47d528bb5b387515a42edd77e07bad8ebb53b7f877",
    "adoptedSource": {
      "repository": "kinoko34077/txt-auto-replace",
      "commit": "48ceade01db46af3fad7acfb8743c3d841885c33",
      "path": "transforms/20-lexical-replacements.json5",
      "blobSha": "32d4acff7532b5dd21d0bab1d1ba414298f27687"
    },
    "files": [
      {
        "path": "20-kinotch-token-style.json5",
        "payloadDigest": "c3d1f58309b2060d37591ece438fdc3d047025b03d4398ca4f219737b7f424d1",
        "byteLength": 214
      }
    ]
  },
  "bundle": {
    "id": "kinotch-token-style",
    "label": "KiNoTch. token style",
    "kind": "token-rules",
    "rules": [
      {
        "from": "こと",
        "to": "ヿ",
        "type": "literal",
        "priority": 100
      }
    ]
  }
});
})(typeof globalThis !== "undefined" ? globalThis : this);
