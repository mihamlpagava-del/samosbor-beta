const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const vm = require('vm');
const { execSync } = require('child_process');

console.log('=== СБОРКА АРХИВА ДЛЯ GAME JOLT (HTML5 ZIP + GAME JOLT API JS SDK) ===\n');

const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUILD_DIR = path.join(ROOT_DIR, 'gamejolt-build');
const ZIP_OUTPUT = path.join(ROOT_DIR, 'samosbor-gamejolt.zip');
const DESKTOP_OUTPUT = path.join('C:', 'Users', 'Bachi', 'Desktop', 'samosbor-gamejolt.zip');

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Ошибка: Папка public не найдена!');
  process.exit(1);
}

// 1. Очистка и создание gamejolt-build
if (fs.existsSync(BUILD_DIR)) {
  console.log('1. Очистка старой директории gamejolt-build...');
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

  // 3. Подготовка index.html для Game Jolt
  console.log('3. Адаптация index.html для платформы Game Jolt...');
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  // А. Язык страницы и заголовок
  html = html.replace(/<html lang="ru">/, '<html lang="en">');
  html = html.replace(/<title>ТЕРМИНАЛ: САМОСБОР<\/title>/, '<title>SAMOSBOR: Living Cell 7749 (Game Jolt)</title>');

  // Б. Подключение официального Game Jolt API JS SDK в <head>
  html = html.replace(/<!-- Pikabu Games SDK -->\s*<script async src="https:\/\/games\.pikabu\.ru\/sdk\/sdk\.js"[\s\S]*?<\/script>/g, '');
  html = html.replace(/<script async src="https:\/\/games\.pikabu\.ru\/sdk\/sdk\.js"[\s\S]*?<\/script>/g, '');

  const vkHeadRegex = /<!-- VK Bridge SDK[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/;
  const gjHeadMeta = `<!-- Game Jolt HTML5 & Official Game Jolt API JS SDK -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<script src="assets/gamejolt.min.js"></script>`;
  if (vkHeadRegex.test(html)) {
    html = html.replace(vkHeadRegex, gjHeadMeta);
  } else {
    html = html.replace(/<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge[\s\S]*?<\/script>/, gjHeadMeta);
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

  // Е. Английский язык по умолчанию для международной аудитории Game Jolt
  html = html.replace(
    /let currentLang = localStorage\.getItem\('samosbor_lang'\) \|\| 'ru';/,
    `let currentLang = localStorage.getItem('samosbor_gj_lang') || 'en';`
  );
  html = html.replace(
    /localStorage\.setItem\('samosbor_lang', currentLang\);/g,
    `localStorage.setItem('samosbor_gj_lang', currentLang);`
  );

  // Ж. Кнопки в support-controls: переключатель языка, полноэкранный режим и Game Jolt инфо
  html = html.replace(
    /<button id="btn-donate"[\s\S]*?<\/button>/,
    `<button id="btn-fullscreen-toggle" class="support-btn" onclick="toggleGjFullscreen();" style="border-color: #2fe06f; color: #2fe06f; background: rgba(47,224,111,0.12);">
      ⛶ FULLSCREEN
    </button>
    <button id="btn-donate" class="support-btn" onclick="document.getElementById('donate-modal').style.display='flex';" style="border-color: #2fe06f; color: #2fe06f; background: rgba(47,224,111,0.12);">
      ⚡ GAME JOLT
    </button>`
  );

  // З. Модальное окно сообщества Game Jolt
  const donateModalRegex = /<div id="donate-modal" class="modal-overlay" style="z-index: 92;">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
  const gjInfoModal = `<div id="donate-modal" class="modal-overlay" style="z-index: 92;">
    <div class="shop-panel" style="width: 600px; max-width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
      <div class="shop-header">
        <span style="color: #2fe06f;">⚡ COMMUNITY // GAME JOLT</span>
        <button onclick="document.getElementById('donate-modal').style.display='none';">[X]</button>
      </div>
      <div style="font-size: 13px; color: #ccc; line-height: 1.6; margin-bottom: 16px; text-align: left;">
        Welcome to the Soviet Gigastructure post-apocalyptic block: <b>SAMOSBOR</b>.<br><br>
        Survive deadly anomalies, explore infinite floors, fight grotesque abominations, scavenge rations, upgrade your hazard gear, and trade with fellow inmates!<br><br>
        <b>Support the game on Game Jolt:</b><br>
        • Follow this game page for updates and devlogs<br>
        • Like and rate the game<br>
        • Share your thoughts and feedback in the comments
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
        <button type="button" onclick="toggleGjFullscreen();" style="padding: 10px; font-size: 13px; color: #2fe06f; border-color: #2fe06f; cursor: pointer; background: rgba(47,224,111,0.1);">
          ⛶ TOGGLE FULLSCREEN
        </button>
      </div>
      <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
        <button onclick="document.getElementById('donate-modal').style.display='none';" style="margin: 0; padding: 6px 14px; font-size: 12px; border-color: #555; color: #888;" data-i18n="btn_close">CLOSE</button>
      </div>
    </div>
  </div>`;
  html = html.replace(donateModalRegex, gjInfoModal);

  // И. Замена кнопок опций в options-menu
  html = html.replace(
    /<button id="btn-opt-donate"[\s\S]*?<button id="btn-vk-fav"[\s\S]*?<\/button>/,
    `<button id="btn-opt-fs" class="audio-btn opt-btn" style="color: #2fe06f;" onclick="toggleGjFullscreen()">⛶ Fullscreen / Полноэкранный режим</button>
    <button id="btn-opt-donate" class="audio-btn opt-btn" style="color: #2fe06f;" onclick="document.getElementById('donate-modal').style.display='flex'">⚡ Game Jolt Info</button>`
  );

  // К. Панель быстрого входа на экране login-screen (Quick Play для Game Jolt)
  const loginPanelsRegex = /<!-- Панель входа через VK -->[\s\S]*?(?=<div id="login-divider")/i;
  const gjLoginBox = `<!-- Панель быстрого входа для Game Jolt -->
      <div id="gj-login-box" style="margin-bottom: 18px; padding: 14px; border: 1px solid #2fe06f; background: rgba(47, 224, 111, 0.08); border-radius: 4px;">
        <div id="gj-user-info" style="font-size: 12px; color: #aaa; margin-bottom: 8px;">
          Instant Play (Game Jolt / Guest mode, no registration required):
        </div>
        <button id="gj-quick-btn" type="button" onclick="quickStartGameJolt();" style="width: 100%; background: #2fe06f; color: #000; border: 1px solid #2fe06f; font-size: 13px; padding: 10px; cursor: pointer; font-weight: bold; letter-spacing: 1px; font-family: inherit;">
          ⚡ QUICK PLAY / ИГРАТЬ СЕЙЧАС
        </button>
      </div>\n\n    `;
  html = html.replace(loginPanelsRegex, gjLoginBox);
  html = html.replace(/<button id="btn-pkb-rewarded"[\s\S]*?<\/button>/g, '');

  // Включаем показ разделителя перед ручным вводом пароля
  html = html.replace(
    /<div id="login-divider" style="display:\s*none;/,
    '<div id="login-divider" style="display: block;'
  );

  // Л. Замена всей платформенной логики на интеграцию Game Jolt
  const platformJsRegex = /\/\/ ===== ПЛАТФОРМЕННАЯ ИНТЕГРАЦИЯ: PIKABU GAMES & VKONTAKTE =====[\s\S]*?(?=\s*let isVideoPlaying = false;)/;
  const gjJsCode = `// ===== ИНТЕГРАЦИЯ GAME JOLT & ВЕБ-ПЛАТФОРМ =====
let isPikabuEnvironment = false;
let isVkEnvironment = false;
let vkUserData = null;
let pkbSdk = null;
window.notifyPikabuGameStarted = function() {};

function initGameJoltSDK() {
  try {
    if (typeof GJAPI !== 'undefined') {
      if (GJAPI.bLoggedIn && GJAPI.sUserName) {
        console.log('[Game Jolt API] Обнаружен игрок Game Jolt:', GJAPI.sUserName);
        const uInput = document.getElementById('username');
        const gjBtn = document.getElementById('gj-quick-btn');
        const gjInfo = document.getElementById('gj-user-info');
        if (uInput && !uInput.value) uInput.value = GJAPI.sUserName;
        if (gjBtn) gjBtn.innerText = '⚡ PLAY AS ' + GJAPI.sUserName.toUpperCase() + ' (GAME JOLT)';
        if (gjInfo) gjInfo.innerHTML = 'Game Jolt Player recognized: <b style="color:#2fe06f;">' + GJAPI.sUserName + '</b>';
        
        if (typeof GJAPI.SessionOpen === 'function') {
          try { GJAPI.SessionOpen(); } catch(e){}
        }
      } else {
        console.log('[Game Jolt API] Запуск в гостевом режиме (Guest mode)');
      }
    }
  } catch(err) {
    console.warn('[Game Jolt API] Инициализация:', err);
  }
}

function quickStartGameJolt() {
  let uInput = document.getElementById('username');
  let pInput = document.getElementById('password');
  let err = document.getElementById('auth-error');
  
  let gjUser = (typeof GJAPI !== 'undefined' && GJAPI.bLoggedIn && GJAPI.sUserName) ? GJAPI.sUserName : null;
  let guestId = localStorage.getItem('samosbor_gj_user');
  if (!guestId) {
    guestId = 'Inmate_' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('samosbor_gj_user', guestId);
  }
  let u = (uInput && uInput.value.trim()) ? uInput.value.trim() : (gjUser || guestId);
  let p = (pInput && pInput.value.trim()) ? pInput.value.trim() : 'gj_pass_7749';
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

function toggleGjFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.log('[Game Jolt] Fullscreen error:', err);
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
  let guestId = localStorage.getItem('samosbor_gj_user');
  if (guestId) {
    if (uInput && !uInput.value) uInput.value = guestId;
    if (pInput && !pInput.value) pInput.value = 'gj_pass_7749';
  }
  initGameJoltSDK();
});
`;

  html = html.replace(platformJsRegex, gjJsCode);

  // М. Устранение вызовов Pikabu функций
  html = html.replace(/if\s*\(\s*typeof notifyPikabuGameStarted === 'function'\s*\)\s*notifyPikabuGameStarted\(\);?/g, '');
  html = html.replace(/notifyPikabuGameStarted\(\);?/g, '');

  // Н. Очистка упоминаний VK в текстах интерфейса
  html = html.replace(/ВКонтакте/g, 'Game Jolt');
  html = html.replace(/VK/g, 'Game Jolt');
  html = html.replace(/https:\/\/unpkg\.com\/[^\s"']+/g, '');

  // 4. Проверка синтаксиса JavaScript в index.html с помощью V8 vm
  console.log('4. Валидация синтаксиса JavaScript через V8 engine...');
  const scripts = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi) || [];
  scripts.forEach((s, idx) => {
    const code = s.replace(/<script[^>]*>|<\/script>/gi, '');
    try {
      new vm.Script(code, { filename: `inline_script_${idx}.js` });
      console.log(`- Inline Script ${idx}: Синтаксис валиден (${code.length} символов)`);
    } catch (e) {
      console.error(`❌ Ошибка синтаксиса в скрипте ${idx}:`, e.stack);
      process.exit(1);
    }
  });

  fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), html, 'utf8');
  console.log('Готово: gamejolt-build/index.html создан.');

  // 5. Упаковка в ZIP архив
  console.log('5. Создание zip-архива samosbor-gamejolt.zip с POSIX путями...');
  if (fs.existsSync(ZIP_OUTPUT)) {
    fs.unlinkSync(ZIP_OUTPUT);
  }

  try {
    execSync(`tar.exe -a -c -f "${ZIP_OUTPUT}" -C "${BUILD_DIR}" index.html assets`, {
      stdio: 'inherit'
    });
    const zipStat = fs.statSync(ZIP_OUTPUT);
    console.log(`\n🎉 УСПЕХ! Архив для Game Jolt успешно создан:`);
    console.log(`- Файл: ${ZIP_OUTPUT}`);
    console.log(`- Размер архива: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`- index.html и папка assets/ упакованы в корень с правильными Unix-путями (assets/...).`);
    console.log(`- Официальный Game Jolt API JS SDK (gamejolt.min.js) включен локально в assets/.`);

    // Копирование на Рабочий стол
    try {
      fs.copyFileSync(ZIP_OUTPUT, DESKTOP_OUTPUT);
      console.log(`- Скопировано на Рабочий стол: ${DESKTOP_OUTPUT}`);
    } catch (copyErr) {
      console.warn('Не удалось скопировать на рабочий стол:', copyErr.message);
    }
  } catch (err) {
    console.error('Ошибка при создании zip-архива:', err);
    process.exit(1);
  }
})();

