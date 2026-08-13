/* XForm Revival — discovered inline-instance collection projection for xforms-repeat. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

  class DiscoveredRepeatProjectionError extends Error {
    constructor(code, message) { super(message); this.name = "DiscoveredRepeatProjectionError"; this.code = code; }
  }

  function directText(element) {
    return Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.nodeValue).join("").trim();
  }

  class XFormsDiscoveredRepeatProjector {
    static project({ inlineInstanceXml, bindings, bindId } = {}) {
      if (!root.XFormsBindTargetResolver?.resolve) throw new DiscoveredRepeatProjectionError("resolver-unavailable", "Load xforms-bind-target-resolver.js before the discovered repeat projector.");
      if (typeof bindId !== "string" || bindId.trim() === "") throw new DiscoveredRepeatProjectionError("missing-bind-id", "A repeat projection requires a non-empty bind-id.");
      const documentNode = new DOMParser().parseFromString(inlineInstanceXml, "application/xml");
      if (documentNode.querySelector("parsererror")) throw new DiscoveredRepeatProjectionError("invalid-instance", "Cannot parse inline XML for repeat projection.");
      const bindingIndex = bindings.findIndex((binding) => binding.sourceId === bindId);
      if (bindingIndex < 0) throw new DiscoveredRepeatProjectionError("unknown-bind-id", `No discovered bind has id '${bindId}'.`);
      const binding = bindings[bindingIndex];
      if (binding.parentBindingIndex !== null || binding.targetKind !== "nodeset") throw new DiscoveredRepeatProjectionError("unsupported-repeat-bind", `Repeat bind '${bindId}' must be a top-level nodeset binding.`);
      const resolved = root.XFormsBindTargetResolver.resolve({ instanceDocument: documentNode, bindings });
      const target = resolved[bindingIndex];
      const elements = [documentNode.documentElement, ...documentNode.documentElement.querySelectorAll("*")];
      const items = target.nodeIds.map((nodeId) => Object.freeze({ key: `node-${nodeId}`, nodeId, label: directText(elements[nodeId]) }));
      return Object.freeze({ items: Object.freeze(items), repeatIndex: items.length ? 1 : 0 });
    }
  }

  root.DiscoveredRepeatProjectionError = DiscoveredRepeatProjectionError;
  root.XFormsDiscoveredRepeatProjector = XFormsDiscoveredRepeatProjector;
})();
