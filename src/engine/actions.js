/*
 * XForm Revival — action controller.
 * Historical reference: extensions/xforms/nsXFormsActionModuleBase.* and
 * nsXForms{SetValue,InsertDelete,SetIndex,Toggle,SetFocus,Dispatch,Send,Load,
 * Message,Rebuild,Recalculate,Revalidate,Refresh,Reset}Element.cpp
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const { localName, direct, text, dispatch, xpathNodes, sameOriginUrl } = root.utils;
  const actionNames = new Set([
    "action", "setvalue", "insert", "delete", "setindex", "toggle", "setfocus", "dispatch",
    "rebuild", "recalculate", "revalidate", "refresh", "reset", "send", "load", "message"
  ]);

  class ActionController {
    constructor(model, controls, submission, report = () => {}) {
      this.model = model;
      this.controls = controls;
      this.submission = submission;
      this.report = report;
    }

    async executeChildren(parent, context, eventContext = {}) {
      const actions = Array.from(parent?.children || []).filter((child) => actionNames.has(localName(child)));
      for (const action of actions) await this.execute(action, context, eventContext);
    }

    async execute(action, context, eventContext = {}) {
      const name = localName(action);
      const actionContext = this.model.contextFor(action, context);
      if (name === "action") {
        await this.executeChildren(action, actionContext, eventContext);
      } else if (name === "setvalue") {
        const target = this.model.nodeFor(action, actionContext);
        const value = action.getAttribute("value") || text(action);
        if (target) this.model.mutate(target, this.model.evaluateString(value, target));
      } else if (name === "insert") {
        this.insert(action, actionContext);
      } else if (name === "delete") {
        this.delete(action, actionContext);
      } else if (name === "setindex") {
        this.controls.setRepeatIndex(action.getAttribute("repeat") || action.getAttribute("id"), Number(action.getAttribute("index") || 1));
      } else if (name === "toggle") {
        const caseId = action.getAttribute("case") || text(direct(action, "case")[0]);
        this.controls.toggleCase(caseId);
      } else if (name === "setfocus") {
        const controlId = action.getAttribute("control") || text(direct(action, "control")[0]);
        this.controls.focus(controlId);
      } else if (name === "dispatch") {
        const targetId = action.getAttribute("targetid") || text(direct(action, "targetid")[0]);
        const eventName = action.getAttribute("name") || text(direct(action, "name")[0]) || "xforms-dispatch";
        dispatch(this.controls.targetForId(targetId) || this.model.element, eventName, { ...eventContext, model: this.model });
      } else if (name === "reset") {
        this.model.reset();
      } else if (["rebuild", "recalculate", "revalidate", "refresh"].includes(name)) {
        this.model.runUpdate({ rebuild: name === "rebuild", reason: name });
      } else if (name === "send") {
        await this.submission.send(action.getAttribute("submission") || action.getAttribute("id"), actionContext);
      } else if (name === "load") {
        const target = action.getAttribute("resource") || action.getAttribute("href") || text(direct(action, "resource")[0]);
        if (target) window.location.assign(sameOriginUrl(this.model.document, target).href);
      } else if (name === "message") {
        this.report(action.getAttribute("value") || text(action) || "XForms message", "info");
      }
      if (!new Set(["action", "reset", "rebuild", "recalculate", "revalidate", "refresh", "send", "load"]).has(name)) {
        this.model.runUpdate({ rebuild: this.model.rebuildRequested, reason: name });
      }
    }

    insert(action, context) {
      const target = this.model.nodeFor(action, context);
      if (!target) return;
      const originExpression = action.getAttribute("origin");
      const origin = originExpression ? xpathNodes(this.model.document, originExpression, context)[0] : null;
      const copy = origin ? target.ownerDocument.importNode(origin, true) : target.ownerDocument.createElement(target.localName);
      const position = action.getAttribute("at") || "last";
      if (position === "first") target.insertBefore(copy, target.firstChild);
      else target.append(copy);
      this.model.rebuildRequested = true;
      this.model.changedNodes.add(target);
      dispatch(target, "xforms-insert", { insertedNode: copy });
    }

    delete(action, context) {
      const targets = this.model.nodesFor(action, context);
      for (const target of targets) {
        if (target.parentNode) {
          const parent = target.parentNode;
          parent.removeChild(target);
          this.model.changedNodes.add(parent);
          dispatch(parent, "xforms-delete", { deletedNode: target });
        }
      }
      if (targets.length) this.model.rebuildRequested = true;
    }
  }

  root.ActionController = ActionController;
})();
