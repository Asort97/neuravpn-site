(function () {
    "use strict";
    window.neuravpnCabinetFeatures = function (options) {
        const $ = id => document.getElementById(id);
        const api = options.api;
        const devices = $("devicesDialog"), confirm = $("deleteDeviceDialog");
        const list = $("deviceList"), refresh = $("refreshDevicesBtn");
        const payment = $("paymentChoiceModal");
        let loading = false, deleting = false, selected = null, deviceVersion = 0;
        let checkoutVersion = 0, plan = null, quote = null, checking = false, paying = false, paymentFocus = null;
        const slotDialog = $("deviceSlotDialog");
        let devicePlan = null, slotBusy = false, slotOrder = null, slotMode = "purchase";
        const demoDevices = [{ id: "demo-android", name: "Samsung Galaxy S24 · Android", last_seen: Date.now() }, { id: "demo-ios", name: "iPhone 15 · iOS", last_seen: Date.now() - 3600000 }];

        function status(id, text, error) {
            const el = $(id);
            el.textContent = text || "";
            el.classList.toggle("is-error", !!error);
            el.classList.toggle("is-ok", !!text && !error);
        }
        function icon(name) {
            const el = document.createElement("span");
            el.className = "ui-icon icon-" + name;
            el.setAttribute("aria-hidden", "true");
            return el;
        }
        function renderDevices(data) {
            list.replaceChildren();
            devicePlan = data.device_plan || { enabled: false, extra_slots: 0 };
            $("devicesCount").textContent = (data.partial ? "Найдено: " : "Зарегистрировано: ") + data.devices.length + (devicePlan.enabled ? " из " + (5 + devicePlan.extra_slots) : "");
            $("devicePlanSummary").textContent = devicePlan.enabled ? "5 устройств включено. Дополнительных мест: " + devicePlan.extra_slots + (devicePlan.extra_slots ? " · +" + (devicePlan.extra_slots * 50) + " ₽ при каждом продлении." : ".") : "Для вас лимит устройств пока не включён. Доплачивать не нужно.";
            $("addDeviceSlotBtn").classList.toggle("hidden", !devicePlan.enabled);
            $("reduceDeviceSlotBtn").classList.toggle("hidden", !devicePlan.enabled || !devicePlan.extra_slots);
            $("addDeviceSlotBtn").disabled = devicePlan.extra_slots >= 95;
            status("devicesStatus", data.partial ? "Список неполный: часть панелей недоступна. Попробуйте обновить позже." : data.devices.length ? "" : "Пока нет зарегистрированных устройств.", data.partial);
            data.devices.forEach(device => {
                const row = document.createElement("li"); row.className = "device-row";
                const badge = icon("devices"); badge.classList.add("device-symbol");
                const text = document.createElement("div"); text.className = "device-info";
                const name = document.createElement("strong"); name.textContent = device.name;
                const seen = document.createElement("span");
                const date = new Date(device.last_seen);
                seen.textContent = device.last_seen > 0 && Number.isFinite(date.getTime()) ? "Обновлено " + date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Дата обновления неизвестна";
                text.append(name, seen);
                const remove = document.createElement("button");
                remove.type = "button"; remove.className = "icon-button delete-device";
                remove.title = "Удалить устройство"; remove.setAttribute("aria-label", "Удалить " + device.name);
                remove.append(icon("trash"));
                remove.addEventListener("click", () => {
                    if (loading || deleting) return;
                    selected = device;
                    $("deleteDeviceName").textContent = device.name;
                    status("deleteDeviceStatus", "");
                    confirm.showModal();
                    $("cancelDeleteDeviceBtn").focus();
                });
                row.append(badge, text, remove); list.append(row);
            });
        }
        async function loadDevices() {
            if (loading || deleting) return;
            const version = ++deviceVersion;
            loading = true; refresh.disabled = true;
            list.setAttribute("aria-busy", "true");
            list.querySelectorAll("button").forEach(b => b.disabled = true);
            status("devicesStatus", "Загружаем устройства со всех серверов...");
            try {
                const data = options.demo ? { devices: demoDevices, partial: false } : await api("/api/devices");
                if (version === deviceVersion && devices.open) renderDevices(data);
            } catch (e) {
                if (version === deviceVersion && devices.open) {
                    list.replaceChildren(); $("devicesCount").textContent = "";
                    devicePlan = null; $("devicePlanSummary").textContent = "";
                    $("addDeviceSlotBtn").classList.add("hidden"); $("reduceDeviceSlotBtn").classList.add("hidden");
                    status("devicesStatus", e.message || "Не удалось загрузить устройства. Повторите попытку.", true);
                }
            } finally {
                loading = false; refresh.disabled = false; list.setAttribute("aria-busy", "false");
                if (devices.open && version !== deviceVersion) loadDevices();
            }
        }
        $("devicesBtn").addEventListener("click", () => {
            if (!devices.open) devices.showModal();
            loadDevices();
        });
        refresh.addEventListener("click", loadDevices);
        $("closeDevicesBtn").addEventListener("click", () => { if (!deleting) devices.close(); });
        devices.addEventListener("close", () => { ++deviceVersion; list.replaceChildren(); $("devicesCount").textContent = ""; });
        devices.addEventListener("cancel", e => { if (deleting) e.preventDefault(); });
        $("cancelDeleteDeviceBtn").addEventListener("click", () => { if (!deleting) confirm.close(); });
        confirm.addEventListener("cancel", e => { if (deleting) e.preventDefault(); });
        $("confirmDeleteDeviceBtn").addEventListener("click", async () => {
            if (!selected || deleting) return;
            deleting = true;
            $("confirmDeleteDeviceBtn").disabled = $("cancelDeleteDeviceBtn").disabled = refresh.disabled = true;
            status("deleteDeviceStatus", "Удаляем запись...");
            try {
                let data;
                if (options.demo) {
                    const index = demoDevices.findIndex(d => d.id === selected.id);
                    if (index >= 0) demoDevices.splice(index, 1);
                    data = { devices: demoDevices, partial: false, result: "deleted" };
                } else data = await api("/api/devices/delete", { method: "POST", body: { id: selected.id } });
                confirm.close(); selected = null;
                renderDevices(data);
                status("devicesStatus", data.result === "partial" ? "Удаление подтверждено не на всех серверах. Обновите список и повторите позже." : data.result === "absent" ? "Запись уже отсутствует." : "Запись устройства удалена.", data.result === "partial");
                if (data.partial && data.result !== "partial") status("devicesStatus", "Удаление выполнено, но список обновлён не полностью. Повторите обновление позже.", true);
                refresh.focus();
            } catch (e) {
                status("deleteDeviceStatus", (e.message || "Не удалось подтвердить удаление.") + " Закройте это окно и обновите список перед повторной попыткой.", true);
            } finally {
                deleting = false;
                $("confirmDeleteDeviceBtn").disabled = $("cancelDeleteDeviceBtn").disabled = refresh.disabled = false;
            }
        });

        function showSlotDialog(mode) {
            if (!devicePlan || !devicePlan.enabled || loading || deleting || slotBusy) return;
            slotMode = mode; slotOrder = null;
            $("deviceSlotTitle").textContent = mode === "reduce" ? "Убрать дополнительное место?" : "Дополнительное устройство";
            $("deviceSlotPrice").textContent = mode === "reduce" ? "Лимит: " + (4 + devicePlan.extra_slots) : "50 ₽";
            $("deviceSlotTerms").textContent = mode === "reduce" ? "Лимит уменьшится на одно место сразу. Сначала удалите лишнее устройство из списка. Оплата за текущий срок не возвращается. При каждом следующем продлении цена снизится на 50 ₽. Автопродление отключится." : "Одно место до окончания текущей VPN-подписки. При каждом продлении +50 ₽ за место, независимо от срока тарифа. Дни не добавляются. После изменения числа мест автопродление отключится: его можно включить заново.";
            $("confirmDeviceSlotBtn").textContent = mode === "reduce" ? "Убрать место" : "Продолжить";
            $("deviceSlotPayLink").classList.add("hidden"); status("deviceSlotStatus", "");
            slotDialog.showModal(); $("cancelDeviceSlotBtn").focus();
        }
        $("addDeviceSlotBtn").addEventListener("click", () => showSlotDialog("purchase"));
        $("reduceDeviceSlotBtn").addEventListener("click", () => showSlotDialog("reduce"));
        $("cancelDeviceSlotBtn").addEventListener("click", () => { if (!slotBusy) slotDialog.close(); });
        slotDialog.addEventListener("cancel", e => { if (slotBusy) e.preventDefault(); });
        $("confirmDeviceSlotBtn").addEventListener("click", async () => {
            if (slotBusy || !devicePlan || !devicePlan.enabled) return;
            if (options.demo) { status("deviceSlotStatus", "Оплата в демо-режиме отключена.", true); return; }
            slotBusy = true; $("confirmDeviceSlotBtn").disabled = $("cancelDeviceSlotBtn").disabled = true;
            status("deviceSlotStatus", slotOrder ? "Проверяем оплату..." : "Обрабатываем запрос...");
            try {
                const action = slotMode === "reduce" ? "reduce" : slotOrder ? "check" : "purchase";
                const data = await api("/api/devices/" + action, { method: "POST", body: { id: slotOrder ? slotOrder.id : "" } });
                if (action === "reduce" || data.order && data.order.applied) {
                    slotDialog.close(); slotOrder = null;
                    await loadDevices();
                    if (options.onDevicePlanChanged) await options.onDevicePlanChanged();
                    status("devicesStatus", action === "reduce" ? "Одно дополнительное место убрано. Автопродление отключено." : "Оплата подтверждена. Место добавлено; синхронизация с панелью займёт до минуты. Обновите VPN-подписку.");
                } else if (data.order && data.order.confirmation_url) {
                    const link = new URL(data.order.confirmation_url);
                    if (link.protocol !== "https:") throw new Error("Некорректная ссылка оплаты");
                    slotOrder = data.order;
                    $("deviceSlotPayLink").href = link.href; $("deviceSlotPayLink").classList.remove("hidden");
                    $("confirmDeviceSlotBtn").textContent = "Я оплатил";
                    status("deviceSlotStatus", action === "check" ? "Оплата пока не подтверждена. Повторите проверку после оплаты." : "Счёт готов. Оплатите его, затем проверьте оплату.");
                } else throw new Error("Не удалось проверить платёж. Повторите попытку.");
            } catch (e) { status("deviceSlotStatus", e.message || "Не удалось выполнить запрос.", true); }
            finally { slotBusy = false; $("confirmDeviceSlotBtn").disabled = $("cancelDeviceSlotBtn").disabled = false; }
        });

        function paymentButtons() {
            $("payAnyMethodBtn").disabled = $("payAutopayBtn").disabled = checking || paying || !quote;
            $("applyPromoBtn").disabled = checking || paying;
            $("promoInput").disabled = paying;
            $("closePaymentModalBtn").disabled = paying;
        }
        function money(value) { return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽"; }
        function renderQuote(q, message) {
            quote = q;
            const line = $("paymentChoiceText"); line.replaceChildren();
            const total = document.createElement("strong"); total.textContent = plan.title + " · " + money(q.amount); line.append(total);
            $("paymentDevicePrice").textContent = q.device_extra_slots ? "В сумме учтено дополнительных мест: " + q.device_extra_slots + " · " + money(q.device_amount) + " за выбранный срок. Скидка по промокоду применяется только к тарифу." : "5 устройств включено. Для аккаунтов без включённого лимита ограничения пока не применяются.";
            if (q.discount) {
                const old = document.createElement("del"); old.textContent = money(q.base_amount); line.append(old);
                status("promoStatus", (message ? message + " " : "") + "Скидка " + q.discount + "% по коду " + q.promo_code + " применена.");
            } else status("promoStatus", message || "");
        }
        async function refreshQuote(apply) {
            if (!plan || paying || checking) return;
            const version = ++checkoutVersion;
            checking = true; paymentButtons();
            if (apply) status("promoStatus", "Проверяем промокод...");
            else status("checkoutStatus", "Проверяем стоимость...");
            try {
                const data = options.demo ? { quote: { amount: plan.amount, base_amount: plan.amount, discount: 0, quote: "demo" }, message: apply ? "В демо-режиме промокоды не активируются." : "" } : await api(apply ? "/api/promocode/apply" : "/api/payments/quote", { method: "POST", body: { plan_id: plan.id, code: $("promoInput").value.trim() } });
                if (version !== checkoutVersion) return;
                renderQuote(data.quote, data.message);
                if (apply) $("promoInput").value = "";
                status("checkoutStatus", "");
            } catch (e) {
                if (version !== checkoutVersion) return;
                status(apply ? "promoStatus" : "checkoutStatus", e.message || "Не удалось проверить стоимость. Откройте оплату заново.", true);
            } finally {
                if (version === checkoutVersion) { checking = false; paymentButtons(); }
            }
        }
        $("promoForm").addEventListener("submit", e => {
            e.preventDefault();
            if (!$("promoInput").value.trim()) { status("promoStatus", "Введите промокод.", true); $("promoInput").focus(); return; }
            refreshQuote(true);
        });
        payment.addEventListener("keydown", e => {
            if (e.key === "Escape" && !paying) { $("closePaymentModalBtn").click(); return; }
            if (e.key !== "Tab") return;
            const focusable = [...payment.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
        return {
            openCheckout(p) {
                ++checkoutVersion; plan = p; quote = null; checking = paying = false;
                paymentFocus = document.activeElement;
                $("promoInput").value = ""; status("promoStatus", ""); status("checkoutStatus", "");
                $("paymentDevicePrice").textContent = "";
                document.querySelector(".cabinet-shell").inert = true;
                document.body.classList.add("checkout-open");
                refreshQuote(false); $("paymentChoiceTitle").focus();
            },
            closeCheckout() {
                if (paying) return false;
                ++checkoutVersion; checking = false;
                document.querySelector(".cabinet-shell").inert = false;
                document.body.classList.remove("checkout-open");
                if (paymentFocus) paymentFocus.focus();
                return true;
            },
            beginPayment() {
                if (!quote || paying || checking) return null;
                if (options.demo) { status("checkoutStatus", "В демо-режиме оплата отключена.", true); return null; }
                paying = true; paymentButtons(); status("checkoutStatus", "Создаём платёж...");
                return quote.quote;
            },
            async paymentError(e) {
                paying = false;
                if (e.status === 409) { quote = null; await refreshQuote(false); }
                status("checkoutStatus", e.message || "Не удалось создать платёж. Повторите попытку.", true);
                paymentButtons();
            },
            endPayment() { paying = false; paymentButtons(); }
        };
    };
}());
