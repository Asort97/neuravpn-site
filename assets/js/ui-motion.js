/* Ripple interaction adapted from Magic UI (MIT); see THIRD_PARTY_NOTICES.md.
 * Native DOM/CSS keeps the existing site free of a second UI runtime. */
(function () {
    "use strict";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const active = new Set();
    function clear() {
        active.forEach(item => { window.clearTimeout(item.timer); item.layer.remove(); });
        active.clear();
    }
    document.addEventListener("click", function (event) {
        if (reduced.matches || document.hidden) return;
        const button = event.target.closest(".btn, .plan-card");
        if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return;
        clear();
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const layer = document.createElement("span");
        layer.className = "ui-ripple-layer";
        layer.setAttribute("aria-hidden", "true");
        const ripple = document.createElement("span");
        ripple.className = "ui-ripple";
        ripple.style.width = ripple.style.height = size + "px";
        ripple.style.left = (event.detail ? event.clientX - rect.left : rect.width / 2) - size / 2 + "px";
        ripple.style.top = (event.detail ? event.clientY - rect.top : rect.height / 2) - size / 2 + "px";
        layer.appendChild(ripple); button.appendChild(layer);
        const item = { layer: layer, timer: 0 };
        item.timer = window.setTimeout(function () { layer.remove(); active.delete(item); }, 450);
        active.add(item);
    }, { capture: true, passive: true });
    document.addEventListener("visibilitychange", function () { if (document.hidden) clear(); });
    reduced.addEventListener?.("change", clear);
})();
