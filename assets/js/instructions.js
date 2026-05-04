(function () {
    const mediaBase = "../../assets/instructions/";
    const guides = {
        windows: {
            label: "Windows",
            eyebrow: "[WINDOWS] NEURAVPN CLIENT",
            title: "Инструкция для Windows",
            intro: "Установка клиента NeuraVPN, импорт ключа и запуск подключения.",
            actions: [
                { text: "Скачать Windows", href: "../../" },
                { text: "Личный кабинет", href: "../../cabinet/" }
            ],
            steps: [
                { media: "Windows/neuravpn_app/0.png", title: "Скачайте клиент", text: `скачайте последнюю версию neuravpn с сайта, нажав кнопку «скачать для windows».` },
                { title: "Распакуйте архив", text: `после завершения загрузки выполните следующие действия:<br><br>1) найдите загруженный файл <code>neuravpn_windows_vX.X.X</code>.<br>2) щелкните правой кнопкой мыши на файле и выберите «извлечь все».` },
                { title: "Запустите от администратора", text: `откройте папку с распакованными файлами. найдите файл <code>neuravpn.exe</code>. щелкните по нему правой кнопкой мыши и запустите от имени администратора.` },
                { media: "Windows/0.MP4", title: "Импортируйте ключ", text: `предварительно скопировав ключ доступа, в программе нажмите на кнопку «вставить из буфера». Если ключ открыт в кабинете, можно использовать авто-импорт.` },
                { media: "Windows/1.MP4", title: "Подключитесь", text: `подключитесь к VPN, нажав по большой кнопке в центре.` }
            ]
        },
        android: {
            label: "Android",
            eyebrow: "[ANDROID] V2RAYTUN",
            title: "Инструкция для Android",
            intro: "Установка V2RayTun из Google Play, импорт ключа и включение VPN.",
            actions: [
                { text: "Скачать V2RayTun", href: "https://play.google.com/store/apps/details?id=com.v2raytun.android&hl=ru" },
                { text: "Личный кабинет", href: "../../cabinet/" }
            ],
            steps: [
                { media: "Android/0.MP4", title: "Скачайте приложение", text: `скачайте <a href="https://play.google.com/store/apps/details?id=com.v2raytun.android&hl=ru">v2RayTun</a> из Google Play.` },
                { media: "Android/1.MP4", title: "Вставьте ключ", text: `зайдите в приложение и вставьте ключ из буфера обмена. предварительно скопируйте ключ подключения из личного кабинета.` },
                { media: "Android/2.MP4", title: "Включите VPN", text: `далее нажмите на кнопку включения. VPN начнёт работать.` }
            ]
        },
        ios: {
            label: "iOS",
            eyebrow: "[IOS] V2RAYTUN",
            title: "Инструкция для iOS",
            intro: "Установка V2RayTun из App Store, импорт ключа и включение VPN.",
            actions: [
                { text: "Скачать V2RayTun", href: "https://apps.apple.com/kz/app/v2raytun/id6476628951" },
                { text: "Сменить регион", href: "../ios-region/" },
                { text: "Личный кабинет", href: "../../cabinet/" }
            ],
            steps: [
                { media: "Ios/0.MP4", title: "Скачайте приложение", text: `скачайте <a href="https://apps.apple.com/kz/app/v2raytun/id6476628951">v2RayTun</a> из App Store.<br><br><b>Важно:</b> если приложение недоступно в РФ, смените регион App Store.` },
                { media: "Ios/1.MP4", title: "Вставьте ключ", text: `зайдите в приложение и вставьте ключ из буфера обмена. предварительно скопируйте ключ подключения из личного кабинета.` },
                { media: "Ios/2.MP4", title: "Включите VPN", text: `далее нажмите на кнопку включения. VPN начнёт работать.` }
            ]
        },
        macos: {
            label: "macOS",
            eyebrow: "[MACOS] V2RAYTUN",
            title: "Инструкция для macOS",
            intro: "Установка V2RayTun из App Store и импорт ключа подключения.",
            actions: [
                { text: "Скачать V2RayTun", href: "https://apps.apple.com/kz/app/v2raytun/id6476628951" },
                { text: "Личный кабинет", href: "../../cabinet/" }
            ],
            steps: [
                { title: "Скачайте приложение", text: `скачайте <a href="https://apps.apple.com/kz/app/v2raytun/id6476628951">v2RayTun</a> из App Store.` },
                { title: "Вставьте ключ", text: `зайдите в приложение и вставьте ключ из буфера обмена. предварительно скопируйте ключ подключения из личного кабинета.` },
                { title: "Включите VPN", text: `далее нажмите на кнопку включения. VPN начнёт работать.` }
            ]
        },
        "ios-region": {
            label: "iOS region",
            eyebrow: "[IOS] APP STORE REGION",
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
                { media: "ChangeRegion/4.png", title: "Заполните данные", text: `заполните данные, как показано на картинке, и нажмите Done.<br><br>Street - <code>Абая</code><br>City/Town - <code>Кокшетау</code><br>Region - <code>Aqmola</code><br>Postcode - <code>020000</code><br>Phone - <code>77011234567</code>` }
            ]
        }
    };

    const guideID = document.body.dataset.guide;
    const guide = guides[guideID];
    if (!guide) {
        return;
    }

    document.title = "neuravpn - " + guide.label;
    document.getElementById("guideEyebrow").textContent = guide.eyebrow;
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
        article.appendChild(content);
        steps.appendChild(article);
    });

    function renderMedia(src) {
        if (/\.mp4$/i.test(src)) {
            const video = document.createElement("video");
            video.src = src;
            video.controls = true;
            video.playsInline = true;
            video.preload = "metadata";
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
})();
