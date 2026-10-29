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
            $("devicesCount").textContent = (data.partial ? "Найдено: " : "Всего: ") + data.devices.length;
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
