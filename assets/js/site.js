(function () {
            const DOMAIN = "<мой домен>";
            const ANDROID_PACKAGE = "com.neuravpn.app";
            const ANDROID_APK_URL = "<ссылка на apk>";
            const WINDOWS_EXE_URL = "<ссылка на exe/msi>";
            const ANDROID_LATEST_DIRECT_URL = "https://github.com/Asort97/neuravpn-client/releases/latest/download/neuravpn_android_v1.0.3.apk";
            const WINDOWS_LATEST_DIRECT_URL = "https://github.com/Asort97/neuravpn-client/releases/latest/download/neuravpn_windows_v1.0.3.zip";
            const RELEASES_PAGE_URL = "https://github.com/Asort97/neuravpn-client/releases";
            const GITHUB_API_LATEST_RELEASE = "https://api.github.com/repos/Asort97/neuravpn-client/releases/latest";
            const MAX_V_SIZE = 32 * 1024;
            const REDIRECT_TIMEOUT_MS = 1600;
            const AUTO_OPEN_DELAY_MS = 120;

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

            const initialAndroidUrl = isPlaceholderUrl(ANDROID_APK_URL) ? ANDROID_LATEST_DIRECT_URL : ANDROID_APK_URL;
            const initialWindowsUrl = isPlaceholderUrl(WINDOWS_EXE_URL) ? WINDOWS_LATEST_DIRECT_URL : WINDOWS_EXE_URL;
            setLinkTargets(landingDownloadAndroidBtn, initialAndroidUrl, { newTab: false });
            setLinkTargets(landingDownloadWindowsBtn, initialWindowsUrl, { newTab: false });
            setLinkTargets(fallbackAndroidBtn, initialAndroidUrl, { newTab: false });
            setLinkTargets(fallbackWindowsBtn, initialWindowsUrl, { newTab: false });
            void bindLatestReleaseLinks();

            const rawV = getRawQueryParam("v");
            const rawOpen = getRawQueryParam("open");
            const rawMode = getRawQueryParam("mode");
            const rawAuto = getRawQueryParam("auto");
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
            let lastOpenAtMs = 0;

            openAppBtn.addEventListener("click", function (event) {
                event.preventDefault();
                openInApp();
            });

            if (shouldAutoOpen(rawAuto)) {
                window.setTimeout(function () {
                    openInApp();
                }, AUTO_OPEN_DELAY_MS);
            }

            function openInApp() {
                const now = Date.now();
                if (now - lastOpenAtMs < 700) {
                    return;
                }
                lastOpenAtMs = now;

                if (encodedV.length > MAX_V_SIZE) {
                    showTooLong();
                    return;
                }

                if (isAndroid) {
                    tryOpenAndroid(encodedV);
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
            }

            function tryOpenAndroid(encodedPayload) {
                const schemeUrl = "neuravpn://import?v=" + encodedPayload;
                tryOpen(schemeUrl, {
                    timeoutMs: REDIRECT_TIMEOUT_MS,
                    onTimeout: function () {
                        showManualInstallFallback();
                    }
                });
            }

            function showManualInstallFallback() {
                openStatus.textContent = "Приложение не открылось автоматически.";
                fallbackHint.textContent = "Установите приложение для Android или Windows.";
                fallbackBlock.classList.remove("hidden");
            }

            function tryOpen(targetUrl, options) {
                const opts = options || {};
                const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : REDIRECT_TIMEOUT_MS;
                const onTimeout = typeof opts.onTimeout === "function" ? opts.onTimeout : null;
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
                        if (onTimeout) {
                            onTimeout();
                            return;
                        }
                        fallbackHint.textContent = "Приложение не открылось автоматически. Установите его и повторите попытку.";
                        fallbackBlock.classList.remove("hidden");
                    }
                }, timeoutMs);
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

            function setLinkTargets(element, href, options) {
                if (!element) {
                    return;
                }
                element.href = href;
                const openInNewTab = !options || options.newTab !== false;
                if (openInNewTab) {
                    element.target = "_blank";
                    element.rel = "noopener noreferrer";
                } else {
                    element.removeAttribute("target");
                    element.removeAttribute("rel");
                }
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

            async function bindLatestReleaseLinks() {
                try {
                    const response = await fetch(GITHUB_API_LATEST_RELEASE, {
                        method: "GET",
                        headers: {
                            "Accept": "application/vnd.github+json"
                        }
                    });
                    if (!response.ok) {
                        return;
                    }

                    const release = await response.json();
                    const assets = Array.isArray(release.assets) ? release.assets : [];
                    if (assets.length === 0) {
                        return;
                    }

                    const androidAsset = pickBestAsset(assets, {
                        extensions: [".apk"],
                        includeTokens: ["android", "neuravpn"],
                        excludeTokens: ["source"]
                    });
                    const windowsAsset = pickBestAsset(assets, {
                        extensions: [".msi", ".exe", ".msix", ".zip"],
                        includeTokens: ["windows", "neuravpn"],
                        excludeTokens: ["source"]
                    });

                    if (androidAsset && androidAsset.browser_download_url) {
                        setLinkTargets(landingDownloadAndroidBtn, androidAsset.browser_download_url, { newTab: false });
                        setLinkTargets(fallbackAndroidBtn, androidAsset.browser_download_url, { newTab: false });
                    }
                    if (windowsAsset && windowsAsset.browser_download_url) {
                        setLinkTargets(landingDownloadWindowsBtn, windowsAsset.browser_download_url, { newTab: false });
                        setLinkTargets(fallbackWindowsBtn, windowsAsset.browser_download_url, { newTab: false });
                    }
                } catch (error) {
                    return;
                }
            }

            function pickBestAsset(assets, options) {
                const extensions = Array.isArray(options.extensions) ? options.extensions : [];
                const includeTokens = Array.isArray(options.includeTokens) ? options.includeTokens : [];
                const excludeTokens = Array.isArray(options.excludeTokens) ? options.excludeTokens : [];
                const filtered = assets.filter(function (asset) {
                    const name = typeof asset.name === "string" ? asset.name.toLowerCase() : "";
                    const url = typeof asset.browser_download_url === "string" ? asset.browser_download_url.toLowerCase() : "";
                    const hasAllowedExt = extensions.some(function (ext) {
                        const e = ext.toLowerCase();
                        return name.endsWith(e) || url.endsWith(e);
                    });
                    if (!hasAllowedExt) {
                        return false;
                    }

                    const hasExcluded = excludeTokens.some(function (token) {
                        const t = token.toLowerCase();
                        return name.indexOf(t) >= 0 || url.indexOf(t) >= 0;
                    });
                    return !hasExcluded;
                });

                if (filtered.length === 0) {
                    return null;
                }

                let best = null;
                let bestScore = -1;
                for (let i = 0; i < filtered.length; i++) {
                    const asset = filtered[i];
                    const name = typeof asset.name === "string" ? asset.name.toLowerCase() : "";
                    const url = typeof asset.browser_download_url === "string" ? asset.browser_download_url.toLowerCase() : "";
                    let score = 0;
                    for (let j = 0; j < includeTokens.length; j++) {
                        const token = includeTokens[j].toLowerCase();
                        if (name.indexOf(token) >= 0 || url.indexOf(token) >= 0) {
                            score += 2;
                        }
                    }
                    if (name.indexOf("release") >= 0) {
                        score += 1;
                    }
                    if (score > bestScore) {
                        best = asset;
                        bestScore = score;
                    }
                }
                return best;
            }

            function isPlaceholderUrl(url) {
                if (!url) {
                    return true;
                }
                return url.indexOf("<") >= 0 || url.indexOf(">") >= 0;
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

            function shouldAutoOpen(rawAutoValue) {
                if (rawAutoValue === null || rawAutoValue === "") {
                    return true;
                }
                const value = safeDecode(rawAutoValue).toLowerCase();
                return value !== "0" && value !== "false" && value !== "no" && value !== "off";
            }

            void DOMAIN;
        })();
