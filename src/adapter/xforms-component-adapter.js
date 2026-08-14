/*
 * XForm Revival — opt-in XForms markup to Web Component adapter.
 *
 * This transitional adapter only maps a static presentation subset. It does
 * not parse models, evaluate XPath, assign bindings, or own worker state.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const XFORMS_NAMESPACE = "http://www.w3.org/2002/xforms";
  const COMPONENT_BY_ELEMENT = Object.freeze({
    input: "xforms-input",
    secret: "xforms-secret",
    textarea: "xforms-textarea",
    range: "xforms-range",
    output: "xforms-output",
    select: "xforms-select",
    select1: "xforms-select1",
    trigger: "xforms-trigger",
    submit: "xforms-submit",
    group: "xforms-group",
    switch: "xforms-switch",
    case: "xforms-case"
  });
  const CONTAINER_ELEMENTS = new Set(["group", "switch", "case"]);
  const PRESENTATION_CHILDREN = new Set(["label", "hint", "alert", "value", "item", "choices", "itemset"]);
  const SKIPPED_ELEMENTS = new Set(["model", "instance", "bind", "itemset", "submission"]);

  function localName(element) {
    const name = String(element?.localName || element?.tagName || "").toLowerCase();
    return name.includes(":") ? name.split(":").pop() : name;
  }

  function isXForms(element, expected) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const qualifiedName = `${element.tagName || ""} ${element.localName || ""}`;
    const matched = element.namespaceURI === XFORMS_NAMESPACE || /(?:^|\s)xf:/i.test(qualifiedName);
    return matched && (!expected || localName(element) === expected);
  }

  function isTemplate(element) {
    return element?.nodeType === Node.ELEMENT_NODE && element.localName?.toLowerCase() === "template" && element.content;
  }

  function directChildren(element, expected) {
    return Array.from(element.children).filter((child) => isXForms(child, expected));
  }

  function text(element) {
    return (element?.textContent || "").trim();
  }

  function presentation(source) {
    return {
      label: text(directChildren(source, "label")[0]) || source.getAttribute("label") || "",
      hint: text(directChildren(source, "hint")[0]),
      alert: text(directChildren(source, "alert")[0])
    };
  }

  function isWithinItemset(element) {
    for (let current = element.parentElement; current; current = current.parentElement) {
      if (isXForms(current, "itemset")) return true;
    }
    return false;
  }

  function staticChoices(source) {
    return Array.from(source.querySelectorAll("*") || [])
      .filter((element) => isXForms(element, "item") && !isWithinItemset(element))
      .map((item) => {
        const value = text(directChildren(item, "value")[0]);
        return {
          value,
          label: text(directChildren(item, "label")[0]) || value
        };
      });
  }

  function validNodeId(source) {
    const raw = source.getAttribute("data-node-id");
    if (raw === null || raw.trim() === "") return null;
    const nodeId = Number(raw);
    return Number.isSafeInteger(nodeId) && nodeId >= 0 ? String(nodeId) : null;
  }

  function caseIdentifier(source) {
    return source.getAttribute("case-id") || source.id || null;
  }

  class XFormsComponentAdapter {
    static upgrade(rootElement = document) {
      if (!rootElement?.querySelectorAll && rootElement?.nodeType !== Node.ELEMENT_NODE) {
        throw new TypeError("upgrade(root) requires a Document, DocumentFragment, or Element root.");
      }
      const summary = { upgraded: 0, skipped: 0, diagnostics: [] };
      const scope = rootElement.nodeType === Node.DOCUMENT_NODE ? rootElement.documentElement : rootElement;
      if (!scope) return Object.freeze(summary);

      const report = (code, message, source) => {
        const diagnostic = Object.freeze({
          code,
          level: "warning",
          message,
          sourceId: source?.id || null,
          sourceName: localName(source)
        });
        summary.diagnostics.push(diagnostic);
        scope.dispatchEvent(new CustomEvent("xforms-adapter-diagnostic", {
          detail: diagnostic,
          bubbles: true,
          composed: true
        }));
      };

      const upgradeChildren = (source) => {
        for (const child of Array.from(source.children || [])) {
          if (isTemplate(child)) {
            upgradeChildren(child.content);
            continue;
          }
          if (!isXForms(child)) {
            upgradeChildren(child);
            continue;
          }
          const name = localName(child);
          if (COMPONENT_BY_ELEMENT[name]) upgradeElement(child);
          else if (SKIPPED_ELEMENTS.has(name)) summary.skipped += 1;
          else upgradeChildren(child);
        }
      };

      const moveContainerContent = (source, destination) => {
        for (const child of Array.from(source.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE && isXForms(child) && PRESENTATION_CHILDREN.has(localName(child))) continue;
          destination.append(child);
        }
      };

      const upgradeElement = (source) => {
        const name = localName(source);
        const componentName = COMPONENT_BY_ELEMENT[name];
        if (!componentName || !source.parentNode) return;
        if (!customElements.get(componentName)) {
          throw new Error(`Load xforms-components.js before upgrading <xf:${name}>.`);
        }

        const sourcePresentation = presentation(source);
        const selectedCase = name === "switch"
          ? caseIdentifier(directChildren(source, "case").find((candidate) => candidate.getAttribute("selected") === "true"))
          : null;
        if (CONTAINER_ELEMENTS.has(name)) upgradeChildren(source);
        if ((name === "select" || name === "select1") && source.querySelector("*") && Array.from(source.querySelectorAll("*")).some((element) => isXForms(element, "itemset"))) {
          report("static-itemset-only", "xf:itemset is not upgraded; only static xf:item choices are projected.", source);
        }

        const destination = source.ownerDocument.createElement(componentName);
        if (source.id) {
          destination.id = source.id;
          destination.setAttribute("control-id", source.id);
        }
        if (source.hasAttribute("ref")) destination.setAttribute("ref", source.getAttribute("ref"));
        const nodeId = validNodeId(source);
        if (nodeId !== null) destination.setAttribute("node-id", nodeId);
        if (name === "case") {
          const identifier = caseIdentifier(source);
          if (identifier) destination.setAttribute("case-id", identifier);
        }
        if (name === "switch" && selectedCase) destination.setAttribute("selected-case", selectedCase);

        source.replaceWith(destination);
        if (CONTAINER_ELEMENTS.has(name)) moveContainerContent(source, destination);
        const state = { ...sourcePresentation };
        if (name === "select" || name === "select1") state.choices = staticChoices(source);
        destination.setControlState?.(state);
        summary.upgraded += 1;
      };

      if (isTemplate(scope)) upgradeChildren(scope.content);
      else if (isXForms(scope) && COMPONENT_BY_ELEMENT[localName(scope)]) upgradeElement(scope);
      else upgradeChildren(scope);
      return Object.freeze({
        upgraded: summary.upgraded,
        skipped: summary.skipped,
        diagnostics: Object.freeze([...summary.diagnostics])
      });
    }
  }

  root.XFormsComponentAdapter = XFormsComponentAdapter;
})();
