(function () {
    const API_BASE = detectAPIBase();
    const authView = document.getElementById("authView");
    const dashboardView = document.getElementById("dashboardView");
    const emailForm = document.getElementById("emailForm");
    const codeForm = document.getElementById("codeForm");
    const emailInput = document.getElementById("emailInput");
    const codeInput = document.getElementById("codeInput");
    const authStatus = document.getElementById("authStatus");
    const changeEmailBtn = document.getElementById("changeEmailBtn");
    const accountChooser = document.getElementById("accountChooser");
    const accountList = document.getElementById("accountList");
    const userMeta = document.getElementById("userMeta");
    const dashboardTitle = document.getElementById("dashboardTitle");
    const daysBig = document.getElementById("daysBig");
    const subState = document.getElementById("subState");
    const expireText = document.getElementById("expireText");
    const subLink = document.getElementById("subLink");
    const copySubBtn = document.getElementById("copySubBtn");
    const openSubBtn = document.getElementById("openSubBtn");
    const autoImportBtn = document.getElementById("autoImportBtn");
    const plansEl = document.getElementById("plans");
    const paymentStatus = document.getElementById("paymentStatus");
    const saveCard = document.getElementById("saveCard");
    const autopayText = document.getElementById("autopayText");
    const disableAutopayBtn = document.getElementById("disableAutopayBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const toastEl = document.getElementById("toast");

    let pendingEmail = "";
    let selectedUserID = "";
    let toastTimer = 0;

    boot();

    emailForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        pendingEmail = emailInput.value.trim();
        selectedUserID = "";
        setStatus(authStatus, "отправляем код...", "");
        accountChooser.classList.add("hidden");
        try {
            await api("/api/auth/request-code", {
                method: "POST",
                body: { email: pendingEmail }
            });
            emailForm.classList.add("hidden");
            codeForm.classList.remove("hidden");
            codeInput.focus();
            setStatus(authStatus, "код отправлен. Если SMTP не настроен, код будет в логах web-сервиса.", "ok");
            showToast("код отправлен");
        } catch (error) {
            setStatus(authStatus, error.message || "не удалось отправить код", "error");
            showToast("не удалось отправить код", "error");
        }
    });

    codeForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        await verifyCode("");
    });

    changeEmailBtn.addEventListener("click", function () {
        codeForm.classList.add("hidden");
        emailForm.classList.remove("hidden");
        accountChooser.classList.add("hidden");
        codeInput.value = "";
        setStatus(authStatus, "", "");
        emailInput.focus();
        showToast("email можно изменить");
    });

    copySubBtn.addEventListener("click", async function () {
        const value = subLink.value.trim();
        if (!value) {
            showToast("ключ ещё не загружен", "error");
            return;
        }
        try {
            await copyText(value);
            copySubBtn.textContent = "скопировано";
            showToast("ключ скопирован");
            window.setTimeout(function () { copySubBtn.textContent = "Скопировать ссылку"; }, 1400);
        } catch (error) {
            showToast("не удалось скопировать", "error");
        }
    });

    logoutBtn.addEventListener("click", async function () {
        await api("/api/auth/logout", { method: "POST", body: {} }).catch(function () {});
        showAuth();
        showToast("вы вышли");
    });

    disableAutopayBtn.addEventListener("click", async function () {
        if (!confirm("Отключить автопродление?")) {
            return;
        }
        try {
            await api("/api/autopay/disable", { method: "POST", body: {} });
            await loadMe();
            showToast("автопродление отключено");
        } catch (error) {
            showToast(error.message || "не удалось отключить автопродление", "error");
        }
    });

    async function boot() {
        try {
            await loadMe();
        } catch (error) {
            showAuth();
        }
    }

    async function verifyCode(userID) {
        setStatus(authStatus, "проверяем код...", "");
        try {
            const response = await api("/api/auth/verify-code", {
                method: "POST",
                body: {
                    email: pendingEmail,
                    code: codeInput.value.trim(),
                    user_id: userID || selectedUserID || ""
                }
            });
            if (response.multiple) {
                renderAccountChooser(response.accounts || []);
                setStatus(authStatus, "выберите аккаунт", "");
                showToast("выберите аккаунт");
                return;
            }
            await loadMe();
            showToast("вход выполнен");
        } catch (error) {
            setStatus(authStatus, error.message || "код не подошёл", "error");
            showToast(error.message || "код не подошёл", "error");
        }
    }

    function renderAccountChooser(accounts) {
        accountList.innerHTML = "";
        accounts.forEach(function (account) {
            const button = document.createElement("button");
            button.className = "account-button";
            button.type = "button";
            button.textContent = account.label || account.masked_id || "аккаунт";
            button.addEventListener("click", function () {
                selectedUserID = account.id || "";
                verifyCode(selectedUserID);
            });
            accountList.appendChild(button);
        });
        accountChooser.classList.remove("hidden");
    }

    async function loadMe() {
        const me = await api("/api/me");
        showDashboard(me);
        loadPlans();
    }

    function showAuth() {
        authView.classList.remove("hidden");
        dashboardView.classList.add("hidden");
    }

    function showDashboard(me) {
        authView.classList.add("hidden");
        dashboardView.classList.remove("hidden");
        const days = Number(me.days || 0);
        daysBig.textContent = String(days);
        if (dashboardTitle) {
            dashboardTitle.textContent = "Привет, " + displayName(me);
        }
        userMeta.textContent = [me.email || "email не указан", me.masked_id || me.user_id || ""].filter(Boolean).join(" · ");
        subState.textContent = days > 0 ? "активна" : "нет активной подписки";
        subState.classList.toggle("is-active", days > 0);
        expireText.textContent = me.expires_at ? "примерная дата окончания: " + formatDate(me.expires_at) : "остаток синхронизируется из Xray через бота";
        subLink.value = me.subscription_url || "";
        openSubBtn.href = me.subscription_url || "#";
        const encoded = encodeURIComponent(me.subscription_url || "");
        autoImportBtn.href = encoded ? "../?open=1&auto=1&v=" + encoded : "../?open=1";
        autopayText.textContent = me.autopay_enabled ? "автопродление включено" + (me.autopay_plan_id ? " · тариф " + me.autopay_plan_id : "") : "автопродление выключено";
        disableAutopayBtn.disabled = !me.autopay_enabled;
    }

    async function loadPlans() {
        try {
            const data = await api("/api/plans");
            plansEl.innerHTML = "";
            (data.plans || []).forEach(function (plan) {
                const button = document.createElement("button");
                button.className = "plan-card";
                button.type = "button";
                button.innerHTML = "<strong>" + escapeHTML(plan.title) + "</strong><span>" + Number(plan.amount).toFixed(0) + " ₽ · " + plan.days + " дней</span>";
                button.addEventListener("click", function () { createPayment(plan.id); });
                plansEl.appendChild(button);
            });
        } catch (error) {
            plansEl.textContent = "не удалось загрузить тарифы";
        }
    }

    async function createPayment(planID) {
        setStatus(paymentStatus, "создаём платёж...", "");
        showToast("создаём платёж");
        try {
            const data = await api("/api/payments/create", {
                method: "POST",
                body: { plan_id: planID, save_card: saveCard.checked }
            });
            if (data.confirmation_url) {
                showToast("переходим к оплате");
                window.location.href = data.confirmation_url;
                return;
            }
            setStatus(paymentStatus, "платёж создан, но ссылка не пришла", "error");
            showToast("ссылка оплаты не пришла", "error");
        } catch (error) {
            setStatus(paymentStatus, error.message || "не удалось создать платёж", "error");
            showToast(error.message || "не удалось создать платёж", "error");
        }
    }

    async function api(path, options) {
        const opts = options || {};
        const fetchOptions = {
            method: opts.method || "GET",
            credentials: "include",
            headers: { "Accept": "application/json" }
        };
        if (opts.body) {
            fetchOptions.headers["Content-Type"] = "application/json";
            fetchOptions.body = JSON.stringify(opts.body);
        }
        const response = await fetch(API_BASE + path, fetchOptions);
        const text = await response.text();
        let data = {};
        if (text) {
            try { data = JSON.parse(text); } catch (error) { data = { error: text }; }
        }
        if (!response.ok) {
            throw new Error(data.error || "API error " + response.status);
        }
        return data;
    }

    function setStatus(el, text, kind) {
        el.textContent = text || "";
        el.classList.toggle("is-error", kind === "error");
        el.classList.toggle("is-ok", kind === "ok");
    }

    async function copyText(value) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
            return;
        }
        subLink.focus();
        subLink.select();
        if (!document.execCommand("copy")) {
            throw new Error("copy failed");
        }
        window.getSelection().removeAllRanges();
    }

    function showToast(message, kind) {
        if (!toastEl) {
            return;
        }
        window.clearTimeout(toastTimer);
        toastEl.textContent = message;
        toastEl.classList.toggle("is-error", kind === "error");
        toastEl.classList.add("is-visible");
        toastTimer = window.setTimeout(function () {
            toastEl.classList.remove("is-visible");
        }, 1800);
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return date.toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" });
    }

    function escapeHTML(value) {
        return String(value || "").replace(/[&<>'"]/g, function (char) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
        });
    }

    function displayName(me) {
        const email = String(me.email || "");
        if (email.includes("@")) {
            return email.split("@")[0];
        }
        return me.masked_id || "пользователь";
    }

    function detectAPIBase() {
        if (window.NEURAVPN_API_BASE) {
            return window.NEURAVPN_API_BASE;
        }
        const stored = localStorage.getItem("neuravpn_api_base");
        if (stored) {
            return stored;
        }
        if (window.location.port === "8085") {
            return window.location.protocol + "//" + window.location.hostname + ":8090";
        }
        return "";
    }
})();
