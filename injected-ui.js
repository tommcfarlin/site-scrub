// Functions injected into the active tab via chrome.scripting.executeScript.
//
// IMPORTANT: executeScript serializes each function's SOURCE and runs it in the
// page (isolated world). These functions must be fully self-contained — they
// may use DOM/window and their own arguments, but must not reference anything
// from this module's scope (imports, constants, other functions).

// A single, parameterized modal used for both confirm and info dialogs.
// opts = {
//   title, message,
//   buttons: [{ label, value, destructive?, primary?, requireTrusted? }],
//   dismissValue,        // resolved on Escape / overlay click
//   autofocusIndex = 0,  // which button gets initial focus
// }
// Resolves with the chosen button's `value` (or `dismissValue` if dismissed).
export function dialogInPage(opts) {
  return new Promise((resolve) => {
    const ID = "__wash_dialog__";
    document.getElementById(ID)?.remove();

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const host = document.createElement("div");
    host.id = ID;
    // Closed shadow root: the host page can't query, style, or drive our nodes.
    const root = host.attachShadow({ mode: "closed" });

    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(15,23,42,0.35)",
      backdropFilter: reduce ? "none" : "blur(2px)",
      font: "14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "#fff",
      color: "#0f172a",
      borderRadius: "14px",
      padding: "22px 22px 18px",
      width: "320px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
      textAlign: "center",
    });

    const titleEl = document.createElement("div");
    titleEl.id = ID + "-title";
    titleEl.textContent = opts.title;
    Object.assign(titleEl.style, { fontSize: "17px", fontWeight: "600", marginBottom: "8px" });

    const bodyEl = document.createElement("div");
    bodyEl.id = ID + "-desc";
    bodyEl.textContent = opts.message;
    Object.assign(bodyEl.style, { color: "#475569", marginBottom: "18px", lineHeight: "1.4" });

    overlay.setAttribute("aria-labelledby", titleEl.id);
    overlay.setAttribute("aria-describedby", bodyEl.id);

    const done = (value) => {
      host.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(opts.dismissValue); }
    };

    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", gap: "10px" });

    const btnEls = opts.buttons.map((b) => {
      const el = document.createElement("button");
      el.textContent = b.label;
      Object.assign(el.style, {
        flex: "1", padding: "10px", borderRadius: "9px", cursor: "pointer", fontSize: "14px",
      });
      if (b.destructive) {
        Object.assign(el.style, { border: "none", background: "#dc2626", color: "#fff", fontWeight: "600" });
      } else if (b.primary) {
        Object.assign(el.style, { border: "none", background: "#2563eb", color: "#fff", fontWeight: "600" });
      } else {
        Object.assign(el.style, { border: "1px solid #e2e8f0", background: "#f8fafc", color: "#0f172a" });
      }
      // Destructive/confirming buttons may require a genuine (isTrusted) click,
      // so a hostile page can't auto-confirm by dispatching a synthetic event.
      el.addEventListener("click", (e) => {
        if (b.requireTrusted && !e.isTrusted) return;
        done(b.value);
      });
      row.append(el);
      return el;
    });

    // Trap Tab within the dialog. The shadow root is closed, so the focused
    // node is root.activeElement, not document.activeElement.
    overlay.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      if (btnEls.length < 2) { e.preventDefault(); return; }
      const active = root.activeElement;
      const first = btnEls[0];
      const last = btnEls[btnEls.length - 1];
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(opts.dismissValue); });
    document.addEventListener("keydown", onKey, true);

    card.append(titleEl, bodyEl, row);
    overlay.append(card);
    root.append(overlay);
    (document.body || document.documentElement).append(host);

    (btnEls[opts.autofocusIndex ?? 0] ?? btnEls[0]).focus();
  });
}

// Transient 🧽 indicator, top-right, that fades out. `message` (optional) is
// announced to assistive tech via a visually-hidden live region, since the
// sponge itself is decorative.
export function spongeSplashInPage(message) {
  const ID = "__wash_sponge__";
  document.getElementById(ID)?.remove();

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const el = document.createElement("div");
  el.id = ID;
  el.textContent = "🧽";
  Object.assign(el.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: "2147483647",
    fontSize: "40px",
    lineHeight: "1",
    filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.3))",
    pointerEvents: "none",
    opacity: reduce ? "1" : "0",
    transform: reduce ? "none" : "translateY(-8px) scale(0.9)",
    transition: reduce ? "none" : "opacity 250ms ease, transform 250ms ease",
  });
  (document.body || document.documentElement).append(el);

  if (!reduce) {
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0) scale(1)";
    });
  }
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = reduce ? "none" : "translateY(-8px) scale(0.9)";
  }, 1100);
  setTimeout(() => el.remove(), 1500);

  if (message) {
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    Object.assign(status.style, {
      position: "fixed", width: "1px", height: "1px", margin: "-1px",
      overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap",
    });
    status.textContent = message;
    (document.body || document.documentElement).append(status);
    setTimeout(() => status.remove(), 2000);
  }
}
