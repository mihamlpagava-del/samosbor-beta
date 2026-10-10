const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== СБОРКА АРХИВА ДЛЯ ЯНДЕКС ИГР ===\n');

const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUILD_DIR = path.join(ROOT_DIR, 'yandex-build');
const ZIP_OUTPUT = path.join(ROOT_DIR, 'samosbor-yandex-games.zip');

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Ошибка: Папка public не найдена!');
  process.exit(1);
}

// 1. Очистка и создание yandex-build
if (fs.existsSync(BUILD_DIR)) {
  console.log('1. Очистка старой директории yandex-build...');
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// 2. Копирование assets (без vk-bridge.min.js)
console.log('2. Копирование ресурсов assets...');
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    if (item === 'vk-bridge.min.js') continue; // не нужен в Яндекс Играх
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
copyDir(path.join(PUBLIC_DIR, 'assets'), path.join(BUILD_DIR, 'assets'));

// 3. Подготовка index.html для Яндекс Игр
console.log('3. Адаптация index.html для платформы Яндекс Игры...');
let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

// А. Замена VK Bridge на Yandex Games SDK в <head>
const vkHeadRegex = /<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge\/dist\/browser\.min\.js"><\/script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/;
const yaHeadSdk = `<!-- Яндекс Игры SDK v2 -->\n<script src="https://yandex.ru/games/sdk/v2"></script>`;
if (vkHeadRegex.test(html)) {
  html = html.replace(vkHeadRegex, yaHeadSdk);
} else {
  // запасной вариант замены
  html = html.replace(/<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge[\s\S]*?<\/script>/, yaHeadSdk);
}

// Б. Настройка подключения Socket.io к внешнему серверу игры
html = html.replace(
  /const socket = io\(\);/,
  `// Подключение к серверу игры (локально или удаленный прод)
const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? ''
  : 'https://195-19-219-215.sslip.io';
const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling']
});`
);

// В. Замена кнопки и модалки "Поддержать проект (VK)" на систему бонусов Яндекс Игр
html = html.replace(
  /<button id="btn-donate"[\s\S]*?<\/button>/,
  `<button id="btn-donate" class="support-btn" onclick="showYandexRewardDialog();" style="border-color: var(--term-warn); color: var(--term-warn); background: rgba(255,170,0,0.15);">
    🎁 БОНУС: +50 ТАЛОНОВ
  </button>`
);

// Г. Замена содержимого donate-modal
const donateModalRegex = /<div id="donate-modal" class="modal-overlay" style="z-index: 92;">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
const yaBonusModal = `<div id="donate-modal" class="modal-overlay" style="z-index: 92;">
  <div class="shop-panel" style="width: 580px; max-width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
    <div class="shop-header">
      <span style="color: var(--term-warn);">🎁 ГУМАНИТАРНОЕ СНАБЖЕНИЕ // ЯНДЕКС ИГРЫ</span>
      <button onclick="document.getElementById('donate-modal').style.display='none';">[X]</button>
    </div>
    <div style="font-size: 13px; color: #ccc; line-height: 1.6; margin-bottom: 16px; text-align: left;">
      Ресурсы в блоке на исходе. Вы можете запросить дополнительную партию талонов за просмотр короткого видеоролика от спонсоров:
    </div>
    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
      <button onclick="watchRewardAdForTalons();" style="padding: 12px; font-size: 14px; color: var(--term-warn); border-color: var(--term-warn); font-weight: bold; cursor: pointer; background: rgba(255,170,0,0.1);">
        🎬 ПОЛУЧИТЬ +50 ТАЛОНОВ (ПРОСМОТР РОЛИКА)
      </button>
      <button onclick="requestYandexReview();" style="padding: 10px; font-size: 13px; color: var(--term-info); border-color: var(--term-info); cursor: pointer; background: rgba(0,180,255,0.08);">
        ⭐ ОЦЕНИТЬ ИГРУ В КАТАЛОГЕ ЯНДЕКСА
      </button>
    </div>
    <div id="donate-status" style="font-size: 13px; min-height: 20px; text-align: center; color: var(--term-green);"></div>
    <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
      <button onclick="document.getElementById('donate-modal').style.display='none';" style="margin: 0; padding: 6px 14px; font-size: 12px; border-color: #555; color: #888;" data-i18n="btn_close">ЗАКРЫТЬ</button>
    </div>
  </div>
</div>`;

html = html.replace(donateModalRegex, yaBonusModal);

// Д. Замена кнопок в options-menu
html = html.replace(
  /<button id="btn-opt-donate"[\s\S]*?<button id="btn-vk-fav"[\s\S]*?<\/button>/,
  `<button id="btn-opt-donate" class="audio-btn opt-btn" style="color: var(--term-warn);" onclick="showYandexRewardDialog()">🎁 Бонус за рекламу (+50 талонов)</button>
  <button id="btn-ya-review" class="audio-btn opt-btn" style="color: var(--term-info);" onclick="requestYandexReview()">⭐ Оценить игру</button>`
);

// Е. Замена VK блока на экране входа (login-screen)
const vkLoginBoxRegex = /<!-- Панель входа через VK -->[\s\S]*?<\/div>\s*<\/div>/;
const yaLoginBox = `<!-- Панель входа через Яндекс Игры -->
    <div id="ya-login-box" style="margin-bottom: 18px; padding: 12px; border: 1px solid #ffcc00; background: rgba(255, 204, 0, 0.08); border-radius: 4px;">
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 10px;">
        <img id="ya-user-avatar" style="width: 36px; height: 36px; border-radius: 50%; border: 1px solid #ffcc00; display: none;" src="" alt="">
        <div style="font-size: 13px; color: #fff;">
          <span data-i18n="login_inmate_label">Заключенный:</span> <span id="ya-user-name" style="color: #ffcc00; font-weight: bold;">Игрок Яндекс</span>
        </div>
      </div>
      <button id="ya-login-btn" type="button" style="width: 100%; background: #fc3f1d; color: #fff; border: 1px solid #ff7253; font-size: 13px; padding: 9px; cursor: pointer; font-weight: bold; letter-spacing: 1px; font-family: inherit;">
        🟡 БЫСТРЫЙ ВХОД (ЯНДЕКС ID)
      </button>
    </div>`;

html = html.replace(vkLoginBoxRegex, yaLoginBox);

// Ж. Замена JS интеграции VK Bridge на Яндекс SDK методы
const vkJsRegex = /\/\/ ===== ИНТЕГРАЦИЯ VK\.COM & VK MINI APPS \(VK BRIDGE\) =====[\s\S]*?function donateVkVotes[\s\S]*?}\s*}/;
const yaJsCode = `// ===== ИНТЕГРАЦИЯ ЯНДЕКС ИГР (YANDEX GAMES SDK v2) =====
let ysdk = null;
let yaPlayer = null;

function initYandexSDK() {
  if (typeof YaGames === 'undefined') {
    console.log('[Yandex] YaGames SDK не обнаружен (запуск вне каталога Яндекса).');
    return;
  }
  YaGames.init().then(_ysdk => {
    ysdk = _ysdk;
    window.ysdk = _ysdk;
    console.log('[Yandex] SDK v2 успешно инициализирован');

    // Оповещаем каталог Яндекса о завершении загрузки игры
    if (ysdk.features && ysdk.features.LoadingAPI) {
      ysdk.features.LoadingAPI.ready();
    }

    // Инициализация игрока Яндекс
    initYandexPlayer();

    // Первый показ межстраничного баннера через небольшую паузу
    setTimeout(() => {
      showYandexFullscreenAdv();
    }, 1500);
  }).catch(err => {
    console.warn('[Yandex] Ошибка инициализации YaGames:', err);
  });
}

function initYandexPlayer() {
  if (!ysdk) return;
  ysdk.getPlayer({ scopes: false }).then(_player => {
    yaPlayer = _player;
    let pName = yaPlayer.getName() || ('Inmate_' + yaPlayer.getUniqueID().slice(-6));
    let pPhoto = yaPlayer.getPhoto('medium') || '';

    let yaBox = document.getElementById('ya-login-box');
    let yaName = document.getElementById('ya-user-name');
    let yaAvatar = document.getElementById('ya-user-avatar');
    if (yaBox) yaBox.style.display = 'block';
    if (yaName) yaName.innerText = pName;
    if (yaAvatar && pPhoto) {
      yaAvatar.src = pPhoto;
      yaAvatar.style.display = 'block';
    }

    let uInput = document.getElementById('username');
    let pInput = document.getElementById('password');
    if (uInput && !uInput.value) uInput.value = pName;
    if (pInput && !pInput.value) pInput.value = 'ya_' + yaPlayer.getUniqueID().slice(-8);
  }).catch(err => {
    console.log('[Yandex] Гостевой режим:', err);
    let uInput = document.getElementById('username');
    let pInput = document.getElementById('password');
    let guestId = localStorage.getItem('samosbor_ya_guest_id');
    if (!guestId) {
      guestId = 'Inmate_' + Math.floor(1000 + Math.random() * 9000);
      localStorage.setItem('samosbor_ya_guest_id', guestId);
    }
    if (uInput && !uInput.value) uInput.value = guestId;
    if (pInput && !pInput.value) pInput.value = 'guest_pass_7749';
  });
}

const yaLoginBtn = document.getElementById('ya-login-btn');
if (yaLoginBtn) {
  yaLoginBtn.onclick = () => {
    if (yaPlayer) {
      let uname = yaPlayer.getName() || ('Inmate_' + yaPlayer.getUniqueID().slice(-6));
      let upass = 'ya_' + yaPlayer.getUniqueID();
      socket.emit('login', { username: uname, password: upass });
    } else if (ysdk && ysdk.auth) {
      ysdk.auth.openAuthDialog().then(() => {
        initYandexPlayer();
      }).catch(() => {
        let u = document.getElementById('username').value || ('Inmate_' + Math.floor(1000 + Math.random()*9000));
        let p = document.getElementById('password').value || 'guest_pass_7749';
        socket.emit('login', { username: u, password: p });
      });
    } else {
      let u = document.getElementById('username').value || ('Inmate_' + Math.floor(1000 + Math.random()*9000));
      let p = document.getElementById('password').value || 'guest_pass_7749';
      socket.emit('login', { username: u, password: p });
    }
  };
}

// Межстраничная полноэкранная реклама
function showYandexFullscreenAdv(callback) {
  if (ysdk && ysdk.adv) {
    if (ysdk.features && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.stop();
    ysdk.adv.showFullscreenAdv({
      callbacks: {
        onClose: function(wasShown) {
          if (ysdk.features && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.start();
          if (callback) callback();
        },
        onError: function(err) {
          if (ysdk.features && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.start();
          if (callback) callback();
        }
      }
    });
  } else {
    if (callback) callback();
  }
}

// Вознаграждаемая реклама (Rewarded Video)
function showYandexRewardedAdv(onSuccess, onFail) {
  if (ysdk && ysdk.adv) {
    if (ysdk.features && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.stop();
    ysdk.adv.showRewardedVideo({
      callbacks: {
        onOpen: () => {},
        onRewarded: () => {
          if (onSuccess) onSuccess();
        },
        onClose: () => {
          if (ysdk.features && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.start();
        },
        onError: (err) => {
          if (ysdk.features && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.start();
          if (onFail) onFail(err);
        }
      }
    });
  } else {
    if (onFail) onFail('SDK не доступен');
  }
}

function showYandexRewardDialog() {
  const m = document.getElementById('donate-modal');
  if (m) m.style.display = 'flex';
}

function watchRewardAdForTalons() {
  const st = document.getElementById('donate-status');
  if (st) {
    st.style.color = 'var(--term-warn)';
    st.innerText = 'Запуск рекламного ролика...';
  }
  showYandexRewardedAdv(() => {
    socket.emit('rewardAdWatched');
    if (st) {
      st.style.color = 'var(--term-green)';
      st.innerText = 'УСПЕШНО! Начислено +50 талонов снабжения!';
    }
    playSound('buy');
  }, (err) => {
    if (st) {
      st.style.color = 'var(--term-danger)';
      st.innerText = 'Реклама временно недоступна или была прервана.';
    }
  });
}

function requestYandexReview() {
  if (ysdk && ysdk.feedback) {
    ysdk.feedback.canReview().then(({ value, reason }) => {
      if (value) {
        ysdk.feedback.requestReview().then(({ feedbackSent }) => {
          console.log('[Yandex] Запрос отзыва выполнен:', feedbackSent);
        });
      } else {
        console.log('[Yandex] Запрос отзыва отклонен SDK:', reason);
      }
    }).catch(e => console.log(e));
  }
}

// Инициализация
if (typeof YaGames !== 'undefined') {
  initYandexSDK();
} else {
  window.addEventListener('load', initYandexSDK);
}`;

html = html.replace(vkJsRegex, yaJsCode);

// Очистка упоминаний VK в текстах интерфейса
html = html.replace(/ВКонтакте/g, 'Яндекс Играх');
html = html.replace(/VK/g, 'Яндекс');

fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), html, 'utf8');
console.log('Готово: yandex-build/index.html создан.');

// 4. Упаковка в ZIP архив
console.log('4. Создание zip-архива samosbor-yandex-games.zip...');
if (fs.existsSync(ZIP_OUTPUT)) {
  fs.unlinkSync(ZIP_OUTPUT);
}

try {
  // Архивируем содержимое yandex-build так, чтобы index.html был прямо в корне архива
  execSync(`powershell -Command "Compress-Archive -Path '${BUILD_DIR}\\*' -DestinationPath '${ZIP_OUTPUT}' -CompressionLevel Optimal"`, {
    stdio: 'inherit'
  });
  const zipStat = fs.statSync(ZIP_OUTPUT);
  console.log(`\n УСПЕХ! Архив успешно создан:`);
  console.log(`- Файл: ${ZIP_OUTPUT}`);
  console.log(`- Размер архива: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`- index.html расположен в корне архива (требование Яндекс Игр).`);
} catch (err) {
  console.error('Ошибка при создании zip-архива:', err);
  process.exit(1);
}
