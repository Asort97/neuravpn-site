(function () {
    const mediaBase = "../../assets/instructions/";
    const guides = {
        windows: {
            label: "Windows",
            title: "Инструкция для Windows",
            intro: "Установка клиента NeuraVPN, импорт ключа и запуск подключения.",
            actions: [
                { text: "Скачать Windows", href: "../../" }
            ],
            steps: [
                { media: "Windows/neuravpn_app/0.png", title: "Скачайте клиент", text: `скачайте последнюю версию neuravpn с сайта, нажав кнопку «скачать для windows».` },
                { title: "Распакуйте архив", text: `после завершения загрузки выполните следующие действия:<br><br>1) найдите загруженный файл <b>neuravpn_windows_vX.X.X</b>.<br>2) щелкните правой кнопкой мыши на файле и выберите «извлечь все».` },
                { title: "Запустите от администратора", text: `откройте папку с распакованными файлами. найдите файл <b>neuravpn.exe</b>. щелкните по нему правой кнопкой мыши и запустите от имени администратора.` },
                { media: "Windows/0.MP4", title: "Импортируйте ключ", text: `предварительно скопировав ключ доступа, в программе нажмите на кнопку «вставить из буфера». Если ключ открыт в кабинете, можно использовать авто-импорт.` },
                { media: "Windows/1.MP4", title: "Подключитесь", text: `подключитесь к VPN, нажав по большой кнопке в центре.` }
            ]
        },
        android: {
            label: "Android",
            title: "Инструкция для Android",
            intro: "Установка V2RayTun из Google Play, импорт ключа и включение VPN.",
            actions: [
                { text: "Скачать V2RayTun", href: "https://play.google.com/store/apps/details?id=com.v2raytun.android&hl=ru" }
            ],
            steps: [
                { media: "Android/0.MP4", title: "Скачайте приложение", text: `скачайте <a href="https://play.google.com/store/apps/details?id=com.v2raytun.android&hl=ru">v2RayTun</a> из Google Play.` },
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
                { media: "Ios/0.MP4", title: "Скачайте приложение", text: `скачайте <a href="https://apps.apple.com/kz/app/v2raytun/id6476628951">v2RayTun</a> из App Store.<br><br><b>Важно:</b> если приложение недоступно в РФ, смените регион App Store.`, actions: [{ text: "Сменить регион", href: "../ios-region/" }] },
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
                { text: "Назад к iOS", href: "../ios/" },
                { text: "App Store", href: "https://apps.apple.com/kz/app/v2raytun/id6476628951" }
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

    document.title = "neuravpn - " + guide.label;
    document.getElementById("guideTitle").textContent = guide.title;
    document.getElementById("guideIntro").textContent = guide.intro;

    const actions = document.getElementById("guideActions");
    guide.actions.forEach(function (action, index) {
        const a = document.createElement("a");
        a.className = index === 0 ? "btn btn-primary" : "btn btn-secondary";
        a.href = action.href;
        a.textContent = action.text;
        if (/^https?:\/\//.test(action.href)) {
            a.target = "_blank";
            a.rel = "noopener noreferrer";
        }
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
                a.className = "btn btn-secondary";
                a.href = action.href;
                a.textContent = action.text;
                if (/^https?:\/\//.test(action.href)) {
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                }
                stepActions.appendChild(a);
            });
            content.appendChild(stepActions);
        }
        article.appendChild(content);
        steps.appendChild(article);
    });
    startInstructionVideos();

    function renderMedia(src) {
        if (/\.mp4$/i.test(src)) {
            const video = document.createElement("video");
            const source = document.createElement("source");
            video.className = "instruction-video";
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            video.playsInline = true;
            video.controls = false;
            video.disablePictureInPicture = true;
            video.preload = "auto";
            video.setAttribute("autoplay", "autoplay");
            video.setAttribute("loop", "loop");
            video.setAttribute("muted", "muted");
            video.setAttribute("playsinline", "playsinline");
            video.setAttribute("disablepictureinpicture", "disablepictureinpicture");
            video.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
            source.src = src + "?v=20260506-5";
            source.type = "video/mp4";
            video.appendChild(source);
            video.load();
            video.addEventListener("loadeddata", function () { playVideo(video); }, { once: true });
            video.addEventListener("canplay", function () { playVideo(video); }, { once: true });
            video.addEventListener("pause", function () {
                if (!video.ended && document.visibilityState === "visible") {
                    window.setTimeout(function () { playVideo(video); }, 120);
                }
            });
            return video;
        }
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Шаг инструкции";
        loadingLazy(img);
        return img;
    }

    function loadingLazy(img) {
        try {
            img.loading = "lazy";
        } catch (error) {}
    }

    function startInstructionVideos() {
        const videos = document.querySelectorAll(".step-media video");
        videos.forEach(function (video) {
            playVideo(video);
        });
        bindVideoViewportAutoplay(videos);
        retryVideoAutoplay(videos);
        window.addEventListener("load", function () { retryVideoAutoplay(videos); }, { once: true });
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "visible") {
                retryVideoAutoplay(videos);
            }
        });
    }

    function playVideo(video) {
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
        video.controls = false;
        if (video.readyState < 2) {
            try {
                video.load();
            } catch (error) {}
        }
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(function () {});
        }
    }

    function bindVideoViewportAutoplay(videos) {
        if (!("IntersectionObserver" in window)) {
            return;
        }
        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    playVideo(entry.target);
                }
            });
        }, { threshold: 0.15 });
        videos.forEach(function (video) {
            observer.observe(video);
        });
    }

    function retryVideoAutoplay(videos) {
        let attempts = 0;
        const timer = window.setInterval(function () {
            attempts += 1;
            videos.forEach(function (video) {
                if (video.paused || video.readyState < 2) {
                    playVideo(video);
                }
            });
            if (attempts >= 8) {
                window.clearInterval(timer);
            }
        }, 450);
    }
})();
