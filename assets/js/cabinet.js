(function () {
    const API_BASE = detectAPIBase();
    const TG_WEBAPP = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    let telegramInitData = readTelegramInitData();
    const IS_MINI_APP = detectMiniApp();
    const IS_DEMO = new URLSearchParams(window.location.search).get("demo") === "1";
    const authView = document.getElementById("authView");
    const dashboardView = document.getElementById("dashboardView");
    const emailForm = document.getElementById("emailForm");
    const codeForm = document.getElementById("codeForm");
    const emailInput = document.getElementById("emailInput");
    const codeInput = document.getElementById("codeInput");
    const authStatus = document.getElementById("authStatus");
    const changeEmailBtn = document.getElementById("changeEmailBtn");
    const resendCodeBtn = document.getElementById("resendCodeBtn");
    const accountChooser = document.getElementById("accountChooser");
    const accountList = document.getElementById("accountList");
    const signupOffer = document.getElementById("signupOffer");
    const telegramLoginBox = document.getElementById("telegramLoginBox");
    const telegramLoginBtn = document.getElementById("telegramLoginBtn");
    const telegramBotLoginLink = document.getElementById("telegramBotLoginLink");
    const telegramLoginStatus = document.getElementById("telegramLoginStatus");
    const miniAppRecovery = document.getElementById("miniAppRecovery");
    const retryMiniAppBtn = document.getElementById("retryMiniAppBtn");
    const requestCodeBtn = document.getElementById("requestCodeBtn");
    const verifyCodeBtn = document.getElementById("verifyCodeBtn");
    const userMeta = document.getElementById("userMeta");
    const daysBig = document.getElementById("daysBig");
    const accessSuffix = document.getElementById("accessSuffix");
    const activePill = document.querySelector(".active-pill");
    const subState = document.getElementById("subState");
    const expireText = document.getElementById("expireText");
    const subLink = document.getElementById("subLink");
    const copySubBtn = document.getElementById("copySubBtn");
    const openSubBtn = document.getElementById("openSubBtn");
    const referralInvite = document.getElementById("referralInvite");
    const plansEl = document.getElementById("plans");
    const paymentStatus = document.getElementById("paymentStatus");
    const autopaySetup = document.getElementById("autopaySetup");
    const autopayPlanTitle = document.getElementById("autopayPlanTitle");
    const autopayNextText = document.getElementById("autopayNextText");
    const autopayToggle = document.getElementById("autopayToggle");
    const detachCardBtn = document.getElementById("detachCardBtn");
    const autopayText = document.getElementById("autopayText");
    const disableAutopayBtn = document.getElementById("disableAutopayBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const toastEl = document.getElementById("toast");
    const paymentChoiceModal = document.getElementById("paymentChoiceModal");
    const paymentChoiceText = document.getElementById("paymentChoiceText");
    const payAnyMethodBtn = document.getElementById("payAnyMethodBtn");
    const payAutopayBtn = document.getElementById("payAutopayBtn");
    const closePaymentModalBtn = document.getElementById("closePaymentModalBtn");
    const detachConfirmModal = document.getElementById("detachConfirmModal");
    const confirmDetachBtn = document.getElementById("confirmDetachBtn");
    const cancelDetachBtn = document.getElementById("cancelDetachBtn");
    const paymentReturnModal = document.getElementById("paymentReturnModal");
    const paymentReturnText = document.getElementById("paymentReturnText");
    const enableReturnAutopayBtn = document.getElementById("enableReturnAutopayBtn");
    const skipReturnAutopayBtn = document.getElementById("skipReturnAutopayBtn");

    let pendingEmail = "";
    let selectedUserID = "";
    let toastTimer = 0;
    let selectedPlan = null;
    let currentMe = null;
    let profileRefresh = null;
    let profileVersion = 0;
    let paymentReturnShown = false;
    let resendTimerID = 0;
    let resendLeft = 0;
    let telegramPollTimer = 0;
    let telegramLoginDeadline = 0;
    let telegramLoginToken = "";
    let telegramPollBusy = false;
    let telegramStartBusy = false;
    let miniAppLoginBusy = false;
    let miniAppRetryTimer = 0;
    let miniAppRetries = 0;
    let bootCancelled = false;
    let emailRequestBusy = false;
    let emailVerifyBusy = false;
    let emailSessionReady = false;
    const TELEGRAM_BOT_USERNAME = String(window.NEURAVPN_TELEGRAM_BOT || "neuravpn_bot").replace(/^@/, "");

    if (IS_MINI_APP) {
        document.body.classList.add("is-mini-app");
        if (TG_WEBAPP) {
            try { TG_WEBAPP.ready(); TG_WEBAPP.expand(); } catch (error) {}
        }
        document.getElementById("authTitle").textContent = "Личный кабинет";
        document.getElementById("authHint").textContent = "";
    }

    boot();
    referralInvite.addEventListener("click", function (event) {
        if (IS_DEMO) {
            event.preventDefault();
            showToast("в вашем кабинете здесь будет личная ссылка приглашения");
        } else if (TG_WEBAPP && typeof TG_WEBAPP.openTelegramLink === "function") {
            event.preventDefault();
            TG_WEBAPP.openTelegramLink(referralInvite.href);
        }
    });
    window.addEventListener("pageshow", function () {
        clearPendingPaymentStatus();
        resumeAuthentication();
    });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            clearPendingPaymentStatus();
            resumeAuthentication();
        }
    });
    window.addEventListener("online", resumeAuthentication);
    retryMiniAppBtn.addEventListener("click", function () {
        miniAppRetries = 0;
        completeTelegramMiniAppLogin();
    });
    setInterval(function () {
        if (currentMe && (currentMe.subscription_verified !== true || Date.now() - currentMe.received_at >= 60000)) {
            refreshProfile();
        }
    }, 10000);
    setInterval(renderSubscriptionState, 30000);

    emailForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        await requestCode(false);
    });

    codeForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        await verifyCode("");
    });

    changeEmailBtn.addEventListener("click", function () {
        if (emailRequestBusy || emailVerifyBusy) return;
        emailSessionReady = false;
        codeForm.classList.add("hidden");
        emailForm.classList.remove("hidden");
        accountChooser.classList.add("hidden");
        signupOffer.classList.add("hidden");
        codeInput.value = "";
        stopResendTimer();
        setStatus(authStatus, "", "");
        emailInput.focus();
        showToast("email можно изменить");
    });

    resendCodeBtn.addEventListener("click", async function () {
        if (resendCodeBtn.disabled) {
            return;
        }
        await requestCode(true);
    });

    telegramLoginBtn.addEventListener("click", startTelegramLogin);

    copySubBtn.addEventListener("click", async function () {
        const value = subLink.value.trim();
        if (!value) {
            showToast("ключ ещё не загружен", "error");
            return;
        }
        try {
            await copyText(value);
            logUI("copy_key", "");
            copySubBtn.textContent = "скопировано";
            showToast("ключ скопирован");
            window.setTimeout(function () { copySubBtn.textContent = "Скопировать ключ"; }, 1400);
        } catch (error) {
            showToast("не удалось скопировать", "error");
        }
    });

    logoutBtn.addEventListener("click", async function () {
        await api("/api/auth/logout", { method: "POST", body: {} }).catch(function () {});
        stopTelegramPolling();
        window.clearTimeout(miniAppRetryTimer);
        showAuth();
        if (IS_MINI_APP) {
            if (TG_WEBAPP && typeof TG_WEBAPP.close === "function") TG_WEBAPP.close();
            else completeTelegramMiniAppLogin();
        }
        showToast("вы вышли");
    });

    disableAutopayBtn.addEventListener("click", openDetachConfirm);
    detachCardBtn.addEventListener("click", openDetachConfirm);
    cancelDetachBtn.addEventListener("click", closeDetachConfirm);
    confirmDetachBtn.addEventListener("click", detachCard);
    enableReturnAutopayBtn.addEventListener("click", enableAutopayFromReturn);
    skipReturnAutopayBtn.addEventListener("click", closePaymentReturnModal);
    closePaymentModalBtn.addEventListener("click", closePaymentChoice);
    paymentChoiceModal.addEventListener("click", function (event) {
        if (event.target === paymentChoiceModal) {
            closePaymentChoice();
        }
    });
    detachConfirmModal.addEventListener("click", function (event) {
        if (event.target === detachConfirmModal) {
            closeDetachConfirm();
        }
    });
    payAnyMethodBtn.addEventListener("click", function () {
        if (!selectedPlan) {
            return;
        }
        closePaymentChoice();
        createPayment(selectedPlan.id, false);
    });
    payAutopayBtn.addEventListener("click", function () {
        if (!selectedPlan) {
            return;
        }
        closePaymentChoice();
        createPayment(selectedPlan.id, true);
    });
    document.querySelectorAll(".platform-card[data-platform]").forEach(function (link) {
        link.addEventListener("click", function (event) {
            event.preventDefault();
            const href = IS_MINI_APP ? withMiniAppParam(link.href) : link.href;
            const platform = link.getAttribute("data-platform") || link.textContent.trim();
            logUI("instruction_open", platform);
            window.setTimeout(function () {
                window.location.href = href;
            }, 80);
        });
    });
    autopayToggle.addEventListener("change", function () {
        if (!currentMe || !currentMe.autopay_available) {
            autopayToggle.checked = false;
            return;
        }
        if (!autopayToggle.checked) {
            disableAutopay();
        } else {
            enableAutopay();
        }
    });

    async function boot() {
        if (IS_DEMO) {
            showDemoDashboard();
            return;
        }
        if (IS_MINI_APP) {
            await completeTelegramMiniAppLogin();
            return;
        }
        if (await completeTelegramLoginFromURL()) return;
        try {
            await loadMe();
            if (!bootCancelled) showPaymentReturnIfNeeded();
        } catch (error) {
            if (bootCancelled) return;
            showAuth();
            if (error.status !== 401) {
                setStatus(authStatus, "Не удалось загрузить кабинет. Повторяем запрос...", "error");
                window.setTimeout(function () {
                    if (!bootCancelled && !currentMe && !document.hidden) boot();
                }, 3000);
            } else if (isPaymentReturn()) {
                setStatus(authStatus, "оплата прошла. Войдите, чтобы увидеть обновлённую подписку.", "ok");
            }
        }
    }

    async function completeTelegramMiniAppLogin() {
        if (!IS_MINI_APP || miniAppLoginBusy) return false;
        window.clearTimeout(miniAppRetryTimer);
        telegramInitData = readTelegramInitData();
        showAuth();
        if (!telegramInitData) {
            setStatus(authStatus, "Telegram не передал данные входа. Закройте кабинет и откройте его кнопкой в боте.", "error");
            return false;
        }
        miniAppLoginBusy = true;
        retryMiniAppBtn.disabled = true;
        showMiniAppLoading();
        try {
            await api("/api/auth/telegram-webapp", { method: "POST", body: { init_data: telegramInitData } });
            await loadMe();
            miniAppRetries = 0;
            showPaymentReturnIfNeeded();
            return true;
        } catch (error) {
            showAuth();
            if (error.status === 401 || error.status === 403) {
                setStatus(authStatus, "Данные входа Telegram устарели. Закройте кабинет и заново откройте его кнопкой в боте.", "error");
            } else {
                setStatus(authStatus, "Не удалось связаться с сервером. Повторяем вход автоматически...", "error");
                const delay = Math.min(15000, 1000 * Math.pow(2, miniAppRetries++));
                miniAppRetryTimer = window.setTimeout(function () {
                    if (!document.hidden) completeTelegramMiniAppLogin();
                }, delay);
            }
            return false;
        } finally {
            miniAppLoginBusy = false;
            retryMiniAppBtn.disabled = false;
        }
    }

    function resumeAuthentication() {
        if (IS_MINI_APP && !currentMe) completeTelegramMiniAppLogin();
        else refreshProfile();
        if (telegramLoginToken) checkTelegramLogin(telegramLoginToken);
    }

    function showMiniAppLoading() {
        authView.classList.remove("hidden");
        dashboardView.classList.add("hidden");
        emailForm.classList.add("hidden");
        codeForm.classList.add("hidden");
        telegramLoginBox.classList.add("hidden");
        accountChooser.classList.add("hidden");
        signupOffer.classList.add("hidden");
        miniAppRecovery.classList.remove("hidden");
        setStatus(authStatus, "входим через Telegram...", "ok");
    }

    async function completeTelegramLoginFromURL() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("telegram_login");
        if (!token) {
            return false;
        }
        params.delete("telegram_login");
        const cleanURL = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
        window.history.replaceState({}, document.title, cleanURL);
        telegramLoginToken = token;
        telegramLoginDeadline = Date.now() + 300000;
        showAuth();
        showToast("завершаем вход через Telegram");
        startTelegramPolling();
        await checkTelegramLogin(token);
        return true;
    }

    async function verifyCode(userID) {
        if (emailVerifyBusy || emailRequestBusy || telegramStartBusy) return;
        cancelBoot();
        stopTelegramPolling();
        emailVerifyBusy = true;
        verifyCodeBtn.disabled = true;
        changeEmailBtn.disabled = true;
        setStatus(authStatus, "", "");
        showToast("проверяем код");
        try {
            const response = emailSessionReady ? {} : await api("/api/auth/verify-code", {
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
            emailSessionReady = true;
            await loadMe();
            showPaymentReturnIfNeeded();
            showToast("вход выполнен");
        } catch (error) {
            if (error.status === 401) emailSessionReady = false;
            setStatus(authStatus, error.message || "код не подошёл", "error");
            showToast(error.message || "код не подошёл", "error");
        } finally {
            emailVerifyBusy = false;
            verifyCodeBtn.disabled = false;
            changeEmailBtn.disabled = false;
        }
    }

    async function requestCode(isResend) {
        if (emailRequestBusy || emailVerifyBusy || telegramStartBusy) return;
        cancelBoot();
        stopTelegramPolling();
        emailRequestBusy = true;
        emailSessionReady = false;
        requestCodeBtn.disabled = true;
        resendCodeBtn.disabled = true;
        changeEmailBtn.disabled = true;
        pendingEmail = emailInput.value.trim() || pendingEmail;
        selectedUserID = "";
        setStatus(authStatus, "", "");
        accountChooser.classList.add("hidden");
        signupOffer.classList.add("hidden");
        showToast(isResend ? "отправляем новый код" : "отправляем код");
        try {
            await api("/api/auth/request-code", {
                method: "POST",
                body: { email: pendingEmail }
            });
            emailForm.classList.add("hidden");
            codeForm.classList.remove("hidden");
            codeInput.focus();
            setStatus(authStatus, "код отправлен. Проверьте почту и папку «Спам».", "ok");
            showToast("код отправлен");
            startResendTimer(120);
        } catch (error) {
            if (error.code === "account_not_found" || error.code === "email_not_verified") {
                codeForm.classList.add("hidden");
                emailForm.classList.remove("hidden");
                signupOffer.classList.remove("hidden");
                setStatus(authStatus, error.message, "error");
                return;
            }
            if (error.status === 429) startResendTimer(error.data.retry_after || 60);
            setStatus(authStatus, error.message || "не удалось отправить код", "error");
            showToast("не удалось отправить код", "error");
        } finally {
            emailRequestBusy = false;
            requestCodeBtn.disabled = false;
            changeEmailBtn.disabled = false;
            updateResendButton();
        }
    }

    function cancelBoot() {
        bootCancelled = true;
        profileVersion++;
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

    async function loadMe(includePlans) {
        const version = ++profileVersion;
        let me;
        try {
            me = await api("/api/me");
        } catch (error) {
            if (version !== profileVersion) return;
            throw error;
        }
        if (version !== profileVersion) return;
        showDashboard(me);
        if (includePlans !== false) loadPlans();
    }

    function refreshProfile() {
        if (IS_DEMO || !currentMe || document.hidden || dashboardView.classList.contains("hidden")) return;
        renderSubscriptionState();
        if (profileRefresh) return;
        profileRefresh = loadMe(false).catch(function (error) {
            if (error.status === 401) {
                showAuth();
                if (IS_MINI_APP) completeTelegramMiniAppLogin();
            } else if (currentMe) {
                currentMe.subscription_verified = false;
                renderSubscriptionState();
            }
        }).finally(function () { profileRefresh = null; });
    }

    function showAuth() {
        currentMe = null;
        profileVersion++;
        authView.classList.remove("hidden");
        dashboardView.classList.add("hidden");
        logoutBtn.classList.add("hidden");
        miniAppRecovery.classList.toggle("hidden", !IS_MINI_APP);
        if (IS_MINI_APP) {
            emailForm.classList.add("hidden");
            codeForm.classList.add("hidden");
            telegramLoginBox.classList.add("hidden");
            signupOffer.classList.add("hidden");
            accountChooser.classList.add("hidden");
        } else {
            emailForm.classList.remove("hidden");
            telegramLoginBox.classList.remove("hidden");
            telegramLoginBtn.classList.remove("hidden");
            codeForm.classList.add("hidden");
        }
    }

    function showDashboard(me) {
        me.received_at = Date.now();
        currentMe = me;
        const referralURL = me.referral_url || (/^\d+$/.test(String(me.user_id || ""))
            ? "https://t.me/" + TELEGRAM_BOT_USERNAME + "?start=ref_" + me.user_id : "");
        referralInvite.classList.toggle("hidden", !IS_MINI_APP || !referralURL);
        if (referralURL) {
            referralInvite.href = "https://t.me/share/url?url=" + encodeURIComponent(referralURL)
                + "&text=" + encodeURIComponent("подключай vpn, опробовав его бесплатно 5 дней!");
        } else {
            referralInvite.removeAttribute("href");
        }
        stopTelegramPolling();
        window.clearTimeout(miniAppRetryTimer);
        clearPendingPaymentStatus();
        authView.classList.add("hidden");
        dashboardView.classList.remove("hidden");
        logoutBtn.classList.remove("hidden");
        renderSubscriptionState();
        userMeta.textContent = profileLabel(me);
        subLink.value = me.subscription_url || "";
        openSubBtn.href = me.subscription_url || "#";
        autopayText.textContent = me.autopay_available ? (me.autopay_enabled ? "автопродление включено" : "карта привязана, автосписание выключено") : "карта не привязана";
        disableAutopayBtn.disabled = !me.autopay_enabled;
        detachCardBtn.classList.toggle("hidden", !me.autopay_available);
        if (me.autopay_available) {
            showAutopayStatus(me);
        } else {
            autopaySetup.classList.add("hidden");
        }
    }

    function renderSubscriptionState() {
        if (!currentMe) return;
        const state = window.neuravpnSubscriptionState(currentMe);
        daysBig.textContent = !state.known ? "—" : state.unlimited ? "∞" : String(state.days);
        accessSuffix.textContent = !state.known ? "статус уточняется" : state.unlimited ? "безлимитно" : state.active ? "дней активно" : "дней осталось";
        activePill.classList.toggle("is-inactive", state.known && !state.active);
        activePill.classList.toggle("is-unknown", !state.known);
        subState.textContent = !state.known ? "статус не подтверждён" : state.active ? "активна" : "нет активной подписки";
        subState.classList.toggle("is-active", state.known && state.active);
        expireText.textContent = !state.known ? "Не удалось проверить срок подписки. Повторяем проверку автоматически."
            : state.pending ? "Срок начнётся после первого подключения"
            : currentMe.expires_at ? "Дата окончания: " + formatDate(currentMe.expires_at) : "";
    }

    async function startTelegramLogin() {
        if (telegramStartBusy || emailRequestBusy || emailVerifyBusy) return;
        cancelBoot();
        stopTelegramPolling();
        telegramStartBusy = true;
        telegramLoginBtn.disabled = true;
        setStatus(authStatus, "", "");
        setStatus(telegramLoginStatus, "готовим вход через бота...", "");
        try {
            const data = await api("/api/auth/telegram/start", { method: "POST", body: {} });
            const botURL = new URL(data.bot_url);
            if (!data.token || botURL.protocol !== "https:" || botURL.hostname !== "t.me") throw new Error("не удалось подготовить ссылку входа");
            telegramLoginToken = data.token;
            telegramLoginDeadline = Date.now() + Math.min(data.expires_in || 300, 300) * 1000;
            telegramBotLoginLink.href = botURL.href;
            telegramBotLoginLink.classList.remove("hidden");
            telegramLoginBtn.classList.add("hidden");
            setStatus(telegramLoginStatus, "подтвердите вход в боте. Кабинет откроется автоматически.", "ok");
            startTelegramPolling();
        } catch (error) {
            setStatus(telegramLoginStatus, error.message || "не удалось начать вход. Попробуйте ещё раз.", "error");
        } finally {
            telegramStartBusy = false;
            telegramLoginBtn.disabled = false;
        }
    }

    function startTelegramPolling() {
        window.clearInterval(telegramPollTimer);
        telegramPollTimer = window.setInterval(function () {
            if (!document.hidden) checkTelegramLogin(telegramLoginToken);
        }, 2000);
    }

    async function checkTelegramLogin(token) {
        if (!token || telegramPollBusy) {
            return;
        }
        if (Date.now() > telegramLoginDeadline) {
            stopTelegramPolling();
            setStatus(telegramLoginStatus, "вход через Telegram истёк. Нажмите кнопку ещё раз.", "error");
            showToast("Telegram вход истёк", "error");
            return;
        }
        telegramPollBusy = true;
        try {
            const data = await api("/api/auth/telegram/check", { method: "POST", body: { token: token } });
            if (telegramLoginToken !== token) return;
            if (!data.confirmed) {
                return;
            }
            await loadMe();
            showPaymentReturnIfNeeded();
            showToast("вход через Telegram выполнен");
        } catch (error) {
            if (telegramLoginToken !== token) return;
            if (error.status === 410) stopTelegramPolling();
            setStatus(telegramLoginStatus, error.message || "Не удалось проверить вход. Повторяем проверку...", "error");
        } finally {
            telegramPollBusy = false;
        }
    }

    function stopTelegramPolling() {
        window.clearInterval(telegramPollTimer);
        telegramPollTimer = 0;
        telegramLoginDeadline = 0;
        telegramLoginToken = "";
        telegramBotLoginLink.classList.add("hidden");
        telegramLoginBtn.classList.remove("hidden");
        if (telegramLoginBtn) {
            telegramLoginBtn.disabled = false;
        }
    }

    async function loadPlans() {
        if (IS_DEMO) {
            renderPlans(demoPlans());
            return;
        }
        try {
            const data = await api("/api/plans");
            renderPlans(data.plans || []);
        } catch (error) {
            plansEl.textContent = "не удалось загрузить тарифы";
        }
    }

    function renderPlans(plans) {
        plansEl.innerHTML = "";
        getVisiblePlans(plans || []).forEach(function (plan) {
            const button = document.createElement("button");
            button.className = "plan-card";
            button.type = "button";
            button.innerHTML = [
                "<strong>" + escapeHTML(plan.title) + "</strong>",
                '<span class="plan-price">' + Number(plan.amount).toFixed(0) + " ₽</span>"
            ].join("");
            button.addEventListener("click", function () { openPaymentChoice(plan); });
            plansEl.appendChild(button);
        });
    }

    function openPaymentChoice(plan) {
        selectedPlan = plan;
        logUI("plan_selected", plan.title + " · " + Number(plan.amount).toFixed(0) + " ₽");
        paymentChoiceText.textContent = plan.title + " · " + Number(plan.amount).toFixed(0) + " ₽";
        payAutopayBtn.textContent = "Картой с автопродлением";
        paymentChoiceModal.classList.remove("hidden");
        setStatus(paymentStatus, "", "");
    }

    function closePaymentChoice() {
        paymentChoiceModal.classList.add("hidden");
        clearPendingPaymentStatus();
    }

    function showDemoDashboard() {
        showDashboard({
            user_id: "623290294",
            masked_id: "6232***294",
            email: "asort97@mail.ru",
            days: 21,
            subscription_verified: true,
            active: true,
            checked_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
            subscription_url: "https://webhook.staticdeliverycdn.com/merged-sub/623290294/e8f2f084b81dc99fd2c8df286642fb9320aa1ebe666693a910d3f06f3f1e0335",
            autopay_available: true,
            autopay_enabled: false,
            autopay_plan_id: "30d"
        });
        renderPlans(demoPlans());
        setStatus(paymentStatus, "demo-режим: платежи и API не вызываются", "ok");
    }

    function demoPlans() {
        return [
            { id: "30d", title: "30 дней", amount: 149, days: 30 },
            { id: "60d", title: "60 дней", amount: 289, days: 60 },
            { id: "90d", title: "90 дней", amount: 419, days: 90 },
            { id: "365d", title: "365 дней", amount: 1499, days: 365 }
        ];
    }

    function startResendTimer(seconds) {
        stopResendTimer();
        resendLeft = seconds;
        updateResendButton();
        resendTimerID = window.setInterval(function () {
            resendLeft -= 1;
            updateResendButton();
            if (resendLeft <= 0) {
                stopResendTimer(false);
                updateResendButton();
            }
        }, 1000);
    }

    function stopResendTimer(reset) {
        window.clearInterval(resendTimerID);
        resendTimerID = 0;
        if (reset !== false) {
            resendLeft = 0;
        }
        updateResendButton();
    }

    function updateResendButton() {
        if (!resendCodeBtn) {
            return;
        }
        if (resendLeft > 0) {
            resendCodeBtn.disabled = true;
            resendCodeBtn.innerHTML = 'получить код заново через <span id="resendTimer">' + resendLeft + '</span> сек.';
        } else {
            resendCodeBtn.disabled = false;
            resendCodeBtn.textContent = "получить код заново";
        }
    }

    function showAutopayStatus(me) {
        autopayToggle.checked = Boolean(me.autopay_enabled);
        autopayPlanTitle.textContent = "Автопродление";
        autopayNextText.textContent = me.autopay_enabled ? "Следующее автосписание: " + nextAutopayText(0) : "";
        autopaySetup.classList.remove("hidden");
    }

    async function createPayment(planID, enableAutopay) {
        setStatus(paymentStatus, "создаём платёж...", "");
        showToast("создаём платёж");
        try {
            const data = await api("/api/payments/create", {
                method: "POST",
                body: { plan_id: planID, save_card: enableAutopay }
            });
            if (data.confirmation_url) {
                showToast("переходим к оплате");
                setStatus(paymentStatus, "", "");
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

    function openDetachConfirm() {
        if (!currentMe || !currentMe.autopay_available) {
            showToast("карта не привязана", "error");
            return;
        }
        detachConfirmModal.classList.remove("hidden");
    }

    function closeDetachConfirm() {
        detachConfirmModal.classList.add("hidden");
        if (currentMe) {
            autopayToggle.checked = Boolean(currentMe.autopay_enabled);
        }
    }

    async function detachCard() {
        confirmDetachBtn.disabled = true;
        try {
            await api("/api/autopay/detach", { method: "POST", body: {} });
            closeDetachConfirm();
            selectedPlan = null;
            autopaySetup.classList.add("hidden");
            await loadMe();
            showToast("карта отвязана");
        } catch (error) {
            showToast(error.message || "не удалось отвязать карту", "error");
        } finally {
            confirmDetachBtn.disabled = false;
        }
    }

    async function enableAutopay() {
        autopayToggle.disabled = true;
        try {
            await api("/api/autopay/enable", { method: "POST", body: {} });
            await loadMe();
            showToast("автосписание включено");
        } catch (error) {
            autopayToggle.checked = false;
            showToast(error.message || "не удалось включить автосписание", "error");
        } finally {
            autopayToggle.disabled = false;
        }
    }

    async function disableAutopay() {
        autopayToggle.disabled = true;
        try {
            await api("/api/autopay/disable", { method: "POST", body: {} });
            await loadMe();
            showToast("автосписание выключено");
        } catch (error) {
            autopayToggle.checked = true;
            showToast(error.message || "не удалось выключить автосписание", "error");
        } finally {
            autopayToggle.disabled = false;
        }
    }

    function showPaymentReturnIfNeeded() {
        if (paymentReturnShown || !isPaymentReturn() || !currentMe) {
            return;
        }
        paymentReturnShown = true;
        showToast("оплата прошла");
        if (currentMe.autopay_enabled) {
            paymentReturnText.textContent = "Подписка обновляется. Автосписание уже включено.";
            enableReturnAutopayBtn.classList.add("hidden");
        } else if (currentMe.autopay_available) {
            paymentReturnText.textContent = "Подписка обновляется. Можно включить автосписание, чтобы доступ продлевался автоматически.";
            enableReturnAutopayBtn.classList.remove("hidden");
        } else {
            paymentReturnText.textContent = "Подписка обновляется. Автосписание можно будет включить после оплаты картой с сохранением карты.";
            enableReturnAutopayBtn.classList.add("hidden");
        }
        paymentReturnModal.classList.remove("hidden");
        window.history.replaceState({}, document.title, window.location.pathname);
        window.setTimeout(loadMe, 2500);
    }

    function closePaymentReturnModal() {
        paymentReturnModal.classList.add("hidden");
    }

    async function enableAutopayFromReturn() {
        enableReturnAutopayBtn.disabled = true;
        try {
            await api("/api/autopay/enable", { method: "POST", body: {} });
            await loadMe();
            paymentReturnText.textContent = "Автосписание включено. Следующее списание будет ближе к окончанию подписки.";
            enableReturnAutopayBtn.classList.add("hidden");
            showToast("автосписание включено");
        } catch (error) {
            showToast(error.message || "не удалось включить автосписание", "error");
        } finally {
            enableReturnAutopayBtn.disabled = false;
        }
    }

    function isPaymentReturn() {
        const payment = paymentReturnKind();
        return payment === "return";
    }

    function paymentReturnKind() {
        return new URLSearchParams(window.location.search).get("payment") || "";
    }

    async function api(path, options) {
        const opts = options || {};
        const fetchOptions = {
            method: opts.method || "GET",
            cache: "no-store",
            credentials: "include",
            headers: { "Accept": "application/json" }
        };
        if (opts.body) {
            fetchOptions.headers["Content-Type"] = "application/json";
            fetchOptions.body = JSON.stringify(opts.body);
        }
        if (IS_MINI_APP && telegramInitData) {
            fetchOptions.headers.Authorization = "tma " + telegramInitData;
        }
        const controller = new AbortController();
        fetchOptions.signal = controller.signal;
        const timeoutMs = path.startsWith("/api/auth/") || path === "/api/me" ? 20000 : 35000;
        const timeout = window.setTimeout(function () { controller.abort(); }, timeoutMs);
        try {
            const response = await fetch(API_BASE + path, fetchOptions);
            const text = await response.text();
            let data;
            try { data = JSON.parse(text); } catch (_) {
                const error = new Error("сервер вернул некорректный ответ. Повторите попытку.");
                error.status = response.ok ? 502 : response.status;
                throw error;
            }
            if (!data || typeof data !== "object") throw new Error("некорректный ответ сервера");
            if (!response.ok) {
                const error = new Error(data.error || "ошибка сервера: " + response.status);
                error.code = data.code || "";
                error.status = response.status;
                error.data = data;
                throw error;
            }
            return data;
        } catch (error) {
            if (error.name === "AbortError") throw new Error("сервер не ответил вовремя. Повторите попытку.");
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    function logUI(action, details) {
        const payload = JSON.stringify({
            action: action,
            details: details || "",
            source: IS_MINI_APP ? "miniapp" : "site"
        });
        if (navigator.sendBeacon && !IS_MINI_APP) {
            const blob = new Blob([payload], { type: "application/json" });
            navigator.sendBeacon(API_BASE + "/api/log/ui", blob);
            return;
        }
        fetch(API_BASE + "/api/log/ui", {
            method: "POST",
            credentials: "include",
            headers: Object.assign({ "Content-Type": "application/json" }, IS_MINI_APP && telegramInitData ? { Authorization: "tma " + telegramInitData } : {}),
            body: payload,
            keepalive: true
        }).catch(function () {});
    }

    function setStatus(el, text, kind) {
        el.textContent = text || "";
        el.classList.toggle("is-error", kind === "error");
        el.classList.toggle("is-ok", kind === "ok");
    }

    function clearPendingPaymentStatus() {
        if (paymentStatus.textContent.trim().toLowerCase().includes("создаём платёж")) {
            setStatus(paymentStatus, "", "");
        }
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

    function formatGB(value) {
        const n = Number(value || 0);
        const rounded = Math.round(n * 100) / 100;
        const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
        return text.replace(".", ",") + " ГБ";
    }

    function nextAutopayText(days) {
        const daysToAdd = Number(days || 0);
        const now = new Date();
        let date = now;
        if (currentMe && currentMe.expires_at) {
            const expires = new Date(currentMe.expires_at);
            if (!Number.isNaN(expires.getTime()) && expires > now) {
                date = expires;
            }
        }
        if (daysToAdd > 0) {
            date = new Date(date.getTime());
            date.setDate(date.getDate() + daysToAdd);
            return formatDate(date.toISOString());
        }
        if (date > now) {
            return formatDate(date.toISOString());
        }
        return "в день окончания подписки";
    }

    function escapeHTML(value) {
        return String(value || "").replace(/[&<>'"]/g, function (char) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
        });
    }

    function getVisiblePlans(plans) {
        return plans.slice();
    }

    function displayName(me) {
        const email = String(me.email || "");
        if (email.includes("@")) {
            return email.split("@")[0];
        }
        return me.masked_id || "пользователь";
    }

    function profileLabel(me) {
        const email = String(me.email || "").trim();
        if (email) {
            return email;
        }
        const id = String(me.user_id || me.masked_id || "").trim();
        return id ? "ID:" + id : "пользователь";
    }

    function detectAPIBase() {
        // Production requests stay same-origin; stale developer settings must not receive auth data.
        if (window.location.port === "8085" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
            return window.location.protocol + "//" + window.location.hostname + ":8090";
        }
        return "";
    }

    function readTelegramInitData() {
        const webApp = window.Telegram && window.Telegram.WebApp;
        if (webApp && webApp.initData) return webApp.initData;
        const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
        return hash.get("tgWebAppData") || "";
    }

    function detectMiniApp() {
        const params = new URLSearchParams(window.location.search);
        return params.get("mini_app") === "1" || Boolean(telegramInitData);
    }

    function withMiniAppParam(href) {
        try {
            const url = new URL(href, window.location.href);
            url.searchParams.set("mini_app", "1");
            return url.href;
        } catch (error) {
            return href;
        }
    }
})();
