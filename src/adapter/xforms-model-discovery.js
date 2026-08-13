/*
 * XForm Revival — opt-in XForms model declaration discovery.
 *
 * This adapter emits browser-neutral declaration data. It does not resolve bind
 * targets, evaluate expressions, load external instances, or hydrate a worker.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const XFORMS_NAMESPACE = "http://www.w3.org/2002/xforms";
  const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
  const PROPERTY_ATTRIBUTES = Object.freeze(["calculate", "readonly", "relevant", "required", "constraint"]);

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

  function directXFormsChildren(element, expected) {
    return Array.from(element.children).filter((child) => isXForms(child, expected));
  }

  function allXForms(rootElement, expected) {
    const result = [];
    if (isXForms(rootElement, expected)) result.push(rootElement);
    for (const element of Array.from(rootElement?.querySelectorAll?.("*") || [])) {
      if (isXForms(element, expected)) result.push(element);
    }
    return result;
  }

  function namespacesInScope(element) {
    const namespaces = { xml: XML_NAMESPACE };
    for (let current = element; current?.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
      for (const attribute of Array.from(current.attributes)) {
        if (attribute.name === "xmlns" && namespaces[""] === undefined) namespaces[""] = attribute.value;
        if (attribute.name.startsWith("xmlns:") && namespaces[attribute.name.slice(6)] === undefined) {
          namespaces[attribute.name.slice(6)] = attribute.value;
        }
      }
    }
    return Object.freeze(namespaces);
  }

  function immutableDiagnostic({ code, message, source, attribute = null, offset = null }) {
    return Object.freeze({
      code,
      level: "warning",
      message,
      sourceId: source?.id || null,
      sourceName: localName(source),
      attribute,
      offset
    });
  }

  class XFormsModelDiscovery {
    static discover(rootElement = document) {
      if (!rootElement?.querySelectorAll && rootElement?.nodeType !== Node.ELEMENT_NODE) {
        throw new TypeError("discover(root) requires a Document, DocumentFragment, or Element root.");
      }
      if (!root.XPathCompatibility?.inspectXPath10) {
        throw new Error("Load xpath-compatibility.js before discovering XForms model declarations.");
      }
      const scope = rootElement.nodeType === Node.DOCUMENT_NODE ? rootElement.documentElement : rootElement;
      const diagnostics = [];
      const report = (input) => {
        const diagnostic = immutableDiagnostic(input);
        diagnostics.push(diagnostic);
        scope?.dispatchEvent(new CustomEvent("xforms-model-diagnostic", {
          detail: diagnostic,
          bubbles: true,
          composed: true
        }));
      };
      const validateExpression = (source, value, attribute) => {
        try {
          root.XPathCompatibility.inspectXPath10(value);
          return value;
        } catch (error) {
          report({
            code: "xpath-compatibility",
            message: `Cannot use ${attribute} on xf:bind: ${error.message}`,
            source,
            attribute,
            offset: Number.isInteger(error.offset) ? error.offset : null
          });
          return null;
        }
      };
      const discoverBindTree = (bind, parentBindingIndex, bindings) => {
        const hasRef = bind.hasAttribute("ref");
        const hasNodeset = bind.hasAttribute("nodeset");
        let bindingIndex = parentBindingIndex;
        if (!hasRef && !hasNodeset) {
          report({
            code: "bind-missing-target",
            message: "xf:bind requires exactly one of ref or nodeset in the initial discovery subset.",
            source: bind
          });
        } else if (hasRef && hasNodeset) {
          report({
            code: "bind-ambiguous-target",
            message: "xf:bind cannot declare both ref and nodeset in the initial discovery subset.",
            source: bind
          });
        } else {
          const targetAttribute = hasRef ? "ref" : "nodeset";
          const target = validateExpression(bind, bind.getAttribute(targetAttribute), targetAttribute);
          const properties = {};
          let valid = target !== null;
          for (const attribute of PROPERTY_ATTRIBUTES) {
            if (!bind.hasAttribute(attribute)) continue;
            const value = validateExpression(bind, bind.getAttribute(attribute), attribute);
            if (value === null) valid = false;
            else properties[attribute] = value;
          }
          if (valid) {
            bindingIndex = bindings.length;
            bindings.push(Object.freeze({
              sourceId: bind.id || null,
              targetKind: hasRef ? "ref" : "nodeset",
              target,
              datatype: bind.getAttribute("type") || null,
              parentBindingIndex,
              properties: Object.freeze(properties)
            }));
          }
        }
        for (const child of directXFormsChildren(bind, "bind")) discoverBindTree(child, bindingIndex, bindings);
      };
      const models = allXForms(scope, "model").map((model) => {
        const inlineInstances = [];
        for (const instance of directXFormsChildren(model, "instance")) {
          if (instance.hasAttribute("src") || instance.hasAttribute("resource")) {
            const attribute = instance.hasAttribute("src") ? "src" : "resource";
            report({
              code: "external-instance-deferred",
              message: `External xf:instance ${attribute} is deferred and was not fetched.`,
              source: instance,
              attribute
            });
          }
          const instanceRoot = Array.from(instance.children).find((child) => !isXForms(child));
          if (!instanceRoot) {
            if (!instance.hasAttribute("src") && !instance.hasAttribute("resource")) {
              report({
                code: "inline-instance-missing-root",
                message: "Inline xf:instance has no element root.",
                source: instance
              });
            }
            continue;
          }
          inlineInstances.push(Object.freeze({
            sourceId: instance.id || null,
            xml: new XMLSerializer().serializeToString(instanceRoot),
            nodeCount: 1 + instanceRoot.querySelectorAll("*").length,
            namespaces: namespacesInScope(instanceRoot)
          }));
        }
        const bindings = [];
        for (const bind of directXFormsChildren(model, "bind")) discoverBindTree(bind, null, bindings);
        return Object.freeze({
          sourceId: model.id || null,
          inlineInstances: Object.freeze(inlineInstances),
          bindings: Object.freeze(bindings)
        });
      });
      return Object.freeze({ models: Object.freeze(models), diagnostics: Object.freeze(diagnostics) });
    }
  }

  root.XFormsModelDiscovery = XFormsModelDiscovery;
})();
