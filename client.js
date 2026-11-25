(() => {
  // actions.js
  function viewForTail(owner, view) {
    return view && view.seq === owner.turn.end?.seq ? view : null;
  }
  function reviewRouteForCard(card, route) {
    return card?.kind === "next_task" || card?.kind === "session_choice" ? "" : route;
  }
  async function deliver(ctx, attempt, placement, text, origin, remember) {
    if (!attempt.target) {
      if (placement === "new") {
        attempt.candidate ??= crypto.randomUUID();
        remember();
        attempt.target = await ctx.sessions.create({ ...origin.options, sessionId: attempt.candidate });
      } else attempt.target = origin.id;
      remember();
    }
    const result = await ctx.sessions.using(attempt.target, { source: "controllerOperation" }, ({ binding }) => {
      const snap = binding.session.getSnapshot();
      if (snap.openState !== "open") throw Error(snap.openError?.message || "Session unavailable");
      attempt.possiblySent = true;
      remember();
      return binding.session.prompt([{ type: "text", text }], "queue", void 0, attempt.requestId);
    });
    if (!result.ok || !result.value?.accepted) throw Error(result.error?.message || "No acceptance receipt");
    attempt.done = true;
    remember();
    if (placement === "new") ctx.uiWorkspace.openSession(attempt.target);
  }

  // autosave.js
  function createAutosave(form) {
    const pending = /* @__PURE__ */ new Map(), listeners = /* @__PURE__ */ new Set(), failed = /* @__PURE__ */ new Set();
    let running = false, scheduled = false, state = { draft: {}, saving: false, error: false };
    function notify() {
      state = { draft: Object.fromEntries([...pending].map(([k, v]) => [k, v.value])), saving: pending.size > 0, error: failed.size > 0 };
      for (const fn of listeners) fn();
    }
    async function drain() {
      scheduled = false;
      if (running) return;
      running = true;
      try {
        while (pending.size) {
          const batch = [...pending];
          let ok = false;
          try {
            ok = await form.mutate(batch.map(([key, item]) => ({ op: "set", path: [key], value: item.value })));
          } catch {
          }
          for (const [key, item] of batch) {
            if (pending.get(key) !== item) continue;
            pending.delete(key);
            if (!ok) failed.add(key);
          }
          notify();
        }
      } finally {
        running = false;
      }
    }
    return { read: () => state, subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }, change(key, value) {
      if (!form.getSnapshot().writable) return;
      failed.delete(key);
      pending.set(key, { value });
      notify();
      if (!running && !scheduled) {
        scheduled = true;
        queueMicrotask(drain);
      }
    } };
  }

  // settings.js
  var settingsCopy = {
    zh: { page: "\u4E0B\u4E00\u6B65\u5EFA\u8BAE", enabled: "\u542F\u7528\u4E0B\u4E00\u6B65\u5EFA\u8BAE", model: "\u68C0\u67E5\u6A21\u578B", local: "\u4E0D\u8C03\u7528\u5916\u90E8\u6A21\u578B", loading: "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026", unavailableForm: "\u8BBE\u7F6E\u6682\u4E0D\u53EF\u7528", readonly: "\u5F53\u524D\u914D\u7F6E\u53EA\u8BFB", saving: "\u6B63\u5728\u4FDD\u5B58\u2026", saveError: "\u8BBE\u7F6E\u672A\u4FDD\u5B58\uFF0C\u8BF7\u91CD\u8BD5\u3002", catalogError: "\u672A\u80FD\u8BFB\u53D6\u6A21\u578B\u5217\u8868", empty: "\u6682\u65E0\u53EF\u9009\u6A21\u578B", retry: "\u91CD\u65B0\u52A0\u8F7D\u6A21\u578B", privacy: "\u9009\u62E9\u6A21\u578B\u540E\uFF0C\u672C\u8F6E\u7528\u6237\u6587\u5B57\u548C\u6700\u7EC8\u56DE\u590D\u4F1A\u53D1\u9001\u7ED9\u8BE5\u6A21\u578B\uFF0C\u53EF\u80FD\u4EA7\u751F\u8D39\u7528\u3002", reviewError: "\u672C\u8F6E\u5EFA\u8BAE\u68C0\u67E5\u672A\u5B8C\u6210\u3002" },
    en: { page: "Next step cards", enabled: "Enable next step cards", model: "Review model", local: "No external model", loading: "Loading settings\u2026", unavailableForm: "Settings unavailable", readonly: "These settings are read-only", saving: "Saving\u2026", saveError: "Settings not saved. Try again.", catalogError: "Could not load models", empty: "No models available", retry: "Reload models", privacy: "Selecting a model sends the user text and final reply from each turn to that model. Charges may apply.", reviewError: "The suggestion check did not complete." }
  };
  function visibleCard(snapshot) {
    return snapshot.status === "ready" && snapshot.value?.enabled === true;
  }
  function createSettings(React, form, t) {
    const h = React.createElement, subscribe = (fn) => form.subscribe(fn), read = () => form.getSnapshot();
    const editor = createAutosave(form);
    function useSettings() {
      return React.useSyncExternalStore(subscribe, read);
    }
    function Page() {
      const snap = useSettings(), { draft, saving, error } = React.useSyncExternalStore(editor.subscribe, editor.read);
      const [models, setModels] = React.useState(null), [load, setLoad] = React.useState(0), [catalogError, setCatalogError] = React.useState(false);
      React.useEffect(() => {
        const c = new AbortController();
        setCatalogError(false);
        setModels(null);
        fetch("api/dsh-suggest-card.models", { signal: c.signal, cache: "no-store" }).then((r) => {
          if (!r.ok) throw Error();
          return r.json();
        }).then((list) => {
          if (!Array.isArray(list)) throw Error();
          if (!c.signal.aborted) setModels(list);
        }).catch(() => {
          if (!c.signal.aborted) setCatalogError(true);
        });
        return () => c.abort();
      }, [load]);
      const route = draft.reviewModel ?? snap.value?.reviewModel ?? "", locked = !snap.writable, change = editor.change;
      const notice = snap.status !== "ready" ? snap.status === "loading" ? "loading" : "unavailableForm" : !snap.writable ? "readonly" : saving ? "saving" : error ? "saveError" : null;
      return h("section", { className: "dsc-settings" }, h("style", null, `
      .dsc-settings{color:var(--dsw-alias-label-primary);font:inherit}.dsc-settings h2{font-size:1.1em;margin:0 0 16px;font-weight:600}
      .dsc-setting{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}.dsc-setting span{min-width:0;overflow-wrap:anywhere}
      .dsc-setting input{appearance:none;position:relative;flex:none;width:36px;height:22px;margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
      .dsc-setting input::after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary)}.dsc-setting input:checked{background:var(--dsw-alias-label-primary)}.dsc-setting input:checked::after{left:17px;background:var(--dsw-alias-bg-base)}
      .dsc-setting input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.dsc-setting input:disabled{opacity:.55;cursor:default}.dsc-settings p{color:var(--dsw-alias-label-secondary)}
      @media(forced-colors:active){.dsc-setting input{appearance:auto}.dsc-setting input::after{display:none}}
      .dsc-setting select{max-width:65%;min-width:0;font:inherit;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:5px}.dsc-settings small{color:var(--dsw-alias-label-secondary)}
    `), h("h2", null, t("page")), snap.status === "ready" && h(
        React.Fragment,
        null,
        h("label", { className: "dsc-setting" }, t("enabled"), h("input", { type: "checkbox", role: "switch", checked: draft.enabled ?? visibleCard(snap), disabled: locked, onChange: (e) => void change("enabled", e.target.checked) })),
        h("label", { className: "dsc-setting" }, t("model"), h("select", { value: route, disabled: locked, onChange: (e) => void change("reviewModel", e.target.value) }, h("option", { value: "" }, t("local")), route && !models?.some((m) => m.id === route) && h("option", { value: route }, route), models?.map((m) => h("option", { key: m.id, value: m.id }, m.label)))),
        h("p", null, h("small", null, t("privacy"))),
        (catalogError || models?.length === 0) && h("p", null, t(catalogError ? "catalogError" : "empty"), " ", h("button", { type: "button", onClick: () => setLoad((n) => n + 1) }, t("retry")))
      ), h("p", { role: "status" }, notice ? t(notice) : null));
    }
    return { Page, useSettings };
  }

  // client-entry.js
  var ns = "dsh-suggest-card";
  var css = `
.dsc-wrap{max-width:37rem;min-width:0;margin-block:16px 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px);overflow-wrap:anywhere}
.dsc-card,.dsc-replies{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:8px;color:inherit}
.dsc-card{width:100%;max-width:26rem;overflow:hidden;text-align:start;font:inherit}
.dsc-caption{padding:4px 12px;background:var(--dsw-alias-bg-layer-1);font-weight:550;line-height:1.4}
.dsc-body{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:4px;padding:6px 8px 6px 12px}
.dsc-copy{display:grid;gap:2px}.dsc-title{font-weight:550;line-height:1.45}.dsc-desc{color:var(--dsw-alias-label-secondary);line-height:1.5;white-space:pre-wrap}
.dsc-actions,.dsc-placements,.dsc-replies{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.dsc-actions{padding:0 12px 6px}.dsc-placements{max-width:100%;margin-inline-start:auto;justify-content:flex-end}.dsc-actions .dsc-btn:not(.dsc-primary){background:transparent}.dsc-replies{width:fit-content;max-width:100%;padding:9px}
.dsc-wrap button{cursor:pointer}.dsc-btn,.dsc-close{border:0;font:inherit;color:inherit}.dsc-btn{max-width:100%;padding:6px 12px;border-radius:6px;line-height:1.4;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1)}
.dsc-btn.dsc-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}.dsc-close{font-size:1.25em;background:transparent;line-height:1;width:28px;height:28px;border-radius:5px}
.dsc-wrap button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dsc-wrap button:disabled{opacity:.6;cursor:default}
@media(hover:hover){.dsc-close:hover:not(:disabled),.dsc-btn:not(.dsc-primary):hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dsc-primary:hover:not(:disabled){opacity:.85}}
.dsc-note{color:var(--dsw-alias-label-secondary);margin-top:5px}.dsc-error{color:var(--dsw-alias-state-error-primary)}
`;
  var dict = {
    zh: { new: "\u65B0\u4F1A\u8BDD", here: "\u5728\u8FD9\u91CC\u505A", start: "\u5F00\u59CB", options: "\u9009\u9879", close: "\u5173\u95ED\u5EFA\u8BAE", sent: "\u5DF2\u53D1\u9001", busy: "\u6B63\u5728\u53D1\u9001\u2026", failed: "\u672A\u786E\u8BA4\u53D1\u9001\uFF0C\u8BF7\u91CD\u8BD5\uFF1A", open: "\u5728\u65B0\u4F1A\u8BDD\u4E2D\u5F00\u59CB", reply: "\u56DE\u590D\u9009\u9879", unavailable: "\u5F53\u524D\u4E0D\u53EF\u53D1\u9001" },
    en: { new: "New session", here: "Do it here", start: "Start", options: "Options", close: "Dismiss suggestion", sent: "Sent", busy: "Sending\u2026", failed: "Delivery not confirmed. Retry: ", open: "Start in a new session", reply: "Reply options", unavailable: "Sending unavailable" }
  };
  window.__ModuleLoader__.load({ id: "@k99k5/dsh-suggest-card", factory(require2) {
    const React = require2("react"), h = React.createElement;
    return { inject: ["slots", "locale", "sessions", "uiWorkspace", "configForms"], apply(ctx) {
      const uiLocale = `${ns}.ui`;
      ctx.effect(() => ctx.locale.register(uiLocale, { zh: { ...dict.zh, ...settingsCopy.zh }, en: { ...dict.en, ...settingsCopy.en } }));
      const t = ctx.locale.bind(uiLocale);
      const { Page, useSettings } = createSettings(React, ctx.configForms.get(ns), t);
      ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: ns, order: 95, label: () => t("page"), locale: uiLocale }, Page));
      const memory = /* @__PURE__ */ new Map(), locks = /* @__PURE__ */ new Set();
      function save(key, state) {
        memory.set(key, state);
        try {
          sessionStorage.setItem(key, JSON.stringify(state));
        } catch {
        }
      }
      function load(key) {
        if (memory.has(key)) return memory.get(key);
        try {
          return JSON.parse(sessionStorage.getItem(key)) || {};
        } catch {
          return {};
        }
      }
      function Card({ card, origin, identity, allowHere, allowNew }) {
        const [receipt, setReceipt] = React.useState(() => load(identity));
        const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
        const remember = (state) => {
          save(identity, state);
          setReceipt({ ...state });
        };
        async function send(where, text2, action) {
          const prior = load(identity);
          if (locks.has(identity) || prior.done || prior.dismissed || (where === "new" ? !allowNew : !allowHere) || prior.possiblySent && prior.action !== action) return;
          locks.add(identity);
          setBusy(true);
          setError("");
          try {
            const attempt = prior.action === action ? { ...prior } : { action, requestId: crypto.randomUUID() };
            remember(attempt);
            await deliver(ctx, attempt, where, text2, origin, () => remember(attempt));
          } catch (e) {
            setError(e.message || String(e));
          } finally {
            locks.delete(identity);
            setBusy(false);
          }
        }
        if (receipt.dismissed) return null;
        if (receipt.done) return h("div", { className: "dsc-wrap dsc-note", role: "status" }, t("sent"));
        const text = card.kind === "question" ? "" : `${card.title}

${card.description}`;
        const disabled = (action, where) => busy || !!(receipt.possiblySent && receipt.action !== action) || (where === "new" ? !allowNew : !allowHere);
        const btn = (label, action, where, value, primary) => h("button", { type: "button", key: action, className: "dsc-btn" + (primary ? " dsc-primary" : ""), title: where === "new" ? t("open") : void 0, "aria-label": where === "new" ? `${label}: ${t("open")}` : void 0, disabled: disabled(action, where), onClick: () => send(where, value, action) }, label);
        let content;
        if (card.kind === "question") content = h("div", { className: "dsc-replies", role: "group", "aria-label": t("reply") }, card.labels.map((label, i) => btn(label, String(i), "here", label, i === 0)));
        else content = h(
          "div",
          { className: "dsc-card", role: "group", "aria-label": card.title },
          h("div", { className: "dsc-caption" }, t("new")),
          h(
            "div",
            { className: "dsc-body" },
            h("div", { className: "dsc-copy" }, h("span", { className: "dsc-title" }, card.title), h("span", { className: "dsc-desc" }, card.description)),
            h("button", { type: "button", className: "dsc-close", disabled: busy, title: t("close"), "aria-label": t("close"), onClick: () => remember({ dismissed: true }) }, "\xD7")
          ),
          h("div", { className: "dsc-actions" }, h("span", null, t("options")), h("div", { className: "dsc-placements" }, btn(t("here"), "here", "here", text, false), btn(t("start"), "new", "new", text, true)))
        );
        const denied = card.kind === "question" ? !allowHere : !allowHere && !allowNew;
        return h("div", { className: "dsc-wrap" }, h("style", null, css), content, h("div", { role: "status", className: "dsc-note" + (error ? " dsc-error" : "") }, error ? t("failed") + error : busy ? t("busy") : denied ? t("unavailable") : null));
      }
      function Reviewed({ lookup, ...props }) {
        const [result, setResult] = React.useState(null);
        React.useEffect(() => {
          const c = new AbortController();
          fetch(`api/dsh-suggest-card.result?key=${encodeURIComponent(lookup)}`, { signal: c.signal, cache: "no-store" }).then((r) => {
            if (!r.ok) throw Error();
            return r.json();
          }).then((r) => {
            if (!c.signal.aborted) setResult(r);
          }).catch(() => {
            if (!c.signal.aborted) setResult({ error: true });
          });
          return () => c.abort();
        }, [lookup]);
        if (result?.error) return h("small", { role: "status" }, t("reviewError"));
        return result?.card ? h(Card, { ...props, card: result.card }) : null;
      }
      function Tail(p) {
        const settings = useSettings();
        const view = p.useProjection("suggestCardV2", (v) => viewForTail(p, v));
        const allowHere = p.useAccess("session/prompt");
        const allowCreate = p.useRemoteAccess("session/create");
        const cwd = p.useSessions((v) => v.byId[p.sessionId]?.cwd);
        const workspaceId = p.useWorkspaces((v) => v.items.find((w) => w.sessionIds.includes(p.sessionId))?.workspaceId);
        if (!view || !visibleCard(settings)) return null;
        const lookup = `${p.sessionId}:${view.seq}`, route = reviewRouteForCard(view.card, settings.value.reviewModel);
        const identity = `${ns}:${lookup}:${route || "local"}`;
        const props = { key: identity, identity, allowHere, allowNew: allowHere && allowCreate && !!(workspaceId || cwd), origin: { id: p.sessionId, options: workspaceId ? { workspaceId } : { cwd } } };
        return route ? h(Reviewed, { ...props, lookup }) : view.card ? h(Card, { ...props, card: view.card }) : null;
      }
      ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({ name: "conversation.chat.turnTail", id: ns, order: -5 }, Tail));
    } };
  } });
})();
