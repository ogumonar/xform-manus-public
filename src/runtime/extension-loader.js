/*
 * XForm Revival — WebExtension loader.
 * Historical reference: extensions/xforms/nsXFormsModule.cpp and nsXFormsElementFactory.*
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const { descendants } = root.utils;

  function status(message, level = "info") {
    let element = document.querySelector(".xfr-status[data-xfr-engine-status]");
    if (!element) {
      element = document.createElement("div");
      element.className = "xfr-status";
      element.dataset.xfrEngineStatus = "true";
      (document.body || document.documentElement).prepend(element);
    }
    element.dataset.level = level;
    element.textContent = message;
    if (level === "error") console.warn("[XForm Revival]", message);
  }

  async function initializeModel(modelElement) {
    const model = new root.XFormsModel(document, modelElement, status);
    modelElement.classList.add("xfr-model");
    await model.initialize();
    const renderer = new root.ControlRenderer(document, model, status);
    const submission = new root.SubmissionController(model, status);
    const actions = new root.ActionController(model, renderer, submission, status);
    renderer.actions = actions;
    renderer.render();
    model.runUpdate({ rebuild: false, reason: "view-attach" });
    return { model, renderer, actions, submission };
  }

  async function launch() {
    const models = descendants(document, "model");
    if (!models.length) return;
    try {
      root.engines = [];
      for (const modelElement of models) root.engines.push(await initializeModel(modelElement));
      document.documentElement.dataset.xformRevival = "source-mapped-engine-ready";
      root.utils.dispatch(document, "xforms-ready", { engines: root.engines });
    } catch (error) {
      status(`XForms engine startup failed: ${error.message}`, "error");
      console.error("[XForm Revival]", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", launch, { once: true });
  else launch();
})();
