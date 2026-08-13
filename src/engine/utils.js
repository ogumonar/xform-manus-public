/*
 * XForm Revival — shared engine utilities.
 * Historical reference: extensions/xforms/nsXFormsUtils.* and nsXFormsAtoms.*
 * New code; it does not execute or wrap the historical XPCOM implementation.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const XF_NS = "http://www.w3.org/2002/xforms";
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const XSD_NS = "http://www.w3.org/2001/XMLSchema";
  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  const localName = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";
    const name = String(element.localName || element.tagName || "").toLowerCase();
    return name.includes(":") ? name.split(":").pop() : name;
  };

  const isXForms = (element, expected) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const prefixed = /^xf:/i.test(element.tagName || "") || /^xf:/i.test(element.localName || "");
    const inNamespace = element.namespaceURI === XF_NS;
    return (prefixed || inNamespace) && (!expected || localName(element) === expected);
  };

  const descendants = (rootElement, expected) => {
    const found = [];
    if (isXForms(rootElement, expected)) found.push(rootElement);
    for (const element of rootElement?.getElementsByTagName?.("*") || []) {
      if (isXForms(element, expected)) found.push(element);
    }
    return found;
  };

  const direct = (element, expected) => Array.from(element?.children || [])
    .filter((child) => isXForms(child, expected));

  const text = (element) => (element?.textContent || "").trim();

  function splitArguments(value) {
    const parts = [];
    let start = 0;
    let level = 0;
    let quote = null;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "(") level += 1;
      else if (character === ")") level -= 1;
      else if (character === "," && level === 0) {
        parts.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts;
  }

  function createXmlDocumentFromHtmlNode(source) {
    const xml = document.implementation.createDocument(null, null);
    const clone = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return xml.importNode(node, true);
      const explicitNamespace = node.hasAttribute?.("xmlns");
      const namespace = node.namespaceURI === XHTML_NS && !explicitNamespace ? null : node.namespaceURI;
      const result = xml.createElementNS(namespace, node.localName || node.nodeName);
      for (const attribute of Array.from(node.attributes || [])) {
        if (attribute.name === "xmlns" && namespace === null) continue;
        result.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
      }
      for (const child of Array.from(node.childNodes || [])) result.append(clone(child));
      return result;
    };
    xml.append(clone(source));
    return xml;
  }

  function parseXml(source) {
    const parsed = new DOMParser().parseFromString(source, "application/xml");
    if (parsed.querySelector("parsererror")) throw new Error("The resource is not well-formed XML.");
    return parsed;
  }

  function namespaceResolver(pageDocument, context) {
    return (prefix) => {
      if (prefix === "xml") return XML_NS;
      if (prefix === "xf" || prefix === "xforms") return XF_NS;
      if (prefix === "xsd" || prefix === "xs") return XSD_NS;
      return context?.lookupNamespaceURI?.(prefix) || pageDocument.documentElement?.lookupNamespaceURI?.(prefix) || null;
    };
  }

  function xpath(documentNode, expression, context, type = XPathResult.ANY_TYPE) {
    if (!expression || !context) return null;
    try {
      const owner = context.nodeType === Node.DOCUMENT_NODE ? context : context.ownerDocument;
      return owner.evaluate(expression, context, namespaceResolver(documentNode, context), type, null);
    } catch (error) {
      throw new Error(`XPath evaluation failed for '${expression}': ${error.message}`);
    }
  }

  function xpathNodes(documentNode, expression, context) {
    const result = xpath(documentNode, expression, context, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
    const nodes = [];
    for (let index = 0; result && index < result.snapshotLength; index += 1) nodes.push(result.snapshotItem(index));
    return nodes;
  }

  function xpathString(documentNode, expression, context) {
    const result = xpath(documentNode, expression, context, XPathResult.STRING_TYPE);
    return result ? result.stringValue : "";
  }

  function xpathBoolean(documentNode, expression, context) {
    const result = xpath(documentNode, expression, context, XPathResult.BOOLEAN_TYPE);
    return result ? result.booleanValue : false;
  }

  function dispatch(target, type, detail = {}) {
    target.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  }

  function sameOriginUrl(documentNode, value) {
    const url = new URL(value, documentNode.location.href);
    if (url.origin !== documentNode.location.origin) {
      throw new Error(`Cross-origin resource blocked by XForm Revival: ${url.origin}`);
    }
    return url;
  }

  root.utils = {
    XF_NS, XML_NS, XSD_NS, XHTML_NS, localName, isXForms, descendants, direct, text,
    splitArguments, createXmlDocumentFromHtmlNode, parseXml, namespaceResolver,
    xpath, xpathNodes, xpathString, xpathBoolean, dispatch, sameOriginUrl
  };
})();
