const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

console.log('=== СБОРКА АРХИВА ДЛЯ CRAZYGAMES (С ОПТИМИЗАЦИЕЙ < 20 МБ) ===\n');

const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUILD_DIR = path.join(ROOT_DIR, 'crazygames-build');
const ZIP_OUTPUT = path.join(ROOT_DIR, 'samosbor-crazygames.zip');

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Ошибка: Папка public не найдена!');
  process.exit(1);
}

// 1. Очистка и создание crazygames-build
if (fs.existsSync(BUILD_DIR)) {
  console.log('1. Очистка старой директории crazygames-build...');
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// 2. Умное сжатие картинок PNG и копирование ресурсов
console.log('2. Оптимизация и сжатие изображений для веса < 20 МБ...');
async function copyAndCompressAssets(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const item of fs.readdirSync(srcDir)) {
    if (item === 'vk-bridge.min.js' || item === 'video') continue;
    if (item.endsWith('.apk') || item.endsWith('.jar') || item.endsWith('.mp4')) continue;
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
      const buf = await pipeline.png({ quality: 68, compressionLevel: 9, palette: true }).toBuffer();
      fs.writeFileSync(destPath, buf);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

(async () => {
  const t0 = Date.now();
  await copyAndCompressAssets(path.join(PUBLIC_DIR, 'assets'), path.join(BUILD_DIR, 'assets'));
  console.log(`- Ресурсы оптимизированы за ${((Date.now() - t0) / 1000).toFixed(1)} сек.`);

  // 3. Подготовка index.html для CrazyGames
  console.log('3. Адаптация index.html для платформы CrazyGames...');
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  // А. Язык страницы и заголовок
  html = html.replace(/<html lang="ru">/, '<html lang="en">');
  html = html.replace(/<title>ТЕРМИНАЛ: САМОСБОР<\/title>/, '<title>Terminal: Samosbor</title>');

  // Б. Подключение CrazyGames SDK v3 в <head>
  const vkHeadRegex = /<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge\/dist\/browser\.min\.js"><\/script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/;
  const cgHeadMeta = `<!-- CrazyGames SDK v3 & HTML5 Meta -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>`;

  if (vkHeadRegex.test(html)) {
    html = html.replace(vkHeadRegex, cgHeadMeta);
  } else {
    html = html.replace(/<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge[\s\S]*?<\/script>/, cgHeadMeta);
  }

  // В. Настройка подключения Socket.io к внешнему защищенному серверу игры
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

  // Г. Английский язык по умолчанию для CrazyGames
  html = html.replace(
    /let currentLang = localStorage\.getItem\('samosbor_lang'\) \|\| 'ru';/,
    `let currentLang = localStorage.getItem('samosbor_cg_lang') || 'en';`
  );
  html = html.replace(
    /localStorage\.setItem\('samosbor_lang', currentLang\);/g,
    `localStorage.setItem('samosbor_cg_lang', currentLang);`
  );

  // Перевод основных статических кнопок верхней панели в HTML
  html = html.replace(
    /<button id="btn-feedback" class="audio-btn" style="border-color: rgba\(255,170,0,0\.5\); color: var\(--term-warn\);" data-i18n="btn_feedback">⚠️ БАГИ \/ ИДЕИ \[Shift\+P\]<\/button>/,
    `<button id="btn-feedback" class="audio-btn" style="border-color: rgba(255,170,0,0.5); color: var(--term-warn);" data-i18n="btn_feedback">⚠️ BUGS / IDEAS [Shift+P]</button>`
  );
  html = html.replace(
    /<button id="btn-bestiary" class="audio-btn" style="display:none;" data-i18n="btn_bestiary">📖 БЕСТИАРИЙ<\/button>/,
    `<button id="btn-bestiary" class="audio-btn" style="display:none;" data-i18n="btn_bestiary">📖 BESTIARY</button>`
  );
  html = html.replace(
    /<button id="btn-info" class="audio-btn" data-i18n="btn_info">ℹ️ СПРАВКА<\/button>/,
    `<button id="btn-info" class="audio-btn" data-i18n="btn_info">ℹ️ GUIDE</button>`
  );
  html = html.replace(
    /<button id="btn-options" class="audio-btn" data-i18n="btn_options">⚙️ ОПЦИИ<\/button>/,
    `<button id="btn-options" class="audio-btn" data-i18n="btn_options">⚙️ OPTIONS</button>`
  );
  html = html.replace(
    /<span id="lang-toggle-text">🌐 EN<\/span>/,
    `<span id="lang-toggle-text">🌐 [EN]</span>`
  );
  html = html.replace(
    /<span id="lang-toggle-text">🌐 РУ<\/span>/,
    `<span id="lang-toggle-text">🌐 [EN]</span>`
  );
  html = html.replace(
    /<h2 style="margin:0;" data-i18n="notebook_title">ДНЕВНИК ЗАКЛЮЧЕННОГО<\/h2>/,
    `<h2 style="margin:0;" data-i18n="notebook_title">INMATE'S DIARY</h2>`
  );

  // Д. Кнопки в support-controls: быстрые талоны за рекламу и поддержка CrazyGames
  html = html.replace(
    /<button id="btn-donate"[\s\S]*?<\/button>/,
    `<button id="btn-donate" class="support-btn" onclick="document.getElementById('donate-modal').style.display='flex';" style="border-color: var(--term-warn); color: var(--term-warn); background: rgba(255,170,0,0.12);">
      🎁 FREE TALONS
    </button>`
  );

  // Е. Модалка CrazyGames: бонусы за рекламу и информация о проекте
  const donateModalRegex = /<div id="donate-modal" class="modal-overlay" style="z-index: 92;">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
  const cgInfoModal = `<div id="donate-modal" class="modal-overlay" style="z-index: 500;">
    <div class="shop-panel" style="width: 580px; max-width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
      <div class="shop-header">
        <span style="color: var(--term-warn);">🎁 SUPPLY REWARDS // CRAZYGAMES</span>
        <button onclick="document.getElementById('donate-modal').style.display='none';">[X]</button>
      </div>
      <div style="font-size: 13px; color: #ccc; line-height: 1.6; margin-bottom: 16px; text-align: left;">
        Welcome to the Gigakhrushchyovka! Watch a brief transmission to replenish emergency supply rations, or support the project with a high rating on CrazyGames.
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
        <button type="button" onclick="watchCrazyGamesRewardedAd();" style="padding: 12px; font-size: 14px; color: var(--term-warn); border-color: var(--term-warn); font-weight: bold; cursor: pointer; background: rgba(255,170,0,0.12);">
          🎁 WATCH AD FOR +50 SUPPLY TALONS
        </button>
      </div>
      <div id="cg-ad-status" style="font-size: 12px; min-height: 20px; text-align: center; color: var(--term-green);"></div>
      <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
        <button onclick="document.getElementById('donate-modal').style.display='none';" style="margin: 0; padding: 6px 14px; font-size: 12px; border-color: #555; color: #888;" data-i18n="btn_close">CLOSE</button>
      </div>
    </div>
  </div>`;
  html = html.replace(donateModalRegex, cgInfoModal);

  // Ж. Замена кнопок опций в options-menu
  html = html.replace(
    /<button id="btn-opt-donate"[\s\S]*?<button id="btn-vk-fav"[\s\S]*?<\/button>/,
    `<button id="btn-opt-donate" class="audio-btn opt-btn" style="color: var(--term-warn);" onclick="document.getElementById('donate-modal').style.display='flex'">🎁 Free Talons & Rewards</button>`
  );

  // З. Панель быстрого входа на экране login-screen (Instant Play для CrazyGames)
  const vkLoginBoxRegex = /<!-- Панель входа через VK -->[\s\S]*?<\/div>\s*<\/div>/;
  const cgLoginBox = `<!-- Панель быстрого старта CrazyGames -->
      <div id="cg-login-box" style="margin-bottom: 18px; padding: 14px; border: 1px solid var(--term-warn); background: rgba(255, 170, 0, 0.08); border-radius: 4px;">
        <div style="font-size: 12px; color: #aaa; margin-bottom: 8px;">
          Instant Play (Guest Inmate):
        </div>
        <button id="cg-quick-btn" type="button" onclick="quickStartCrazyGames();" style="width: 100%; background: var(--term-warn); color: #000; border: 1px solid var(--term-warn); font-size: 14px; padding: 12px; cursor: pointer; font-weight: bold; letter-spacing: 1px; font-family: inherit;">
          ⚡ PLAY NOW / QUICK PLAY
        </button>
      </div>`;
  html = html.replace(vkLoginBoxRegex, cgLoginBox);

  // Включаем показ разделителя перед ручным вводом пароля
  html = html.replace(
    /<div id="login-divider" style="display: none;/,
    '<div id="login-divider" style="display: block;'
  );

  // И. Замена VK Bridge JS на полную интеграцию CrazyGames SDK v3 (включая Data Module для облачных сохранений)
  const vkJsRegex = /\/\/ ===== ИНТЕГРАЦИЯ VK\.COM & VK MINI APPS \(VK BRIDGE\) =====[\s\S]*?(?=\s*function startBootSequence)/;
  const cgJsCode = `// ===== ИНТЕГРАЦИЯ CRAZYGAMES SDK v3 & DATA MODULE =====
let cgSdkInitialized = false;
let cgLoadedSaveData = null;

// Загрузка данных через CrazyGames SDK Data Module
async function loadCrazyGamesSaveData() {
  if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.data) {
    try {
      console.log('[CrazyGames] Checking cloud save via Data Module...');
      // Загрузка данных
      const data = await window.CrazyGames.SDK.data.getItem("saveData");
      if (data) {
        const loaded = JSON.parse(data);
        cgLoadedSaveData = loaded;
        console.log('[CrazyGames] Save data restored from Data Module:', loaded);

        // Восстановление учетных данных заключенного
        if (loaded && loaded.auth && loaded.auth.username) {
          const u = loaded.auth.username;
          const p = loaded.auth.password || 'cg_secret_8821';
          localStorage.setItem('samosbor_cg_user', u);
          localStorage.setItem('samosbor_cg_pass', p);
          cachedLoginPayload = { type: 'manual', data: { username: u, password: p } };
          try { sessionStorage.setItem('samosbor_auth', JSON.stringify(cachedLoginPayload)); } catch(e){}

          const uInput = document.getElementById('username');
          const pInput = document.getElementById('password');
          if (uInput && !uInput.value) uInput.value = u;
          if (pInput && !pInput.value) pInput.value = p;

          const cgQuickBtn = document.getElementById('cg-quick-btn');
          if (cgQuickBtn) {
            cgQuickBtn.innerText = '⚡ CONTINUE AS ' + u.toUpperCase();
          }

          // Если сокет уже подключился — выполняем авторизацию
          if (typeof socket !== 'undefined' && socket && socket.connected) {
            console.log('[CrazyGames] Auto-logging in using cloud save:', u);
            reportGameplayStart();
            socket.emit('login', { username: u, password: p });
          }
        }

        // Восстановление локальных настроек
          if (loaded && loaded.settings) {
          if (loaded.settings.lang) {
            currentLang = loaded.settings.lang;
            localStorage.setItem('samosbor_cg_lang', currentLang);
            if (typeof applyLanguage === 'function') applyLanguage();
          }
          if (loaded.settings.tutorialCompleted) {
            localStorage.setItem('samosbor_tutorial_completed', 'true');
          }
        }
      } else {
        console.log('[CrazyGames] No cloud save data found yet (first launch).');
      }
    } catch (dataErr) {
      console.warn('[CrazyGames] Error loading from Data Module:', dataErr);
    }
  }
}

// Сохранение данных через CrazyGames SDK Data Module
let lastCgSaveTime = 0;
async function saveCrazyGamesData(customState) {
  if (!window.CrazyGames || !window.CrazyGames.SDK || !window.CrazyGames.SDK.data) return;

  const now = Date.now();
  if (now - lastCgSaveTime < 1000 && !customState) return;
  lastCgSaveTime = now;

  try {
    const uInput = document.getElementById('username');
    const pInput = document.getElementById('password');
    let u = (typeof myUsername !== 'undefined' && myUsername) || (uInput && uInput.value.trim()) || localStorage.getItem('samosbor_cg_user') || '';
    let p = (pInput && pInput.value.trim()) || localStorage.getItem('samosbor_cg_pass') || 'cg_secret_8821';
    if (!u) return;

    let gameState = customState || (typeof clientMe !== 'undefined' && clientMe ? {
      me: clientMe,
      map: (typeof serverMap !== 'undefined') ? serverMap : {},
      unlockedSectors: (typeof myUnlockedSectors !== 'undefined') ? myUnlockedSectors : [],
      quickSlots: (typeof myQuickSlots !== 'undefined') ? myQuickSlots : [],
      questItems: (typeof myQuestItems !== 'undefined') ? myQuestItems : [],
      timestamp: Date.now()
    } : null);

    const saveData = {
      auth: { username: u, password: p },
      gameState: gameState,
      settings: {
        lang: (typeof currentLang !== 'undefined') ? currentLang : 'en',
        tutorialCompleted: localStorage.getItem('samosbor_tutorial_completed') === 'true'
      },
      savedAt: new Date().toISOString()
    };

    // Сохранение данных
    await window.CrazyGames.SDK.data.setItem("saveData", JSON.stringify(saveData));
    console.log('[CrazyGames] Cloud save updated via CrazyGames.SDK.data.setItem("saveData", ...) for user:', u);
  } catch (err) {
    console.warn('[CrazyGames] Failed to save cloud data:', err);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (typeof applyLanguage === 'function') applyLanguage();
  if (window.CrazyGames && window.CrazyGames.SDK) {
    try {
      await window.CrazyGames.SDK.init();
      cgSdkInitialized = true;
      console.log('[CrazyGames] SDK v3 initialized successfully.');
      await loadCrazyGamesSaveData();
      if (typeof applyLanguage === 'function') applyLanguage();
    } catch (err) {
      console.warn('[CrazyGames] SDK init warning:', err);
    }
  }
});

// Отчеты о состоянии геймплея (обязательное требование CrazyGames QA)
function reportGameplayStart() {
  if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.game) {
    try { window.CrazyGames.SDK.game.gameplayStart(); } catch(e){}
  }
}

function reportGameplayStop() {
  if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.game) {
    try { window.CrazyGames.SDK.game.gameplayStop(); } catch(e){}
  }
}

function triggerHappyTime() {
  if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.game) {
    try { window.CrazyGames.SDK.game.happytime(); } catch(e){}
  }
}

// Запрос межстраничной рекламы (Midgame Ad)
function showCrazyGamesMidgameAd(onComplete) {
  if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.ad) {
    reportGameplayStop();
    window.CrazyGames.SDK.ad.requestAd('midgame', {
      adStarted: () => {
        if (typeof musicEnabled !== 'undefined' && musicEnabled && currentAmbient && AMBIENTS[currentAmbient]) {
          AMBIENTS[currentAmbient].pause();
        }
      },
      adFinished: () => {
        reportGameplayStart();
        if (typeof musicEnabled !== 'undefined' && musicEnabled && currentAmbient && AMBIENTS[currentAmbient]) {
          AMBIENTS[currentAmbient].play().catch(()=>{});
        }
        if (onComplete) onComplete();
      },
      adError: (err) => {
        console.warn('[CrazyGames] Midgame ad error:', err);
        reportGameplayStart();
        if (typeof musicEnabled !== 'undefined' && musicEnabled && currentAmbient && AMBIENTS[currentAmbient]) {
          AMBIENTS[currentAmbient].play().catch(()=>{});
        }
        if (onComplete) onComplete();
      }
    });
  } else {
    if (onComplete) onComplete();
  }
}

// Запрос вознаграждаемой рекламы (Rewarded Ad)
function watchCrazyGamesRewardedAd() {
  const statusEl = document.getElementById('cg-ad-status');
  if (statusEl) {
    statusEl.style.color = 'var(--term-warn)';
    statusEl.innerText = (currentLang === 'en') ? 'Loading video transmission...' : 'Загрузка видеосигнала...';
  }

  if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.ad) {
    reportGameplayStop();
    window.CrazyGames.SDK.ad.requestAd('rewarded', {
      adStarted: () => {
        if (typeof musicEnabled !== 'undefined' && musicEnabled && currentAmbient && AMBIENTS[currentAmbient]) {
          AMBIENTS[currentAmbient].pause();
        }
      },
      adFinished: () => {
        reportGameplayStart();
        if (typeof musicEnabled !== 'undefined' && musicEnabled && currentAmbient && AMBIENTS[currentAmbient]) {
          AMBIENTS[currentAmbient].play().catch(()=>{});
        }
        socket.emit('rewardAdWatched');
        if (statusEl) {
          statusEl.style.color = 'var(--term-green)';
          statusEl.innerText = (currentLang === 'en') ? 'SUCCESS! +50 Talons granted!' : 'УСПЕШНО! Начислено +50 талонов снабжения!';
        }
        if (typeof playSound === 'function') playSound('buy');
        if (typeof saveCrazyGamesData === 'function') saveCrazyGamesData();
      },
      adError: (err) => {
        console.warn('[CrazyGames] Rewarded ad error:', err);
        reportGameplayStart();
        if (typeof musicEnabled !== 'undefined' && musicEnabled && currentAmbient && AMBIENTS[currentAmbient]) {
          AMBIENTS[currentAmbient].play().catch(()=>{});
        }
        if (statusEl) {
          statusEl.style.color = 'var(--term-danger)';
          statusEl.innerText = (currentLang === 'en') ? 'Ad unavailable at the moment.' : 'Реклама временно недоступна.';
        }
      }
    });
  } else {
    // Режим разработки без SDK
    socket.emit('rewardAdWatched');
    if (statusEl) {
      statusEl.style.color = 'var(--term-green)';
      statusEl.innerText = 'DEV: +50 Talons granted!';
    }
    if (typeof playSound === 'function') playSound('buy');
    if (typeof saveCrazyGamesData === 'function') saveCrazyGamesData();
  }
}

// Быстрый вход для CrazyGames
function quickStartCrazyGames() {
  let uInput = document.getElementById('username');
  let pInput = document.getElementById('password');
  let err = document.getElementById('auth-error');
  let guestId = localStorage.getItem('samosbor_cg_user');
  if (!guestId) {
    guestId = 'Inmate_' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('samosbor_cg_user', guestId);
  }
  let guestPass = localStorage.getItem('samosbor_cg_pass') || 'cg_secret_8821';
  localStorage.setItem('samosbor_cg_pass', guestPass);

  let u = (uInput && uInput.value.trim()) ? uInput.value.trim() : guestId;
  let p = (pInput && pInput.value.trim()) ? pInput.value.trim() : guestPass;
  if (uInput && !uInput.value) uInput.value = u;
  if (pInput && !pInput.value) pInput.value = p;
  if (err) err.innerHTML = '<span style="color:var(--term-warn);">' + ((currentLang === 'en') ? 'Authorizing inmate...' : 'Авторизация...') + '</span>';
  
  cachedLoginPayload = { type: 'manual', data: { username: u, password: p } };
  try { sessionStorage.setItem('samosbor_auth', JSON.stringify(cachedLoginPayload)); } catch(e){}

  reportGameplayStart();
  socket.emit('login', { username: u, password: p });
  if (typeof saveCrazyGamesData === 'function') saveCrazyGamesData();
}

window.addEventListener('load', () => {
  let uInput = document.getElementById('username');
  let pInput = document.getElementById('password');
  let guestId = localStorage.getItem('samosbor_cg_user');
  let guestPass = localStorage.getItem('samosbor_cg_pass') || 'cg_secret_8821';
  if (guestId) {
    if (uInput && !uInput.value) uInput.value = guestId;
    if (pInput && !pInput.value) pInput.value = guestPass;
  }
});

window.addEventListener('beforeunload', () => {
  if (typeof saveCrazyGamesData === 'function') saveCrazyGamesData();
});
window.addEventListener('pagehide', () => {
  if (typeof saveCrazyGamesData === 'function') saveCrazyGamesData();
});
`;

  html = html.replace(vkJsRegex, cgJsCode);

  // К. Интеграция сохранения и авто-входа с модулем CrazyGames Data
  html = html.replace(
    /function performAutoLogin\(\) \{/,
    `function performAutoLogin() {
  if (!cachedLoginPayload && typeof cgLoadedSaveData !== 'undefined' && cgLoadedSaveData && cgLoadedSaveData.auth) {
    cachedLoginPayload = { type: 'manual', data: cgLoadedSaveData.auth };
  }`
  );

  html = html.replace(
    /function submitManualLogin\(\) \{/,
    `function submitManualLogin() {
  if (typeof saveCrazyGamesData === 'function') setTimeout(saveCrazyGamesData, 50);`
  );

  html = html.replace(
    /socket\.on\('gameState', \(data\) => \{/,
    `socket.on('gameState', (data) => {
  if (typeof saveCrazyGamesData === 'function') saveCrazyGamesData(data);`
  );

  html = html.replace(
    /socket\.on\('loginSuccess', \(data\) => \{/,
    `socket.on('loginSuccess', (data) => {
  if (typeof saveCrazyGamesData === 'function') saveCrazyGamesData();`
  );

  // Л. Автоматические отчеты gameplayStart / gameplayStop при смене экранов
  html = html.replace(
    /function showScreen\(id\) \{/,
    `function showScreen(id) {
  if (id === 'login-screen') {
    if (typeof reportGameplayStop === 'function') reportGameplayStop();
  } else if (id === 'hub-screen' || id === 'map-screen') {
    if (typeof reportGameplayStart === 'function') reportGameplayStart();
  }`
  );

  // М. Хуки CrazyGames на события победы/поражения в бою
  html = html.replace(
    /playSound\(data\.win \? 'victory' : 'defeat'\);/,
    `playSound(data.win ? 'victory' : 'defeat');
    if (data.win) {
      if (typeof triggerHappyTime === 'function') triggerHappyTime();
    } else {
      if (typeof showCrazyGamesMidgameAd === 'function') showCrazyGamesMidgameAd();
    }`
  );

  // Очистка упоминаний VK в текстах интерфейса
  html = html.replace(/ВКонтакте/g, 'CrazyGames');
  html = html.replace(/VK/g, 'CrazyGames');

  fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), html, 'utf8');
  console.log('Готово: crazygames-build/index.html создан.');

  // 4. Упаковка в ZIP архив
  console.log('4. Создание zip-архива samosbor-crazygames.zip с POSIX путями (forward slash)...');
  if (fs.existsSync(ZIP_OUTPUT)) {
    fs.unlinkSync(ZIP_OUTPUT);
  }

  try {
    execSync(`tar.exe -a -c -f "${ZIP_OUTPUT}" -C "${BUILD_DIR}" index.html assets`, {
      stdio: 'inherit'
    });
    const zipStat = fs.statSync(ZIP_OUTPUT);
    console.log(`\n🎉 УСПЕХ! Архив для CrazyGames успешно создан:`);
    console.log(`- Файл: ${ZIP_OUTPUT}`);
    console.log(`- Размер архива: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`- index.html и папка assets/ упакованы прямо в корень архива (согласно требованиям CrazyGames).`);
  } catch (err) {
    console.error('Ошибка при создании zip-архива:', err);
    process.exit(1);
  }
})();
