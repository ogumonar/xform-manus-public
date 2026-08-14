/* XForm Revival — constrained occurrence-local repeat control association. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const VALUE_CONTROL_SELECTOR = [
    "xforms-input", "xforms-secret", "xforms-textarea", "xforms-range",
    "xforms-output", "xforms-select", "xforms-select1"
  ].join(",");
  const SIMPLE_CHILD_REF = /^[A-Za-z_][A-Za-z0-9._-]*$/;

  class RepeatOccurrenceContextError extends Error {
    constructor(code, message) { super(message); this.name = "RepeatOccurrenceContextError"; this.code = code; }
  }

  function fail(code, message) { throw new RepeatOccurrenceContextError(code, message); }

  function parseInlineInstance(inlineInstanceXml) {
    const documentNode = new DOMParser().parseFromString(inlineInstanceXml, "application/xml");
    if (documentNode.querySelector("parsererror")) fail("repeat-context-invalid-instance", "Cannot parse inline XML for repeat occurrence control association.");
    return documentNode;
  }

  function compactElementIds(documentNode) {
    return new Map([documentNode.documentElement, ...documentNode.documentElement.querySelectorAll("*")].map((element, nodeId) => [element, nodeId]));
  }

  function contextTarget(item, ref) {
    if (ref === ".") return item;
    if (!SIMPLE_CHILD_REF.test(ref)) fail("repeat-context-unsupported-ref", `Repeat-local control ref '${ref}' must be '.' or one unprefixed direct child name.`);
    const matches = Array.from(item.children).filter((child) => child.localName === ref);
    if (matches.length !== 1) fail("repeat-context-ambiguous-target", `Repeat-local ref '${ref}' selected ${matches.length} direct child elements; exactly one is required.`);
    return matches[0];
  }

  function repeatBinding(bindings, bindId) {
    if (typeof bindId !== "string" || bindId.trim() === "") fail("repeat-context-missing-bind-id", "A repeat occurrence context requires a non-empty bind-id.");
    const bindingIndex = bindings.findIndex((binding) => binding?.sourceId === bindId);
    if (bindingIndex < 0) fail("repeat-context-unknown-bind-id", `No discovered bind has id '${bindId}'.`);
    const binding = bindings[bindingIndex];
    if (binding.parentBindingIndex !== null || binding.targetKind !== "nodeset") {
      fail("repeat-context-unsupported-repeat-bind", `Repeat bind '${bindId}' must be a top-level nodeset binding.`);
    }
    return { binding, bindingIndex };
  }

  function contextControls(template) {
    if (!template?.content) fail("repeat-context-template-missing", "Repeat occurrence control association requires one direct template.");
    return Array.from(template.content.querySelectorAll(VALUE_CONTROL_SELECTOR));
  }

  function cloneControls(occurrence) {
    return Array.from(occurrence.querySelectorAll(VALUE_CONTROL_SELECTOR));
  }

  class XFormsRepeatOccurrenceContextAdapter {
    static bind({ inlineInstanceXml, bindings, repeat, client } = {}) {
      if (!root.XFormsBindTargetResolver?.resolve) {
        fail("repeat-context-dependencies-unavailable", "Load xforms-bind-target-resolver.js before xforms-repeat-occurrence-context-adapter.js.");
      }
      if (!repeat?.matches?.("xforms-repeat[bind-id]")) {
        fail("repeat-context-invalid-repeat", "Repeat occurrence control association requires xforms-repeat[bind-id].");
      }
      if (!client?.registerComponent) fail("repeat-context-client-unavailable", "Repeat occurrence control association requires an initialized worker client.");
      if (!Array.isArray(bindings)) throw new TypeError("Repeat occurrence control association requires ordered discovered bindings.");

      const { bindingIndex } = repeatBinding(bindings, repeat.getAttribute("bind-id"));
      const documentNode = parseInlineInstance(inlineInstanceXml);
      const resolved = root.XFormsBindTargetResolver.resolve({ instanceDocument: documentNode, bindings: bindings.slice(0, bindingIndex + 1) });
      const itemNodeIds = resolved[bindingIndex]?.nodeIds || [];
      const elements = [documentNode.documentElement, ...documentNode.documentElement.querySelectorAll("*")];
      const elementIds = compactElementIds(documentNode);
      const templateControlsList = contextControls(repeat.querySelector(":scope > template"));
      const occurrences = Array.from(repeat.shadowRoot?.querySelectorAll("[part=occurrence]") || []);
      if (occurrences.length !== itemNodeIds.length) {
        fail("repeat-context-occurrence-mismatch", `Repeat projected ${occurrences.length} occurrences for ${itemNodeIds.length} compact item targets.`);
      }

      const assignments = [];
      itemNodeIds.forEach((itemNodeId, occurrenceIndex) => {
        const occurrence = occurrences[occurrenceIndex];
        const expectedKey = `node-${itemNodeId}`;
        if (occurrence?.dataset.repeatKey !== expectedKey) {
          fail("repeat-context-occurrence-mismatch", `Repeat occurrence ${occurrenceIndex + 1} does not carry expected key '${expectedKey}'.`);
        }
        const clones = cloneControls(occurrence);
        if (clones.length !== templateControlsList.length) {
          fail("repeat-context-template-mismatch", `Repeat occurrence ${occurrenceIndex + 1} contains ${clones.length} value controls for ${templateControlsList.length} template controls.`);
        }
        const item = elements[itemNodeId];
        if (!item || item.nodeType !== Node.ELEMENT_NODE) fail("repeat-context-unmapped-item", `Compact repeat item ${itemNodeId} is not an element target.`);
        templateControlsList.forEach((templateControl, controlIndex) => {
          const clone = clones[controlIndex];
          if (clone.hasAttribute("node-id")) {
            assignments.push({ component: clone, nodeId: clone.getAttribute("node-id"), key: expectedKey, explicit: true });
            return;
          }
          const ref = templateControl.getAttribute("ref")?.trim();
          if (!ref) return;
          const target = contextTarget(item, ref);
          const nodeId = elementIds.get(target);
          if (!Number.isSafeInteger(nodeId)) fail("repeat-context-unmapped-target", `Repeat-local ref '${ref}' selected an element outside the compact instance map.`);
          assignments.push({ component: clone, nodeId: String(nodeId), key: expectedKey, explicit: false });
        });
      });

      for (const assignment of assignments) {
        if (!assignment.explicit) assignment.component.setAttribute("node-id", assignment.nodeId);
        assignment.component.setAttribute("data-xforms-repeat-context-node-id", assignment.nodeId);
        assignment.component.setAttribute("data-xforms-repeat-context-key", assignment.key);
        assignment.component.bindClient(client);
      }
      return Object.freeze({ associated: assignments.filter((assignment) => !assignment.explicit).length, preservedExplicitNodeIds: assignments.filter((assignment) => assignment.explicit).length });
    }
  }

  root.RepeatOccurrenceContextError = RepeatOccurrenceContextError;
  root.XFormsRepeatOccurrenceContextAdapter = XFormsRepeatOccurrenceContextAdapter;
})();
