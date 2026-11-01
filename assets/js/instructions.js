(function () {
    const mediaBase = "../../assets/instructions/";
    const DOWNLOADS = {
        android: "https://github.com/Asort97/neuravpn-client/releases/download/v1.0.5/neuravpn_android_v1.0.5_arm64.apk",
        windows: "https://github.com/Asort97/neuravpn-client/releases/download/v.1.0.7/neuravpn-setup-v1.0.7.exe"
    };
    const isMiniApp = detectMiniApp();
    if (isMiniApp) {
        document.body.classList.add("is-mini-app");
    }
    const guides = {
        windows: {
            label: "Windows",
            title: "Инструкция для Windows",
            intro: "Установка клиента NeuraVPN, импорт ключа и запуск подключения.",
            actions: [
                { text: "Скачать Windows", href: DOWNLOADS.windows, download: true }
            ],
            steps: [
                { media: "Windows/neuravpn_app/0.png", title: "Скачайте клиент", text: `скачайте установщик neuravpn для Windows.`, actions: [{ text: "Скачать Windows", href: DOWNLOADS.windows, primary: true, download: true }] },
                { title: "Запустите установщик", text: `после завершения загрузки откройте файл <b>neuravpn-setup</b> и установите приложение.` },
                { title: "Откройте приложение", text: `после установки запустите <b>neuravpn</b>. если Windows попросит разрешение, подтвердите запуск.` },
                { media: "Windows/0.MP4", title: "Импортируйте ключ", text: `предварительно скопировав ключ доступа, в программе нажмите на кнопку «вставить из буфера». Если ключ открыт в кабинете, можно использовать авто-импорт.` },
                { media: "Windows/1.MP4", title: "Подключитесь", text: `подключитесь к VPN, нажав по большой кнопке в центре.` }
            ]
        },
        android: {
            label: "Android",
            title: "Инструкция для Android",
            intro: "Установка клиента NeuraVPN, импорт ключа и включение VPN.",
            actions: [
                { text: "Скачать Android", href: DOWNLOADS.android, download: true }
            ],
            steps: [
                { media: "Android/0.MP4", title: "Скачайте приложение", text: `скачайте APK neuravpn и запустите установку.`, actions: [{ text: "Скачать Android", href: DOWNLOADS.android, primary: true, download: true }] },
                { media: "Android/1.MP4", title: "Вставьте ключ", text: `зайдите в приложение и вставьте ключ из буфера обмена. предварительно скопируйте ключ подключения из личного кабинета.` },
                { media: "Android/2.MP4", title: "Включите VPN", text: `далее нажмите на кнопку включения. VPN начнёт работать.` }
            ]
        },
        ios: {
            label: "iOS",
            title: "Инструкция для iOS",
            intro: "Установка V2RayTun из App Store, импорт ключа и включение VPN.",
            actions: [
                { text: "Скачать V2RayTun", href: "https://apps.apple.com/kz/app/v2raytun/id6476628951" }
            ],
            steps: [
                { media: "Ios/0.MP4", title: "Скачайте приложение", text: `скачайте <a href="https://apps.apple.com/kz/app/v2raytun/id6476628951">v2RayTun</a> из App Store.<br><br><b>Важно:</b> если приложение недоступно в РФ, смените регион App Store.`, actions: [{ text: "Сменить регион", href: "../ios-region/", primary: true }] },
                { media: "Ios/1.MP4", title: "Вставьте ключ", text: `зайдите в приложение и вставьте ключ из буфера обмена. предварительно скопируйте ключ подключения из личного кабинета.` },
                { media: "Ios/2.MP4", title: "Включите VPN", text: `далее нажмите на кнопку включения. VPN начнёт работать.` }
            ]
        },
        macos: {
            label: "macOS",
            title: "Инструкция для macOS",
            intro: "Установка V2RayTun из App Store и импорт ключа подключения.",
            actions: [
                { text: "Скачать V2RayTun", href: "https://apps.apple.com/kz/app/v2raytun/id6476628951" }
            ],
            steps: [
                { title: "Скачайте приложение", text: `скачайте <a href="https://apps.apple.com/kz/app/v2raytun/id6476628951">v2RayTun</a> из App Store.` },
                { title: "Вставьте ключ", text: `зайдите в приложение и вставьте ключ из буфера обмена. предварительно скопируйте ключ подключения из личного кабинета.` },
                { title: "Включите VPN", text: `далее нажмите на кнопку включения. VPN начнёт работать.` }
            ]
        },
        "ios-region": {
            label: "iOS region",
            title: "Смена региона App Store",
            intro: "Если V2RayTun недоступен в вашем App Store, смените регион на Казахстан.",
            actions: [
                { text: "Назад к iOS", href: "../ios/" }
            ],
            steps: [
                { media: "ChangeRegion/0.png", title: "Откройте профиль", text: `зайдите в <b>App Store</b> и нажмите на иконку профиля.` },
                { media: "ChangeRegion/1.png", title: "Откройте аккаунт", text: `перейдите в настройки аккаунта, нажав на ваше имя и почту.` },
                { media: "ChangeRegion/2.png", title: "Страна/регион", text: `нажмите на кнопку «страна/регион».` },
                { media: "ChangeRegion/3.png", title: "Выберите Казахстан", text: `в списке стран выберите страну Казахстан.` },
                { media: "ChangeRegion/4.png", title: "Заполните данные", text: `заполните данные, как показано на картинке, и нажмите Done.<br><br>Street - <b>Абая</b><br>City/Town - <b>Кокшетау</b><br>Region - <b>Aqmola</b><br>Postcode - <b>020000</b><br>Phone - <b>77011234567</b>` }
            ]
        }
    };

    const guideID = document.body.dataset.guide;
    const guide = guides[guideID];
    if (!guide) {
        return;
    }
    const keyStepMap = {
        windows: [3],
        android: [1],
        ios: [1],
        macos: [1]
    };
    let subscriptionKeyPromise = null;

    document.title = "neuravpn - " + guide.label;
    document.getElementById("guideTitle").textContent = guide.title;
    document.getElementById("guideIntro").textContent = guide.intro;

    const actions = document.getElementById("guideActions");
    guide.actions.forEach(function (action, index) {
        const a = document.createElement("a");
        a.className = index === 0 ? "btn btn-primary" : "btn btn-secondary";
        a.textContent = action.text;
        setupActionLink(a, action);
        actions.appendChild(a);
    });

    const steps = document.getElementById("guideSteps");
    guide.steps.forEach(function (step, index) {
        const article = document.createElement("article");
        article.className = "guide-step" + (step.media ? "" : " no-media");
        if (step.media) {
            const media = document.createElement("div");
            media.className = "step-media";
            media.appendChild(renderMedia(mediaBase + step.media));
            article.appendChild(media);
        }
        const content = document.createElement("div");
        content.className = "step-content";
        content.innerHTML = [
            '<div class="step-index">шаг ' + (index + 1) + '/' + guide.steps.length + '</div>',
            '<h2>' + step.title + '</h2>',
            '<p>' + step.text + '</p>'
        ].join("");
        if (step.actions && step.actions.length) {
            const stepActions = document.createElement("div");
            stepActions.className = "step-actions";
            step.actions.forEach(function (action) {
                const a = document.createElement("a");
                a.className = action.primary ? "btn btn-primary" : "btn btn-secondary";
                a.textContent = action.text;
                setupActionLink(a, action);
                stepActions.appendChild(a);
            });
            content.appendChild(stepActions);
        }
        if (shouldShowKeyBlock(guideID, index)) {
            content.appendChild(renderKeyCopyBlock());
        }
        article.appendChild(content);
        steps.appendChild(article);
    });
    startInstructionVideos();

    function renderMedia(src) {
        if (/\.mp4$/i.test(src)) {
            const video = document.createElement("video");
            const source = document.createElement("source");
            const heights = { "Android/0.MP4": 1140, "Android/1.MP4": 1684, "Android/2.MP4": 1570, "Ios/0.MP4": 1486, "Ios/1.MP4": 1662, "Ios/2.MP4": 1558, "Windows/0.MP4": 1718, "Windows/1.MP4": 1748 };
            video.width = 1920;
            video.height = heights[src.slice(mediaBase.length)] || 1080;
            video.className = "instruction-video";
            video.autoplay = false;
            video.loop = true;
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            video.playsInline = true;
            video.controls = false;
            video.disablePictureInPicture = true;
            video.preload = "none";
            video.setAttribute("loop", "loop");
            video.setAttribute("muted", "muted");
            video.setAttribute("playsinline", "playsinline");
            video.setAttribute("disablepictureinpicture", "disablepictureinpicture");
            video.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
            source.dataset.src = src + "?v=20260506-5";
            source.type = "video/mp4";
            video.appendChild(source);
            return video;
        }
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Шаг инструкции";
        img.decoding = "async";
        loadingLazy(img);
        return img;
    }

    function setupActionLink(a, action) {
        a.href = action.href;
        if (isMiniApp && isDownloadAction(action)) {
            a.addEventListener("click", function (event) {
                event.preventDefault();
                openExternal(action.href);
            });
            return;
        }
        if (action.download) {
            a.removeAttribute("target");
            a.removeAttribute("rel");
            return;
        }
        if (/^https?:\/\//.test(action.href)) {
            a.target = "_blank";
            a.rel = "noopener noreferrer";
        }
    }

    function isDownloadAction(action) {
        return String(action.text || "").toLowerCase().startsWith("скачать");
    }

    function openExternal(href) {
        const url = new URL(href, window.location.href).href;
        if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openLink === "function") {
            window.Telegram.WebApp.openLink(url, { try_instant_view: false });
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
    }

    function loadingLazy(img) {
        try {
            img.loading = "lazy";
        } catch (error) {}
    }

    function shouldShowKeyBlock(id, index) {
        return (keyStepMap[id] || []).indexOf(index) !== -1;
    }

    function renderKeyCopyBlock() {
        const box = document.createElement("div");
        box.className = "step-key-box";

        const input = document.createElement("input");
        input.className = "step-key-input";
        input.type = "text";
        input.readOnly = true;
        input.value = "загружаем ключ...";

        const button = document.createElement("button");
        button.className = "btn btn-primary step-key-copy";
        button.type = "button";
        button.textContent = "Скопировать ключ";
        button.disabled = true;

        box.appendChild(input);
        box.appendChild(button);

        getSubscriptionKey().then(function (key) {
            if (!key) {
                input.value = "ключ доступен после входа в кабинет";
                button.textContent = "Войти в кабинет";
                button.disabled = false;
                button.addEventListener("click", function () {
                    window.location.href = isMiniApp ? "../../cabinet/?mini_app=1" : "../../cabinet/";
                }, { once: true });
                return;
            }
            input.value = key;
            button.disabled = false;
            button.addEventListener("click", function () {
                copyValue(key, input).then(function () {
                    button.textContent = "Скопировано";
                    window.setTimeout(function () { button.textContent = "Скопировать ключ"; }, 1400);
                }).catch(function () {
                    button.textContent = "Не скопировано";
                    window.setTimeout(function () { button.textContent = "Скопировать ключ"; }, 1400);
                });
            });
        });

        return box;
    }

    function getSubscriptionKey() {
        if (!subscriptionKeyPromise) {
            subscriptionKeyPromise = fetch(apiBase() + "/api/me", {
                credentials: "include",
                headers: { "Accept": "application/json" }
            }).then(function (response) {
                if (!response.ok) {
                    return "";
                }
                return response.json();
            }).then(function (me) {
                return me && me.subscription_url ? String(me.subscription_url) : "";
            }).catch(function () {
                return "";
            });
        }
        return subscriptionKeyPromise;
    }

    function apiBase() {
        if (window.NEURAVPN_API_BASE) {
            return window.NEURAVPN_API_BASE;
        }
        if (window.location.port === "8085") {
            return window.location.protocol + "//" + window.location.hostname + ":8090";
        }
        return "";
    }

    function detectMiniApp() {
        const params = new URLSearchParams(window.location.search);
        return params.get("mini_app") === "1" || Boolean(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
    }

    async function copyValue(value, input) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
            return;
        }
        input.focus();
        input.select();
        if (!document.execCommand("copy")) {
            throw new Error("copy failed");
        }
        window.getSelection().removeAllRanges();
    }

    function startInstructionVideos() {
        const videos = document.querySelectorAll(".step-media video");
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        const visible = new Set();
        const manual = () => reduced.matches || navigator.connection?.saveData || !("IntersectionObserver" in window);
        function update(video) {
            video.controls = !!manual();
            if (document.hidden || !visible.has(video)) { video.pause(); return; }
            const source = video.querySelector("source");
            if (!source.hasAttribute("src")) {
                source.src = source.dataset.src;
                video.preload = manual() ? "metadata" : "auto";
                video.load();
            }
            if (manual()) return;
            const playing = video.play();
            if (playing?.catch) playing.catch(function () { video.controls = true; });
        }
        const observer = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting && entry.intersectionRatio >= 0.15) visible.add(entry.target);
                else visible.delete(entry.target);
                update(entry.target);
            });
        }, { threshold: [0, 0.15] }) : null;
        videos.forEach(function (video) {
            if (observer) observer.observe(video);
            else { visible.add(video); update(video); }
        });
        document.addEventListener("visibilitychange", function () { videos.forEach(update); });
        reduced.addEventListener?.("change", function () { videos.forEach(video => { video.pause(); update(video); }); });
        window.addEventListener("pagehide", function () { videos.forEach(video => video.pause()); });
        window.addEventListener("pageshow", function () { videos.forEach(update); });
    }
})();
