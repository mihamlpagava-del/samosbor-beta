const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

console.log('=== СБОРКА АРХИВА ДЛЯ NEWGROUNDS (HTML5 ZIP + NEWGROUNDS.IO SDK) ===\n');

const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUILD_DIR = path.join(ROOT_DIR, 'newgrounds-build');
const ZIP_OUTPUT = path.join(ROOT_DIR, 'samosbor-newgrounds.zip');

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Ошибка: Папка public не найдена!');
  process.exit(1);
}

// 1. Очистка и создание newgrounds-build
if (fs.existsSync(BUILD_DIR)) {
  console.log('1. Очистка старой директории newgrounds-build...');
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// 2. Оптимизация картинок PNG и копирование ресурсов
console.log('2. Оптимизация ассетов (сжатие для быстрой загрузки в браузере)...');
async function copyAndCompressAssets(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const item of fs.readdirSync(srcDir)) {
    if (item === 'vk-bridge.min.js') continue;
    if (item.endsWith('.apk') || item.endsWith('.jar')) continue;
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      await copyAndCompressAssets(srcPath, destPath);
    } else if (item.endsWith('.png')) {
      let pipeline = sharp(srcPath);
      if (srcDir.includes('icons')) {
        pipeline = pipeline.resize({ width: 96, height: 96, fit: 'inside', withoutEnlargement: true });
      } else if (srcDir.includes('locations')) {
        pipeline = pipeline.resize({ width: 768, withoutEnlargement: true });
      } else if (srcDir.includes('npc')) {
        pipeline = pipeline.resize({ width: 400, withoutEnlargement: true });
      } else if (srcDir.includes('monsters')) {
        pipeline = pipeline.resize({ width: 320, withoutEnlargement: true });
      } else {
        pipeline = pipeline.resize({ width: 200, withoutEnlargement: true });
      }
      const buf = await pipeline.png({ quality: 72, compressionLevel: 9, palette: true }).toBuffer();
      fs.writeFileSync(destPath, buf);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

(async () => {
  const t0 = Date.now();
  await copyAndCompressAssets(path.join(PUBLIC_DIR, 'assets'), path.join(BUILD_DIR, 'assets'));
  console.log(`- Ассеты скопированы и оптимизированы за ${((Date.now() - t0) / 1000).toFixed(1)} сек.`);

  // 3. Подготовка index.html для Newgrounds
  console.log('3. Адаптация index.html для платформы Newgrounds...');
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  // А. Язык страницы и заголовок
  html = html.replace(/<html lang="ru">/, '<html lang="en">');
  html = html.replace(/<title>ТЕРМИНАЛ: САМОСБОР<\/title>/, '<title>SAMOSBOR: Living Cell 7749</title>');

  // Б. Удаление Pikabu SDK и VK Bridge SDK из <head>, подключение Newgrounds.io SDK
  html = html.replace(/<!-- Pikabu Games SDK -->\s*<script async src="https:\/\/games\.pikabu\.ru\/sdk\/sdk\.js"[\s\S]*?<\/script>/g, '');
  html = html.replace(/<script async src="https:\/\/games\.pikabu\.ru\/sdk\/sdk\.js"[\s\S]*?<\/script>/g, '');

  const vkHeadRegex = /<!-- VK Bridge SDK[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/;
  const ngHeadMeta = `<!-- Newgrounds HTML5 & Official Newgrounds.io SDK -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<script src="assets/newgroundsio.min.js"></script>`;
  if (vkHeadRegex.test(html)) {
    html = html.replace(vkHeadRegex, ngHeadMeta);
  } else {
    html = html.replace(/<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge[\s\S]*?<\/script>/, ngHeadMeta);
  }

  // В. Замена внешней ссылки на шрифты Google на надежные локальные моноширинные
  html = html.replace(
    /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=PT\+Mono&display=swap" rel="stylesheet">/,
    '<!-- Локальные системные шрифты (PT Mono / Consolas / monospace) -->'
  );

  // Г. Удаление внешнего CDN fallback для socket.io (локальный файл уже в assets/socket.io.min.js)
  html = html.replace(
    /<script>\s*if\s*\(typeof io === 'undefined'\)\s*\{[\s\S]*?\}\s*<\/script>/,
    '<!-- Socket.io загружен локально из assets/socket.io.min.js -->'
  );

  // Д. Настройка подключения Socket.io к защищенному HTTPS/WSS серверу игры
  if (/const socket = io\(\);/.test(html)) {
    html = html.replace(
      /const socket = io\(\);/,
      `// Подключение к серверу игры по защищенному WSS/HTTPS
const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? ''
  : 'https://195-19-219-215.sslip.io';
const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling']
});`
    );
  }

  // Е. Английский язык по умолчанию для международной аудитории Newgrounds
  html = html.replace(
    /let currentLang = localStorage\.getItem\('samosbor_lang'\) \|\| 'ru';/,
    `let currentLang = localStorage.getItem('samosbor_ng_lang') || 'en';`
  );
  html = html.replace(
    /localStorage\.setItem\('samosbor_lang', currentLang\);/g,
    `localStorage.setItem('samosbor_ng_lang', currentLang);`
  );

  // Ж. Кнопки в support-controls: переключатель языка, полноэкранный режим и Newgrounds инфо
  html = html.replace(
    /<button id="btn-donate"[\s\S]*?<\/button>/,
    `<button id="btn-fullscreen-toggle" class="support-btn" onclick="toggleNgFullscreen();" style="border-color: var(--term-info); color: var(--term-info); background: rgba(0,180,255,0.12);">
      ⛶ FULLSCREEN
    </button>
    <button id="btn-donate" class="support-btn" onclick="document.getElementById('donate-modal').style.display='flex';" style="border-color: #ff8c00; color: #ff8c00; background: rgba(255,140,0,0.12);">
      💀 NEWGROUNDS
    </button>`
  );

  // З. Модальное окно сообщества Newgrounds
  const donateModalRegex = /<div id="donate-modal" class="modal-overlay" style="z-index: 92;">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
  const ngInfoModal = `<div id="donate-modal" class="modal-overlay" style="z-index: 92;">
    <div class="shop-panel" style="width: 600px; max-width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
      <div class="shop-header">
        <span style="color: #ff8c00;">💀 COMMUNITY // NEWGROUNDS</span>
        <button onclick="document.getElementById('donate-modal').style.display='none';">[X]</button>
      </div>
      <div style="font-size: 13px; color: #ccc; line-height: 1.6; margin-bottom: 16px; text-align: left;">
        Welcome to the Soviet Gigastructure post-apocalyptic block: <b>SAMOSBOR</b>.<br><br>
        Survive the anomalies, explore contaminated floors, fight horrific aberrations, upgrade your gear, and trade with fellow inmates!<br><br>
        <b>Support the developer on Newgrounds:</b><br>
        • Vote 5 stars on this project page<br>
        • Leave a review or feedback with ideas and bug reports<br>
        • Share with your friends
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
        <button type="button" onclick="toggleNgFullscreen();" style="padding: 10px; font-size: 13px; color: var(--term-info); border-color: var(--term-info); cursor: pointer; background: rgba(0,180,255,0.08);">
          ⛶ TOGGLE FULLSCREEN
        </button>
      </div>
      <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
        <button onclick="document.getElementById('donate-modal').style.display='none';" style="margin: 0; padding: 6px 14px; font-size: 12px; border-color: #555; color: #888;" data-i18n="btn_close">CLOSE</button>
      </div>
    </div>
  </div>`;
  html = html.replace(donateModalRegex, ngInfoModal);

  // И. Замена кнопок опций в options-menu
  html = html.replace(
    /<button id="btn-opt-donate"[\s\S]*?<button id="btn-vk-fav"[\s\S]*?<\/button>/,
    `<button id="btn-opt-fs" class="audio-btn opt-btn" style="color: var(--term-info);" onclick="toggleNgFullscreen()">⛶ Fullscreen / Полноэкранный режим</button>
    <button id="btn-opt-donate" class="audio-btn opt-btn" style="color: #ff8c00;" onclick="document.getElementById('donate-modal').style.display='flex'">💀 Newgrounds Info</button>`
  );

  // К. Панель быстрого входа на экране login-screen (Quick Play для Newgrounds)
  const loginPanelsRegex = /<!-- Панель входа через VK -->[\s\S]*?(?=<div id="login-divider")/i;
  const ngLoginBox = `<!-- Панель быстрого входа для Newgrounds -->
      <div id="ng-login-box" style="margin-bottom: 18px; padding: 14px; border: 1px solid var(--term-warn); background: rgba(255, 170, 0, 0.08); border-radius: 4px;">
        <div style="font-size: 12px; color: #aaa; margin-bottom: 8px;">
          Instant Play (Guest mode, no registration required):
        </div>
        <button id="ng-quick-btn" type="button" onclick="quickStartNewgrounds();" style="width: 100%; background: var(--term-warn); color: #000; border: 1px solid var(--term-warn); font-size: 13px; padding: 10px; cursor: pointer; font-weight: bold; letter-spacing: 1px; font-family: inherit;">
          ⚡ QUICK PLAY / ИГРАТЬ БЕЗ РЕГИСТРАЦИИ
        </button>
      </div>\n\n    `;
  html = html.replace(loginPanelsRegex, ngLoginBox);
  html = html.replace(/<button id="btn-pkb-rewarded"[\s\S]*?<\/button>/g, '');

  // Включаем показ разделителя перед ручным вводом пароля
  html = html.replace(
    /<div id="login-divider" style="display:\s*none;/,
    '<div id="login-divider" style="display: block;'
  );

  // Л. Замена всей платформенной логики (VK & Pikabu) на интеграцию Newgrounds
  const platformJsRegex = /\/\/ ===== ПЛАТФОРМЕННАЯ ИНТЕГРАЦИЯ: PIKABU GAMES & VKONTAKTE =====[\s\S]*?(?=\s*let isVideoPlaying = false;)/;
  const ngJsCode = `// ===== ИНТЕГРАЦИЯ NEWGROUNDS & ВЕБ-ПЛАТФОРМ =====
let isPikabuEnvironment = false;
let isVkEnvironment = false;
let vkUserData = null;
let pkbSdk = null;
window.notifyPikabuGameStarted = function() {};

window.ngio = null;

function initNewgroundsSDK(appId, aesKey) {
  if (typeof Newgrounds === 'undefined' || !Newgrounds.io) return;
  if (!appId) {
    console.log('[Newgrounds.io] SDK готов к подключению (ожидает App ID)');
    return;
  }
  try {
    window.ngio = new Newgrounds.io.core(appId, aesKey || "");
    window.ngio.getValidSession(function() {
      if (window.ngio.user) {
        console.log('[Newgrounds.io] Пользователь подключен:', window.ngio.user.name);
        let uInput = document.getElementById('username');
        if (uInput && !uInput.value) uInput.value = window.ngio.user.name;
      }
    });
  } catch(e) {
    console.warn('[Newgrounds.io] Ошибка инициализации:', e);
  }
}

function quickStartNewgrounds() {
  let uInput = document.getElementById('username');
  let pInput = document.getElementById('password');
  let err = document.getElementById('auth-error');
  let guestId = localStorage.getItem('samosbor_ng_user');
  if (!guestId) {
    guestId = 'Inmate_' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('samosbor_ng_user', guestId);
  }
  let u = (uInput && uInput.value.trim()) ? uInput.value.trim() : guestId;
  let p = (pInput && pInput.value.trim()) ? pInput.value.trim() : 'ng_pass_7749';
  if (uInput) uInput.value = u;
  if (pInput) pInput.value = p;
  if (err) err.innerHTML = '<span style="color:var(--term-warn);">' + (currentLang === 'en' ? 'Authenticating...' : 'Авторизация...') + '</span>';
  saveAuthSession({ type: 'manual', data: { username: u, password: p } });
  
  if (!socket || !socket.connected) {
    if (err) err.innerHTML = '<span style="color:var(--term-warn);">' + (currentLang === 'en' ? 'Connecting to server...' : 'Подключение к серверу...') + '</span>';
    socket.once('connect', () => {
      if (err) err.innerHTML = '<span style="color:var(--term-warn);">' + (currentLang === 'en' ? 'Authenticating...' : 'Авторизация...') + '</span>';
      socket.emit('login', { username: u, password: p });
    });
    return;
  }
  socket.emit('login', { username: u, password: p });
}

function toggleNgFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.log('[Newgrounds] Fullscreen error:', err);
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
  let guestId = localStorage.getItem('samosbor_ng_user');
  if (guestId) {
    if (uInput && !uInput.value) uInput.value = guestId;
    if (pInput && !pInput.value) pInput.value = 'ng_pass_7749';
  }
  initNewgroundsSDK();
});
`;

  html = html.replace(platformJsRegex, ngJsCode);

  // М. Устранение вызовов Pikabu функций
  html = html.replace(/if\s*\(\s*typeof notifyPikabuGameStarted === 'function'\s*\)\s*notifyPikabuGameStarted\(\);?/g, '');
  html = html.replace(/notifyPikabuGameStarted\(\);?/g, '');

  // Н. Очистка упоминаний VK в текстах интерфейса
  html = html.replace(/ВКонтакте/g, 'Newgrounds');
  html = html.replace(/VK/g, 'Newgrounds');
  html = html.replace(/https:\/\/unpkg\.com\/[^\s"']+/g, '');

  fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), html, 'utf8');
  console.log('Готово: newgrounds-build/index.html создан.');

  // 4. Упаковка в ZIP архив
  console.log('4. Создание zip-архива samosbor-newgrounds.zip с POSIX путями...');
  if (fs.existsSync(ZIP_OUTPUT)) {
    fs.unlinkSync(ZIP_OUTPUT);
  }

  try {
    execSync(`tar.exe -a -c -f "${ZIP_OUTPUT}" -C "${BUILD_DIR}" index.html assets`, {
      stdio: 'inherit'
    });
    const zipStat = fs.statSync(ZIP_OUTPUT);
    console.log(`\n🎉 УСПЕХ! Архив для Newgrounds успешно создан:`);
    console.log(`- Файл: ${ZIP_OUTPUT}`);
    console.log(`- Размер архива: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`- index.html и папка assets/ упакованы в корень с правильными Unix-путями (assets/...).`);
    console.log(`- Официальный Newgrounds.io SDK (newgroundsio.min.js) включен локально в assets/.`);
  } catch (err) {
    console.error('Ошибка при создании zip-архива:', err);
    process.exit(1);
  }
})();
