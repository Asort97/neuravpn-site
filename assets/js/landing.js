/* Landing page behaviour: header state, plan picker, live prices, skeleton settle. */
(function () {
    "use strict";

    const rub = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
    const fmt = function (value) { return rub.format(Math.round(value)) + " ₽"; };
    const perMonth = function (amount, days) {
        const months = Math.max(1, Math.round(days / 30.4));
        const monthly = amount / months;
        return (days === 30 ? "" : "≈") + fmt(monthly) + " в месяц";
    };

    // Header gains a hairline once the page scrolls; one passive listener, rAF-throttled.
    const header = document.getElementById("siteHeader");
    if (header) {
        let ticking = false;
        const update = function () { ticking = false; header.classList.toggle("is-scrolled", window.scrollY > 8); };
        window.addEventListener("scroll", function () {
            if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
        }, { passive: true });
        update();
    }

    // Plan picker: the summary sheet always mirrors the checked row.
    const rows = Array.from(document.querySelectorAll(".plan-row[data-plan]"));
    const summaryTerm = document.getElementById("summaryTerm");
    const summaryAmount = document.getElementById("summaryAmount");
    const summaryOld = document.getElementById("summaryOld");
    const summaryMonth = document.getElementById("summaryMonth");
    const prices = {};
    rows.forEach(function (row) {
        prices[row.dataset.plan] = { amount: Number(row.dataset.amount), original: 0, days: Number(row.dataset.days) };
    });

    function renderRow(row) {
        const p = prices[row.dataset.plan];
        const old = row.querySelector(".plan-price s");
        row.querySelector(".amt").textContent = fmt(p.amount);
        if (p.original > p.amount) { old.textContent = fmt(p.original); old.hidden = false; }
        else { old.textContent = ""; old.hidden = true; }
        row.querySelector(".plan-month").textContent = perMonth(p.amount, p.days);
    }

    function renderSummary() {
        const checked = document.querySelector("input[name='plan']:checked");
        if (!checked || !summaryAmount) return;
        const row = document.querySelector(".plan-row[data-plan='" + checked.value + "']");
        const p = prices[checked.value];
        summaryTerm.textContent = row.querySelector(".plan-term").textContent;
        summaryAmount.textContent = fmt(p.amount);
        summaryOld.textContent = p.original > p.amount ? fmt(p.original) : "";
        summaryMonth.textContent = perMonth(p.amount, p.days);
    }

    document.querySelectorAll("input[name='plan']").forEach(function (input) {
        input.addEventListener("change", renderSummary);
    });
    renderSummary();

    function apiBase() {
        const loc = window.location;
        if (loc.port === "8085" && (loc.hostname === "localhost" || loc.hostname === "127.0.0.1")) {
            return loc.protocol + "//" + loc.hostname + ":8090";
        }
        return "";
    }

    // Live prices: base prices are already in the HTML, so a failure leaves true numbers.
    function loadPrices() {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = controller ? window.setTimeout(function () { controller.abort(); }, 6000) : 0;
        fetch(apiBase() + "/api/public/plans", { credentials: "omit", signal: controller ? controller.signal : undefined })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (data) {
                if (!data || !Array.isArray(data.plans)) return;
                data.plans.forEach(function (plan) {
                    const current = prices[plan.id];
                    if (!current || typeof plan.amount !== "number") return;
                    current.amount = plan.amount;
                    current.original = typeof plan.original === "number" ? plan.original : 0;
                    current.days = plan.days || current.days;
                });
                rows.forEach(renderRow);
                renderSummary();
                renderSale(data.sale);
            })
            .catch(function () { /* keep the printed base prices */ })
            .finally(function () { if (timer) window.clearTimeout(timer); });
    }

    function renderSale(sale) {
        const line = document.getElementById("saleLine");
        if (!line || !sale || !sale.percent) return;
        const ends = new Date(sale.ends_at);
        if (!(ends > new Date())) return;
        const until = ends.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
        line.textContent = "";
        const strong = document.createElement("span");
        strong.textContent = "Скидка " + sale.percent + "% на все тарифы до " + until;
        line.appendChild(strong);
        if (sale.name) {
            const name = document.createElement("span");
            name.className = "fine";
            name.textContent = sale.name;
            line.appendChild(name);
        }
        line.classList.remove("hidden");
    }

    loadPrices();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Hero: a copper signal runs along the drawn network into the cat node.
    // It plays once when the drawing finishes and again whenever the visitor reaches for the main action.
    const signal = document.getElementById("signal");
    const motion = document.getElementById("signalMotion");
    const glow = document.getElementById("catGlow");
    let signalBusy = false;
    function runSignal() {
        if (!signal || !motion || typeof motion.beginElement !== "function" || reduced.matches || document.hidden || signalBusy) return;
        signalBusy = true;
        signal.classList.add("is-running");
        motion.beginElement();
        window.setTimeout(function () {
            signal.classList.remove("is-running");
            glow.classList.remove("is-on");
            void glow.getBoundingClientRect();
            glow.classList.add("is-on");
            window.setTimeout(function () { signalBusy = false; }, 500);
        }, 950);
    }
    if (signal) {
        window.setTimeout(runSignal, 2300);
        const cta = document.getElementById("heroCta");
        if (cta) {
            cta.addEventListener("pointerenter", runSignal);
            cta.addEventListener("focus", runSignal);
        }
        const stage = document.getElementById("stage");
        if (stage) stage.addEventListener("click", runSignal);
    }

    // Hero: the drawing tilts toward a fine pointer. Transform only; one rAF per move.
    const tilt = document.getElementById("stageTilt");
    const hero = document.querySelector(".hero");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (tilt && hero && finePointer.matches) {
        let frame = 0, px = 0, py = 0;
        const apply = function () {
            frame = 0;
            tilt.style.transform = "rotateX(" + (-py * 7).toFixed(2) + "deg) rotateY(" + (px * 9).toFixed(2) + "deg)";
        };
        hero.addEventListener("pointermove", function (event) {
            if (reduced.matches) return;
            const rect = hero.getBoundingClientRect();
            px = (event.clientX - rect.left) / rect.width - 0.5;
            py = (event.clientY - rect.top) / rect.height - 0.5;
            if (!frame) frame = window.requestAnimationFrame(apply);
        }, { passive: true });
        hero.addEventListener("pointerleave", function () {
            px = 0; py = 0;
            if (!frame) frame = window.requestAnimationFrame(apply);
        });
    }

    // Bypass scheme: plays once when it scrolls into view; the replay button runs it again.
    const scheme = document.getElementById("scheme");
    if (scheme) {
        const play = function () {
            scheme.classList.remove("is-playing");
            void scheme.getBoundingClientRect();
            scheme.classList.add("is-playing");
        };
        if ("IntersectionObserver" in window && !reduced.matches) {
            scheme.classList.add("is-armed");
            const io = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) { play(); io.disconnect(); }
                });
            }, { threshold: 0.45 });
            io.observe(scheme);
        }
        const replay = document.getElementById("schemeReplay");
        if (replay) replay.addEventListener("click", play);
    }

    // Skeletons wait for GitHub release data; if it never arrives, they leave quietly.
    const apps = document.getElementById("app");
    if (apps) {
        window.setTimeout(function () { apps.classList.add("is-settled"); }, 8000);
    }
})();
