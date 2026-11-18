// @ts-check
// Functions injected into the active tab via chrome.scripting.executeScript.
//
// IMPORTANT: executeScript serializes each function's SOURCE and runs it in the
// page (isolated world). These functions must be fully self-contained — they
// may use DOM/window and their own arguments, but must not reference anything
// from this module's scope (imports, constants, other functions).

/**
 * @typedef {object} DialogButton
 * @property {string} label
 * @property {boolean} value
 * @property {boolean} [destructive]
 * @property {boolean} [primary]
 * @property {boolean} [requireTrusted]
 */

/**
 * @typedef {object} DialogOptions
 * @property {string} title
 * @property {string} message
 * @property {DialogButton[]} buttons
 * @property {boolean} dismissValue  Resolved on Escape / overlay click.
 * @property {number} [autofocusIndex]  Which button gets initial focus (default 0).
 */

// A single, parameterized modal used for both confirm and info dialogs (see
// DialogOptions). Resolves with the chosen button's `value` (or `dismissValue`
// if dismissed).
/**
 * @param {DialogOptions} opts
 * @returns {Promise<boolean>}
 */
export function dialogInPage(opts) {
  return new Promise((resolve) => {
    const ID = "__wash_dialog__";
    document.getElementById(ID)?.remove();

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Same look as the settings page: system font, one accent, red only on the
    // destructive button, light and dark from the browser setting.
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const c = dark
      ? { card: "#1C1C1E", text: "#F5F5F7", muted: "#98989F", field: "#2C2C2E", accent: "#0071E3", scrim: "rgba(0,0,0,0.6)", ring: "rgba(10,132,255,0.6)", shadow: "0 12px 40px rgba(0,0,0,0.6)" }
      : { card: "#FFFFFF", text: "#1D1D1F", muted: "#6E6E73", field: "#EEEEF1", accent: "#0071E3", scrim: "rgba(0,0,0,0.35)", ring: "rgba(0,113,227,0.45)", shadow: "0 12px 40px rgba(0,0,0,0.25)" };
    const DANGER = "#D70015";

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
      background: c.scrim,
      backdropFilter: "blur(8px)",
      font: "15px/21px -apple-system,BlinkMacSystemFont,'SF Pro Text',Inter,system-ui,sans-serif",
      WebkitFontSmoothing: "antialiased",
      opacity: reduce ? "1" : "0",
      transition: reduce ? "none" : "opacity 160ms ease",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      background: c.card,
      color: c.text,
      borderRadius: "14px",
      padding: "24px 20px 20px",
      width: "340px",
      maxWidth: "calc(100vw - 32px)",
      boxSizing: "border-box",
      boxShadow: c.shadow,
      textAlign: "center",
      transform: reduce ? "none" : "scale(0.96)",
      transition: reduce ? "none" : "transform 160ms ease",
    });

    // The sponge tile is the only decoration, as on the settings page.
    const tile = document.createElement("div");
    tile.textContent = "🧽";
    tile.setAttribute("aria-hidden", "true");
    Object.assign(tile.style, {
      width: "52px", height: "52px", margin: "0 auto 14px", borderRadius: "13px",
      background: "linear-gradient(160deg,#FFF6C7,#FFE27A)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "30px", lineHeight: "1",
    });

    const titleEl = document.createElement("div");
    titleEl.id = ID + "-title";
    titleEl.textContent = opts.title;
    Object.assign(titleEl.style, {
      fontSize: "17px", lineHeight: "22px", fontWeight: "600", letterSpacing: "-0.016em", marginBottom: "6px",
    });

    const bodyEl = document.createElement("div");
    bodyEl.id = ID + "-desc";
    bodyEl.textContent = opts.message;
    Object.assign(bodyEl.style, { color: c.muted, fontSize: "14px", lineHeight: "20px", marginBottom: "20px" });

    overlay.setAttribute("aria-labelledby", titleEl.id);
    overlay.setAttribute("aria-describedby", bodyEl.id);

    /** @param {boolean} value */
    const done = (value) => {
      host.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(opts.dismissValue); }
    };

    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", gap: "10px" });

    const btnEls = opts.buttons.map((b) => {
      const el = document.createElement("button");
      el.textContent = b.label;
      Object.assign(el.style, {
        flex: "1", padding: "10px 16px", borderRadius: "999px", cursor: "pointer",
        font: "inherit", fontSize: "15px", fontWeight: "600", border: "none", outline: "none",
      });
      if (b.destructive) {
        Object.assign(el.style, { background: DANGER, color: "#fff" });
      } else if (b.primary) {
        Object.assign(el.style, { background: c.accent, color: "#fff" });
      } else {
        Object.assign(el.style, { background: c.field, color: c.text });
      }
      // Focus ring set from script, because a page's CSP can block style tags.
      el.addEventListener("focus", () => {
        if (el.matches(":focus-visible")) el.style.boxShadow = `0 0 0 3px ${c.ring}`;
      });
      el.addEventListener("blur", () => { el.style.boxShadow = "none"; });
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

    card.append(tile, titleEl, bodyEl, row);
    overlay.append(card);
    root.append(overlay);
    (document.body || document.documentElement).append(host);

    (btnEls[opts.autofocusIndex ?? 0] ?? btnEls[0]).focus();
    if (!reduce) {
      requestAnimationFrame(() => {
        overlay.style.opacity = "1";
        card.style.transform = "scale(1)";
      });
    }
  });
}

// Transient 🧽 indicator, top-right, that fades out. `message` (optional) is
// announced to assistive tech via a visually-hidden live region, since the
// sponge itself is decorative.
/** @param {string} [message] */
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
