/* XForm Revival — shared source/adapted direct action declaration discovery. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

  function declarationTemplate(trigger) {
    return Array.from(trigger.children).find((child) =>
      child.localName === "template" && child.hasAttribute("data-xforms-action-declarations")
    ) || null;
  }

  class XFormsActionDeclarationSource {
    static collect(host) {
      if (!host?.querySelectorAll) throw new TypeError("Action declaration discovery requires a host element.");
      const sourceTriggers = Array.from(host.querySelectorAll("xf\\:trigger[id]")).map((trigger) =>
        Object.freeze({ trigger, actionChildren: Object.freeze(Array.from(trigger.children)), retained: false })
      );
      const adaptedTriggers = Array.from(host.querySelectorAll("xforms-trigger[id]"))
        .map((trigger) => ({ trigger, template: declarationTemplate(trigger) }))
        .filter(({ template }) => template)
        .map(({ trigger, template }) => Object.freeze({
          trigger,
          actionChildren: Object.freeze(Array.from(template.content.children)),
          retained: true
        }));
      return Object.freeze([...sourceTriggers, ...adaptedTriggers]);
    }
  }

  root.XFormsActionDeclarationSource = XFormsActionDeclarationSource;
})();
