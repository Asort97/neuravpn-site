(function () {
            const DOMAIN = "<мой домен>";
            const ANDROID_PACKAGE = "com.neuravpn.app";
            const ANDROID_APK_URL = "<ссылка на apk>";
            const WINDOWS_EXE_URL = "<ссылка на exe/msi>";
            const RELEASES_PAGE_URL = "https://github.com/Asort97/neuravpn-client/releases";
            const MAX_V_SIZE = 32 * 1024;
            const REDIRECT_TIMEOUT_MS = 1600;
            const AUTO_OPEN_DELAY_MS = 120;
            const ANDROID_SCHEME_RETRY_MS = 550;

            const ua = navigator.userAgent || "";
            const rawPlatform = getRawQueryParam("platform");
            const forcedPlatform = normalizePlatformOverride(rawPlatform);
            const isSamsungBrowser = /SamsungBrowser/i.test(ua);
            const touchPoints = typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
            const uaMobile = !!(navigator.userAgentData && navigator.userAgentData.mobile);
            const looksLikeAndroidDesktopUa =
                isSamsungBrowser &&
                /Linux/i.test(ua) &&
                !/Android/i.test(ua) &&
                touchPoints > 0;
            const isAndroid = forcedPlatform === "android" || /Android/i.test(ua) || looksLikeAndroidDesktopUa;
            const isWindows = forcedPlatform === "windows" || (/Windows NT/i.test(ua) && forcedPlatform !== "android");
            const isiOS = forcedPlatform === "ios" || (/iPhone|iPad|iPod/i.test(ua) && forcedPlatform !== "android");
            const isMac = forcedPlatform === "mac" || ((/Macintosh|Mac OS X/i.test(ua) && !isiOS) && forcedPlatform !== "android");
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
            let releaseCatalogPromise = null;

            const initialAndroidUrl = isPlaceholderUrl(ANDROID_APK_URL) ? RELEASES_PAGE_URL : ANDROID_APK_URL;
            const initialWindowsUrl = isPlaceholderUrl(WINDOWS_EXE_URL) ? RELEASES_PAGE_URL : WINDOWS_EXE_URL;
            setLinkTargets(landingDownloadAndroidBtn, initialAndroidUrl, { newTab: false });
            setLinkTargets(landingDownloadWindowsBtn, initialWindowsUrl, { newTab: false });
            setLinkTargets(fallbackAndroidBtn, initialAndroidUrl, { newTab: false });
            setLinkTargets(fallbackWindowsBtn, initialWindowsUrl, { newTab: false });
            void bindLatestReleaseLinks();
            void loadDownloadCounts();

            const rawV = getRawQueryParam("v");
            const rawOpen = getRawQueryParam("open");
            const rawMode = getRawQueryParam("mode");
            const rawAuto = getRawQueryParam("auto");
            const rawDebug = getRawQueryParam("debug");
            const debugEnabled = shouldEnableDebug(rawDebug);
            const normalizedPath = normalizePath(window.location.pathname);
            const isOpenMode =
                isOpenPath(normalizedPath) ||
                rawV !== null ||
                isOpenModeParam(rawOpen, rawMode);
            let debugConsole = null;

            if (isOpenMode) {
                openModeSection.classList.remove("hidden");
                landingSections.forEach(function (section) { section.classList.add("hidden"); });
                if (debugEnabled) {
                    debugConsole = createDebugConsole();
                    debugLog("debug enabled", {
                        path: normalizedPath,
                        auto: rawAuto,
                        forcePlatform: forcedPlatform || "",
                        ua: ua
                    });
                }
            } else {
                openModeSection.classList.add("hidden");
                landingSections.forEach(function (section) { section.classList.remove("hidden"); });
                return;
            }

            debugLog("platform", {
                android: isAndroid,
                windows: isWindows,
                ios: isiOS,
                mac: isMac,
                telegramWebView: isTelegramWebView,
                samsungBrowser: isSamsungBrowser,
                touchPoints: touchPoints,
                uaMobile: uaMobile,
                looksLikeAndroidDesktopUa: looksLikeAndroidDesktopUa
            });

            if (!rawV) {
                debugLog("invalid: missing v");
                showInvalid("Некорректная ссылка");
                return;
            }

            if (rawV.length > MAX_V_SIZE) {
                debugLog("invalid: raw v too long", { length: rawV.length, limit: MAX_V_SIZE });
                showTooLong();
                return;
            }

            const vlessString = safeDecode(rawV);
            if (!vlessString) {
                debugLog("invalid: decode failed");
                showInvalid("Некорректная ссылка");
                return;
            }

            if (vlessString.length > MAX_V_SIZE) {
                debugLog("invalid: decoded value too long", { length: vlessString.length, limit: MAX_V_SIZE });
                showTooLong();
                return;
            }

            const payloadType = detectPayloadType(vlessString);
            if (!payloadType) {
                debugLog("invalid: payload type not supported", { payloadPreview: shorten(vlessString, 120) });
                showInvalid("Некорректная ссылка");
                return;
            }

            const encodedV = encodeURIComponent(vlessString);
            const platformName = detectPlatformName();
            const payloadLabel = payloadType === "vless" ? "Ключ" : "Подписка";
            openStatus.textContent = payloadLabel + " получен(а). Платформа: " + platformName + (isTelegramWebView ? " (Telegram WebView)" : "");
            debugLog("payload accepted", {
                payloadType: payloadType,
                encodedLength: encodedV.length,
                platform: platformName,
                payloadPreview: shorten(vlessString, 120)
            });
            let lastOpenAtMs = 0;

            openAppBtn.addEventListener("click", function (event) {
                event.preventDefault();
                debugLog("button: open app clicked");
                openInApp("manual");
            });

            if (shouldAutoOpen(rawAuto)) {
                debugLog("auto open scheduled", { delayMs: AUTO_OPEN_DELAY_MS });
                window.setTimeout(function () {
                    debugLog("auto open fired");
                    openInApp("auto");
                }, AUTO_OPEN_DELAY_MS);
            } else {
                debugLog("auto open disabled", { auto: rawAuto });
            }

            function openInApp(source) {
                const now = Date.now();
                if (now - lastOpenAtMs < 700) {
                    debugLog("open throttled", { source: source, deltaMs: now - lastOpenAtMs });
                    return;
                }
                lastOpenAtMs = now;
                debugLog("open attempt", { source: source, encodedLength: encodedV.length });

                if (encodedV.length > MAX_V_SIZE) {
                    debugLog("abort: encoded too long", { length: encodedV.length, limit: MAX_V_SIZE });
                    showTooLong();
                    return;
                }

                if (isAndroid) {
                    debugLog("route: android");
                    tryOpenAndroid(encodedV, source === "manual");
                    return;
                }

                if (isWindows) {
                    const windowsUrl = "neuravpn://import?v=" + encodedV;
                    debugLog("route: windows", { url: shorten(windowsUrl, 140) });
                    tryOpen(windowsUrl);
                    return;
                }

                debugLog("route: unsupported platform");
                openStatus.textContent = "Платформа пока не поддерживает авто-открытие по этой ссылке.";
                fallbackHint.textContent = "Установите приложение для Android или Windows.";
                fallbackBlock.classList.remove("hidden");
            }

            function tryOpenAndroid(encodedPayload, userInitiated) {
                const schemeUrl = "neuravpn://import?v=" + encodedPayload;
                const intentUrl = buildAndroidIntentUrl(encodedPayload);
                debugLog("android handoff", {
                    userInitiated: userInitiated,
                    hasIntent: !!intentUrl,
                    schemeUrl: shorten(schemeUrl, 150),
                    intentUrl: shorten(intentUrl, 180)
                });

                if (userInitiated && intentUrl) {
                    // Samsung/Chrome often allow intent on real user gesture more reliably than custom scheme.
                    debugLog("android manual: try intent first");
                    tryOpen(intentUrl, {
                        timeoutMs: REDIRECT_TIMEOUT_MS,
                        onTimeout: function () {
                            debugLog("android manual intent timeout");
                            showManualInstallFallback();
                        }
                    });
                    return;
                }

                debugLog("android: try scheme first");
                tryOpen(schemeUrl, {
                    timeoutMs: intentUrl ? ANDROID_SCHEME_RETRY_MS : REDIRECT_TIMEOUT_MS,
                    onTimeout: function () {
                        debugLog("android scheme timeout", { hasIntent: !!intentUrl });
                        if (intentUrl) {
                            debugLog("android: fallback to intent");
                            tryOpen(intentUrl, {
                                timeoutMs: REDIRECT_TIMEOUT_MS,
                                onTimeout: function () {
                                    debugLog("android fallback intent timeout");
                                    showManualInstallFallback();
                                }
                            });
                            return;
                        }
                        showManualInstallFallback();
                    }
                });
            }

            function buildAndroidIntentUrl(encodedPayload) {
                const pkg = getValidAndroidPackageName();
                if (!pkg) {
                    debugLog("intent build skipped: invalid package");
                    return "";
                }
                const fallbackUrl = encodeURIComponent(initialAndroidUrl || RELEASES_PAGE_URL);
                const intent = "intent://import?v=" + encodedPayload +
                    "#Intent;scheme=neuravpn;package=" + pkg +
                    ";S.browser_fallback_url=" + fallbackUrl +
                    ";end";
                debugLog("intent built", { package: pkg, fallbackUrl: decodeURIComponent(fallbackUrl) });
                return intent;
            }

            function getValidAndroidPackageName() {
                const pkg = (ANDROID_PACKAGE || "").trim();
                if (!pkg || pkg.indexOf("<") >= 0 || pkg.indexOf(">") >= 0) {
                    return "";
                }
                const packagePattern = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
                return packagePattern.test(pkg) ? pkg : "";
            }

            function showManualInstallFallback() {
                debugLog("show fallback block");
                openStatus.textContent = "Приложение не открылось автоматически.";
                fallbackHint.textContent = "Установите приложение для Android или Windows.";
                fallbackBlock.classList.remove("hidden");
            }

            function tryOpen(targetUrl, options) {
                const opts = options || {};
                const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : REDIRECT_TIMEOUT_MS;
                const onTimeout = typeof opts.onTimeout === "function" ? opts.onTimeout : null;
                debugLog("tryOpen start", { url: shorten(targetUrl, 220), timeoutMs: timeoutMs });
                fallbackBlock.classList.add("hidden");
                let appOpened = false;

                const onBlur = function () {
                    appOpened = true;
                    debugLog("event: blur");
                    cleanup();
                };
                const onPageHide = function () {
                    appOpened = true;
                    debugLog("event: pagehide");
                    cleanup();
                };
                const onVisibility = function () {
                    if (document.visibilityState === "hidden") {
                        appOpened = true;
                        debugLog("event: visibility hidden");
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
                        debugLog("tryOpen timeout", { url: shorten(targetUrl, 220) });
                        if (onTimeout) {
                            onTimeout();
                            return;
                        }
                        fallbackHint.textContent = "Приложение не открылось автоматически. Установите его и повторите попытку.";
                        fallbackBlock.classList.remove("hidden");
                    } else {
                        debugLog("tryOpen success signal");
                    }
                }, timeoutMs);
            }

            function showTooLong() {
                debugLog("showTooLong");
                showInvalid("Ссылка слишком длинная");
            }

            function showInvalid(message) {
                debugLog("showInvalid", { message: message });
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

            async function loadReleaseCatalog() {
                if (!releaseCatalogPromise) {
                    releaseCatalogPromise = fetch(RELEASES_PAGE_URL, {
                        method: "GET",
                        headers: {
                            "Accept": "text/html"
                        }
                    }).then(function (response) {
                        if (!response.ok) {
                            debugLog("releases fetch failed", { status: response.status });
                            return [];
                        }
                        return response.text();
                    }).then(function (html) {
                        return parseReleaseAssetsFromHtml(html);
                    }).catch(function (error) {
                        debugLog("releases fetch error", { message: error && error.message ? error.message : String(error) });
                        return [];
                    });
                }

                return releaseCatalogPromise;
            }

            async function bindLatestReleaseLinks() {
                const assets = await loadReleaseCatalog();
                if (assets.length === 0) {
                    return;
                }

                const androidAsset = pickLatestPlatformAsset(assets, "android");
                const windowsAsset = pickLatestPlatformAsset(assets, "windows");

                if (androidAsset && androidAsset.browser_download_url) {
                    setLinkTargets(landingDownloadAndroidBtn, androidAsset.browser_download_url, { newTab: false });
                    setLinkTargets(fallbackAndroidBtn, androidAsset.browser_download_url, { newTab: false });
                    debugLog("android download link updated", { name: androidAsset.name || "", version: androidAsset._resolvedVersion || "" });
                }
                if (windowsAsset && windowsAsset.browser_download_url) {
                    setLinkTargets(landingDownloadWindowsBtn, windowsAsset.browser_download_url, { newTab: false });
                    setLinkTargets(fallbackWindowsBtn, windowsAsset.browser_download_url, { newTab: false });
                    debugLog("windows download link updated", { name: windowsAsset.name || "", version: windowsAsset._resolvedVersion || "" });
                }
            }

            async function loadDownloadCounts() {
                const androidEl = document.getElementById("androidDownloadCount");
                const windowsEl = document.getElementById("windowsDownloadCount");
                if (!androidEl && !windowsEl) return;

                // Download counters require GitHub API (download_count), so keep hidden in HTML-only mode.
                if (androidEl) androidEl.textContent = "";
                if (windowsEl) windowsEl.textContent = "";
            }

            function parseReleaseAssetsFromHtml(html) {
                if (!html || typeof html !== "string") {
                    return [];
                }

                const linkPattern = /href="([^\"]*\/releases\/download\/[^\"]+)"/gi;
                const uniqueByUrl = {};
                const assets = [];
                let match;

                while ((match = linkPattern.exec(html)) !== null) {
                    const rawHref = String(match[1] || "").replace(/&amp;/g, "&");
                    const absoluteUrl = new URL(rawHref, "https://github.com").toString();
                    if (uniqueByUrl[absoluteUrl]) {
                        continue;
                    }
                    uniqueByUrl[absoluteUrl] = true;

                    const pathParts = absoluteUrl.split("/");
                    const name = decodeURIComponent(pathParts[pathParts.length - 1] || "");
                    const downloadIndex = pathParts.indexOf("download");
                    const releaseTag = downloadIndex >= 0 && downloadIndex + 1 < pathParts.length ? decodeURIComponent(pathParts[downloadIndex + 1]) : "";

                    assets.push({
                        name: name,
                        browser_download_url: absoluteUrl,
                        _releaseVersion: extractVersionFromText(releaseTag)
                    });
                }

                return assets;
            }

            function pickLatestPlatformAsset(assets, platform) {
                let bestAsset = null;
                let bestVersion = "";

                for (let i = 0; i < assets.length; i++) {
                    const asset = assets[i];
                    if (detectAssetPlatform(asset) !== platform) {
                        continue;
                    }

                    const assetVersion = extractVersionFromText(asset.name || "") || asset._releaseVersion || "0.0.0";
                    if (!bestAsset || compareVersions(assetVersion, bestVersion) > 0) {
                        bestAsset = asset;
                        bestVersion = assetVersion;
                        bestAsset._resolvedVersion = assetVersion;
                    }
                }

                return bestAsset;
            }

            function detectAssetPlatform(asset) {
                const name = typeof asset.name === "string" ? asset.name.toLowerCase() : "";
                const url = typeof asset.browser_download_url === "string" ? asset.browser_download_url.toLowerCase() : "";

                if (!name && !url) {
                    return "";
                }
                if (name.indexOf("source") >= 0 || url.indexOf("source") >= 0) {
                    return "";
                }
                if (name.endsWith(".apk") || url.endsWith(".apk") || name.indexOf("android") >= 0 || url.indexOf("android") >= 0) {
                    return "android";
                }
                if (
                    name.endsWith(".exe") || name.endsWith(".msi") || name.endsWith(".msix") || name.endsWith(".zip") ||
                    url.endsWith(".exe") || url.endsWith(".msi") || url.endsWith(".msix") || url.endsWith(".zip") ||
                    name.indexOf("windows") >= 0 || url.indexOf("windows") >= 0
                ) {
                    return "windows";
                }

                return "";
            }

            function extractVersionFromText(text) {
                if (!text) {
                    return "";
                }
                const match = String(text).match(/v?(\d+(?:\.\d+)+)/i);
                return match ? match[1] : "";
            }

            function compareVersions(left, right) {
                const leftParts = String(left || "0").split(".").map(toVersionNumber);
                const rightParts = String(right || "0").split(".").map(toVersionNumber);
                const maxLength = Math.max(leftParts.length, rightParts.length);

                for (let i = 0; i < maxLength; i++) {
                    const leftPart = i < leftParts.length ? leftParts[i] : 0;
                    const rightPart = i < rightParts.length ? rightParts[i] : 0;
                    if (leftPart > rightPart) {
                        return 1;
                    }
                    if (leftPart < rightPart) {
                        return -1;
                    }
                }

                return 0;
            }

            function toVersionNumber(value) {
                const parsed = parseInt(value, 10);
                return Number.isFinite(parsed) ? parsed : 0;
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

            function shouldEnableDebug(rawDebugValue) {
                if (rawDebugValue === null) {
                    return false;
                }
                const value = safeDecode(rawDebugValue).toLowerCase();
                if (value === "" || value === "1" || value === "true" || value === "yes" || value === "on") {
                    return true;
                }
                return false;
            }

            function normalizePlatformOverride(rawValue) {
                if (rawValue === null) {
                    return "";
                }
                const value = safeDecode(rawValue).toLowerCase();
                if (value === "android") {
                    return "android";
                }
                if (value === "windows" || value === "win") {
                    return "windows";
                }
                if (value === "ios" || value === "iphone" || value === "ipad") {
                    return "ios";
                }
                if (value === "mac" || value === "macos" || value === "osx") {
                    return "mac";
                }
                return "";
            }

            function createDebugConsole() {
                if (!openModeSection) {
                    return null;
                }
                const card = openModeSection.querySelector(".onboarding-card");
                if (!card) {
                    return null;
                }

                const panel = document.createElement("div");
                panel.className = "debug-panel";
                panel.innerHTML = [
                    '<div class="debug-head">',
                    '<span>Debug Handoff</span>',
                    '<button type="button" class="debug-copy-btn">Copy log</button>',
                    '</div>',
                    '<pre class="debug-log"></pre>'
                ].join("");
                card.appendChild(panel);

                const logEl = panel.querySelector(".debug-log");
                const copyBtn = panel.querySelector(".debug-copy-btn");
                const lines = [];
                if (copyBtn) {
                    copyBtn.addEventListener("click", function () {
                        const text = lines.join("\n");
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(text);
                        }
                    });
                }
                return {
                    lines: lines,
                    logEl: logEl
                };
            }

            function debugLog(message, data) {
                if (!debugConsole || !debugConsole.logEl) {
                    return;
                }
                const now = new Date();
                const ts = now.toISOString().slice(11, 23);
                const suffix = typeof data === "undefined" ? "" : " " + stringifyDebug(data);
                const line = "[" + ts + "] " + message + suffix;
                debugConsole.lines.push(line);
                if (debugConsole.lines.length > 200) {
                    debugConsole.lines.shift();
                }
                debugConsole.logEl.textContent = debugConsole.lines.join("\n");
                debugConsole.logEl.scrollTop = debugConsole.logEl.scrollHeight;
            }

            function stringifyDebug(value) {
                if (typeof value === "string") {
                    return shorten(value, 320);
                }
                try {
                    return shorten(JSON.stringify(value), 320);
                } catch (error) {
                    return shorten(String(value), 320);
                }
            }

            function shorten(value, maxLen) {
                const input = String(value || "");
                const limit = typeof maxLen === "number" ? maxLen : 160;
                if (input.length <= limit) {
                    return input;
                }
                return input.slice(0, limit) + "...";
            }

            void DOMAIN;
        })();
