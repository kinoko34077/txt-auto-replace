(() => {
  "use strict";

  const saveAllButton = document.getElementById("save-all");
  const statusNode = document.getElementById("status");
  if (!saveAllButton || !statusNode) return;

  let dirty = false;

  const saveStateNode = document.createElement("span");
  saveStateNode.id = "save-state";
  saveStateNode.className = "chip";
  saveStateNode.setAttribute("role", "status");
  saveStateNode.setAttribute("aria-live", "polite");
  saveAllButton.insertAdjacentElement("afterend", saveStateNode);

  const refreshDirtyState = () => {
    saveStateNode.textContent = dirty
      ? "\u672a\u4fdd\u5b58\u306e\u5909\u66f4\u3042\u308a"
      : "\u4fdd\u5b58\u6e08\u307f";
    saveStateNode.dataset.dirty = dirty ? "true" : "false";
    saveAllButton.dataset.dirty = dirty ? "true" : "false";
    saveAllButton.title = dirty
      ? "\u672a\u4fdd\u5b58\u306e\u5909\u66f4\u3092\u4fdd\u5b58\u3057\u307e\u3059"
      : "\u73fe\u5728\u306e\u8a2d\u5b9a\u306f\u4fdd\u5b58\u6e08\u307f\u3067\u3059";
  };

  const markDirty = () => {
    dirty = true;
    refreshDirtyState();
  };

  const markSaved = () => {
    dirty = false;
    refreshDirtyState();
  };

  document.addEventListener("settings-dirty", markDirty);
  document.addEventListener("settings-saved", markSaved);

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  refreshDirtyState();
})();
