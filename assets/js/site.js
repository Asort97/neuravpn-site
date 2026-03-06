(function () {
            const DOMAIN = "<мой домен>";
            const ANDROID_PACKAGE = "<мой package name>";
            const ANDROID_APK_URL = "<ссылка на apk>";
            const WINDOWS_EXE_URL = "<ссылка на exe/msi>";
            const MAX_V_SIZE = 32 * 1024;
            const REDIRECT_TIMEOUT_MS = 1600;

            const ua = navigator.userAgent || "";
            const isAndroid = /Android/i.test(ua);
            const isWindows = /Windows NT/i.test(ua);
            const isiOS = /iPhone|iPad|iPod/i.test(ua);
            const isMac = /Macintosh|Mac OS X/i.test(ua) && !isiOS;
            const isTelegramWebView = /Telegram/i.test(ua) || typeof window.TelegramWebviewProxy !== "undefined";

            const openModeSection = document.getElementById("openModeSection");
            const landingSections = document.querySelectorAll("[data-landing='true']");
            const openTitle = document.getElementById("openTitle");
            const openSubtitle = document.getElementById("openSubtitle");
            const openStatus = document.getElementById("openStatus");
            const openAppBtn = document.getElementById("openAppBtn");
            const fallbackBlock = document.getElementById("fallbackBlock");
            const fallbackHint = document.getElementById("fallbackHint");

            const landingDownloadAndroidBtn = document.getElementById("landingDownloadAndroidBtn");
            const landingDownloadWindowsBtn = document.getElementById("landingDownloadWindowsBtn");
            const fallbackAndroidBtn = document.getElementById("fallbackAndroidBtn");
            const fallbackWindowsBtn = document.getElementById("fallbackWindowsBtn");

            setLinkTargets(landingDownloadAndroidBtn, ANDROID_APK_URL);
            setLinkTargets(landingDownloadWindowsBtn, WINDOWS_EXE_URL);
            setLinkTargets(fallbackAndroidBtn, ANDROID_APK_URL);
            setLinkTargets(fallbackWindowsBtn, WINDOWS_EXE_URL);

            const rawV = getRawQueryParam("v");
            const rawOpen = getRawQueryParam("open");
            const rawMode = getRawQueryParam("mode");
            const normalizedPath = normalizePath(window.location.pathname);
            const isOpenMode =
                isOpenPath(normalizedPath) ||
                rawV !== null ||
                isOpenModeParam(rawOpen, rawMode);

            if (isOpenMode) {
                openModeSection.classList.remove("hidden");
                landingSections.forEach(function (section) { section.classList.add("hidden"); });
            } else {
                openModeSection.classList.add("hidden");
                landingSections.forEach(function (section) { section.classList.remove("hidden"); });
                return;
            }

            if (!rawV) {
                showInvalid("Некорректная ссылка");
                return;
            }

            if (rawV.length > MAX_V_SIZE) {
                showTooLong();
                return;
            }

            const vlessString = safeDecode(rawV);
            if (!vlessString) {
                showInvalid("Некорректная ссылка");
                return;
            }

            if (vlessString.length > MAX_V_SIZE) {
                showTooLong();
                return;
            }

            const payloadType = detectPayloadType(vlessString);
            if (!payloadType) {
                showInvalid("Некорректная ссылка");
                return;
            }

            const encodedV = encodeURIComponent(vlessString);
            const platformName = detectPlatformName();
            const payloadLabel = payloadType === "vless" ? "Ключ" : "Подписка";
            openStatus.textContent = payloadLabel + " получен(а). Платформа: " + platformName + (isTelegramWebView ? " (Telegram WebView)" : "");

            openAppBtn.addEventListener("click", function (event) {
                event.preventDefault();

                if (encodedV.length > MAX_V_SIZE) {
                    showTooLong();
                    return;
                }

                if (isAndroid) {
                    const intentUrl = "intent://import?v=" + encodedV + "#Intent;scheme=neuravpn;package=" + ANDROID_PACKAGE + ";end";
                    tryOpen(intentUrl);
                    return;
                }

                if (isWindows) {
                    const windowsUrl = "neuravpn://import?v=" + encodedV;
                    tryOpen(windowsUrl);
                    return;
                }

                openStatus.textContent = "Платформа пока не поддерживает авто-открытие по этой ссылке.";
                fallbackHint.textContent = "Установите приложение для Android или Windows.";
                fallbackBlock.classList.remove("hidden");
            });

            function tryOpen(targetUrl) {
                fallbackBlock.classList.add("hidden");
                let appOpened = false;

                const onBlur = function () {
                    appOpened = true;
                    cleanup();
                };
                const onPageHide = function () {
                    appOpened = true;
                    cleanup();
                };
                const onVisibility = function () {
                    if (document.visibilityState === "hidden") {
                        appOpened = true;
                        cleanup();
                    }
                };
                const cleanup = function () {
                    window.removeEventListener("blur", onBlur);
                    window.removeEventListener("pagehide", onPageHide);
                    document.removeEventListener("visibilitychange", onVisibility);
                };

                window.addEventListener("blur", onBlur);
                window.addEventListener("pagehide", onPageHide);
                document.addEventListener("visibilitychange", onVisibility);

                window.location.href = targetUrl;

                window.setTimeout(function () {
                    cleanup();
                    if (!appOpened) {
                        fallbackHint.textContent = "Приложение не открылось автоматически. Установите его и повторите попытку.";
                        fallbackBlock.classList.remove("hidden");
                    }
                }, REDIRECT_TIMEOUT_MS);
            }

            function showTooLong() {
                showInvalid("Ссылка слишком длинная");
            }

            function showInvalid(message) {
                openTitle.textContent = "Некорректная ссылка";
                openSubtitle.textContent = message;
                openStatus.textContent = "Проверьте ссылку из Telegram и попробуйте снова.";
                openAppBtn.classList.add("hidden");
                fallbackHint.textContent = "Можно установить приложение вручную:";
                fallbackBlock.classList.remove("hidden");
            }

            function setLinkTargets(element, href) {
                if (!element) {
                    return;
                }
                element.href = href;
                element.target = "_blank";
                element.rel = "noopener noreferrer";
            }

            function normalizePath(pathname) {
                if (!pathname) {
                    return "/";
                }
                const path = pathname.replace(/\/+$/, "");
                return path === "" ? "/" : path;
            }

            function isOpenPath(path) {
                if (!path) {
                    return false;
                }
                return path === "/open" || path.endsWith("/open") || path.endsWith("/open/index.html");
            }

            function safeDecode(value) {
                try {
                    return decodeURIComponent(value.replace(/\+/g, "%20"));
                } catch (error) {
                    return "";
                }
            }

            function getRawQueryParam(paramName) {
                const search = window.location.search;
                if (!search || search.length < 2) {
                    return null;
                }

                const pairs = search.slice(1).split("&");
                for (let i = 0; i < pairs.length; i++) {
                    const pair = pairs[i];
                    if (!pair) {
                        continue;
                    }

                    const separatorIndex = pair.indexOf("=");
                    const rawKey = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
                    const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : "";
                    const decodedKey = safeDecode(rawKey);

                    if (decodedKey === paramName) {
                        return rawValue;
                    }
                }
                return null;
            }

            function detectPlatformName() {
                if (isAndroid) {
                    return "Android";
                }
                if (isWindows) {
                    return "Windows";
                }
                if (isiOS) {
                    return "iOS";
                }
                if (isMac) {
                    return "macOS";
                }
                return "Unknown";
            }

            function detectPayloadType(value) {
                if (!value) {
                    return "";
                }

                if (value.startsWith("vless://")) {
                    return "vless";
                }

                if (value.startsWith("https://") || value.startsWith("http://")) {
                    try {
                        const url = new URL(value);
                        if (url.protocol === "https:" || url.protocol === "http:") {
                            return "subscription";
                        }
                    } catch (error) {
                        return "";
                    }
                }

                return "";
            }

            function isOpenModeParam(rawOpenValue, rawModeValue) {
                if (rawOpenValue !== null) {
                    const openValue = safeDecode(rawOpenValue).toLowerCase();
                    if (openValue === "" || openValue === "1" || openValue === "true" || openValue === "yes") {
                        return true;
                    }
                }

                if (rawModeValue !== null) {
                    const modeValue = safeDecode(rawModeValue).toLowerCase();
                    if (modeValue === "open") {
                        return true;
                    }
                }

                return false;
            }

            void DOMAIN;
        })();
