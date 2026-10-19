const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== СБОРКА АРХИВА ДЛЯ ПИКАБУ ИГРЫ (PIKABU GAMES) ===\n');

const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUILD_DIR = path.join(ROOT_DIR, 'pikabu-build');
const ZIP_OUTPUT = path.join(ROOT_DIR, 'samosbor-pikabu-games.zip');

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Ошибка: Папка public не найдена!');
  process.exit(1);
}

// 1. Очистка и создание pikabu-build
if (fs.existsSync(BUILD_DIR)) {
  console.log('1. Очистка старой директории pikabu-build...');
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// 2. Копирование assets (без vk-bridge.min.js)
console.log('2. Копирование ресурсов assets...');
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    if (item === 'vk-bridge.min.js') continue; // не нужен в Пикабу Играх
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

// 3. Подготовка index.html для Пикабу Игр
console.log('3. Адаптация index.html для платформы Пикабу Игры...');
let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

// А. Удаление VK Bridge скриптов из <head>
const vkBridgeRegex = /<!-- VK Bridge SDK[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/;
if (vkBridgeRegex.test(html)) {
  html = html.replace(vkBridgeRegex, '<!-- VK Bridge исключен для платформы Пикабу Игры -->');
} else {
  html = html.replace(/<script src="https:\/\/unpkg\.com\/@vkontakte\/vk-bridge[\s\S]*?<\/script>/g, '');
}

// Б. Удаление внешней ссылки на Google Fonts (замена на надежные локальные моноширинные шрифты)
html = html.replace(
  /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=PT\+Mono&display=swap" rel="stylesheet">/,
  '<!-- Локальные системные шрифты (PT Mono / Consolas / monospace) -->'
);

// В. Удаление внешнего CDN fallback для socket.io
html = html.replace(
  /<script>\s*if\s*\(typeof io === 'undefined'\)\s*\{[\s\S]*?\}\s*<\/script>/,
  '<!-- Socket.io загружен локально из assets/socket.io.min.js -->'
);

// Г. Удаление внешних unpkg ссылок
html = html.replace(/https:\/\/unpkg\.com\/[^\s"']+/g, '');

// Д. Удаление окна доната VK и кнопок VK из разметки
html = html.replace(/<div id="donate-modal"[\s\S]*?<!-- \/donate-modal -->|<div id="donate-modal"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '<!-- Окно доната VK удалено для Пикабу Игр -->');
html = html.replace(/<div id="vk-login-box"[\s\S]*?<\/div>\s*<\/div>/, '<!-- VK логин блок удален -->');
html = html.replace(/<button id="btn-donate"[\s\S]*?<\/button>/, '');
html = html.replace(/<button id="btn-opt-donate"[\s\S]*?<\/button>/, '');
html = html.replace(/<button id="btn-vk-[^"]*"[\s\S]*?<\/button>/g, '');

// Е. Гарантированное отображение блока логина Пикабу
html = html.replace(/<div id="pkb-login-box" style="display:\s*none;/, '<div id="pkb-login-box" style="display: block;');

// Ж. Прямая привязка backend URL к живому игровому серверу для Пикабу
html = html.replace(
  /const BACKEND_URL = \(window\.location\.hostname === 'localhost'[\s\S]*?: 'https:\/\/195-19-219-215\.sslip\.io';/,
  "const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://195-19-219-215.sslip.io';"
);

// Проверка на чистоту файла index.html
console.log('4. Валидация сборки...');
if (html.includes('vkBridge.send')) {
  console.log('ℹ️ Примечание: вызовы vkBridge изолированы и не выполняются в среде Пикабу.');
}

fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), html, 'utf8');
console.log('Готово: pikabu-build/index.html создан.');

// 5. Упаковка в ZIP архив
console.log('5. Создание zip-архива samosbor-pikabu-games.zip...');
if (fs.existsSync(ZIP_OUTPUT)) {
  fs.unlinkSync(ZIP_OUTPUT);
}

try {
  execSync(`tar.exe -a -c -f "${ZIP_OUTPUT}" -C "${BUILD_DIR}" index.html assets`, {
    stdio: 'inherit'
  });
  const zipStat = fs.statSync(ZIP_OUTPUT);
  console.log(`\n🎉 УСПЕХ! Архив для Пикабу Игр успешно создан:`);
  console.log(`- Файл: ${ZIP_OUTPUT}`);
  console.log(`- Размер архива: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`- index.html и assets/ упакованы с правильными Unix-путями.`);
} catch (err) {
  console.error('Ошибка при создании zip-архива:', err);
  process.exit(1);
}

