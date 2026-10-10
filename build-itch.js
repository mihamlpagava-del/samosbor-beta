const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== СБОРКА АРХИВА ДЛЯ ITCH.IO ===\n');

const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUILD_DIR = path.join(ROOT_DIR, 'itch-build');
const ZIP_OUTPUT = path.join(ROOT_DIR, 'samosbor-itch-io.zip');

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Ошибка: Папка public не найдена!');
  process.exit(1);
}

// 1. Очистка и создание itch-build
if (fs.existsSync(BUILD_DIR)) {
  console.log('1. Очистка старой директории itch-build...');
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// 2. Копирование assets (без vk-bridge.min.js и без лишних бинарников)
console.log('2. Копирование ресурсов assets...');
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    if (item === 'vk-bridge.min.js') continue;
    if (item.endsWith('.apk') || item.endsWith('.jar')) continue;
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

// 3. Подготовка index.html для Itch.io
console.log('3. Адаптация index.html для платформы Itch.io...');
let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

// А. Удаление VK Bridge из <head>
const vkHeadRegex = /<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge\/dist\/browser\.min\.js"><\/script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/;
const itchHeadMeta = `<!-- Itch.io HTML5 Build -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`;
if (vkHeadRegex.test(html)) {
  html = html.replace(vkHeadRegex, itchHeadMeta);
} else {
  html = html.replace(/<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge[\s\S]*?<\/script>/, itchHeadMeta);
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

// В. Кнопки в support-controls: переключатель языка, фуллскрин, о проекте
html = html.replace(
  /<button id="btn-donate"[\s\S]*?<\/button>/,
  `<button id="btn-fullscreen-toggle" class="support-btn" onclick="toggleItchFullscreen();" style="border-color: var(--term-info); color: var(--term-info); background: rgba(0,180,255,0.12);">
    ⛶ FULLSCREEN
  </button>
  <button id="btn-donate" class="support-btn" onclick="document.getElementById('donate-modal').style.display='flex';" style="border-color: var(--term-warn); color: var(--term-warn); background: rgba(255,170,0,0.12);">
    ⭐ ITCH.IO
  </button>`
);

// Г. Модалка о проекте и поддержке на Itch.io
const donateModalRegex = /<div id="donate-modal" class="modal-overlay" style="z-index: 92;">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
const itchInfoModal = `<div id="donate-modal" class="modal-overlay" style="z-index: 92;">
  <div class="shop-panel" style="width: 600px; max-width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
    <div class="shop-header">
      <span style="color: var(--term-warn);">⭐ СООБЩЕСТВО // ITCH.IO</span>
      <button onclick="document.getElementById('donate-modal').style.display='none';">[X]</button>
    </div>
    <div style="font-size: 13px; color: #ccc; line-height: 1.6; margin-bottom: 16px; text-align: left;">
      Спасибо за интерес к миру Гигахрущевки и выживанию в блоке «САМОСБОР»!<br><br>
      Игра развивается благодаря отзывам игроков. Вы можете поддержать проект:<br>
      • Поставить оценку (5 звёзд) на странице Itch.io<br>
      • Написать комментарий с отзывом или идеей для квестов<br>
      • Поделиться ссылкой с друзьями
    </div>
    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
      <button type="button" onclick="toggleItchFullscreen();" style="padding: 10px; font-size: 13px; color: var(--term-info); border-color: var(--term-info); cursor: pointer; background: rgba(0,180,255,0.08);">
        ⛶ ПОЛНОЭКРАННЫЙ РЕЖИМ (FULLSCREEN)
      </button>
    </div>
    <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
      <button onclick="document.getElementById('donate-modal').style.display='none';" style="margin: 0; padding: 6px 14px; font-size: 12px; border-color: #555; color: #888;" data-i18n="btn_close">ЗАКРЫТЬ</button>
    </div>
  </div>
</div>`;
html = html.replace(donateModalRegex, itchInfoModal);

// Д. Замена кнопок опций в options-menu
html = html.replace(
  /<button id="btn-opt-donate"[\s\S]*?<button id="btn-vk-fav"[\s\S]*?<\/button>/,
  `<button id="btn-opt-fs" class="audio-btn opt-btn" style="color: var(--term-info);" onclick="toggleItchFullscreen()">⛶ Полноэкранный режим (Fullscreen)</button>
  <button id="btn-opt-donate" class="audio-btn opt-btn" style="color: var(--term-warn);" onclick="document.getElementById('donate-modal').style.display='flex'">⭐ О проекте на Itch.io</button>`
);

// Е. Панель быстрого входа на экране login-screen
const vkLoginBoxRegex = /<!-- Панель входа через VK -->[\s\S]*?<\/div>\s*<\/div>/;
const itchLoginBox = `<!-- Панель быстрого входа для Itch.io -->
    <div id="itch-login-box" style="margin-bottom: 18px; padding: 14px; border: 1px solid var(--term-warn); background: rgba(255, 170, 0, 0.08); border-radius: 4px;">
      <div style="font-size: 12px; color: #aaa; margin-bottom: 8px;">
        Вход без обязательной регистрации (быстрый старт):
      </div>
      <button id="itch-quick-btn" type="button" onclick="quickStartItch();" style="width: 100%; background: var(--term-warn); color: #000; border: 1px solid var(--term-warn); font-size: 13px; padding: 10px; cursor: pointer; font-weight: bold; letter-spacing: 1px; font-family: inherit;">
        ⚡ БЫСТРЫЙ ВХОД / QUICK PLAY
      </button>
    </div>`;
html = html.replace(vkLoginBoxRegex, itchLoginBox);

// Включаем показ разделителя перед ручным вводом пароля
html = html.replace(
  /<div id="login-divider" style="display: none;/,
  '<div id="login-divider" style="display: block;'
);

// Ж. Замена VK Bridge JS на интеграцию Itch.io
const vkJsRegex = /\/\/ ===== ИНТЕГРАЦИЯ VK\.COM & VK MINI APPS \(VK BRIDGE\) =====[\s\S]*?(?=\s*function startBootSequence)/;
const itchJsCode = `// ===== ИНТЕГРАЦИЯ ITCH.IO & ВЕБ-ПЛАТФОРМ =====
function quickStartItch() {
  let uInput = document.getElementById('username');
  let pInput = document.getElementById('password');
  let err = document.getElementById('auth-error');
  let guestId = localStorage.getItem('samosbor_itch_user');
  if (!guestId) {
    guestId = 'Inmate_' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('samosbor_itch_user', guestId);
  }
  let u = (uInput && uInput.value.trim()) ? uInput.value.trim() : guestId;
  let p = (pInput && pInput.value.trim()) ? pInput.value.trim() : 'itch_pass_7749';
  if (uInput && !uInput.value) uInput.value = u;
  if (pInput && !pInput.value) pInput.value = p;
  if (err) err.innerHTML = '<span style="color:var(--term-warn);">Авторизация...</span>';
  socket.emit('login', { username: u, password: p });
}

function toggleItchFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.log('[Itch] Fullscreen error:', err);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

window.addEventListener('load', () => {
  let uInput = document.getElementById('username');
  let pInput = document.getElementById('password');
  let guestId = localStorage.getItem('samosbor_itch_user');
  if (guestId) {
    if (uInput && !uInput.value) uInput.value = guestId;
    if (pInput && !pInput.value) pInput.value = 'itch_pass_7749';
  }
});
`;

html = html.replace(vkJsRegex, itchJsCode);

// Очистка упоминаний VK в текстах интерфейса
html = html.replace(/ВКонтакте/g, 'Itch.io');
html = html.replace(/VK/g, 'Itch.io');

fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), html, 'utf8');
console.log('Готово: itch-build/index.html создан.');

// 4. Упаковка в ZIP архив
console.log('4. Создание zip-архива samosbor-itch-io.zip...');
if (fs.existsSync(ZIP_OUTPUT)) {
  fs.unlinkSync(ZIP_OUTPUT);
}

try {
  // Архивируем содержимое itch-build так, чтобы index.html был прямо в корне архива
  execSync(`powershell -Command "Compress-Archive -Path '${BUILD_DIR}\\*' -DestinationPath '${ZIP_OUTPUT}' -CompressionLevel Optimal"`, {
    stdio: 'inherit'
  });
  const zipStat = fs.statSync(ZIP_OUTPUT);
  console.log(`\n🎉 УСПЕХ! Архив для Itch.io успешно создан:`);
  console.log(`- Файл: ${ZIP_OUTPUT}`);
  console.log(`- Размер архива: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`- index.html расположен в корне архива (требование Itch.io).`);
} catch (err) {
  console.error('Ошибка при создании zip-архива:', err);
  process.exit(1);
}
