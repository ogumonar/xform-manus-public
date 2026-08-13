/*
 * XForm Revival — submission engine.
 * Historical reference: extensions/xforms/nsXFormsSubmissionElement.*
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const { parseXml, dispatch, sameOriginUrl, xpathNodes } = root.utils;

  class SubmissionController {
    constructor(model, report = () => {}) {
      this.model = model;
      this.report = report;
    }

    validForSubmission() {
      this.model.revalidate();
      for (const bind of this.model.binds) {
        for (const node of this.model.nodesForBind(bind)) {
          const properties = this.model.propertiesFor(bind, node);
          if (properties.relevant && !properties.valid) return false;
        }
      }
      return true;
    }

    async send(id, context = null) {
      const submission = this.model.submissions.get(id) || (id && this.model.document.getElementById(id)) || this.model.submissions.values().next().value;
      if (!submission) throw new Error("No xf:submission exists for this send or submit control.");
      if (submission.getAttribute("validate") !== "false" && !this.validForSubmission()) {
        dispatch(submission, "xforms-submit-error", { reason: "validation-error" });
        this.report("The XForms submission was blocked because the model contains invalid data.", "error");
        return null;
      }
      const instance = this.model.instances.get(submission.getAttribute("instance") || "default") || this.model.defaultInstance();
      if (!instance?.documentElement) throw new Error("The submission has no instance data.");
      const resource = submission.getAttribute("resource") || submission.getAttribute("action") || this.model.document.location.href;
      const url = sameOriginUrl(this.model.document, resource);
      const method = (submission.getAttribute("method") || "post").toLowerCase();
      const serialization = (submission.getAttribute("serialization") || "application/xml").toLowerCase();
      const options = { method: method === "get" ? "GET" : method.toUpperCase(), credentials: "same-origin", headers: {} };
      if (options.method === "GET") {
        for (const [key, value] of this.urlEncoded(instance.documentElement)) url.searchParams.append(key, value);
      } else if (serialization.includes("urlencoded")) {
        options.headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
        options.body = new URLSearchParams(this.urlEncoded(instance.documentElement)).toString();
      } else {
        options.headers["Content-Type"] = "application/xml;charset=UTF-8";
        options.body = new XMLSerializer().serializeToString(instance.documentElement);
      }
      dispatch(submission, "xforms-submit", { url: url.href, method: options.method, serialization });
      try {
        const response = await fetch(url, options);
        const body = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await this.replaceResponse(submission, instance, body, response.url);
        dispatch(submission, "xforms-submit-done", { status: response.status, responseURL: response.url });
        return response;
      } catch (error) {
        dispatch(submission, "xforms-submit-error", { reason: "resource-error", error: error.message });
        this.report(`XForms submission failed: ${error.message}`, "error");
        return null;
      }
    }

    urlEncoded(rootElement) {
      const leaves = Array.from(rootElement.getElementsByTagName("*")).filter((element) => element.children.length === 0);
      return (leaves.length ? leaves : [rootElement]).map((element) => [element.localName, element.textContent]);
    }

    async replaceResponse(submission, instance, body, responseUrl) {
      const replace = submission.getAttribute("replace") || "none";
      if (replace === "all") {
        window.location.assign(responseUrl);
        return;
      }
      if (replace === "none") return;
      if (replace === "text") {
        const expression = submission.getAttribute("targetref");
        const target = expression ? xpathNodes(this.model.document, expression, instance.documentElement)[0] : instance.documentElement;
        if (target) this.model.mutate(target, body);
      } else if (replace === "instance") {
        const response = parseXml(body);
        const target = instance.documentElement;
        while (target.firstChild) target.removeChild(target.firstChild);
        for (const attribute of Array.from(target.attributes || [])) target.removeAttribute(attribute.name);
        for (const attribute of Array.from(response.documentElement.attributes || [])) target.setAttribute(attribute.name, attribute.value);
        for (const child of Array.from(response.documentElement.childNodes)) target.append(instance.importNode(child, true));
        this.model.rebuildRequested = true;
      }
      this.model.runUpdate({ rebuild: this.model.rebuildRequested, reason: "submission-response" });
    }
  }

  root.SubmissionController = SubmissionController;
})();
