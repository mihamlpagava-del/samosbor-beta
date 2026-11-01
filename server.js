const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.enable('trust proxy');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket']
});

// Разрешаем встраивание в iframe (ВКонтакте и веб)
app.use((req, res, next) => {
    res.removeHeader('X-Frame-Options');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Эндпоинты проверки работоспособности (защита от 404/502 на туннелях и чекерах)
app.get('/health', (req, res) => {
    res.json({
        status: "ok",
        game: "SAMOSBOR",
        playersOnline: Object.keys(onlinePlayers).length,
        uptime: Math.floor(process.uptime())
    });
});

app.get('/', (req, res, next) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath) && req.accepts('html')) {
        return res.sendFile(indexPath);
    }
    res.json({
        status: "ok",
        game: "SAMOSBOR",
        playersOnline: Object.keys(onlinePlayers).length
    });
});

const LOG_FILE = path.join(__dirname, 'server_logs.txt');
function writeLog(message) {
    const time = new Date().toLocaleString('ru-RU');
    const logMsg = `[${time}] ${message}\n`;
    console.log(`[LOG] ${message}`);
    fs.appendFile(LOG_FILE, logMsg, () => {});
}

process.on('uncaughtException', (err) => {
    writeLog(`[КРИТИЧЕСКАЯ ОШИБКА uncaughtException]: ${err && (err.stack || err.message)}`);
    console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
    writeLog(`[КРИТИЧЕСКАЯ ОШИБКА unhandledRejection]: ${reason}`);
    console.error('[UNHANDLED REJECTION]', reason);
});

const DB_FILE = path.join(__dirname, 'database.json');
const DB_BAK_FILE = path.join(__dirname, 'database.json.bak');
let db = { players: {}, map: {}, vkMap: {}, feedback: [] };
let isDbDirty = false;
let isSavingDb = false;
let lastSaveStartTime = 0;

// Атомарная запись БД (защита от повреждения файла при сбоях/перезагрузке)
function flushDBSync() {
    if (!isDbDirty) return;
    const data = JSON.stringify(db, null, 2);
    const tempFile = DB_FILE + '.tmp';
    try {
        fs.writeFileSync(tempFile, data, 'utf8');
        try {
            fs.renameSync(tempFile, DB_FILE);
        } catch (renameErr) {
            fs.writeFileSync(DB_FILE, data, 'utf8');
            try { fs.unlinkSync(tempFile); } catch (e) {}
        }
        isDbDirty = false;
        if (db.players && Object.keys(db.players).length > 0) {
            try { fs.writeFileSync(DB_BAK_FILE, data, 'utf8'); } catch (e) {}
        }
    } catch (err) {
        writeLog(`Ошибка синхронной записи БД: ${err.message}`);
        try {
            fs.writeFileSync(DB_FILE, data, 'utf8');
            isDbDirty = false;
        } catch (fatalErr) {
            writeLog(`КРИТИЧЕСКАЯ ОШИБКА записи БД: ${fatalErr.message}`);
        }
    }
}

function flushDBAsync() {
    // Сторожевой таймер: сброс зависшей асинхронной записи (>5 сек)
    if (isSavingDb && Date.now() - lastSaveStartTime > 5000) {
        writeLog('[БД ПРЕДУПРЕЖДЕНИЕ] Сброс зависшего флага isSavingDb');
        isSavingDb = false;
    }
    if (!isDbDirty || isSavingDb) return;
    isSavingDb = true;
    lastSaveStartTime = Date.now();
    const tempFile = DB_FILE + '.tmp';
    try {
        const data = JSON.stringify(db, null, 2);
        fs.writeFile(tempFile, data, 'utf8', (err) => {
            if (err) {
                isSavingDb = false;
                writeLog(`Ошибка записи темп-файла БД: ${err.message}. Пробуем прямую запись...`);
                try {
                    fs.writeFileSync(DB_FILE, data, 'utf8');
                    isDbDirty = false;
                    if (db.players && Object.keys(db.players).length > 0) {
                        try { fs.writeFileSync(DB_BAK_FILE, data, 'utf8'); } catch (e) {}
                    }
                } catch (e) {}
                return;
            }
            fs.rename(tempFile, DB_FILE, (renameErr) => {
                isSavingDb = false;
                if (!renameErr) {
                    isDbDirty = false;
                    if (db.players && Object.keys(db.players).length > 0) {
                        try { fs.writeFileSync(DB_BAK_FILE, data, 'utf8'); } catch (e) {}
                    }
                } else {
                    writeLog(`Ошибка переименования темп-файла БД: ${renameErr.message}. Запись напрямую...`);
                    try {
                        fs.writeFileSync(DB_FILE, data, 'utf8');
                        isDbDirty = false;
                        try { fs.unlinkSync(tempFile); } catch (e) {}
                        if (db.players && Object.keys(db.players).length > 0) {
                            try { fs.writeFileSync(DB_BAK_FILE, data, 'utf8'); } catch (e) {}
                        }
                    } catch (e) {
                        writeLog(`Ошибка прямой записи БД: ${e.message}`);
                    }
                }
            });
        });
    } catch (err) {
        isSavingDb = false;
        writeLog(`Ошибка сериализации БД: ${err.message}`);
    }
}

function saveDB(immediate = false) {
    isDbDirty = true;
    if (immediate) {
        flushDBSync();
    }
}

// Периодическое сохранение БД каждые 2 секунды
setInterval(flushDBAsync, 2000);

process.on('SIGINT', () => { flushDBSync(); process.exit(0); });
process.on('SIGTERM', () => { flushDBSync(); process.exit(0); });
process.on('exit', () => { flushDBSync(); });
process.on('uncaughtException', (err) => { writeLog(`КРИТИЧЕСКАЯ ОШИБКА: ${err.message}\n${err.stack}`); flushDBSync(); });
process.on('unhandledRejection', (reason) => { writeLog(`НЕОБРАБОТАННОЕ ОТКЛОНЕНИЕ: ${reason}`); });

// Инициализация и авто-восстановление базы данных
function initDatabase() {
    let loaded = null;
    let source = '';

    // Сначала пытаемся прочитать основной файл
    if (fs.existsSync(DB_FILE)) {
        try {
            const raw = fs.readFileSync(DB_FILE, 'utf8').trim();
            if (raw.length > 2) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    const playerCount = parsed.players ? Object.keys(parsed.players).length : 0;
                    if (playerCount > 0) {
                        loaded = parsed;
                        source = `${DB_FILE} (${playerCount} игроков)`;
                    }
                }
            }
        } catch (err) {
            writeLog(`[БД ОШИБКА] Поврежден основной файл ${DB_FILE}: ${err.message}`);
        }
    }

    // Если основной файл пуст или поврежден — проверяем резервную копию database.json.bak
    if (!loaded && fs.existsSync(DB_BAK_FILE)) {
        try {
            const rawBak = fs.readFileSync(DB_BAK_FILE, 'utf8').trim();
            if (rawBak.length > 2) {
                const parsedBak = JSON.parse(rawBak);
                if (parsedBak && typeof parsedBak === 'object') {
                    const bakPlayerCount = parsedBak.players ? Object.keys(parsedBak.players).length : 0;
                    if (bakPlayerCount > 0) {
                        loaded = parsedBak;
                        source = `РЕЗЕРВНАЯ КОПИЯ ${DB_BAK_FILE} (${bakPlayerCount} игроков)`;
                        writeLog(`[БД ВОССТАНОВЛЕНИЕ] Основной файл базы отсутствовал или был пуст. Успешно восстановлены данные из ${DB_BAK_FILE}!`);
                    }
                }
            }
        } catch (bakErr) {
            writeLog(`[БД ОШИБКА] Ошибка чтения резервной копии ${DB_BAK_FILE}: ${bakErr.message}`);
        }
    }

    // Если в основном файле 0 игроков, а в .bak есть игроки — предотвращаем перезапись базы пустышкой!
    if (loaded && fs.existsSync(DB_BAK_FILE)) {
        const currentCount = loaded.players ? Object.keys(loaded.players).length : 0;
        if (currentCount === 0) {
            try {
                const rawBak = fs.readFileSync(DB_BAK_FILE, 'utf8').trim();
                const parsedBak = JSON.parse(rawBak);
                const bakCount = (parsedBak && parsedBak.players) ? Object.keys(parsedBak.players).length : 0;
                if (bakCount > 0) {
                    writeLog(`[БД ВОССТАНОВЛЕНИЕ] Предотвращено обнуление базы! Восстановлено ${bakCount} игроков из ${DB_BAK_FILE}`);
                    loaded = parsedBak;
                    source = `РЕЗЕРВНАЯ КОПИЯ ${DB_BAK_FILE} (${bakCount} игроков)`;
                }
            } catch (e) {}
        }
    }

    if (loaded) {
        if (loaded.players && loaded.map) {
            db = loaded;
        } else {
            db.players = loaded.players || loaded || {};
            db.map = loaded.map || {};
        }
        if (!db.players) db.players = {};
        if (!db.map) db.map = {};
        if (!db.vkMap) db.vkMap = {};
        if (!Array.isArray(db.feedback)) db.feedback = [];
        if (!Array.isArray(db.fleaMarket)) db.fleaMarket = [];
        if (!Array.isArray(db.chatHistory)) db.chatHistory = [];
        if (db.chatHistory.length === 0) {
            db.chatHistory = [
                { user: 'Диспетчер', text: 'Внимание всем блокам: радиоканал связи активен. Соблюдайте режим светомаскировки.', time: '12:00' },
                { user: 'Семен_Ликвидатор', text: 'Кто собирает штурмовой отряд на вылазку? Я в полной броне с огнеметом.', time: '12:05' },
                { user: 'Архип_Слесарь', text: 'Выставил на барахолку спецовку и монтировку, забирайте талонами.', time: '12:12' }
            ];
        }
        if (db.fleaMarket.length === 0) {
            db.fleaMarket = [
                { id: 'lot_seed_1', seller: 'Семён_Ликвидатор', sellerTitle: 'Ликвидатор', itemId: 'weapon_crowbar_uncommon', price: 180, createdAt: Date.now() - 3600000 },
                { id: 'lot_seed_2', seller: 'Архип_Слесарь', sellerTitle: 'Ударник Труда', itemId: 'clothes_worker_uncommon', price: 75, createdAt: Date.now() - 7200000 },
                { id: 'lot_seed_3', seller: 'Зэк_Бывалый', sellerTitle: 'Заключенный', itemId: 'food_medkit', price: 55, createdAt: Date.now() - 1800000 },
                { id: 'lot_seed_4', seller: 'Химик_Гриша', sellerTitle: 'Сталкер', itemId: 'mat_chem', price: 12, createdAt: Date.now() - 900000 },
                { id: 'lot_seed_5', seller: 'Мастер_Петрович', sellerTitle: 'Ударник Труда', itemId: 'mat_electro', price: 18, createdAt: Date.now() - 450000 }
            ];
        }
        writeLog(`[БД ЗАГРУЗКА] Успешно загружена база из ${source}`);
        saveDB(true);
    } else {
        writeLog(`[БД] База данных не обнаружена. Инициализация чистой структуры.`);
        db = { players: {}, map: {}, vkMap: {}, feedback: [], fleaMarket: [], chatHistory: [] };
    }
}
initDatabase();

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword) return false;
    if (typeof storedPassword === 'string' && storedPassword.startsWith('scrypt:')) {
        const parts = storedPassword.split(':');
        if (parts.length === 3) {
            const salt = parts[1];
            const hash = parts[2];
            try {
                const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
                return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
            } catch (e) {
                return false;
            }
        }
    }
    // Обратная совместимость для существующих паролей в открытом виде
    return storedPassword === password;
}

function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

let onlinePlayers = {};
let activeCombats = {};
let globalBosses = {};
let coopSquads = {}; // Активные отряды совместной вылазки
let currentShopItems = [];
let nextShopUpdate = 0;
let chatHistory = (typeof db !== 'undefined' && db && Array.isArray(db.chatHistory)) ? db.chatHistory : [];
const MAX_CHAT_MESSAGES = 100;

// ===== КОНФИГУРАЦИЯ ВОЛН СОВМЕСТНОЙ ВЫЛАЗКИ =====
const RAID_WAVE_MONSTERS = [
    { wave: 1, name: "Хлюп-Мутант Сливной Трубы", hp: 220, dmg: 12, def: 2, reward: 35, xp: 45, img: "m_slime.png", tier: "common" },
    { wave: 2, name: "Членистоногий Труп", hp: 300, dmg: 16, def: 4, reward: 45, xp: 60, img: "m_corpse.png", tier: "common" },
    { wave: 3, name: "Гнилостный Червь Вентиляции", hp: 400, dmg: 20, def: 6, reward: 60, xp: 80, img: "m_worm.png", tier: "common" },
    { wave: 4, name: "Сбежавший Биомеханоид", hp: 520, dmg: 25, def: 8, reward: 75, xp: 110, img: "m_biomech.png", tier: "uncommon" },
    { wave: 5, name: "Очумевший Ликвидатор-Мутант", hp: 660, dmg: 30, def: 10, reward: 95, xp: 145, img: "m_liquidator.png", tier: "uncommon" },
    { wave: 6, name: "Мясная Амальгама Блока", hp: 820, dmg: 35, def: 12, reward: 120, xp: 185, img: "m_amalgam.png", tier: "uncommon" },
    { wave: 7, name: "Чумной Плевун Тумана", hp: 1000, dmg: 40, def: 15, reward: 150, xp: 230, img: "m_spitter.png", tier: "rare" },
    { wave: 8, name: "Цербер Технических Катакомб", hp: 1220, dmg: 46, def: 18, reward: 190, xp: 285, img: "m_hound.png", tier: "rare" },
    { wave: 9, name: "Осквернённый Страж Периметра", hp: 1480, dmg: 52, def: 22, reward: 240, xp: 350, img: "m_guard.png", tier: "rare" },
    { wave: 10, name: "Верховный Адепт Культа Самосбора", hp: 1800, dmg: 60, def: 25, reward: 300, xp: 450, img: "m_cultist.png", tier: "elite" }
];

const RAID_ELITE_BOSSES = {
    blue: {
        name: "🔷 Кобальтовый Левиафан Блока-9",
        tier: "rare_blue",
        colorTheme: "#33aaff",
        badge: "СИНИЙ РЕДКИЙ БОСС",
        hp: 3600,
        dmg: 74,
        def: 32,
        reward: 950,
        xp: 1600,
        img: "boss_reactor.png",
        lore: "Редкий аномальный исполин. Его ледяной панцирь искрится синим разрядом и поглощает кинетическую энергию!",
        lootTable: ['weapon_chainsaw', 'clothes_stalker', 'food_medkit', 'mat_electro']
    },
    purple: {
        name: "🔮 Псионический Пожиратель Бездны",
        tier: "epic_purple",
        colorTheme: "#c033ff",
        badge: "ФИОЛЕТОВЫЙ ЭПИЧЕСКИЙ БОСС",
        hp: 4600,
        dmg: 90,
        def: 28,
        reward: 1600,
        xp: 2500,
        img: "boss_final.png",
        lore: "Эпическая древняя сущность нулевого горизонта. Её фиолетовый пси-туман сокрушает рассудок и расплавляет броню!",
        lootTable: ['weapon_shotgun', 'clothes_liquidator', 'food_medkit', 'mat_chem']
    }
};

function getPublicRaidSquads() {
    let list = [];
    for (let sId in coopSquads) {
        let sq = coopSquads[sId];
        list.push({
            id: sq.id,
            name: sq.name,
            leader: sq.leader,
            memberCount: sq.members.length,
            maxMembers: 4,
            status: sq.status,
            currentWave: sq.currentWave || 1,
            members: sq.members.map(m => {
                let mp = db.players[m.username];
                return {
                    username: m.username,
                    level: m.level || (mp ? mp.level : 1),
                    title: m.title || (mp ? mp.title : 'Заключенный'),
                    isReady: !!m.isReady,
                    isDowned: !!m.isDowned,
                    hp: m.hp !== undefined ? m.hp : (mp ? mp.hp : 100),
                    maxHp: m.maxHp || (mp ? mp.maxHp : 100),
                    skin: mp && mp.appearance ? mp.appearance.skin : 'skin_1'
                };
            })
        });
    }
    return list;
}

function broadcastToSquad(squad, event, data) {
    if (!squad || !squad.members) return;
    for (let m of squad.members) {
        let sId = Object.keys(onlinePlayers).find(k => onlinePlayers[k] === m.username);
        if (sId) {
            io.to(sId).emit(event, data);
        }
    }
}

function getSquadClientData(sq) {
    if (!sq) return null;
    return {
        id: sq.id,
        name: sq.name,
        leader: sq.leader,
        status: sq.status,
        currentWave: sq.currentWave || 1,
        maxWaves: sq.maxWaves || 11,
        members: sq.members.map(m => {
            let mp = db.players[m.username];
            return {
                username: m.username,
                level: m.level || (mp ? mp.level : 1),
                title: m.title || (mp ? mp.title : 'Заключенный'),
                hp: m.hp !== undefined ? m.hp : (mp ? mp.hp : 100),
                maxHp: m.maxHp || (mp ? mp.maxHp : 100),
                isReady: !!m.isReady,
                isDowned: !!m.isDowned,
                skin: mp && mp.appearance ? mp.appearance.skin : 'skin_1',
                equipment: mp ? (mp.equipment || {}) : {}
            };
        }),
        chat: sq.chat || []
    };
}

function getIntermissionData(sq) {
    if (!sq) return null;
    return {
        clearedWave: sq.clearedWave || sq.currentWave || 1,
        nextWave: (sq.clearedWave || sq.currentWave || 1) + 1,
        timer: Math.max(0, Math.ceil(sq.intermissionTimer || 15)),
        votes: sq.votes || {},
        members: sq.members ? sq.members.map(m => m.username) : []
    };
}

function resolveRaidIntermission(squad) {
    if (!squad || squad.status !== 'intermission') return;
    let evacCount = squad.members.filter(m => squad.votes && squad.votes[m.username] === 'evacuate').length;
    let contCount = squad.members.filter(m => squad.votes && squad.votes[m.username] === 'continue').length;
    let totalMembers = squad.members.length;

    let shouldEvacuate = false;
    if (totalMembers <= 1) {
        shouldEvacuate = (evacCount > 0 || (squad.intermissionTimer <= 0 && contCount === 0));
    } else {
        shouldEvacuate = (evacCount >= Math.ceil(totalMembers / 2) || (squad.intermissionTimer <= 0 && contCount === 0));
    }

    if (shouldEvacuate) {
        squad.status = 'ended';
        squad.members.forEach(m => {
            let mp = db.players[m.username];
            if (mp) {
                mp.location = 'safe_room';
                if (mp.hp <= 0) mp.hp = 50;
            }
        });
        broadcastToSquad(squad, 'raidSortieEnded', {
            win: true,
            evacuated: true,
            clearedWave: squad.clearedWave,
            reason: 'ОТРЯД ПРИНЯЛ РЕШЕНИЕ ЭВАКУИРОВАТЬСЯ В ЖИЛЯЧЕЙКУ С ТРОФЕЯМИ!'
        });
        delete coopSquads[squad.id];
        saveDB();
        broadcastGameState();
        return;
    }

    squad.currentWave = (squad.clearedWave || squad.currentWave) + 1;
    squad.votes = {};
    if (squad.currentWave <= 10) {
        let mob = RAID_WAVE_MONSTERS[squad.currentWave - 1];
        let hpMult = 1 + (squad.members.length - 1) * 0.45;
        squad.enemy = {
            name: mob.name,
            hp: Math.floor(mob.hp * hpMult),
            maxHp: Math.floor(mob.hp * hpMult),
            dmg: mob.dmg,
            def: mob.def,
            reward: mob.reward,
            xp: mob.xp,
            img: mob.img,
            tier: mob.tier
        };
        squad.eTimer = 2.5;
        squad.logs.push('[ВОЛНА ' + squad.currentWave + '/11] Штурм продолжается! Появился ' + squad.enemy.name + '!');
        broadcastToSquad(squad, 'playSound', 'buy');
    } else if (squad.currentWave === 11) {
        let bossRoll = Math.random() < 0.5 ? 'blue' : 'purple';
        let bossConfig = RAID_ELITE_BOSSES[bossRoll];
        let hpMult = 1 + (squad.members.length - 1) * 0.5;
        squad.enemy = {
            name: bossConfig.name,
            hp: Math.floor(bossConfig.hp * hpMult),
            maxHp: Math.floor(bossConfig.hp * hpMult),
            dmg: bossConfig.dmg,
            def: bossConfig.def,
            reward: bossConfig.reward,
            xp: bossConfig.xp,
            img: bossConfig.img,
            tier: bossConfig.tier,
            colorTheme: bossConfig.colorTheme,
            badge: bossConfig.badge,
            lore: bossConfig.lore,
            lootTable: bossConfig.lootTable
        };
        squad.eTimer = 3.0;
        squad.logs.push('[ТРЕВОГА МАКСИМАЛЬНОГО УРОВНЯ] 10 волн отбито! ПОЯВИЛСЯ ' + squad.enemy.name + '! ' + squad.enemy.lore);
        broadcastToSquad(squad, 'playSound', 'defeat');
    }
    squad.status = 'combat';
    let sData = getSquadClientData(squad);
    broadcastToSquad(squad, 'raidWaveStarted', {
        currentWave: squad.currentWave,
        maxWaves: squad.maxWaves,
        enemy: squad.enemy,
        squad: sData,
        members: sData ? sData.members : []
    });
}

function getOnlinePlayersList() {
    let list = [];
    let seen = new Set();
    for (let sId in onlinePlayers) {
        let u = onlinePlayers[sId];
        if (u && !seen.has(u)) {
            seen.add(u);
            let p = db.players[u];
            let activeSquad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === u));
            let statusText = 'В жилячейке';
            if (activeSquad) {
                statusText = activeSquad.status === 'combat' ? '⚔️ Рейд: В ' + activeSquad.currentWave + '/11' : '👥 В лобби рейда';
            } else if (p && p.location !== 'safe_room') {
                statusText = '🧭 Блок (Эт. ' + (p.floor || 0) + ')';
            }
            list.push({
                username: u,
                level: p ? p.level : 1,
                title: p ? (p.title || 'Заключенный') : 'Заключенный',
                floor: p ? (p.floor || 0) : 0,
                location: p ? (p.location || 'safe_room') : 'safe_room',
                statusText: statusText,
                inCombat: !!(activeCombats[u] || (activeSquad && activeSquad.status === 'combat'))
            });
        }
    }
    return list;
}

function getSpeedMult(filter) { if (filter >= 65) return 1.25; if (filter >= 45) return 1.0; if (filter >= 20) return 0.8; return 0.5; }

const BASE_EQUIP = {
    weapon_wood: { name: "Деревяшка с гвоздями", type: "weapon", cost: 50, dmg: 5, def: 0, reqLevel: 1 },
    weapon_pipe: { name: "Тяжелый вентиль", type: "weapon", cost: 100, dmg: 8, def: 0, reqLevel: 3 },
    weapon_crowbar: { name: "Ржавая монтировка", type: "weapon", cost: 150, dmg: 14, def: 0, reqLevel: 6 },
    weapon_machete: { name: "Самодельный мачете", type: "weapon", cost: 250, dmg: 20, def: 0, reqLevel: 6 },
    weapon_axe: { name: "Пожарный топор", type: "weapon", cost: 350, dmg: 28, def: 0, reqLevel: 10 },
    weapon_spear: { name: "Арматурное копье", type: "weapon", cost: 450, dmg: 35, def: 0, reqLevel: 10 },
    weapon_chainsaw: { name: "Ржавая бензопила", type: "weapon", cost: 600, dmg: 48, def: 0, reqLevel: 12 },
    weapon_pistol: { name: "Пистолет Макарова", type: "weapon", cost: 900, dmg: 65, def: 0, reqLevel: 15 },
    weapon_shotgun: { name: "Дробовик КС-23", type: "weapon", cost: 1500, dmg: 90, def: 0, reqLevel: 18 },
    weapon_flamethrower: { name: "Огнемет Самосбора", type: "weapon", cost: 2500, dmg: 130, def: 0, reqLevel: 22 },
    clothes_robe: { name: "Тюремная роба", type: "clothes", cost: 20, dmg: 0, def: 2, reqLevel: 1 },
    clothes_worker: { name: "Спецовка сантехника", type: "clothes", cost: 50, dmg: 0, def: 5, reqLevel: 2 },
    clothes_ozk: { name: "Костюм химзащиты (ОЗК)", type: "clothes", cost: 80, dmg: 0, def: 10, reqLevel: 4 },
    clothes_guard: { name: "Форма ВОХР", type: "clothes", cost: 150, dmg: 0, def: 16, reqLevel: 6 },
    clothes_stalker: { name: "Плащ сталкера", type: "clothes", cost: 250, dmg: 0, def: 24, reqLevel: 8 },
    clothes_scout: { name: "Броня разведчика", type: "clothes", cost: 400, dmg: 0, def: 35, reqLevel: 11 },
    clothes_hazmat: { name: "Тяжелый хазмат", type: "clothes", cost: 600, dmg: 0, def: 48, reqLevel: 14 },
    clothes_kevlar: { name: "Кевларовый жилет", type: "clothes", cost: 900, dmg: 0, def: 65, reqLevel: 17 },
    clothes_exosuit: { name: "Экзоскелет грузчика", type: "clothes", cost: 1500, dmg: 0, def: 90, reqLevel: 20 },
    clothes_liquidator: { name: "Броня Ликвидатора", type: "clothes", cost: 3000, dmg: 0, def: 120, reqLevel: 25 },
    mask_cloth: { name: "Тряпичная маска", type: "mask", cost: 10, dmg: 0, def: 1, reqLevel: 1 },
    mask_respirator: { name: "Респиратор Лепесток", type: "mask", cost: 30, dmg: 0, def: 2, reqLevel: 2 },
    mask_gp5: { name: "Противогаз ГП-5", type: "mask", cost: 50, dmg: 0, def: 4, reqLevel: 4 },
    mask_tactical: { name: "Шлем Заслон", type: "mask", cost: 250, dmg: 0, def: 12, reqLevel: 10 },
    backpack_small: { name: "Вещмешок", type: "backpack", cost: 200, def: 0, reqLevel: 2, bonusCap: 4 },
    backpack_med: { name: "Рюкзак сталкера", type: "backpack", cost: 600, def: 0, reqLevel: 6, bonusCap: 8 },
    backpack_large: { name: "Тактический короб", type: "backpack", cost: 1500, def: 0, reqLevel: 12, bonusCap: 12 }
};

const RARITIES = [
    { id: 'common', name: '', mult: 1, color: '#aaaaaa', paperColor: '#333333', lvlBonus: 0 },
    { id: 'uncommon', name: 'Улучш. ', mult: 1.25, color: '#33ff33', paperColor: '#006600', lvlBonus: 1 },
    { id: 'rare', name: 'Редкий ', mult: 1.5, color: '#33aaff', paperColor: '#0033aa', lvlBonus: 2 },
    { id: 'epic', name: 'Эпич. ', mult: 2.0, color: '#aa33ff', paperColor: '#5500aa', lvlBonus: 4 },
    { id: 'legendary', name: 'ЛЕГЕНДАРНЫЙ ', mult: 3.0, color: '#ffaa00', paperColor: '#a65300', lvlBonus: 7 }
];

const ELEMENTS = [
    { id: '', suffix: '', dmgMult: 1 },
    { id: '_fire', suffix: ' 🔥', dmgMult: 1.15, isFire: true },
    { id: '_electro', suffix: ' ⚡', dmgMult: 1.10, isElectro: true },
    { id: '_bleed', suffix: ' 🩸', dmgMult: 1.05, isBleed: true }
];

let GAME_ITEMS = {
    food_ration: { name: "Брикет слизи", type: "consumable", cost: 10, restoreFilter: 0, restoreHp: 10, restoreHunger: 40, color: '#fff', paperColor: '#222' },
    food_pure: { name: "Биоконцентрат", type: "consumable", cost: 25, restoreFilter: 50, restoreHp: 30, restoreHunger: 100, color: '#fff', paperColor: '#222' },
    food_medkit: { name: "Военная аптечка", type: "consumable", cost: 60, restoreFilter: 0, restoreHp: 60, restoreHunger: 0, color: '#fff', paperColor: '#222' },
    food_energy: { name: "Энергетик", type: "consumable", cost: 40, restoreFilter: 80, restoreHp: 0, restoreHunger: 10, color: '#fff', paperColor: '#222' },
    special_knife: { name: "Метательный нож", type: "special", cost: 30, combatDmg: 20, color: '#ff3333', paperColor: '#880000' },
    special_shocker: { name: "Электрошокер", type: "special", cost: 60, combatDmg: 45, color: '#ff3333', paperColor: '#880000' },
    special_grenade: { name: "Граната Ф-1", type: "special", cost: 100, combatDmg: 90, color: '#ff3333', paperColor: '#880000' },
    mat_scrap: { name: "Кусок металла", type: "material", cost: 5, color: '#aaa', paperColor: '#444' },
    mat_tape: { name: "Изолента", type: "material", cost: 5, color: '#aaa', paperColor: '#444' },
    mat_chem: { name: "Химикаты", type: "material", cost: 10, color: '#33ff33', paperColor: '#006600', isCure: true },
    mat_electro: { name: "Электроника", type: "material", cost: 15, color: '#33aaff', paperColor: '#0033aa' },
    tool_scraper: { name: "Кустарный скребок", type: "tool", cost: 100, color: '#33ff33', paperColor: '#006600', desc: "+1 слизь" },
    tool_pump: { name: "Пневмонасос", type: "tool", cost: 400, color: '#33aaff', paperColor: '#0033aa', desc: "+3 слизи" },
    tool_harvester: { name: "Промо-экстрактор", type: "tool", cost: 1500, color: '#aa33ff', paperColor: '#5500aa', desc: "+7 слизи" },
    tool_robot: { name: "Автосборщик", type: "tool", cost: 500, color: '#ffaa00', paperColor: '#a65300', desc: "Добывает слизь автономно" },
    quest_boltcutter: { name: "Ржавый болторез", type: "quest", color: '#ffaa00', paperColor: '#a65300' },
    quest_battery: { name: "Топливный элемент", type: "quest", color: '#ffaa00', paperColor: '#a65300' },
    quest_red_card: { name: "Красная ключ-карта", type: "quest", color: '#ffaa00', paperColor: '#a65300' },
    quest_fuse: { name: "Предохранитель", type: "quest", color: '#ffaa00', paperColor: '#a65300' },
    quest_lift_repair: { name: "Ремкомплект лифта", type: "quest", color: '#ffaa00', paperColor: '#a65300' },
    quest_lift_buttons: { name: "Блок кнопок", type: "quest", color: '#ffaa00', paperColor: '#a65300' },
    quest_lift_wire: { name: "Провод генератора", type: "quest", color: '#ffaa00', paperColor: '#a65300' },

    // Сюжетные предметы Этажи 1-4 (Катакомбы ЖКХ)
    quest_wrench_heavy: { name: "Тяжелый разводной ключ", type: "quest", color: '#ffd27d', paperColor: '#a65300' },
    quest_pressure_valve: { name: "Клапан сброса давления", type: "quest", color: '#ffb03a', paperColor: '#a65300' },
    quest_coagulant: { name: "Канистра коагулянта", type: "quest", color: '#39ff14', paperColor: '#006600' },
    quest_pipe_patch: { name: "Свинцовая заплата", type: "quest", color: '#a8b5c2', paperColor: '#555' },
    quest_manometer: { name: "Манометр высокого давления", type: "quest", color: '#ffd84d', paperColor: '#a65300' },
    quest_boiler_crank: { name: "Вентильная рукоять", type: "quest", color: '#ff7733', paperColor: '#882200' },
    quest_slime_sample: { name: "Проба едкой слизи", type: "quest", color: '#c724e0', paperColor: '#660066' },
    quest_elevator_gear_1: { name: "Зубчатая шестерня лебедки", type: "quest", color: '#ffcc00', paperColor: '#a65300' },

    // Сюжетные предметы Этажи 5-9 (Спецархив и Бюрократия)
    quest_punchcard_secret: { name: "Секретная перфокарта", type: "quest", color: '#5ce1e6', paperColor: '#005577' },
    quest_cipher_disc: { name: "Диск шифратора «Энигма-Х»", type: "quest", color: '#ffc83b', paperColor: '#a65300' },
    quest_commissar_stamp: { name: "Печать комиссара", type: "quest", color: '#ff3333', paperColor: '#880000' },
    quest_magnetic_tape: { name: "Бобина спецвещания", type: "quest", color: '#40c4ff', paperColor: '#004488' },
    quest_archive_keycard: { name: "Ключ-карта Архивариуса", type: "quest", color: '#ff5252', paperColor: '#880000' },
    quest_elevator_cable_2: { name: "Бронированный трос", type: "quest", color: '#d0d8e0', paperColor: '#555' },

    // Сюжетные предметы Этажи 10-14 (Энергоблок и Реактор)
    quest_coolant_rod: { name: "Стержень охладителя", type: "quest", color: '#00e5ff', paperColor: '#006688' },
    quest_highvolt_relay: { name: "Высоковольтное реле", type: "quest", color: '#ffea00', paperColor: '#887700' },
    quest_copper_inductor: { name: "Медная катушка индуктивности", type: "quest", color: '#ff8533', paperColor: '#883300' },
    quest_dielectric_gloves: { name: "Диэлектрический изолятор", type: "quest", color: '#ff9100', paperColor: '#884400' },
    quest_lead_baffle: { name: "Свинцовая заслонка", type: "quest", color: '#ffd600', paperColor: '#666600' },
    quest_elevator_motor_3: { name: "Электропривод лифта", type: "quest", color: '#00e676', paperColor: '#006622' },

    // Сюжетные предметы Этажи 15-19 (Цитадель ВОХР)
    quest_vokhr_token: { name: "Жетон старшины ВОХР", type: "quest", color: '#ff3d00', paperColor: '#881100' },
    quest_officer_cipher: { name: "Блокнот с шифрами взвода", type: "quest", color: '#ff1744', paperColor: '#880011' },
    quest_decon_filter: { name: "Дегазационный фильтр", type: "quest", color: '#76ff03', paperColor: '#336600' },
    quest_brass_keys: { name: "Связка латунных ключей", type: "quest", color: '#ffc107', paperColor: '#775500' },
    quest_commandant_seal: { name: "Магнитная пломба коменданта", type: "quest", color: '#d50000', paperColor: '#660000' },
    quest_elevator_hydraulic_4: { name: "Гидроцилиндр клети", type: "quest", color: '#00b0ff', paperColor: '#004477' },

    // Сюжетные предметы Этажи 20-24 (Мясные Катакомбы и Культ)
    quest_meat_relic: { name: "Окаменевший мясной нарост", type: "quest", color: '#ff1744', paperColor: '#880011' },
    quest_bone_chisel: { name: "Костяное зубило сектантов", type: "quest", color: '#eceff1', paperColor: '#555' },
    quest_ritual_chalice: { name: "Чаша крови тумана", type: "quest", color: '#d500f9', paperColor: '#660077' },
    quest_cult_psalter: { name: "Псалтырь Неизбежного Тумана", type: "quest", color: '#aa00ff', paperColor: '#550077' },
    quest_flesh_key: { name: "Живой ключ-симбиот", type: "quest", color: '#ff4081', paperColor: '#770033' },
    quest_elevator_seal_5: { name: "Очистительный знак лифта", type: "quest", color: '#ff007f', paperColor: '#770033' },

    // Сюжетные предметы Этажи 25-29 (Чрево Чернобога)
    quest_singularity_core: { name: "Сгусток времени", type: "quest", color: '#7c4dff', paperColor: '#330088' },
    quest_black_prism: { name: "Призма черного стекла", type: "quest", color: '#b388ff', paperColor: '#441188' },
    quest_master_blueprint: { name: "Истинный чертеж Гигахрущевки", type: "quest", color: '#00e5ff', paperColor: '#005577' },
    quest_reality_anchor: { name: "Якорь реальности", type: "quest", color: '#ffab00', paperColor: '#885500' },
    quest_chernobog_key: { name: "Ключ разрыва цикла", type: "quest", color: '#ff1744', paperColor: '#880000' },
    quest_elevator_final_key: { name: "Ключ Бездны", type: "quest", color: '#ffffff', paperColor: '#222' }
};

for (let key in BASE_EQUIP) {
    RARITIES.forEach(r => {
        ELEMENTS.forEach(el => {
            if (BASE_EQUIP[key].type !== 'weapon' && el.id !== '') return;
            let rKey = r.id === 'common' ? key : `${key}_${r.id}`;
            let fullKey = rKey + el.id;
            GAME_ITEMS[fullKey] = {
                name: r.name + BASE_EQUIP[key].name + el.suffix,
                type: BASE_EQUIP[key].type,
                reqLevel: BASE_EQUIP[key].reqLevel + r.lvlBonus,
                cost: Math.floor(BASE_EQUIP[key].cost * r.mult * r.mult * (el.id ? 1.5 : 1)),
                dmg: Math.floor((BASE_EQUIP[key].dmg || 0) * r.mult * el.dmgMult),
                def: Math.floor((BASE_EQUIP[key].def || 0) * r.mult),
                color: r.color, paperColor: r.paperColor, iconId: key,
                bonusCap: BASE_EQUIP[key].bonusCap,
                isFire: el.isFire, isElectro: el.isElectro, isBleed: el.isBleed
            };
        });
    });
}

function rollItemWithRarity(baseId) {
    if (!BASE_EQUIP[baseId]) return baseId;
    let roll = Math.random();
    if (roll < 0.02) return baseId + '_legendary';
    if (roll < 0.08) return baseId + '_epic';
    if (roll < 0.20) return baseId + '_rare';
    if (roll < 0.45) return baseId + '_uncommon';
    return baseId;
}

function getMaxInv(player) {
    let cap = 12;
    if (player.equipment && player.equipment.backpack && GAME_ITEMS[player.equipment.backpack]) {
        cap += GAME_ITEMS[player.equipment.backpack].bonusCap || 0;
    }
    return cap;
}

const MUTATIONS = [
    { id: 'mut_thick_skin', name: 'Толстая кожа', desc: 'Урон от врагов снижен на 20%, но Фильтр тратится в 2 раза быстрее.' },
    { id: 'mut_adrenaline', name: 'Адреналиновая железа', desc: 'Ваш урон увеличен на 30%, но Голод растет быстрее.' },
    { id: 'mut_toxic_blood', name: 'Токсичная кровь', desc: 'Заражение больше не растет, но вы не можете лечиться Аптечками.' }
];

const GAME_PERKS = [
    { id: 'perk_health', name: 'Бычий Свинец', desc: '+25 к Максимальному HP.' },
    { id: 'perk_lungs', name: 'Луженые Легкие', desc: 'Расход фильтра в Тумне снижен до 7%.' },
    { id: 'perk_butcher', name: 'Мясник', desc: 'Урон от Прицельной атаки (Крита) увеличен на 30%.' },
    { id: 'perk_hoarder', name: 'Барахольщик', desc: 'Шанс выпадения лута с врагов увеличен.' },
    { id: 'perk_vampire', name: 'Вампиризм', desc: 'Восстанавливает 5 HP при убийстве врага.' }
];

// --- СИСТЕМА ДОСТИЖЕНИЙ (АЧИВКИ САМОСБОРА) ---
const ACHIEVEMENTS_LIST = [
    // 1. УБИЙСТВО МОНСТРОВ
    { id: 'ach_kill_1', category: 'combat', icon: '🩸', name: 'Первая кровь', name_en: 'First Blood', desc: 'Уничтожить первого монстра Самосбора в катакомбах.', desc_en: 'Slay your first Samosbor creature in the catacombs.', target: 1, stat: 'monstersKilled', rewardTalons: 50, rewardXp: 25 },
    { id: 'ach_kill_25', category: 'combat', icon: '⚔️', name: 'Ликвидатор слизи', name_en: 'Slime Liquidator', desc: 'Истребить 25 порождений Тумана.', desc_en: 'Exterminate 25 spawns of the Fog.', target: 25, stat: 'monstersKilled', rewardTalons: 200, rewardXp: 100 },
    { id: 'ach_kill_100', category: 'combat', icon: '💀', name: 'Чистильщик блоков', name_en: 'Sector Purifier', desc: 'Уничтожить 100 мутантов и тварей.', desc_en: 'Destroy 100 mutants and horrors.', target: 100, stat: 'monstersKilled', rewardTalons: 500, rewardXp: 300 },
    { id: 'ach_kill_500', category: 'combat', icon: '☠️', name: 'Бич Самосбора', name_en: 'Scourge of Samosbor', desc: 'Истребить 500 порождений Гигахрущевки.', desc_en: 'Wipe out 500 abominations of the Megastructure.', target: 500, stat: 'monstersKilled', rewardTalons: 1500, rewardXp: 1000 },

    // 2. УБИЙСТВО БОССОВ
    { id: 'ach_boss_1', category: 'boss', icon: '👹', name: 'Смерть титану', name_en: 'Titan Falls', desc: 'Сразить первого босса шахтного лифта.', desc_en: 'Defeat your first Elevator Guardian boss.', target: 1, stat: 'bossesKilled', rewardTalons: 300, rewardXp: 200 },
    { id: 'ach_boss_5', category: 'boss', icon: '🛡️', name: 'Усмиритель гигантов', name_en: 'Giant Subduer', desc: 'Победить 5 боссов в глубинах Хруща.', desc_en: 'Overcome 5 bosses in the depths of the complex.', target: 5, stat: 'bossesKilled', rewardTalons: 800, rewardXp: 600 },
    { id: 'ach_boss_10', category: 'boss', icon: '👑', name: 'Владыка глубин', name_en: 'Lord of the Deeps', desc: 'Одержать победу над 10 уникальными боссами этажей.', desc_en: 'Defeat 10 unique floor bosses.', target: 10, stat: 'bossesKilled', rewardTalons: 2000, rewardXp: 1500 },

    // 3. ПРОХОДКА ЭТАЖЕЙ
    { id: 'ach_floor_5', category: 'floor', icon: '🛗', name: 'Спуск в Спецархив', name_en: 'Descent to Archive', desc: 'Спуститься на 5-й этаж Гигахрущевки.', desc_en: 'Descend to Floor 5 of the Megastructure.', target: 5, stat: 'maxFloor', rewardTalons: 250, rewardXp: 150 },
    { id: 'ach_floor_10', category: 'floor', icon: '☢️', name: 'Зона Реактора', name_en: 'Reactor Core Zone', desc: 'Достичь 10-го этажа сквозь радиацию и распад.', desc_en: 'Reach Floor 10 through radiation and decay.', target: 10, stat: 'maxFloor', rewardTalons: 600, rewardXp: 400 },
    { id: 'ach_floor_20', category: 'floor', icon: '🌌', name: 'Врата Чернобога', name_en: 'Gates of Chernobog', desc: 'Пробиться сквозь плоть на 20-й горизонт.', desc_en: 'Break through flesh to Floor 20.', target: 20, stat: 'maxFloor', rewardTalons: 1200, rewardXp: 800 },
    { id: 'ach_floor_all', category: 'floor', icon: '🏆', name: 'Покоритель Хруща', name_en: 'Master of the Megastructure', desc: 'Достичь финального 30-го этажа Бездны.', desc_en: 'Reach the final 30th floor of the Abyss.', target: 30, stat: 'maxFloor', rewardTalons: 3000, rewardXp: 2500 },

    // 4. ОТКРЫТИЕ ДВЕРЕЙ И СЕКТОРОВ
    { id: 'ach_doors_10', category: 'explore', icon: '🚪', name: 'Взломщик', name_en: 'Breaker', desc: 'Взломать и открыть 10 заблокированных гермодверей.', desc_en: 'Breach and open 10 locked blast doors.', target: 10, stat: 'roomsCleared', rewardTalons: 150, rewardXp: 80 },
    { id: 'ach_doors_50', category: 'explore', icon: '🗝️', name: 'Ключник Самосбора', name_en: 'Master Locksmith', desc: 'Открыть 50 секторов и гермозатворов.', desc_en: 'Open 50 sectors and airlocks.', target: 50, stat: 'roomsCleared', rewardTalons: 500, rewardXp: 350 },
    { id: 'ach_doors_100', category: 'explore', icon: '🔓', name: 'Мастер деблокировки', name_en: 'Unstoppable Breacher', desc: 'Открыть 100 герметичных створок в Жилом Блоке.', desc_en: 'Open 100 sealed doors across the Complex.', target: 100, stat: 'roomsCleared', rewardTalons: 1200, rewardXp: 800 },
    { id: 'ach_floor_full', category: 'explore', icon: '🗺️', name: 'Полная зачистка', name_en: 'Total Cleansing', desc: 'Разблокировать все 25 секторов (A0–E4) на одном этаже.', desc_en: 'Unlock all 25 sectors (A0 through E4) on a single floor.', target: 1, stat: 'fullFloorsCleared', rewardTalons: 400, rewardXp: 300 },

    // 5. ОТКРЫТИЕ ЗАГАДОК И МИНИ-ИГР
    { id: 'ach_puzzle_1', category: 'puzzles', icon: '💡', name: 'Первая искра', name_en: 'First Spark', desc: 'Решить первую загадку, шифр или мини-игру коммутации.', desc_en: 'Solve your first riddle, cipher, or circuit minigame.', target: 1, stat: 'puzzlesSolved', rewardTalons: 100, rewardXp: 50 },
    { id: 'ach_puzzle_10', category: 'puzzles', icon: '🧩', name: 'Инженер-дешифровщик', name_en: 'Codebreaker Engineer', desc: 'Решить 10 головоломок с замками, проводами и цепями.', desc_en: 'Solve 10 puzzle challenges across the sectors.', target: 10, stat: 'puzzlesSolved', rewardTalons: 400, rewardXp: 250 },
    { id: 'ach_puzzle_30', category: 'puzzles', icon: '⚡', name: 'Тесла Самосбора', name_en: 'Tesla of the Complex', desc: 'Преодолеть 30 головоломок коммутации, шифров и замков.', desc_en: 'Master 30 circuit, cipher, and lock-cutting challenges.', target: 30, stat: 'puzzlesSolved', rewardTalons: 1000, rewardXp: 700 },

    // 6. ПОЛУЧЕНИЕ РЕДКИХ ПРЕДМЕТОВ
    { id: 'ach_rare_item', category: 'items', icon: '💎', name: 'Ценная находка', name_en: 'Valuable Find', desc: 'Получить предмет редкого (синего) качества.', desc_en: 'Acquire an item of Rare (Blue) quality.', target: 1, stat: 'hasRare', rewardTalons: 150, rewardXp: 100 },
    { id: 'ach_epic_item', category: 'items', icon: '🔮', name: 'Реликт Партии', name_en: 'Party Relic', desc: 'Найти эпический (фиолетовый) предмет экипировки.', desc_en: 'Obtain an Epic (Purple) quality gear piece.', target: 1, stat: 'hasEpic', rewardTalons: 400, rewardXp: 300 },
    { id: 'ach_legendary_item', category: 'items', icon: '⭐', name: 'Легенда Бетона', name_en: 'Concrete Legend', desc: 'Завладеть легендарным (золотым) снаряжением.', desc_en: 'Possess a Legendary (Gold) tier artifact.', target: 1, stat: 'hasLegendary', rewardTalons: 1000, rewardXp: 700 },
    { id: 'ach_full_gear', category: 'items', icon: '🪖', name: 'В полном снаряжении', name_en: 'Fully Equipped', desc: 'Экипировать сразу все 4 слота (Оружие, Респиратор, Костюм, Вещмешок).', desc_en: 'Equip all 4 equipment slots simultaneously.', target: 1, stat: 'isFullyEquipped', rewardTalons: 200, rewardXp: 150 }
];

function checkPlayerAchievements(p, socket) {
    if (!p) return [];
    if (!p.achievements || typeof p.achievements !== 'object' || Array.isArray(p.achievements)) {
        p.achievements = {};
    }

    let allItemIds = [...(p.inventory || []), ...(p.storage || [])];
    if (p.equipment) {
        if (p.equipment.weapon) allItemIds.push(p.equipment.weapon);
        if (p.equipment.mask) allItemIds.push(p.equipment.mask);
        if (p.equipment.suit) allItemIds.push(p.equipment.suit);
        if (p.equipment.backpack) allItemIds.push(p.equipment.backpack);
    }
    let hasRare = allItemIds.some(id => String(id).includes('_rare') || String(id).includes('_epic') || String(id).includes('_legendary')) ? 1 : 0;
    let hasEpic = allItemIds.some(id => String(id).includes('_epic') || String(id).includes('_legendary')) ? 1 : 0;
    let hasLegendary = allItemIds.some(id => String(id).includes('_legendary')) ? 1 : 0;
    let isFullyEquipped = (p.equipment && p.equipment.weapon && p.equipment.mask && p.equipment.suit && p.equipment.backpack) ? 1 : 0;

    let fullFloorsCleared = 0;
    if (p.unlockedSectors && typeof p.unlockedSectors === 'object') {
        for (let fl in p.unlockedSectors) {
            if (Array.isArray(p.unlockedSectors[fl]) && p.unlockedSectors[fl].length >= 25) {
                fullFloorsCleared = 1;
                break;
            }
        }
    }

    let bossesCount = Math.max(p.bossesKilled || 0, Object.keys(p.bossDefeated || {}).length);
    let puzzlesCount = Math.max(p.puzzlesSolved || 0, (p.solvedGames ? p.solvedGames.length : 0));

    const metrics = {
        monstersKilled: p.monstersKilled || 0,
        bossesKilled: bossesCount,
        maxFloor: Math.max(p.maxFloor || 0, p.floor || 0),
        roomsCleared: p.roomsCleared || 0,
        puzzlesSolved: puzzlesCount,
        fullFloorsCleared: fullFloorsCleared,
        hasRare: hasRare,
        hasEpic: hasEpic,
        hasLegendary: hasLegendary,
        isFullyEquipped: isFullyEquipped
    };

    let newlyUnlocked = [];
    ACHIEVEMENTS_LIST.forEach(ach => {
        if (!p.achievements[ach.id]) {
            let currentVal = metrics[ach.stat] || 0;
            if (currentVal >= ach.target) {
                p.achievements[ach.id] = { unlockedAt: Date.now() };
                p.talons = (p.talons || 0) + (ach.rewardTalons || 0);
                p.xp = (p.xp || 0) + (ach.rewardXp || 0);
                if (p.notebook) {
                    p.notebook.push(`[🏆 ДОСТИЖЕНИЕ]: Получено «${ach.name}»! (+${ach.rewardTalons} талонов, +${ach.rewardXp} XP)`);
                }
                newlyUnlocked.push(ach);
                if (socket) {
                    socket.emit('achievementUnlocked', ach);
                    socket.emit('playSound', 'victory');
                }
            }
        }
    });

    return newlyUnlocked;
}

const { RIDDLES_150 } = require('./riddles.js');

// --- ИНТЕРАКТИВНЫЕ ASCII МИНИ-ИГРЫ САМОСБОРА ---
const PHYSICAL_MINIGAMES = [
    // 1. ПЕРЕПИЛИВАНИЕ / СРЕЗАНИЕ ЗАМКОВ (Кликайте/жмакайте по экрану/замку чтобы перепилить дужку!)
    {
        id: 'mg_cut_rust',
        type: 'lock_cut',
        title: 'РЖАВЫЙ НАВЕСНОЙ ЗАМОК',
        title_en: 'RUSTED PADLOCK',
        text: 'Створки гермозатвора скованы старым навесным замком «ЧАЗ». Металл источен сыростью. Нажимайте на экран или кнопку резки, чтобы перепилить дужку ножовкой!',
        text_en: 'The blast doors are locked with an old padlock. The metal is corroded by dampness. Tap or click rapidly on the screen to saw through the shackle!',
        clickPower: 8,
        target: 100
    },
    {
        id: 'mg_cut_chain',
        type: 'lock_cut',
        title: 'ТЯЖЕЛАЯ СТАЛЬНАЯ ЦЕПЬ',
        title_en: 'HEAVY STEEL CHAIN',
        text: 'Противопожарная решетка обмотана каленой якорной цепью. Быстро жмите на экран или кнопку, чтобы перекусить звенья гидравлическим болторезом!',
        text_en: 'The fire gate is wrapped in a heavy mooring chain. Rapidly tap or click to snap the chain links with bolt cutters!',
        clickPower: 7,
        target: 100
    },
    {
        id: 'mg_cut_vokhr',
        type: 'lock_cut',
        title: 'БРОНЕЗАМОК ВОХР',
        title_en: 'VOKHR ARMORED LOCK',
        text: 'Усиленный караульный замок с защитной титановой планкой. Требуется непрерывный распил ножовкой по металлу. Не сбавляйте темп!',
        text_en: 'Reinforced security lock with titanium guard plate. Continuous sawing required. Keep up the rapid pace!',
        clickPower: 6,
        target: 100
    },
    {
        id: 'mg_cut_cable',
        type: 'lock_cut',
        title: 'СИЛОВОЙ НАТЯЖНОЙ ТРОС',
        title_en: 'HIGH-TENSION CABLE',
        text: 'Гермозатвор заклинен сорванным тросом шахтного подъемника. Перепиливайте каленые стальные жилы быстрыми нажатиями!',
        text_en: 'The blast door is jammed by a snapped elevator winch cable. Saw through the hardened steel strands with rapid taps!',
        clickPower: 7,
        target: 100
    },
    {
        id: 'mg_cut_bio',
        type: 'lock_cut',
        title: 'ОКАМЕНЕВШИЙ НАРОСТ ПЛОТИ',
        title_en: 'PETRIFIED FLESH GROWTH',
        text: 'Хрящевая биомасса Самосбора залила ригели засова и окаменела. Наносите частые рубящие удары тесаком, чтобы расколоть нарост!',
        text_en: 'Samosbor cartilaginous biomass flooded the latch bolts and hardened. Deliver rapid slashing strikes to hack through the growth!',
        clickPower: 8,
        target: 100
    },

    // 2. ПЕРЕКУСЫВАНИЕ ПРОВОДОВ / РАЗМИНИРОВАНИЕ
    {
        id: 'mg_wire_solenoid',
        type: 'wire_cut',
        title: 'ЭЛЕКТРОМАГНИТНЫЙ ЗАМОК',
        title_en: 'ELECTROMAGNETIC LOCK',
        text: 'Инструкция электрика: «Питание соленоида идет по ЖЕЛТОМУ проводу. Красный активирует сирену, синий — детонатор разряда, зеленый — заземление». Перекусите провод соленоида!',
        text_en: 'Electrician manual: "Solenoid power runs through the YELLOW wire. Red triggers alarm siren, blue powers detonator, green is ground". Cut the solenoid wire!',
        wires: ['КРАСНЫЙ', 'СИНИЙ', 'ЖЕЛТЫЙ', 'ЗЕЛЕНЫЙ'],
        wires_en: ['RED', 'BLUE', 'YELLOW', 'GREEN'],
        destinations: ['СИРЕНА', 'ДЕТОНАТОР', 'СОЛЕНОИД (ЦЕЛЬ)', 'ЗАЗЕМЛЕНИЕ'],
        destinations_en: ['SIREN', 'DETONATOR', 'SOLENOID (TARGET)', 'GROUND'],
        correctWire: 2
    },
    {
        id: 'mg_wire_trap',
        type: 'wire_cut',
        title: 'РАСТЯЖКА СИСТЕМЫ ОХРАНЫ',
        title_en: 'DEFENSE TRIPWIRE',
        text: 'Схема разминирования: «Для безопасного обесточивания ловушки перекусите СИНИЙ провод деактивации. Красный замкнет запал!»',
        text_en: 'Defusal schematic: "To safely disarm the explosive latch, cut the BLUE bypass line. Red will trip the fuse!"',
        wires: ['КРАСНЫЙ', 'СИНИЙ', 'БЕЛЫЙ', 'ЧЕРНЫЙ'],
        wires_en: ['RED', 'BLUE', 'WHITE', 'BLACK'],
        destinations: ['ЗАПАЛ', 'ДЕАКТИВАЦИЯ (ЦЕЛЬ)', 'КОНДЕНСАТОР', 'КОРПУС'],
        destinations_en: ['FUSE', 'DISARM (TARGET)', 'CAPACITOR', 'CHASSIS'],
        correctWire: 1
    },
    {
        id: 'mg_wire_barrier',
        type: 'wire_cut',
        title: 'СИЛОВОЙ БАРЬЕР ШЛЮЗА',
        title_en: 'AIRLOCK FORCE BARRIER',
        text: 'Аварийный протокол: «Трансформатор барьера запитан через КРАСНЫЙ высоковольтный ввод. Перекусите его для отключения поля».',
        text_en: 'Emergency protocol: "The force field transformer is fed by the RED high-voltage input. Sever it to collapse the barrier".',
        wires: ['КРАСНЫЙ', 'ЖЕЛТЫЙ', 'ЗЕЛЕНЫЙ', 'СИНИЙ'],
        wires_en: ['RED', 'YELLOW', 'GREEN', 'BLUE'],
        destinations: ['ТРАНСФОРМАТОР (ЦЕЛЬ)', 'СИГНАЛИЗАТОР', 'РЕЗЕРВНАЯ ШИНА', 'ЗАЩИТНОЕ РЕЛЕ'],
        destinations_en: ['TRANSFORMER (TARGET)', 'ALARM', 'STANDBY BUS', 'SAFETY RELAY'],
        correctWire: 0
    },
    {
        id: 'mg_wire_relay',
        type: 'wire_cut',
        title: 'РЕЛЕ САМОСБОРА',
        title_en: 'SAMOSBOR RELAY JUNCTION',
        text: 'Журнал дежурного: «Контур аварийной герметизации шунтируется через ЗЕЛЕНУЮ шину. Разорвите ее кусачками».',
        text_en: 'Duty log: "Airlock sealing loop is shunted via the GREEN busbar. Snip it with wire cutters".',
        wires: ['СЕРЫЙ', 'ЗЕЛЕНЫЙ', 'КОРИЧНЕВЫЙ', 'СИНИЙ'],
        wires_en: ['GRAY', 'GREEN', 'BROWN', 'BLUE'],
        destinations: ['ДАТЧИК ДАВЛЕНИЯ', 'ШУНТ ГЕРМЕТИЗАЦИИ (ЦЕЛЬ)', 'ТЕРМОПАРА', 'СИЛОВОЙ КОНТАКТОР'],
        destinations_en: ['PRESSURE SENSOR', 'SEALING SHUNT (TARGET)', 'THERMOCOUPLE', 'POWER CONTACTOR'],
        correctWire: 1
    },

    // 3. ВЕНТИЛЬ СБРОСА ДАВЛЕНИЯ
    {
        id: 'mg_valve_steam',
        type: 'valve_turn',
        title: 'СБРОС ПЕРЕГРЕТОГО ПАРА',
        title_en: 'SUPERHEATED STEAM PURGE',
        text: 'Гидрозатвор заблокирован давлением 160 kPa. Вращайте маховик вентиля нажатиями, чтобы стравить пар до нуля!',
        text_en: 'Airlock is locked by 160 kPa pressure. Rotate the valve wheel with rapid turns to bleed steam down to 0 kPa!',
        startPressure: 160,
        step: 20
    },
    {
        id: 'mg_valve_chlorine',
        type: 'valve_turn',
        title: 'ПРОДУВКА ХЛОРНОЙ МАГИСТРАЛИ',
        title_en: 'CHLORINE LINE FLUSH',
        text: 'В шлюзе скопился тяжелый хлор. Откройте продувочный клапан быстрыми оборотами маховика до сброса давления!',
        text_en: 'Toxic chlorine gas trapped in airlock. Crank the purge valve open until pressure equalizes!',
        startPressure: 140,
        step: 20
    },
    {
        id: 'mg_valve_hydraulic',
        type: 'valve_turn',
        title: 'РУЧНОЙ ГИДРОНАСОС',
        title_en: 'HYDRAULIC MANUAL PUMP',
        text: 'Защитная бронеплита опущена. Вращайте вентиль насоса, чтобы сбросить гидрозамок затвора!',
        text_en: 'Blast plate is locked down. Rotate the hydraulic relief valve to release the deadbolts!',
        startPressure: 180,
        step: 25
    },

    // 4. НАСТРОЙКА РЕЗОНАНСНОЙ ЧАСТОТЫ
    {
        id: 'mg_freq_radio',
        type: 'frequency_tune',
        title: 'РАДИОМАЯК ВОХР',
        title_en: 'VOKHR RADIO BEACON',
        text: 'Поймайте несущую частоту радиоканала маяка (440 MHz). Подстройте сигнал кнопками [+/-] до точного совпадения!',
        text_en: 'Acquire carrier frequency of the beacon (440 MHz). Adjust tuning with [+/-] buttons until exact match!',
        targetFreq: 440,
        startFreq: 380,
        unit: 'MHz'
    },
    {
        id: 'mg_freq_sonar',
        type: 'frequency_tune',
        title: 'АКУСТИЧЕСКИЙ РЕЗОНАТОР',
        title_en: 'ACOUSTIC RESONATOR',
        text: 'Совместите частоту ультразвукового генератора (125 kHz) для разблокировки акустического пьезо-замка!',
        text_en: 'Align ultrasonic generator frequency (125 kHz) to unlock the acoustic piezo-latch!',
        targetFreq: 125,
        startFreq: 85,
        unit: 'kHz'
    }
];

// Логические шифры и калибровка напряжения
const LOGIC_MINIGAMES = [
    { id: 'mg_code_3', type: 'password', title: 'ШИФРОГРАММА ПАРТИИ', text: 'На терминале надпись: «Год великой закладки фундамента Жилого Блока №7». Код в архиве: 1984.', answer: '1984' },
    { id: 'mg_code_4', type: 'password', title: 'АВАРИЙНЫЙ ШЛЮЗ ГАЗА', text: 'Шифр замка: номера букв в слове Г-А-З (Г=4, А=1, З=9). Введите 4-значный код с ведущим нулем.', answer: '0419' },
    { id: 'mg_code_5', type: 'password', title: 'АРХИВНЫЙ КОД НКВД', text: 'Инструкция: «Первая цифра 7, каждая последующая на 2 меньше предыдущей (7, 5, 3, 1)».', answer: '7531' },
    { id: 'mg_code_6', type: 'password', title: 'ЯДЕРНЫЙ БЛОКИРАТОР', text: 'Умножьте 12 на 12 и прибавьте номер аварийного сектора (40). Введите 4-значный код (0184).', answer: '0184' },
    { id: 'mg_code_7', type: 'password', title: 'ПАСПОРТНЫЙ СТОЛ', text: 'Штамп на стене: «Прогрессия кратна трем: 3, 6, 9, затем 2 (остаток цикла)».', answer: '3692' },
    { id: 'mg_code_8', type: 'password', title: 'ШИФР КУЛЬТИСТОВ ПЛОТИ', text: 'Надпись кровью: «Число очей у трех пауков тумана и двух крыс (3*8 + 2*2 = 28)». Введите 4 цифры (0028).', answer: '0028' },
    { id: 'mg_code_9', type: 'password', title: 'ТЕЛЕТАЙП СВЯЗИ', text: 'В формуле резонанса: половина от 1000 минус 80. Полученное четырехзначное число (0420).', answer: '0420' },
    { id: 'mg_code_10', type: 'password', title: 'РЕАКТОРНЫЙ КОД', text: 'Шифр изотопа: 235 уран плюс номер этажа (15). Итоговое 4-значное число (0250).', answer: '0250' },
    { id: 'mg_code_11', type: 'password', title: 'ТЕРМИНАЛ ВОХР', text: 'Пароль караула: сумма квадратов 3 и 4 (9+16=25), повторенная дважды (2525).', answer: '2525' },
    { id: 'mg_code_12', type: 'password', title: 'ПЕЧАТЬ ЧЕРНОБОГА', text: 'Надпись на черном монолите: «Конец равен началу: 1, 0, 0, 1».', answer: '1001' },

    // Подстанции и калибровка напряжения
    { id: 'mg_9', type: 'voltage', title: 'ПОДСТАНЦИЯ: НИЗКИЙ ТОК', text: 'Откалибровать напряжение на 80W.', target: 80 },
    { id: 'mg_v_40', type: 'voltage', title: 'СЛАБОТОЧНЫЙ ЩИТОК', text: 'Откалибровать напряжение на 40W для запуска аварийного реле.', target: 40 },
    { id: 'mg_v_60', type: 'voltage', title: 'ОСВЕЩЕНИЕ СЕКТОРА', text: 'Откалибровать напряжение на 60W для включения прожекторов.', target: 60 },
    { id: 'mg_v_100', type: 'voltage', title: 'ТРАНСФОРМАТОР ТЕХБЛОКА', text: 'Откалибровать напряжение ровно на 100W.', target: 100 },
    { id: 'mg_v_120', type: 'voltage', title: 'СИЛОВАЯ МАГИСТРАЛЬ', text: 'Откалибровать напряжение на 120W для открытия электрогермодвери.', target: 120 }
];

// --- ГОЛОВОЛОМКИ ПОСТРОЕНИЯ ПУТИ А -> Б (ЭЛЕКТРИЧЕСТВО / ГАЗ / ЖИДКОСТЬ В СТИЛЕ ASCII) ---
const CIRCUIT_MINIGAMES = [
    // 1. ЭЛЕКТРИЧЕСТВО: СИЛОВАЯ ШИНА 380V (3x3)
    {
        id: 'mg_circuit_power_1',
        type: 'pipe_circuit',
        theme: 'power',
        title: 'КОММУТАЦИЯ СИЛОВОЙ ШИНЫ 380V',
        title_en: '380V POWER BUS COMMUTATION',
        text: 'Силовая цепь питания гермозатвора разомкнута. Вращайте блоки коммутатора нажатиями, чтобы соединить генератор [A] с соленоидом замка [B]!',
        text_en: 'The blast door power circuit is open. Click or tap commutator blocks to rotate them and connect Generator [A] to Lock Solenoid [B]!',
        startLabel: 'ГЕН-380V',
        startLabel_en: 'GEN-380V',
        endLabel: 'СОЛЕНОИД',
        endLabel_en: 'SOLENOID',
        R: 3, C: 3,
        startR: 0, startC: 0, startDir: 8,
        endR: 2, endC: 2, endDir: 2,
        solved: [
            [10, 12,  5],
            [ 5,  5,  6],
            [ 6,  3, 10]
        ]
    },
    // 2. ГАЗ: ДЕГАЗАЦИЯ ШЛЮЗА (3x3)
    {
        id: 'mg_circuit_gas_1',
        type: 'pipe_circuit',
        theme: 'gas',
        title: 'МАГИСТРАЛЬ ДЕГАЗАЦИИ ШЛЮЗА',
        title_en: 'AIRLOCK DECONTAMINATION GAS LINE',
        text: 'Шлюз блокирован датчиком токсичности. Поверните трубопроводы нажатиями, чтобы провести нейтрализующий газ от баллона [A] к форсункам шлюза [B]!',
        text_en: 'Airlock is locked by toxicity sensors. Rotate the pipelines to route decontaminant gas from Cylinder [A] to Sprinklers [B]!',
        startLabel: 'БАЛЛОН-ГАЗ',
        startLabel_en: 'CYLINDER',
        endLabel: 'ФОРСУНКИ',
        endLabel_en: 'NOZZLES',
        R: 3, C: 3,
        startR: 0, startC: 0, startDir: 8,
        endR: 2, endC: 2, endDir: 2,
        solved: [
            [10, 10, 12],
            [ 5,  6,  5],
            [ 3, 10,  3]
        ]
    },
    // 3. ЖИДКОСТЬ: ГИДРОПРИВОД ЗАТВОРА (3x3)
    {
        id: 'mg_circuit_fluid_1',
        type: 'pipe_circuit',
        theme: 'fluid',
        title: 'ГИДРОПРИВОД ГЕРМОЗАТВОРА',
        title_en: 'HYDRAULIC ACTUATOR LINE',
        text: 'Гидравлические цилиндры опечатаны без давления. Соберите замкнутый трубопровод от насоса высокого давления [A] к поршням затвора [B]!',
        text_en: 'Hydraulic rams lack pressure. Align the high-pressure pipeline from Hydraulic Pump [A] to Blast Pistons [B]!',
        startLabel: 'НАСОС',
        startLabel_en: 'PUMP',
        endLabel: 'ПОРШНИ',
        endLabel_en: 'PISTONS',
        R: 3, C: 3,
        startR: 0, startC: 0, startDir: 8,
        endR: 2, endC: 2, endDir: 2,
        solved: [
            [14, 10, 12],
            [ 5, 15,  5],
            [ 3, 11, 10]
        ]
    },
    // 4. ЭЛЕКТРИЧЕСТВО: РЕЗЕРВНЫЙ ТРАНСФОРМАТОР (3x3)
    {
        id: 'mg_circuit_power_2',
        type: 'pipe_circuit',
        theme: 'power',
        title: 'РЕЗЕРВНЫЙ ТРАНСФОРМАТОР ПОДСТАНЦИИ',
        title_en: 'SUBSTATION BACKUP TRANSFORMER',
        text: 'Реле освещения и привода аварийной секции обесточено. Вращайте распределительные клеммы, чтобы замкнуть контур от ввода [A] к реле [B]!',
        text_en: 'The backup power loop is severed. Rotate the terminal blocks to close the circuit from Feed [A] to Relay [B]!',
        startLabel: 'ВВОД-A',
        startLabel_en: 'FEED-A',
        endLabel: 'РЕЛЕ-B',
        endLabel_en: 'RELAY-B',
        R: 3, C: 3,
        startR: 0, startC: 0, startDir: 8,
        endR: 2, endC: 2, endDir: 2,
        solved: [
            [10, 12,  5],
            [ 5, 15, 12],
            [ 6,  3, 10]
        ]
    },
    // 5. ГАЗ: СБРОС ХЛОРА САМОСБОРА (3x3)
    {
        id: 'mg_circuit_gas_2',
        type: 'pipe_circuit',
        theme: 'gas',
        title: 'СБРОС ХЛОРА В ВЕНТШАХТУ',
        title_en: 'CHLORINE PURGE EXHAUST',
        text: 'Магистраль перегружена едким газом. Проложите аварийный обводной путь от аварийного клапана [A] к вытяжной вентшахте [B]!',
        text_en: 'Vent line clogged with caustic chlorine. Construct a bypass path from Relief Valve [A] to Exhaust Shaft [B]!',
        startLabel: 'КЛАПАН',
        startLabel_en: 'VALVE',
        endLabel: 'ШАХТА-B',
        endLabel_en: 'SHAFT-B',
        R: 3, C: 3,
        startR: 0, startC: 0, startDir: 8,
        endR: 2, endC: 2, endDir: 2,
        solved: [
            [10, 12,  5],
            [ 6,  9,  5],
            [ 3, 10, 10]
        ]
    },
    // 6. ЖИДКОСТЬ: ОХЛАДИТЕЛЬ РЕАКТОРА (4x3)
    {
        id: 'mg_circuit_fluid_2',
        type: 'pipe_circuit',
        theme: 'fluid',
        title: 'КОНТУР ОХЛАЖДЕНИЯ АКТИВНОЙ ЗОНЫ',
        title_en: 'REACTOR CORE COOLANT LOOP',
        text: 'Температура теплоносителя критическая. Соедините теплообменник [A] с рубашкой охлаждения [B] через секцию 4x3!',
        text_en: 'Coolant temperature critical. Route primary coolant from Exchanger [A] to Cooling Jacket [B] across the 4x3 grid!',
        startLabel: 'ОБМЕННИК',
        startLabel_en: 'EXCHANGER',
        endLabel: 'РЕАКТОР',
        endLabel_en: 'REACTOR',
        R: 3, C: 4,
        startR: 0, startC: 0, startDir: 8,
        endR: 2, endC: 3, endDir: 2,
        solved: [
            [10, 10, 12,  5],
            [ 5,  6,  9,  6],
            [ 3,  3, 10, 10]
        ]
    }
];

const MINIGAME_POOL = [
    ...CIRCUIT_MINIGAMES,
    ...PHYSICAL_MINIGAMES,
    ...LOGIC_MINIGAMES,
    ...RIDDLES_150
];

const BASE_MONSTERS = [
    { id: "m_1", minFloor: 0, name: "Плесень-ползун", hp: 10, dmg: 2, reward: 1, xp: 5, img: "m_mold.png", lore: "Простейшая форма жизни." },
    { id: "m_2", minFloor: 0, name: "Слизневик", hp: 14, dmg: 3, reward: 2, xp: 8, img: "m_slime.png", lore: "Сгусток токсичной слизи." },
    { id: "m_3", minFloor: 0, name: "Ржавый паразит", hp: 17, dmg: 4, reward: 3, xp: 12, img: "m_parasite.png", lore: "Насекомое-переросток из вентиляции." },
    { id: "m_rat", minFloor: 0, name: "Чумная крыса", hp: 12, dmg: 3, reward: 2, xp: 7, img: "m_pig.png", lore: "Переносит туманную заразу в катакомбах." },
    { id: "m_larva", minFloor: 0, name: "Личинка Самосбора", hp: 16, dmg: 4, reward: 3, xp: 10, img: "m_worm.png", lore: "Пульсирует в трещинах бетонных стен." },
    { id: "m_4", minFloor: 0, name: "Трубный трупоед", hp: 22, dmg: 5, reward: 4, xp: 15, img: "m_corpse.png", lore: "Питается останками сталкеров." },
    { id: "m_crazed", minFloor: 0, name: "Обезумевший жилец", hp: 26, dmg: 5, reward: 5, xp: 18, img: "m_madman.png", lore: "Разум уничтожен сыростью и туманом." },
    { id: "m_5", minFloor: 1, name: "Обезумевший ликвидатор", hp: 45, dmg: 10, reward: 8, xp: 20, img: "m_madman.png", lore: "Бродит по коридорам." },
    { id: "m_6", minFloor: 2, name: "Туманный утопленник", hp: 60, dmg: 12, reward: 10, xp: 25, img: "m_drowned.png", lore: "Пахнет хлоркой." },
    { id: "m_7", minFloor: 3, name: "Безглазый конвоир", hp: 80, dmg: 15, reward: 12, xp: 35, img: "m_guard.png", lore: "Бывший сотрудник Партии." },
    { id: "m_8", minFloor: 4, name: "Червеобразный нарост", hp: 90, dmg: 18, reward: 15, xp: 45, img: "m_worm.png", lore: "Пульсирующая биомасса." },
    { id: "m_9", minFloor: 5, name: "Мясной культист", hp: 110, dmg: 22, reward: 18, xp: 55, img: "m_cultist.png", lore: "Поклоняется Самосбору." },
    { id: "m_10", minFloor: 6, name: "Адепт Чернобога", hp: 130, dmg: 25, reward: 22, xp: 70, img: "m_adept.png", lore: "Общается с туманом." },
    { id: "m_11", minFloor: 7, name: "Паук-арматурщик", hp: 150, dmg: 30, reward: 25, xp: 85, img: "m_spider.png", lore: "Из бетона и стали." },
    { id: "m_12", minFloor: 8, name: "Гончая Тумана", hp: 180, dmg: 35, reward: 30, xp: 100, img: "m_hound.png", lore: "Быстрая тварь." },
    { id: "m_13", minFloor: 9, name: "Мутировавший сварщик", hp: 210, dmg: 40, reward: 35, xp: 120, img: "m_welder.png", lore: "Баллон в спине." },
    { id: "m_14", minFloor: 10, name: "Свинорыл", hp: 250, dmg: 45, reward: 40, xp: 140, img: "m_pig.png", lore: "Мутация повара." },
    { id: "m_15", minFloor: 11, name: "Некро-сантехник", hp: 280, dmg: 50, reward: 45, xp: 160, img: "m_plumber.png", lore: "С разводным ключом." },
    { id: "m_16", minFloor: 12, name: "Зараженный Ликвидатор", hp: 320, dmg: 55, reward: 55, xp: 180, img: "m_liquidator.png", lore: "Зачищал этажи." },
    { id: "m_17", minFloor: 13, name: "Токсичный плевун", hp: 350, dmg: 60, reward: 65, xp: 210, img: "m_spitter.png", lore: "Плюется слизью." },
    { id: "m_18", minFloor: 14, name: "Бронированный мясник", hp: 400, dmg: 65, reward: 75, xp: 240, img: "m_butcher.png", lore: "Панцирь из цемента." },
    { id: "m_19", minFloor: 15, name: "Ходячий улей слизи", hp: 450, dmg: 70, reward: 85, xp: 280, img: "m_hive.png", lore: "Улей паразитов." },
    { id: "m_20", minFloor: 16, name: "Проповедник Бетона", hp: 500, dmg: 80, reward: 100, xp: 320, img: "m_preacher.png", lore: "Читает мантры." },
    { id: "m_21", minFloor: 17, name: "Искаженный дезертир", hp: 550, dmg: 90, reward: 115, xp: 360, img: "m_deserter.png", lore: "Заблудился." },
    { id: "m_22", minFloor: 18, name: "Амальгама плоти", hp: 620, dmg: 100, reward: 130, xp: 400, img: "m_amalgam.png", lore: "Слияние тел." },
    { id: "m_23", minFloor: 19, name: "Гигантская сколопендра", hp: 700, dmg: 110, reward: 150, xp: 450, img: "m_centipede.png", lore: "Обитатель шахт." },
    { id: "m_24", minFloor: 20, name: "Биомеханический страж", hp: 800, dmg: 125, reward: 180, xp: 520, img: "m_biomech.png", lore: "Проект Партии." },
    { id: "m_25", minFloor: 21, name: "Пожиратель фильтров", hp: 900, dmg: 140, reward: 210, xp: 600, img: "m_eater.png", lore: "Охотится за углем." },
    { id: "m_26", minFloor: 22, name: "Тень Самосбора", hp: 1050, dmg: 160, reward: 250, xp: 700, img: "m_shadow.png", lore: "Поглощает свет." },
    { id: "m_27", minFloor: 23, name: "Сросшиеся близнецы", hp: 1200, dmg: 180, reward: 300, xp: 850, img: "m_twins.png", lore: "Два тела — разум один." },
    { id: "m_28", minFloor: 24, name: "Жрец Кровавого Цемента", hp: 1400, dmg: 210, reward: 350, xp: 1000, img: "m_priest.png", lore: "Шепот сводит с ума." },
    { id: "m_29", minFloor: 25, name: "Архитектор плоти", hp: 1650, dmg: 250, reward: 420, xp: 1250, img: "m_architect.png", lore: "Лепит стены из останков." },
    { id: "m_30", minFloor: 26, name: "Истинный обитатель Тумана", hp: 2000, dmg: 300, reward: 550, xp: 1600, img: "m_true.png", lore: "Абсолютный кошмар." }
];

function generateShop() {
    let pool = ['food_ration', 'food_pure', 'food_medkit', 'mat_chem', 'mat_electro', 'mat_scrap', 'mat_tape', 'special_knife', 'special_shocker', 'backpack_small', 'backpack_med', ...Object.keys(BASE_EQUIP).filter(k=>BASE_EQUIP[k].type!=='backpack')];
    currentShopItems = shuffleArray(pool).slice(0, 6).map(id => rollItemWithRarity(id));
    nextShopUpdate = Date.now() + 10 * 60 * 1000;
    broadcastGameState();
}
setInterval(generateShop, 10 * 60 * 1000);
generateShop();

function getBossForFloor(f) {
    const storyBosses = {
        0: { name: "СТРАЖ ШАХТЫ ЛИФТА [БОСС]", hp: 70, dmg: 7, reward: 80, xp: 150, img: "m_guard.png", lore: "[ДНЕВНИК]: Страж шахты лифта повержен (70 HP). Доступ к подъёмнику открыт." },
        1: { name: "ГИДРАВЛИЧЕСКИЙ ТРУПОРЕЗ [БОСС ЭТ.1]", hp: 800, dmg: 15, reward: 220, xp: 550, img: "m_rat.png", lore: "[ДНЕВНИК]: Гидравлический трупорез повержен (800 HP). Путь на 2-й этаж свободен." },
        2: { name: "КИСЛОТНЫЙ УТОПЛЕННИК [БОСС ЭТ.2]", hp: 950, dmg: 19, reward: 300, xp: 750, img: "m_slime.png", lore: "[ДНЕВНИК]: Кислотный утопленник повержен (950 HP). Стоки очищены." },
        3: { name: "КОТЕЛЬНЫЙ ИФРИТ [БОСС ЭТ.3]", hp: 1100, dmg: 23, reward: 400, xp: 1000, img: "m_hive.png", lore: "[ДНЕВНИК]: Котельный ифрит рассеян (1100 HP). Паровой коллектор пройден." },
        4: { name: "ОТСТОЙНЫЙ МЯСОРОД [БОСС ЭТ.4]", hp: 1300, dmg: 27, reward: 520, xp: 1300, img: "m_flesh.png", lore: "[ДНЕВНИК]: Отстойный мясород уничтожен (1300 HP). Доступ к логову Смотрителя открыт." },
        5: { name: "СМОТРИТЕЛЬ СЛИЗИ [РЕЙД-БОСС]", hp: 1500, dmg: 32, reward: 650, xp: 1600, img: "boss_slime.png", lore: "[ДНЕВНИК]: Смотритель пал (1500 HP)." },
        10: { name: "АРХИВАРИУС [РЕЙД-БОСС]", hp: 9000, dmg: 65, reward: 1400, xp: 3000, img: "boss_arch.png", lore: "[ДНЕВНИК]: Самосбор — обновление здания." },
        15: { name: "ЖИВОЙ РЕАКТОР [РЕЙД-БОСС]", hp: 15000, dmg: 110, reward: 2400, xp: 6000, img: "boss_reactor.png", lore: "[ДНЕВНИК]: Ядро остыло." },
        20: { name: "КОМЕНДАНТ БЛОКА [РЕЙД-БОСС]", hp: 24000, dmg: 160, reward: 4000, xp: 10000, img: "boss_com.png", lore: "[ДНЕВНИК]: Комендант мертв." },
        30: { name: "ЧЕРНОБОГ [ФИНАЛ]", hp: 45000, dmg: 350, reward: 10000, xp: 30000, img: "boss_final.png", lore: "[ДНЕВНИК]: Цикл разорван." }
    };
    if (storyBosses[f]) return storyBosses[f];
    return { name: `АНОМАЛИЯ [РЕЙД ЭТ.${f}]`, hp: 1500 + (f * 600), dmg: 25 + (f * 6), reward: 250 + (f * 20), xp: 600 + (f * 120), img: "m_hive.png", lore: `[ДНЕВНИК]: Путь на этаж ${f+1} очищен.` };
}

const FLOOR_CONFIGS = {
    0: {
        title: "Жилой Блок и Катакомбы",
        keys: ['quest_boltcutter', 'quest_battery', 'quest_red_card', 'quest_fuse'],
        elevatorKeys: ['quest_lift_repair', 'quest_lift_buttons', 'quest_lift_wire'],
        elevatorHint: "ЛИФТ РАЗБИТ. Нужны: Ремкомплект лифта, Блок кнопок, Провод генератора."
    },
    1: {
        title: "Технический шурф гидросистемы",
        keys: ['quest_wrench_heavy', 'quest_pressure_valve', 'quest_boltcutter', 'quest_fuse'],
        elevatorKeys: ['quest_wrench_heavy', 'quest_pressure_valve'],
        elevatorHint: "ПЕРЕКРЫТИЕ ГИДРАВЛИКИ. Нужны: Тяжелый разводной ключ и Клапан сброса давления."
    },
    2: {
        title: "Станция очистки стоков",
        keys: ['quest_coagulant', 'quest_pipe_patch', 'quest_wrench_heavy', 'quest_battery'],
        elevatorKeys: ['quest_coagulant', 'quest_pipe_patch'],
        elevatorHint: "ПРОРЫВ КИСЛОТНОГО СТОКА. Нужны: Канистра коагулянта и Свинцовая заплата."
    },
    3: {
        title: "Аварийный коллектор пара",
        keys: ['quest_manometer', 'quest_boiler_crank', 'quest_coagulant', 'quest_red_card'],
        elevatorKeys: ['quest_manometer', 'quest_boiler_crank'],
        elevatorHint: "КЛАПАН СВЕРХДАВЛЕНИЯ ЗАКРЫТ. Нужны: Манометр высокого давления и Вентильная рукоять."
    },
    4: {
        title: "Нижний отстойник биомассы",
        keys: ['quest_slime_sample', 'quest_elevator_gear_1', 'quest_manometer', 'quest_fuse'],
        elevatorKeys: ['quest_elevator_gear_1'],
        elevatorHint: "ПРИВОД ЛЕБЕДКИ СЛОМАН. Нужна: Зубчатая шестерня лебедки (к логову Смотрителя Слизи)."
    },
    5: {
        title: "Приемная Спецархива Партии",
        keys: ['quest_punchcard_secret', 'quest_cipher_disc', 'quest_battery', 'quest_red_card'],
        elevatorKeys: ['quest_punchcard_secret'],
        elevatorHint: "ДОСТУП ОГРАНИЧЕН ПАРТИЕЙ. Нужна: Секретная перфокарта."
    },
    6: {
        title: "Шифрокабинет Политотдела",
        keys: ['quest_cipher_disc', 'quest_commissar_stamp', 'quest_punchcard_secret', 'quest_fuse'],
        elevatorKeys: ['quest_cipher_disc'],
        elevatorHint: "ШИФРОВАННЫЙ ШЛЮЗ. Нужен: Диск шифратора «Энигма-Х»."
    },
    7: {
        title: "Архив протоколов Самосбора",
        keys: ['quest_commissar_stamp', 'quest_magnetic_tape', 'quest_cipher_disc', 'quest_wrench_heavy'],
        elevatorKeys: ['quest_commissar_stamp'],
        elevatorHint: "РЕЖИМ ЧП. Нужна: Печать комиссара."
    },
    8: {
        title: "Фонотека спецвещания",
        keys: ['quest_magnetic_tape', 'quest_archive_keycard', 'quest_commissar_stamp', 'quest_battery'],
        elevatorKeys: ['quest_magnetic_tape'],
        elevatorHint: "АКУСТИЧЕСКИЙ БЛОКИРАТОР. Нужна: Бобина спецвещания."
    },
    9: {
        title: "Преддверие Спецхрана",
        keys: ['quest_archive_keycard', 'quest_elevator_cable_2', 'quest_magnetic_tape', 'quest_red_card'],
        elevatorKeys: ['quest_elevator_cable_2'],
        elevatorHint: "ОБРЫВ ТРОСОВ ЛИФТА. Нужен: Бронированный трос (к чертогу Архивариуса)."
    },
    10: {
        title: "Высоковольтная распределительная",
        keys: ['quest_coolant_rod', 'quest_highvolt_relay', 'quest_archive_keycard', 'quest_fuse'],
        elevatorKeys: ['quest_coolant_rod'],
        elevatorHint: "КОНТУР ПЕРЕГРЕТ. Нужен: Стержень охладителя."
    },
    11: {
        title: "Трансформаторный лабиринт",
        keys: ['quest_highvolt_relay', 'quest_copper_inductor', 'quest_coolant_rod', 'quest_battery'],
        elevatorKeys: ['quest_highvolt_relay'],
        elevatorHint: "ОБРЫВ СИЛОВОЙ ЦЕПИ. Нужен: Высоковольтное реле."
    },
    12: {
        title: "Генераторный зал глубокого залегания",
        keys: ['quest_copper_inductor', 'quest_dielectric_gloves', 'quest_highvolt_relay', 'quest_wrench_heavy'],
        elevatorKeys: ['quest_copper_inductor'],
        elevatorHint: "МАГНИТНАЯ БЛОКИРОВКА. Нужна: Медная катушка индуктивности."
    },
    13: {
        title: "Охлаждающий контур жидкого свинца",
        keys: ['quest_dielectric_gloves', 'quest_lead_baffle', 'quest_copper_inductor', 'quest_red_card'],
        elevatorKeys: ['quest_dielectric_gloves'],
        elevatorHint: "УТЕЧКА ВЫСОКОГО ТОКА. Нужен: Диэлектрический изолятор."
    },
    14: {
        title: "Шахта Живого Реактора",
        keys: ['quest_lead_baffle', 'quest_elevator_motor_3', 'quest_dielectric_gloves', 'quest_coolant_rod'],
        elevatorKeys: ['quest_elevator_motor_3'],
        elevatorHint: "ДВИГАТЕЛЬ ЛИФТА СГОРЕЛ. Нужен: Электропривод лифта (к Живому Реактору)."
    },
    15: {
        title: "Передовой гарнизон ВОХР",
        keys: ['quest_vokhr_token', 'quest_officer_cipher', 'quest_lead_baffle', 'quest_fuse'],
        elevatorKeys: ['quest_vokhr_token'],
        elevatorHint: "КАРАУЛЬНЫЙ ПОСТ ВОХР. Нужен: Жетон старшины ВОХР."
    },
    16: {
        title: "Казарменный блокпост «Красный угол»",
        keys: ['quest_officer_cipher', 'quest_decon_filter', 'quest_vokhr_token', 'quest_battery'],
        elevatorKeys: ['quest_officer_cipher'],
        elevatorHint: "ШТАБНОЙ КОДОВЫЙ ЗАМОК. Нужен: Блокнот с шифрами взвода."
    },
    17: {
        title: "Станция армейской дегазации",
        keys: ['quest_decon_filter', 'quest_brass_keys', 'quest_officer_cipher', 'quest_red_card'],
        elevatorKeys: ['quest_decon_filter'],
        elevatorHint: "ЗОНА ЗАРАЖЕНИЯ ЗАБЛОКИРОВАНА. Нужен: Дегазационный фильтр."
    },
    18: {
        title: "Штрафной изолятор и карцеры",
        keys: ['quest_brass_keys', 'quest_commandant_seal', 'quest_decon_filter', 'quest_vokhr_token'],
        elevatorKeys: ['quest_brass_keys'],
        elevatorHint: "ТЮРЕМНЫЕ РЕШЕТКИ. Нужна: Связка латунных ключей."
    },
    19: {
        title: "Штаб Коменданта Блока",
        keys: ['quest_commandant_seal', 'quest_elevator_hydraulic_4', 'quest_brass_keys', 'quest_officer_cipher'],
        elevatorKeys: ['quest_elevator_hydraulic_4'],
        elevatorHint: "ГИДРАВЛИКА КЛЕТИ СОРВАНА. Нужен: Гидроцилиндр клети (к цитадели Коменданта)."
    },
    20: {
        title: "Мясные катакомбы первого круга",
        keys: ['quest_meat_relic', 'quest_bone_chisel', 'quest_commandant_seal', 'quest_fuse'],
        elevatorKeys: ['quest_meat_relic'],
        elevatorHint: "ПЛОТЬ СРОСЛАСЬ С ДВЕРЬЮ. Нужен: Окаменевший мясной нарост."
    },
    21: {
        title: "Костяная часовня",
        keys: ['quest_bone_chisel', 'quest_ritual_chalice', 'quest_meat_relic', 'quest_battery'],
        elevatorKeys: ['quest_bone_chisel'],
        elevatorHint: "РИТУАЛЬНАЯ ПЛОМБА. Нужен: Костяное зубило сектантов."
    },
    22: {
        title: "Колодец поглощения",
        keys: ['quest_ritual_chalice', 'quest_cult_psalter', 'quest_bone_chisel', 'quest_red_card'],
        elevatorKeys: ['quest_ritual_chalice'],
        elevatorHint: "ЖЕРТВЕННЫЙ АЛТАРЬ. Нужна: Чаша крови тумана."
    },
    23: {
        title: "Зал шепчущих стен",
        keys: ['quest_cult_psalter', 'quest_flesh_key', 'quest_ritual_chalice', 'quest_meat_relic'],
        elevatorKeys: ['quest_cult_psalter'],
        elevatorHint: "ГОЛОСА ТРЕБУЮТ СЛОВО. Нужен: Псалтырь Неизбежного Тумана."
    },
    24: {
        title: "Врата Преображения",
        keys: ['quest_flesh_key', 'quest_elevator_seal_5', 'quest_cult_psalter', 'quest_bone_chisel'],
        elevatorKeys: ['quest_elevator_seal_5'],
        elevatorHint: "ВРАТА ОПЛЕТЕНЫ МЯСОМ. Нужен: Очистительный знак лифта (к глубинам Бездны)."
    },
    25: {
        title: "Пространственный разлом",
        keys: ['quest_singularity_core', 'quest_black_prism', 'quest_flesh_key', 'quest_battery'],
        elevatorKeys: ['quest_singularity_core'],
        elevatorHint: "ВРЕМЕННОЙ ПАРАДОКС. Нужен: Сгусток времени."
    },
    26: {
        title: "Зеркальный лабиринт бетона",
        keys: ['quest_black_prism', 'quest_master_blueprint', 'quest_singularity_core', 'quest_red_card'],
        elevatorKeys: ['quest_black_prism'],
        elevatorHint: "ИСКАЖЕННОЕ ОТРАЖЕНИЕ. Нужна: Призма черного стекла."
    },
    27: {
        title: "Зал забытых строителей",
        keys: ['quest_master_blueprint', 'quest_reality_anchor', 'quest_black_prism', 'quest_fuse'],
        elevatorKeys: ['quest_master_blueprint'],
        elevatorHint: "ТАЙНА ЗОДЧИХ. Нужен: Истинный чертеж Гигахрущевки."
    },
    28: {
        title: "Сердцевина первородного Тумана",
        keys: ['quest_reality_anchor', 'quest_chernobog_key', 'quest_master_blueprint', 'quest_singularity_core'],
        elevatorKeys: ['quest_reality_anchor'],
        elevatorHint: "РАЗРУШЕНИЕ МАТЕРИИ. Нужен: Якорь реальности."
    },
    29: {
        title: "Врата в Чертог Чернобога",
        keys: ['quest_chernobog_key', 'quest_elevator_final_key', 'quest_reality_anchor', 'quest_black_prism'],
        elevatorKeys: ['quest_elevator_final_key'],
        elevatorHint: "ТОЧКА НЕВОЗВРАТА. Нужен: Ключ Бездны (для спуска к Чернобогу на 30 этаж)."
    }
};

const RANDOM_EVENTS = [
    // --- ОПАСНОСТИ ОКРУЖЕНИЯ ---
    {
        id: 'meat_smell',
        title: 'ЗАПАХ СЫРОГО МЯСА',
        text: 'Резкий запах озона бьет в нос. Из темноты коридора доносится влажное хлюпанье. Самосбор где-то рядом...',
        choices: [
            { id: 'run', text: '[РИСК] Бежать обратно к шлюзу', chance: 0.7, winHp: 0, winLog: '> Вы успели захлопнуть за собой гермодверь.', failHp: -25, failLog: '> Тварь из тумана зацепила вас когтями! (-25 HP)' },
            { id: 'hide', text: 'Затаиться в вентиляционной нише', chance: 0.85, winHp: 0, winLog: '> Существо проползло мимо, не заметив вас.', failHp: -15, failLog: '> Ядовитые испарения обожгли дыхательные пути. (-15 HP)' }
        ]
    },
    {
        id: 'toxic_steam',
        title: 'СВИСТЯЩИЙ ПАРОВОЙ КЛАПАН',
        text: 'Труба лопнула прямо над головой. Белый раскаленный пар с запахом аммиака заливает проход!',
        choices: [
            { id: 'rush_through', text: '[РИСК] Проскочить сквозь струю пара', chance: 0.6, winHp: 0, winLog: '> Вы пригнулись и проскочили без ожогов!', failHp: -30, failLog: '> Пар обжег плечи и повредил маску! (-30 HP)' },
            { id: 'crawl', text: 'Ползти по мокрому бетону у пола', chance: 0.9, winHp: 0, winLog: '> Вы благополучно проползли под облаком пара.', failHp: -10, failLog: '> Горячая вода залила сапоги. (-10 HP)' }
        ]
    },
    {
        id: 'whispering_concrete',
        title: 'ШЕПОТ ИЗ ТРЕЩИН БЕТОНА',
        text: 'Шероховатые плиты стен тихо вибрируют. Голоса десятков погибших жильцов шепчут в голове забытые имена и формулы...',
        choices: [
            { id: 'listen_carefully', text: '[РИСК] Вслушаться в голоса стен', chance: 0.55, winXp: 45, winNotebook: '[ШЕПОТ СТЕН]: «Самосбор не имеет конца. Бетон помнит каждого, кто оставил след на полу».', winLog: '> Вы уловили древние знания блока! (+45 XP, запись в блокнот)', failHp: -20, failLog: '> Разум помутился от безумного шепота! (-20 HP)' },
            { id: 'recite_hymn', text: 'Громко читать устав Партии', winHp: 0, winLog: '> Голоса в голове отступили перед твердым словом закона.' }
        ]
    },

    // --- ИНТЕРАКТИВНЫЕ ДИАЛОГИ С NPC (ПЕРЕДНИЙ ПЛАН) ---
    {
        id: 'npc_stalker',
        title: 'ВСТРЕЧА: СТАЛКЕР ГЛЕБ',
        npc: { name: 'Сталкер Глеб', role: 'Ветеран глубоких вылазок', portrait: 'npc_stalker.png' },
        text: 'У самодельной печурки греется сталкер в потертом кожаном плаще и противогазе ГП-5.\n«Здорово, заключенный. Подсаживайся к теплу, пока Самосбор не накрыл блок. О чем поговорить хочешь?»',
        choices: [
            { id: 'gleb_lore', text: '1. «Расскажи, что творится на этих этажах»', nextNode: 'node_gleb_lore' },
            { id: 'gleb_boss', text: '2. «Как пробиться через запертый лифт?»', nextNode: 'node_gleb_boss' },
            { id: 'gleb_trade', text: '3. «Нужен инструмент для дверей» (Обмен)', nextNode: 'node_gleb_trade' },
            { id: 'leave', text: '4. «Бывай, Глеб. Мне пора дальше.»', winLog: '> Вы попрощались со сталкером.' }
        ],
        nodes: {
            node_gleb_lore: {
                title: 'ГЛЕБ: БАЙКИ О ТУМАНЕ',
                text: 'Глеб негромко хрипит через фильтр: «Гигахрущевка не имеет дна. Чем глубже спускаешься, тем меньше бетона и больше сырой плоти. На 10-м этаже архивы Партии, где директивы оживают. А на 15-м реактор пульсирует как сердце. Не суйся туда без тяжелой брони!»',
                choices: [
                    { id: 'gleb_lore_rec', text: '«Запишу это в блокнот. Что еще посоветуешь?»', winXp: 30, winNotebook: '[СТАЛКЕР ГЛЕБ]: «Самосбор — дыхание Гигахрущевки. Документы на 10 этаже живые, а реактор на 15 этаже бьется как сердце».', nextNode: 'node_gleb_main' },
                    { id: 'leave', text: '«Спасибо за предупреждение. Мне пора.»', winLog: '> Вы покинули стоянку сталкера.' }
                ]
            },
            node_gleb_boss: {
                title: 'ГЛЕБ: СОВЕТ ПО ЛИФТУ',
                text: '«Лифт на каждом этаже заклинило или опечатано. Ищи ключи и детали в технических нишах. А когда запустишь клеть — готовься к бою. Твари тумана чуют пуск лебедки со всего горизонта!»',
                choices: [
                    { id: 'gleb_back', text: '«Понятно. Вернемся к разговору.»', nextNode: 'node_gleb_main' },
                    { id: 'leave', text: '«Я готов к схватке. Бывай.»', winLog: '> Вы продолжили путь.' }
                ]
            },
            node_gleb_trade: {
                title: 'ГЛЕБ: ОБМЕН ХАБАРОМ',
                text: '«Могу отдать Предохранитель или Разводной ключ. Но даром в тумане ничего не бывает — гони 1 Брикет слизи или 50 талонов на фильтры».',
                choices: [
                    { id: 'gleb_buy_fuse', text: 'Отдать Брикет слизи -> получить Предохранитель', reqItem: 'food_ration', winQuestItem: 'quest_fuse', nextNode: 'node_gleb_traded' },
                    { id: 'gleb_buy_wrench', text: 'Отдать 50 талонов -> получить Тяжелый ключ', reqCost: 50, winQuestItem: 'quest_wrench_heavy', nextNode: 'node_gleb_traded' },
                    { id: 'gleb_back', text: '«Пока ничего не нужно.»', nextNode: 'node_gleb_main' }
                ]
            },
            node_gleb_traded: {
                title: 'ГЛЕБ: СДЕЛКА СОВЕРШЕНА',
                text: '«Держи железо. Пусть послужит. Не забывай менять угольные патроны вовремя!»',
                choices: [
                    { id: 'gleb_back', text: '«Еще пара вопросов...»', nextNode: 'node_gleb_main' },
                    { id: 'leave', text: '«Спасибо за помощь. До встречи.»', winLog: '> Сделка со сталкером завершена.' }
                ]
            },
            node_gleb_main: {
                title: 'ВСТРЕЧА: СТАЛКЕР ГЛЕБ',
                text: 'Глеб ворошит угли прутом: «Что еще тебя интересует, заключенный?»',
                choices: [
                    { id: 'gleb_lore', text: '1. «Расскажи о нижних этажах»', nextNode: 'node_gleb_lore' },
                    { id: 'gleb_trade', text: '2. «Давай поторгуем»', nextNode: 'node_gleb_trade' },
                    { id: 'leave', text: '3. «Пора в путь.»', winLog: '> Вы двинулись дальше.' }
                ]
            }
        }
    },
    {
        id: 'npc_liquidator',
        title: 'ВСТРЕЧА: РАНЕНЫЙ ЛИКВИДАТОР',
        npc: { name: 'Ликвидатор Семен', role: 'Штурмовая группа зачистки', portrait: 'npc_liquidator.png' },
        text: 'Тяжелый боец в освинцованной броне сидит у переборки. Стекло гермошлема покрыто гарью и трещинами, дыхание с тяжелым хрипом:\n«Брат... Нашу группу накрыло кислотным выбросом. Промывочный состав кончился. Помоги нейтрализовать ожог — я в долгу не останусь!»',
        choices: [
            { id: 'cure_liquidator', text: '1. Отдать Химикаты для дегазации (нужны Химикаты)', reqItem: 'mat_chem', winQuestItem: 'quest_red_card', nextNode: 'node_liq_cured' },
            { id: 'liq_tactics', text: '2. «Как пробивать броню мутантов в нижних блоках?»', nextNode: 'node_liq_tactics' },
            { id: 'loot_liquidator', text: '3. [РИСК] Обыскать карманы бойца', chance: 0.65, winLoot: 'clothes_guard_rare', winTalons: 40, winLog: '> Вы забрали форму ВОХР и 40 талонов.', failHp: -30, failLog: '> Ликвидатор отбился прикладом и сбил маску! (-30 HP)' },
            { id: 'leave', text: '4. Оставить бойца', winLog: '> Вы тихо удалились.' }
        ],
        nodes: {
            node_liq_cured: {
                title: 'ЛИКВИДАТОР: БЛАГОДАРНОСТЬ',
                text: 'Семен жадно вводит щелочной нейтрализатор через клапан шлема. Хрип утихает:\n«Уф-ф... Легче стало. Забирай мою Красную ключ-карту от армейских шлюзов, мне уже не до штурма. Держись подальше от открытого огня!»',
                choices: [
                    { id: 'liq_more', text: '«Расскажи о тактике зачистки»', winXp: 40, nextNode: 'node_liq_tactics' },
                    { id: 'leave', text: '«Поправляйся, боец.»', winLog: '> Вы помогли ликвидатору и получили ключ-карту.' }
                ]
            },
            node_liq_tactics: {
                title: 'ЛИКВИДАТОР: ТАКТИКА БОЯ',
                text: '«Целься точно в сочленения плит и дыхала. Когда тварь замахивается — сразу уходи в сторону, контратака после уклонения бьет вдвое больнее! И держи фильтр полным, в тумане реакция падает вдвое».',
                choices: [
                    { id: 'leave', text: '«Понял. Буду начеку!»', winXp: 25, winLog: '> Вы усвоили армейскую тактику боя.' }
                ]
            }
        }
    },
    {
        id: 'npc_scientist',
        title: 'ВСТРЕЧА: ПРОФЕССОР ШУХОВ',
        npc: { name: 'Проф. Шухов', role: 'Сектор прикладной физики Тумана', portrait: 'npc_scientist.png' },
        text: 'Сутулый ученый в запятнанном халате и круглых очках над респиратором исступленно чертит мелом формулы прямо на стене:\n«Они думают, Самосбор случаен! Глупцы! Это гиперболическая геометрия пространства! Хочешь взглянуть на расчеты или испытать экспериментальную сыворотку?»',
        choices: [
            { id: 'sci_formula', text: '1. «Что значат эти формулы на стене?»', nextNode: 'node_sci_formula' },
            { id: 'take_stim', text: '2. [РИСК] Принять экспериментальную сыворотку', chance: 0.55, winHp: 50, winXp: 60, winLog: '> Прилив сил! Разум обострился, здоровье восстановлено! (+50 HP, +60 XP)', failHp: -25, failLog: '> Препарат вызвал токсический шок! (-25 HP)' },
            { id: 'sci_trade_elec', text: '3. Предложить Электронику (нужна 1 Электроника)', reqItem: 'mat_electro', winQuestItem: 'quest_highvolt_relay', nextNode: 'node_sci_traded' },
            { id: 'leave', text: '4. Пройти мимо сумасшедшего', winLog: '> Вы оставили ученого наедине с формулами.' }
        ],
        nodes: {
            node_sci_formula: {
                title: 'ПРОФЕССОР: ТАЙНА ГИГАХРУЩЕВКИ',
                text: '«Стены не параллельны! Здание растет внутрь самого себя! Внизу, на тридцатом горизонте, находится точка абсолютной энтропии — Чернобог. Если откалибровать частоту подстанции на 80 или 120 ватт, гермозатворы подчиняются алгоритму!»',
                choices: [
                    { id: 'sci_notes', text: '«Записать частоты подстанции в блокнот.»', winNotebook: '[ПРОФЕССОР ШУХОВ]: «Гигахрущевка бесконечна внутрь себя. Точка энтропии на 30 этаже. Частоты реле: 80W и 120W».', winXp: 35, nextNode: 'node_sci_main' },
                    { id: 'leave', text: '«Звучит безумно. Я пошел.»', winLog: '> Вы продолжили путь.' }
                ]
            },
            node_sci_traded: {
                title: 'ПРОФЕССОР: ЭКСПЕРИМЕНТ',
                text: '«О-о, кремниевые чипы! Прекрасно! Вот, забирай Высоковольтное реле — с ним ты запитаешь распределительный щит лифта!»',
                choices: [
                    { id: 'leave', text: '«Благодарю, профессор.»', winLog: '> Вы получили Высоковольтное реле.' }
                ]
            },
            node_sci_main: {
                title: 'ВСТРЕЧА: ПРОФЕССОР ШУХОВ',
                text: 'Шухов поправляет запотевшие очки: «Ну что, готов проникнуть глубже в суть феномена?»',
                choices: [
                    { id: 'sci_trade_elec', text: 'Предложить Электронику', reqItem: 'mat_electro', winQuestItem: 'quest_highvolt_relay', nextNode: 'node_sci_traded' },
                    { id: 'leave', text: '«Мне пора идти.»', winLog: '> Вы покинули профессора.' }
                ]
            }
        }
    },
    {
        id: 'npc_vokhr',
        title: 'ВСТРЕЧА: МАЙОР БОРИСОВ',
        npc: { name: 'Майор Борисов', role: 'Комендатура ВОХР 7-го блока', portrait: 'npc_vokhr.png' },
        text: 'Офицер ВОХР с тяжелым шрамом на скуле держит руку на кобуре. Его фуражка со звездой запылена бетонной крошкой:\n«Стоять! Руки на виду! В блоке объявлен режим ЧП. Предъяви документы или докажи, что ты не заражен туманом!»',
        choices: [
            { id: 'vokhr_report', text: '1. «Я выполняю работы по ремонту лифта блока.»', nextNode: 'node_vokhr_order' },
            { id: 'vokhr_buy_pass', text: '2. Выкупить Жетон старшины ВОХР (120 т.)', reqCost: 120, winQuestItem: 'quest_vokhr_token', nextNode: 'node_vokhr_deal' },
            { id: 'vokhr_threat', text: '3. [РИСК] Попытаться разоружить майора', chance: 0.45, winLoot: 'weapon_shotgun_rare', winTalons: 80, winLog: '> Вы перехватили оружие майора и забрали патроны!', failHp: -35, failLog: '> Майор ударил рукоятью пистолета в челюсть! (-35 HP)' },
            { id: 'leave', text: '4. Медленно отступить в тень', winLog: '> Вы благополучно разошлись с патрулем.' }
        ],
        nodes: {
            node_vokhr_order: {
                title: 'МАЙОР БОРИСОВ: ПРИКАЗ',
                text: '«Ремонт лифта? Комендатура одобряет. Нижние сектора захвачены мутантами, связь со штабом потеряна. Вот тебе Блокнот с шифрами взвода. Используй его на кодовых терминалах, но упаси Партия разгласить секрет!»',
                choices: [
                    { id: 'vokhr_take_cipher', text: 'Принять Блокнот с шифрами взвода', winQuestItem: 'quest_officer_cipher', winXp: 50, winLog: '> Получен Блокнот с шифрами взвода (+50 XP).' },
                    { id: 'leave', text: '«Служу народу Гигахрущевки!»', winLog: '> Вы получили доступ к армейским терминалам.' }
                ]
            },
            node_vokhr_deal: {
                title: 'МАЙОР БОРИСОВ: ПРОПУСК',
                text: 'Майор пересчитывает талоны: «Держи жетон. С ним караульные пулеметы на блокпосту не откроют огонь на поражение. И не попадайся конвоирам на глаза».',
                choices: [
                    { id: 'leave', text: '«Благодарю за содействие.»', winLog: '> Вы получили Жетон старшины ВОХР.' }
                ]
            }
        }
    },
    {
        id: 'npc_cultist',
        title: 'ВСТРЕЧА: БРАТ ИОНА',
        npc: { name: 'Брат Иона', role: 'Глас Мясного Святилища', portrait: 'npc_cultist.png' },
        text: 'Человек в грубой мешковине, с маской из кости и горящими безумием глазами, монотонно раскачивается у стены, покрытой венами:\n«Ты слышишь зов?.. Плоть зовет плоть... Самосбор не убивает — он соединяет разорванный мир в единое целое... Принеси жертву Святилищу!»',
        choices: [
            { id: 'cult_listen', text: '1. «Что ждет внизу, в Чертоге Чернобога?»', nextNode: 'node_cult_lore' },
            { id: 'cult_offer_meat', text: '2. Пожертвовать Брикет слизи Святилищу', reqItem: 'food_ration', winQuestItem: 'quest_meat_relic', nextNode: 'node_cult_blessed' },
            { id: 'cult_ritual_key', text: '3. Выменять Живой ключ-симбиот (150 т.)', reqCost: 150, winQuestItem: 'quest_flesh_key', nextNode: 'node_cult_key' },
            { id: 'leave', text: '4. Бежать прочь от сектанта', winLog: '> Вы скрылись в глубине коридора.' }
        ],
        nodes: {
            node_cult_lore: {
                title: 'БРАТ ИОНА: ПРОРОЧЕСТВО',
                text: 'Иона шепчет, касаясь стены: «Чернобог — это Сердце Гигахрущевки. Он спит на тридцатом круге. Когда цикл замкнется, стены сожмутся, и все жильцы станут одним телом. Возьми Псалтырь Неизбежного Тумана, читай его, когда дрогнет дух!»',
                choices: [
                    { id: 'cult_take_book', text: 'Забрать Псалтырь Тумана', winQuestItem: 'quest_cult_psalter', winNotebook: '[ПРОРОЧЕСТВО ИОНЫ]: «Чернобог спит на 30 этаже. Самосбор стремится слить весь мир в единое живое тело».', winXp: 50, nextNode: 'node_cult_main' },
                    { id: 'leave', text: '«Жуткая ересь. Я ухожу.»', winLog: '> Вы покинули сектанта.' }
                ]
            },
            node_cult_blessed: {
                title: 'БРАТ ИОНА: БЛАГОСЛОВЕНИЕ',
                text: 'Сектант прижимает слизь к пульсирующей стене, и бетон жадно впитывает ее:\n«Святилище довольно! Прими Окаменевший мясной нарост — он откроет врата нижнего круга!»',
                choices: [
                    { id: 'leave', text: '«Забираю и ухожу.»', winLog: '> Вы получили Окаменевший мясной нарост.' }
                ]
            },
            node_cult_key: {
                title: 'БРАТ ИОНА: ЖИВОЙ КЛЮЧ',
                text: '«Он чувствует твою кровь... Не бойся, он не укусит, пока ты служишь Туману...»',
                choices: [
                    { id: 'leave', text: '«Главное, чтобы открывал гермозатвор.»', winLog: '> Вы получили Живой ключ-симбиот.' }
                ]
            },
            node_cult_main: {
                title: 'ВСТРЕЧА: БРАТ ИОНА',
                text: '«Святилище ждет твоих решений, странник...»',
                choices: [
                    { id: 'cult_offer_meat', text: 'Пожертвовать Брикет слизи', reqItem: 'food_ration', winQuestItem: 'quest_meat_relic', nextNode: 'node_cult_blessed' },
                    { id: 'leave', text: '«Хватит разговоров.»', winLog: '> Вы ушли.' }
                ]
            }
        }
    },
    {
        id: 'npc_archivist',
        title: 'ВСТРЕЧА: ГЛАВНЫЙ АРХИВИСТ',
        npc: { name: 'Главный Архивист', role: 'Хранитель грифа «Секретно»', portrait: 'npc_archivist.png' },
        text: 'Бледный человек с латунным моноклем и механическими пальцами перебирает сотни перфокарт:\n«Дело №7749... Приговорен к исправительным работам в подвалах... Чего вам, гражданин? Архив Партии закрыт на дезинфекцию!»',
        choices: [
            { id: 'arch_ask_records', text: '1. «Где найти документы на запуск лифта?»', nextNode: 'node_arch_records' },
            { id: 'arch_buy_card', text: '2. Выкупить Ключ-карту Архивариуса (100 т.)', reqCost: 100, winQuestItem: 'quest_archive_keycard', nextNode: 'node_arch_deal' },
            { id: 'arch_give_paper', text: '3. Передать найденные формулы НИИ', winQuestItem: 'quest_punchcard_secret', winXp: 40, nextNode: 'node_arch_accepted' },
            { id: 'leave', text: '4. Не мешать работе бюрократа', winLog: '> Вы покинули архив.' }
        ],
        nodes: {
            node_arch_records: {
                title: 'АРХИВИСТ: СЕКРЕТНЫЙ РЕЕСТР',
                text: '«Лифты контролируются перфокартами серии "Х". На шестом этаже шифрокабинет, на восьмом — фонотека. Держи Диск шифратора, без него кодовые замки не расшифровать!»',
                choices: [
                    { id: 'arch_take_disc', text: 'Взять Диск шифратора «Энигма-Х»', winQuestItem: 'quest_cipher_disc', winNotebook: '[АРХИВИСТ]: «Шифры Партии расшифровываются диском "Энигма-Х". Без перфокарт доступ к лифтам заблокирован».', winXp: 40, nextNode: 'node_arch_main' },
                    { id: 'leave', text: '«Спасибо за справку.»', winLog: '> Вы записали указания архивиста.' }
                ]
            },
            node_arch_deal: {
                title: 'АРХИВИСТ: ПРОПУСК ВЫДАН',
                text: '«Штамп поставлен. Ключ-карта активирована. Соблюдайте тишину в читальном зале!»',
                choices: [
                    { id: 'leave', text: '«Понял.»', winLog: '> Получена Ключ-карта Архивариуса.' }
                ]
            },
            node_arch_accepted: {
                title: 'АРХИВИСТ: ДОКУМЕНТ ПРИНЯТ',
                text: '«Ценные сведения. Взамен выдаю Секретную перфокарту с директивами спуска».',
                choices: [
                    { id: 'leave', text: '«Благодарю.»', winLog: '> Получена Секретная перфокарта.' }
                ]
            },
            node_arch_main: {
                title: 'ВСТРЕЧА: ГЛАВНЫЙ АРХИВИСТ',
                text: '«Гражданин, регламент не терпит задержек. Что еще?»',
                choices: [
                    { id: 'arch_buy_card', text: 'Выкупить Ключ-карту (100 т.)', reqCost: 100, winQuestItem: 'quest_archive_keycard', nextNode: 'node_arch_deal' },
                    { id: 'leave', text: '«Я уже ухожу.»', winLog: '> Вы покинули архив.' }
                ]
            }
        }
    },
    {
        id: 'npc_trader',
        title: 'ВСТРЕЧА: БАРЫГА ИЗ ТУМАНА',
        text: 'Незнакомец в потертом плаще сталкера светит фонариком: «Есть редкий хабар, заключенный. Показывай талоны, пока конвоиры не засекли».',
        choices: [
            { id: 'buy_weapon', text: 'Купить Редкий пистолет (150 т.)', reqCost: 150, winLoot: 'weapon_pistol_rare', winLog: '> Вы купили Редкий Пистолет Макарова.' },
            { id: 'buy_medkit', text: 'Купить Военную аптечку (50 т.)', reqCost: 50, winLoot: 'food_medkit', winLog: '> Вы купили Военную аптечку.' },
            { id: 'leave', text: 'Пройти мимо', winLog: '> Вы разошлись в тумане.' }
        ]
    },
    {
        id: 'npc_lifter',
        title: 'ВСТРЕЧА: СЛЕПОЙ ЛИФТЁР МАКАР',
        npc: { name: 'Дед Макар', role: 'Слепой лифтёр шахты', portrait: 'npc_lifter.png' },
        text: 'В полумраке шахты у разбитой клети сидит седой старик в засаленной телогрейке и поцарапанных сварочных очках. Он медленно поворачивает слепое лицо на звук ваших шагов:\n«Слышу поступь... Ты живой? Я уж думал, никто живой сюда больше не доберётся. Я старый слепой лифтёр Макар. Всю жизнь эти тросы смазывал, пока клеть не сорвалась. Лифт наш разбит вдребезги. Чтобы его починить и пустить клеть на нижние этажи, мне нужны три вещи: Ремкомплект лифта, Блок кнопок и Силовой провод генератора. Обыщи этаж, они где-то раскиданы в складах и щитках. Если подвернётся что-то похожее — тащи всё мне, я налажу клеть!»',
        choices: [
            { id: 'makar_quest_info', text: '1. «Где именно искать детали на этаже, дед?»', nextNode: 'node_makar_info' },
            { id: 'makar_repair', text: '2. «Я принёс запчасти! Почини клеть.»', nextNode: 'node_makar_check' },
            { id: 'makar_lore', text: '3. «Как ты выжил здесь в слепоте во время Самосбора?»', nextNode: 'node_makar_lore' },
            { id: 'leave', text: '4. «Я пойду искать детали. Держись тут.»', winLog: '> Вы оставили слепого лифтёра у шахты.' }
        ],
        nodes: {
            node_makar_info: {
                title: 'МАКАР: ГДЕ ИСКАТЬ ЗАПЧАСТИ',
                text: 'Старик стучит сухим мозолистым пальцем по кожуху редуктора:\n«Слушай память слепого: Ремкомплект лифта обычно лежит в опечатанных ящиках аварийной службы на технических складах. Блок кнопок срывали с диспетчерских пультов в коридорах. А силовой провод генератора торчит прямо из распределительных щитов и дизельных установок этажа. Сделай вылазки в неизведанные сектора, обшарь тайники — если подвернётся что-то похожее, тащи мне!»',
                choices: [
                    { id: 'makar_back', text: '«Понял, вернусь к разговору.»', nextNode: 'node_makar_main' },
                    { id: 'leave', text: '«Пошёл на поиски.»', winLog: '> Вы отправились на поиски деталей для лифта.' }
                ]
            },
            node_makar_check: {
                title: 'МАКАР: ОСМОТР ДЕТАЛЕЙ',
                text: 'Дед Макар протягивает загрубевшие, перепачканные солидолом ладони:\n«Давай сюда, ощупаю... Нам нужны сразу три детали: Ремкомплект лифта, Блок кнопок и Провод генератора. Всё собрал, сынок?»',
                choices: [
                    { 
                        id: 'makar_submit_parts', 
                        text: 'Сдать детали: Ремкомплект + Блок кнопок + Провод',
                        reqItems: ['quest_lift_repair', 'quest_lift_buttons', 'quest_lift_wire'],
                        winNotebook: '[СЛЕПОЙ ЛИФТЁР МАКАР]: Старик починил клеть подъемника E4. Дорога на нижние этажи открыта!',
                        winXp: 100,
                        winTalons: 50,
                        activateElevator: true,
                        nextNode: 'node_makar_repaired'
                    },
                    { id: 'makar_back', text: '«У меня пока не всё собрано. Вернусь позже.»', nextNode: 'node_makar_main' }
                ]
            },
            node_makar_repaired: {
                title: 'МАКАР: ЛИФТ ЗАПУЩЕН!',
                text: 'Старик ловко на ощупь затягивает клеммы, спаивает кабели и со щелчком врубает рубильник. Стальные тросы со звоном натягиваются, в шахте вспыхивают желтые сигнальные огни подъемника!\n«Ай молодец, сынок! Слышишь этот ровный гул? Лебедка снова дышит! Теперь лифт готов к спуску. Но будь начеку: при пуске клети сюда сползутся твари из тумана, приготовь оружие!»',
                choices: [
                    { id: 'leave', text: '«Спасибо, дед Макар! Я готов к спуску.»', winLog: '> Лифт успешно отремонтирован дедом Макаром!' }
                ]
            },
            node_makar_lore: {
                title: 'МАКАР: СУДЬБА В ШАХТЕ',
                text: '«Глаза мне выжгло кислотной гарью Самосбора ещё тридцать смен назад. Зато уши стали чуткими — я по скрипу бетона слышу, как твари крадутся по вентиляции за два пролёта. Здесь, у шахты, сквозняк правильный, туман не застаивается. Главное — гермошторку вовремя захлопнуть.»',
                choices: [
                    { id: 'makar_back', text: '«Удивительно... Вернемся к лифту.»', nextNode: 'node_makar_main' },
                    { id: 'leave', text: '«Береги себя, дед.»', winLog: '> Вы попрощались с Макаром.' }
                ]
            },
            node_makar_main: {
                title: 'ВСТРЕЧА: СЛЕПОЙ ЛИФТЁР МАКАР',
                text: '«Ну что, сынок? Нашел детали? Ремкомплект лифта, блок кнопок и провод генератора — вот что нам нужно, чтобы запустить эту махину.»',
                choices: [
                    { id: 'makar_quest_info', text: '1. «Напомни, где искать детали?»', nextNode: 'node_makar_info' },
                    { id: 'makar_repair', text: '2. «Я принес запчасти! Почини клеть.»', nextNode: 'node_makar_check' },
                    { id: 'leave', text: '3. «Пока ищу. Бывай.»', winLog: '> Вы вернулись к осмотру сектора.' }
                ]
            }
        }
    },

    // ===== 10 НОВЫХ ИНТЕРАКТИВНЫХ NPC ГИГАХРУЩА С СЮЖЕТАМИ =====
    {
        id: 'npc_medic_klavdiya',
        title: 'ВСТРЕЧА: ФЕЛЬДШЕР КЛАВДИЯ СТЕПАНОВНА',
        npc: { name: 'Клавдия Степановна', role: 'Фельдшер 4-го медпункта', portrait: 'npc_medic_klavdiya.png' },
        text: 'Среди штабелей ящиков с физраствором сидит женщина в пожелтевшем белом халате поверх армейского ватника. Глаза усталые, но строгие:\n«Здорово, заключенный. Подставляй руку, гляну пульс и цвет вен. Черная плесень сейчас в вентиляции гуляет, если захватило легкие — сразу скажи, пока слизью кашлять не начал.»',
        choices: [
            { id: 'klav_heal', text: '1. «Окажи первую помощь, фельдшер! Перевяжи раны.»', winHp: 100, winLog: '> Фельдшер Клавдия промыла раны спиртом и наложила чистые повязки (+100 HP).' },
            { id: 'klav_buy_medkit', text: '2. Купить Военную аптечку (45 талонов)', reqCost: 45, winLoot: 'food_medkit', winLog: '> Вы приобрели Военную аптечку у фельдшера.' },
            { id: 'klav_buy_cure', text: '3. Купить Антидот от заражения (35 талонов)', reqCost: 35, winLoot: 'antidote_vial', winLog: '> Вы купили сыворотку-антидот.' },
            { id: 'klav_lore', text: '4. «Откуда здесь столько раненых после каждой сирены?»', nextNode: 'node_klav_lore' },
            { id: 'leave', text: '5. «Спасибо, я пойду дальше.»', winLog: '> Вы попрощались с фельдшером Клавдией.' }
        ],
        nodes: {
            node_klav_lore: {
                title: 'КЛАВДИЯ: ИНСТРУКЦИЯ НАРКОМАТА ЗДРАВООХРАНЕНИЯ',
                text: '«После третьей сирены в коридоры выносит фиолетовую пыль. Это не просто споры — это микроскопические частицы псевдоплоти. По инструкции Наркомата за номером 414 положено сжигать зараженных заживо. Но мы прячем людей в подсобках. Береги респиратор, сынок. Без фильтра здесь человек живет ровно семь вдохов.»',
                choices: [
                    { id: 'klav_note', text: 'Записать наставление фельдшера в блокнот (+50 XP)', winNotebook: '[ФЕЛЬДШЕР КЛАВДИЯ]: Фиолетовая пыль Самосбора несёт частицы псевдоплоти. Смерть наступает за 7 вдохов без фильтра.', winXp: 50, nextNode: 'node_klav_main' },
                    { id: 'leave', text: '«Буду начеку. Бывай.»', winLog: '> Вы покинули медпункт.' }
                ]
            },
            node_klav_main: {
                title: 'МЕДПУНКТ: КЛАВДИЯ СТЕПАНОВНА',
                text: '«Ну что еще? Раны затянулись? Держи строй и не шастай по нижним ярусам без аптечки.»',
                choices: [
                    { id: 'klav_heal_repeat', text: 'Подлечить здоровье (+40 HP)', winHp: 40, winLog: '> Клавдия дала стимулирующую таблетку.' },
                    { id: 'leave', text: '«Выдвигаюсь на пост.»', winLog: '> Вы покинули медпункт.' }
                ]
            }
        }
    },
    {
        id: 'npc_cook_valya',
        title: 'ВСТРЕЧА: ТЁТЯ ВАЛЯ «ПОВАРЁШКА»',
        npc: { name: 'Тётя Валя', role: 'Шеф-повар пищеблока П-46', portrait: 'npc_cook_valya.png' },
        text: 'Пар от громадного чана с похлебкой застилает кухню. Пышная женщина в фартуке цвета цемента уверенно машет алюминиевым черпаком:\n«А ну не толпись у раздачи, страдалец! Опять пайку недополучил? Сегодня у нас суповая масса номер два с добавлением сушеного гриба и протеинового шрота. Жрать будешь или харчами перебирать?»',
        choices: [
            { id: 'valya_eat_free', text: '1. «Налей тарелку горячей похлебки, тетя Валя!»', winHp: 50, winLog: '> Вы с аппетитом съели миску обжигающей густой похлебки (+50 HP).' },
            { id: 'valya_trade_slime', text: '2. Сдать 2 куска слизи в обмен на Питательный брикет (+40 XP)', reqLoot: 'mat_slime', winLoot: 'food_ration', winXp: 40, winLog: '> Тетя Валя забрала слизь на переработку и выдала плотный Питательный брикет!' },
            { id: 'valya_buy_pie', text: '3. Купить Сухой паек ВОХР (50 талонов)', reqCost: 50, winLoot: 'food_mre', winLog: '> Вы купили армейский сухпай.' },
            { id: 'valya_lore', text: '4. «Из чего на самом деле варят этот концентрат?»', nextNode: 'node_valya_lore' },
            { id: 'leave', text: '5. «Позже загляну на обед.»', winLog: '> Вы вышли из столовой блока.' }
        ],
        nodes: {
            node_valya_lore: {
                title: 'ТЁТЯ ВАЛЯ: ТАЙНА ПИЩЕВОГО КОМБИНАТА',
                text: 'Тетя Валя наклоняется ближе и понижает голос до свистящего шепота:\n«Синтезаторы белка на 12-м этаже накрылись еще до моего рождения. Всё, что мы едим — это очищенная белковая плесень, снятая со стен колодцев охлаждения. Главное — вываривать в щелочном растворе ровно сорок минут, чтобы жгутики не шевелились в желудке. Но сытно, сынок! Партия заботится о рабочем классе!»',
                choices: [
                    { id: 'valya_note', text: 'Внести секретный рецепт пищеблока в блокнот (+50 XP)', winNotebook: '[ТЁТЯ ВАЛЯ]: Пищевой концентрат производят из вываренной в щелочи стеновой плесени охлаждающих колодцев.', winXp: 50, nextNode: 'node_valya_main' },
                    { id: 'leave', text: '«Спасибо за правду, тетя Валя...»', winLog: '> Вы вернулись в коридор с полным желудком.' }
                ]
            },
            node_valya_main: {
                title: 'СТОЛОВАЯ: ТЁТЯ ВАЛЯ',
                text: '«Ложку оближи и тарелку сдай в мойку! На смене никто голодным не останется, пока Валя у плиты.»',
                choices: [
                    { id: 'leave', text: '«Так точно, выдвигаюсь.»', winLog: '> Вы покинули пищеблок.' }
                ]
            }
        }
    },
    {
        id: 'npc_radio_mayak',
        title: 'ВСТРЕЧА: РАДИСТ МАЯК',
        npc: { name: 'Радист Маяк', role: 'Дежурный связист эфира', portrait: 'npc_radio_mayak.png' },
        text: 'В тесной будке радиоузла пахнет озоном и паяльной канифолью. Худой парень с массивными наушниками лихорадочно крутит верньер лампового приемника «Ишим»:\n«Тише! Слышишь этот треск? На частоте 46.2 МГц пробивается сигнал... Но не из нашего блока. Передают координаты заброшенного склада на нижних перекрытиях. Ты как раз туда идешь?»',
        choices: [
            { id: 'mayak_coords', text: '1. «Запиши мне частоту и координаты тайника!»', winNotebook: '[РАДИСТ МАЯК]: Частота 46.2 МГц перехватила координаты схрона аварийной партии на технических этажах.', winXp: 65, winTalons: 35, winLog: '> Радист Маяк поделился перехваченными координатами (+35 талонов, +65 XP)!' },
            { id: 'mayak_battery', text: '2. Поделиться батарейками взамен на сигнальную ракету', reqQuestItem: 'quest_battery', winLoot: 'flare_gun', winXp: 50, winLog: '> Маяк отблагодарил вас надежным сигнальным фальшфейером!' },
            { id: 'mayak_lore', text: '3. «Что слышно в эфире за пределами нашего блока?»', nextNode: 'node_mayak_lore' },
            { id: 'leave', text: '4. «Не буду отвлекать от вахты.»', winLog: '> Вы оставили радиста слушать шипение ламп.' }
        ],
        nodes: {
            node_mayak_lore: {
                title: 'МАЯК: ГОЛОСА ИЗ ГЛУБИНЫ ГИГАХРУЩА',
                text: '«Иногда радио волны доносят голоса тех этажей, которые забетонировали еще при Брежневе. Там до сих пор работают автоответчики и метрономы. А в полночь в эфир выходит так называемый "Голос 0-го Этажа" — монотонно зачитывает списки фамилий жильцов, которые родятся только через сто лет. Мурашки по коже...»',
                choices: [
                    { id: 'mayak_note', text: 'Записать радио-аномалию в блокнот (+60 XP)', winNotebook: '[ЭФИР МАЯКА]: На нулевом канале автоматический передатчик читает имена еще не родившихся обитателей хруща.', winXp: 60, nextNode: 'node_mayak_main' },
                    { id: 'leave', text: '«Жуткие вещи... Береги уши, Маяк.»', winLog: '> Вы покинули радиоузел.' }
                ]
            },
            node_mayak_main: {
                title: 'РАДИОУЗЕЛ: МАЯК',
                text: '«Эфир чист на пять минут вперед. Если найдешь медную катушку или лампы 6П3С — неси мне, соберу усилитель дальнего перехвата!»',
                choices: [
                    { id: 'leave', text: '«Договорились, буду искать.»', winLog: '> Вы вернулись на маршрут.' }
                ]
            }
        }
    },
    {
        id: 'npc_smelter_kuzma',
        title: 'ВСТРЕЧА: СТАЛЕВАР КУЗЬМА ОГНЕННЫЙ',
        npc: { name: 'Кузьма Огненный', role: 'Бригадир доменного цеха', portrait: 'npc_smelter_kuzma.png' },
        text: 'Жар от открытой горловины плавильной печи обжигает даже сквозь защитное стекло респиратора. Могучий седобородый сталевар в брезентовой робе ловко орудует стальной пикой:\n«Стой где стоишь, обсыплешься окалиной! В такую топку сунься — за полсекунды в шлак обратишься. Металл нынче тугой пошел, с примесью био-массы. Но если ковать под прессом в три наката — броня держит когти тварей без единой царапины!»',
        choices: [
            { id: 'kuzma_temper', text: '1. «Закали моё снаряжение в доменном масле!»', winDef: 2, winHp: 30, winLog: '> Кузьма окунул ваши доспехи в закалочную ванну (+2 к постоянной Броне)!' },
            { id: 'kuzma_trade_metal', text: '2. Сдать металлолом на переплавку (обмен на 45 талонов)', reqLoot: 'mat_scrap', winTalons: 45, winXp: 40, winLog: '> Кузьма бросил металлолом в тигель и отсчитал вам 45 талонов!' },
            { id: 'kuzma_buy_machete', text: '3. Купить Закаленное мачете из рессорной стали (110 талонов)', reqCost: 110, winLoot: 'weapon_machete_steel', winLog: '> Вы приобрели тяжелое закаленное мачете мастера Кузьмы!' },
            { id: 'kuzma_lore', text: '4. «Как цех выдерживает наплыв биомассы во время тревоги?»', nextNode: 'node_kuzma_lore' },
            { id: 'leave', text: '5. «Пойду, пока не спекся от жара.»', winLog: '> Вы отошли от огненного жерла печи.' }
        ],
        nodes: {
            node_kuzma_lore: {
                title: 'КУЗЬМА: СТАЛЬНАЯ ГЕРМЕТИЗАЦИЯ',
                text: '«Огонь — единственное, чего боится эта живая слизь. Когда воет сирена, мы заливаем шлюзовые щели кипящим чугуном прямо из ковша. Металл застывает за минуту, намертво сваривая створки. Ни одна тварь не пролезет сквозь монолитную чугунную плиту. Вот так деды стояли, и мы стоим!»',
                choices: [
                    { id: 'kuzma_note', text: 'Записать метод чугунной обороны цеха (+50 XP)', winNotebook: '[СТАЛЕВАР КУЗЬМА]: Шлюзовые щели при Самосборе заливают жидким чугуном, создавая непреодолимый температурный барьер.', winXp: 50, nextNode: 'node_kuzma_main' },
                    { id: 'leave', text: '«Крепкая работа, Кузьма. Держи огонь!»', winLog: '> Вы оставили сталевара у печи.' }
                ]
            },
            node_kuzma_main: {
                title: 'ПЛАВИЛЬНЫЙ ЦЕХ: КУЗЬМА',
                text: '«Сталь ошибок не прощает. Оружие держи сухим, а дуло — чистым.»',
                choices: [
                    { id: 'leave', text: '«Принял к сведению.»', winLog: '> Вы вернулись в коридоры блока.' }
                ]
            }
        }
    },
    {
        id: 'npc_guide_erofey',
        title: 'ВСТРЕЧА: ПРОВОДНИК ЕРОФЕЙ СЛЕПОЙ',
        npc: { name: 'Ерофей Слепой', role: 'Следопыт вентиляционных шахт', portrait: 'npc_guide_erofey.png' },
        text: 'Из вентиляционной решетки бесшумно скользнула фигура в легком комбезе, увешанном крюками и веревками. Его веки затянуты шрамами, но голова поворачивается безошибочно на биение вашего пульса:\n«Не шуми подошвами, гражданский. Под нами сорок метров пустоты и гнездо многоножек. Я — Ерофей. Двадцать лет ползаю по техническим ходам Гигахруща. Знаю каждый лаз, каждую трубу, где можно пересидеть Самосбор без единой царапины.»',
        choices: [
            { id: 'erofey_train_dodge', text: '1. Пройти урок бесшумного шага (+60 XP, +10% шанс уклонения)', winXp: 60, winLog: '> Ерофей научил вас двигаться на полусогнутых без скрипа подошв (+60 XP)!' },
            { id: 'erofey_show_shortcut', text: '2. Спросить тайный проход в обход монстров сектора', winNotebook: '[ПРОВОДНИК ЕРОФЕЙ]: Открыт обходной вентиляционный коридор E-Вент, позволяющий срезать опасные участки этажа.', winXp: 75, winTalons: 25, winLog: '> Ерофей начертил на пыльной стене схему обходного лаза!' },
            { id: 'erofey_lore', text: '3. «Что находится в самом низу, за вентиляцией?»', nextNode: 'node_erofey_lore' },
            { id: 'leave', text: '4. «Счастливого пути по трубам, Ерофей.»', winLog: '> Проводник растворился в темноте воздуховода.' }
        ],
        nodes: {
            node_erofey_lore: {
                title: 'ЕРОФЕЙ: ПУСТОТЫ МЕЖДУ СТЕНАМИ',
                text: '«Гигахрущ не строили как обычный дом. Между жилыми блоками оставлены гигантские пустые колодцы шириной в сотни метров. Там висят сорвавшиеся лифтовые клети, обросшие фосфорным мхом, и гуляет сквозняк ледяного ветра. Никто не знает, где дно. Говорят, на самом дне спят строительные шагающие экскаваторы размером с пятиэтажку...»',
                choices: [
                    { id: 'erofey_note', text: 'Записать свидетельство о пустых шахтах (+70 XP)', winNotebook: '[ЕРОФЕЙ СЛЕПОЙ]: В колодцах между блоками обнаружены гигантские пустоты и брошенные титанические машины строителей.', winXp: 70, nextNode: 'node_erofey_main' },
                    { id: 'leave', text: '«Спасибо за предупреждение, Ерофей.»', winLog: '> Вы покинули вентиляционный ствол.' }
                ]
            },
            node_erofey_main: {
                title: 'ВЕНТИЛЯЦИОННЫЙ УЗЕЛ: ЕРОФЕЙ',
                text: '«Слушай гул воздуха. Если тяга пошла обратно — гермоклапан закрыт, ищи боковую шахту.»',
                choices: [
                    { id: 'leave', text: '«Понял, держу ухо востро.»', winLog: '> Вы продолжили путь.' }
                ]
            }
        }
    },
    {
        id: 'npc_inspector_kovalev',
        title: 'ВСТРЕЧА: ИНСПЕКТОР КОВАЛЁВ',
        npc: { name: 'Инспектор Ковалёв', role: 'Старший ревизор Спецархива', portrait: 'npc_inspector_kovalev.png' },
        text: 'За массивным канцелярским столом под лампой с зеленым абажуром сидит суровый человек в темно-синем кителе ревизора. На столе выстроились аккуратные стопки папок "СОВ. СЕКРЕТНО":\n«Гражданин, предъявите регистрационную карточку и трудовую книжку. В период действия аварийного протокола бесцельное перемещение карается направлением на очистку жироуловителей. Доложите цель нахождения в служебном секторе!»',
        choices: [
            { id: 'kovalev_report', text: '1. «Я выполняю приказ по зачистке мутантов блока!»', winXp: 80, winTalons: 40, winLog: '> Инспектор Ковалёв сверил рапорт и выдал талоны за примерное исполнение долга (+40 т., +80 XP)!' },
            { id: 'kovalev_permit', text: '2. Получить Спецпропуск с гербовой печатью (75 талонов)', reqCost: 75, winQuestItem: 'quest_vokhr_token', winLog: '> Инспектор припечатал формуляр фиолетовой мастикой: получен Спецпропуск ВОХР!' },
            { id: 'kovalev_lore', text: '3. «Какие тайны скрыты в папках Спецархива?»', nextNode: 'node_kovalev_lore' },
            { id: 'leave', text: '4. «Разрешите следовать по маршруту, товарищ инспектор.»', winLog: '> Ревизор сухо кивнул, не отрывая глаз от ведомости.' }
        ],
        nodes: {
            node_kovalev_lore: {
                title: 'КОВАЛЁВ: ДИРЕКТИВА НОМЕР 0',
                text: 'Инспектор снимает очки в роговой оправе и протирает их суконкой:\n«Согласно первоначальному плану 1974 года, Гигахрущ проектировался не как жилье, а как ковчег глубокого заложения на случай полной аннигиляции внешней биосферы. Самосбор — это не внешняя атака, а сбой внутренней системы самоочистки. Система считает нас чужеродным загрязнением, подлежащим смыву. Но Партия держит оборону уже сорок лет, и мы не отступим.»',
                choices: [
                    { id: 'kovalev_note', text: 'Записать засекреченную директиву ревизора (+90 XP)', winNotebook: '[ИНСПЕКТОР КОВАЛЁВ]: Самосбор — это аварийный цикл внутренней самоочистки гигахруща, принимающий людей за биологический сор.', winXp: 90, nextNode: 'node_kovalev_main' },
                    { id: 'leave', text: '«Это меняет всё... Честь имею, товарищ инспектор.»', winLog: '> Вы покинули кабинет архива.' }
                ]
            },
            node_kovalev_main: {
                title: 'СПЕЦАРХИВ: ИНСПЕКТОР КОВАЛЁВ',
                text: '«Соблюдайте регламент отчетности. Дисциплина — щит социалистического общежития.»',
                choices: [
                    { id: 'leave', text: '«Есть соблюдать регламент!»', winLog: '> Вы вышли в коридор.' }
                ]
            }
        }
    },
    {
        id: 'npc_engineer_zaslavsky',
        title: 'ВСТРЕЧА: ГЛАВЭНЕРГЕТИК ЗАСЛАВСКИЙ',
        npc: { name: 'Заславский В.П.', role: 'Главный энергетик подстанции', portrait: 'npc_engineer_zaslavsky.png' },
        text: 'Воздух гудит от низкочастотного напряжения 10 киловольт. Высокий жилистый инженер в диэлектрических перчатках до локтей проверяет показания амперметров на мраморной панели:\n«Не подходи к шинам, дурак, притянет дугой — пепла не соберут! Опять на третьем фидере просадка. Трансформаторы захлебываются, а насосы откачки слизи требуют тока! Если энергоблок ляжет — погаснут лампы дневного света по всему этажу, и вот тогда начнется настоящий кошмар.»',
        choices: [
            { id: 'zaslav_boost_filter', text: '1. «Запитай мой респиратор от аварийной клеммы!»', winFilter: 100, winLog: '> Заславский подключил ваш фильтр к электролизеру — ресурс фильтра восстановлен до 100%!' },
            { id: 'zaslav_give_fuse', text: '2. Передать найденный Предохранитель в щит (+85 XP, +50 талонов)', reqQuestItem: 'quest_fuse', winXp: 85, winTalons: 50, winLog: '> Заславский вогнал предохранитель в держатель: гул трансформаторов выровнялся (+50 т., +85 XP)!' },
            { id: 'zaslav_buy_gloves', text: '3. Купить Диэлектрические перчатки защиты (60 талонов)', reqCost: 60, winLoot: 'gloves_dielectric', winLog: '> Вы приобрели прочные диэлектрические краги.' },
            { id: 'zaslav_lore', text: '4. «Откуда подстанция берет столько мегаватт энергии?»', nextNode: 'node_zaslav_lore' },
            { id: 'leave', text: '5. «Осторожнее с высоким напряжением, товарищ инженер.»', winLog: '> Вы обошли шинный мост стороной.' }
        ],
        nodes: {
            node_zaslav_lore: {
                title: 'ЗАСЛАВСКИЙ: РЕАКТОР НУЛЕВОЙ ТОЧКИ',
                text: '«На минус 25-м этаже замурован геотермальный плазменный реактор проекта "Искра-9". Топливо туда загрузили при постройке на триста лет вперед. Но кабели с каждым десятилетием ветшают, медь окисляется от кислотных паров. Мы латаем пробои свинцом и асбестом. Пока горят зеленые лампы — блок живет. Если замигает красная — молись своему деду.»',
                choices: [
                    { id: 'zaslav_note', text: 'Записать схему энергоснабжения блока (+80 XP)', winNotebook: '[ГЛАВЭНЕРГЕТИК ЗАСЛАВСКИЙ]: На 25 этаже работает необслуживаемый плазменный реактор "Искра-9", питающий всю энергосеть сектора.', winXp: 80, nextNode: 'node_zaslav_main' },
                    { id: 'leave', text: '«Держи напряжение, инженер!»', winLog: '> Вы вернулись на маршрут патрулирования.' }
                ]
            },
            node_zaslav_main: {
                title: 'ПОДСТАНЦИЯ: ЗАСЛАВСКИЙ',
                text: '«Следи за фазировкой и не трогай оголенные провода. Работаем в штатном режиме.»',
                choices: [
                    { id: 'leave', text: '«Понял, ухожу.»', winLog: '> Вы покинули электрощитовую.' }
                ]
            }
        }
    },
    {
        id: 'npc_sergeant_tarasov',
        title: 'ВСТРЕЧА: СЕРЖАНТ ТАРАСОВ',
        npc: { name: 'Сержант Тарасов', role: 'Командир заслона ВОХР', portrait: 'npc_sergeant_tarasov.png' },
        text: 'За баррикадой из мешков с песком и колючей проволоки дежурят бойцы в тяжелых шлемах "Сфера". Сержант с огрубевшим лицом и шрамом через всю щеку осматривает вас сквозь прицел укороченного автомата:\n«Стой! Опусти оружие стволом в пол. Ты вошел в зону огневого контроля роты ВОХР. За спиной — мирный сектор с жилячейками, впереди — прорыв тумана. Кто такой? Готов встать к бойнице плечом к плечу?»',
        choices: [
            { id: 'tarasov_drill', text: '1. Пройти стрелковую подготовку у сержанта (+75 XP, +3 к урону)', winDmg: 3, winXp: 75, winLog: '> Сержант Тарасов отработал с вами хват и резкий укол штыком (+3 к постоянному урону)!' },
            { id: 'tarasov_ammo', text: '2. Получить комплект армейских патронов и бронепластину (80 талонов)', reqCost: 80, winDef: 2, winHp: 50, winLog: '> Сержант выдал вам титановую бронепластину для бронежилета (+2 Брони, +50 HP)!' },
            { id: 'tarasov_bounty', text: '3. Доложить об уничтожении босса сектора (награда 120 талонов)', reqDefeatedBoss: true, winTalons: 120, winXp: 100, winLog: '> Сержант зафиксировал ликвидацию мутанта и выдал премию от командования (+120 т., +100 XP)!' },
            { id: 'tarasov_lore', text: '4. «Как держится рубеж во время прорыва?»', nextNode: 'node_tarasov_lore' },
            { id: 'leave', text: '5. «Спокойного дежурства, сержант.»', winLog: '> Бойцы ВОХР проводили вас внимательными взглядами.' }
        ],
        nodes: {
            node_tarasov_lore: {
                title: 'ТАРАСОВ: ПРИКАЗ 227 БЛОККОМА',
                text: '«У нас простой приказ: ни шагу назад от гермоворот. Если шлюз взломают — твари хлынут в спальные ячейки, где спят женщины и дети. В прошлый Самосбор на нас перла трехметровая тварь из жира и проволоки. Мы сожгли три огнемета и выставили цепь из ручных гранат. Половина взвода осталась лежать на бетоне, но ворота мы отстояли. Вот что такое служба ВОХР.»',
                choices: [
                    { id: 'tarasov_note', text: 'Записать подвиг бойцов заслона ВОХР (+85 XP)', winNotebook: '[СЕРЖАНТ ТАРАСОВ]: Заслон ВОХР ценой жизни держит огневой рубеж перед спальными блоками жилячеек.', winXp: 85, nextNode: 'node_tarasov_main' },
                    { id: 'leave', text: '«Вечная слава павшим. Держитесь, ребята.»', winLog: '> Вы вернулись на внешнюю линию обороны.' }
                ]
            },
            node_tarasov_main: {
                title: 'ЗАСЛОН ВОХР: СЕРЖАНТ ТАРАСОВ',
                text: '«Оружие на предохранитель не ставь. В тумане промедление стоит жизни.»',
                choices: [
                    { id: 'leave', text: '«Так точно, сержант!»', winLog: '> Вы вышли в нейтральный коридор.' }
                ]
            }
        }
    },
    {
        id: 'npc_hermit_azariy',
        title: 'ВСТРЕЧА: ОТШЕЛЬНИК АЗАРИЙ',
        npc: { name: 'Старец Азарий', role: 'Отшельник плотевых разломов', portrait: 'npc_hermit_azariy.png' },
        text: 'Стены коридора здесь покрыты влажной, мерно пульсирующей багровой пленкой псевдоплоти. В нише среди оплывших стеариновых свечей сидит босой старец в рубище из грубой мешковины. В руках у него четки из позвонков мутантов:\n«Не бойся дрожи стен, странник... Бетон дышит. Он помнит каждого, кто сгинул в бездне за сотни смен. Ты слышишь этот зов? Это не сирена воет — это плачет сам Гигахрущ, замурованный в бесконечности.»',
        choices: [
            { id: 'azariy_bless', text: '1. «Помолись за спасение моей души в тумане, старец.»', winHp: 75, winFilter: 50, winLog: '> Старец Азарий осенил вас защитным знамением: дыхание стало чистым (+75 HP, +50% фильтр)!' },
            { id: 'azariy_relic', text: '2. Пожертвовать Кусок плоти в обмен на Древний оберег (+90 XP)', reqLoot: 'mat_meat', winLoot: 'charm_flesh_ward', winXp: 90, winLog: '> Азарий вручил вам костяной оберег, отпугивающий низших мутантов!' },
            { id: 'azariy_prophecy', text: '3. «Что ждет смельчака на тридцатом этаже?»', nextNode: 'node_azariy_lore' },
            { id: 'leave', text: '4. «Твои слова смущают разум, старик. Я иду дальше.»', winLog: '> Вы поспешили удалиться от мерно бьющихся багровых стен.' }
        ],
        nodes: {
            node_azariy_lore: {
                title: 'АЗАРИЙ: ТАЙНА ЧЕРНОБОГА',
                text: 'Старец поднимает пустые белесые глаза к пульсирующему потолку:\n«На тридцатом этаже спит Первичная Масса. Древние звали её Чернобогом. Она породила этот серый бетон, эти трубы, эти бесконечные коридоры. Сирена Самосбора — это биение её гигантского сердца. Тот, кто вонзит Ключ Разрыва в сердцевину монолита, либо разорвет вечный круг... либо сотрет Гигахрущ в пыль. Готов ли ты к такому выбору, путник?»',
                choices: [
                    { id: 'azariy_note', text: 'Записать пророчество о Чернобоге в блокнот (+100 XP)', winNotebook: '[ОТШЕЛЬНИК АЗАРИЙ]: На 30 этаже покоится Чернобог — первоисточник бетона и сирены Самосбора. Ключ Разрыва решает судьбу цикла.', winXp: 100, nextNode: 'node_azariy_main' },
                    { id: 'leave', text: '«Я найду ответ сам на нижних этажах.»', winLog: '> Вы оставили старца у восковых свечей.' }
                ]
            },
            node_azariy_main: {
                title: 'РАЗЛОМ ПЛОТИ: АЗАРИЙ',
                text: '«Иди с миром, и пусть бетон под твоими стопами не превратится в живую топь.»',
                choices: [
                    { id: 'leave', text: '«Прощай, старец.»', winLog: '> Вы покинули био-разлом.' }
                ]
            }
        }
    },
    {
        id: 'npc_mechanic_makar',
        title: 'ВСТРЕЧА: ДЕД МАКАР В РЕМЗОНЕ',
        npc: { name: 'Дед Макар', role: 'Старший механик ремзоны', portrait: 'npc_mechanic_makar.png' },
        text: 'В мастерской среди разобранных дизелей и стружки от токарного станка стучит молотком дед Макар. Поверх старой спецовки надет кожаный фартук с карманами под гаечные ключи:\n«Здорово, боец! Пришел инструмент подточить или шестеренки раздобыть? У меня здесь любая деталь найдется — от шплинта до коленвала. Главное — руки прямые иметь, тогда и монтировка в руках как лазер режет!»',
        choices: [
            { id: 'makar_hone_weapon', text: '1. «Наточи лезвие моего оружия на наждаке!»', winDmg: 2, winLog: '> Дед Макар снял фаску и довел лезвие на оселке (+2 к постоянному урону)!' },
            { id: 'makar_repair_armor', text: '2. Подлатать швы и заклепки бронежилета (35 талонов)', reqCost: 35, winDef: 2, winHp: 40, winLog: '> Макар заменил лопнувшие заклепки прочной медной проволокой (+2 Брони, +40 HP)!' },
            { id: 'makar_buy_crowbar', text: '3. Купить Усиленную стальную монтировку (70 талонов)', reqCost: 70, winLoot: 'weapon_crowbar_heavy', winLog: '> Вы приобрели увесистую кованую монтировку деда Макара!' },
            { id: 'makar_lore_shop', text: '4. «Как ты умудряешься чинить механизмы в такой разрухе?»', nextNode: 'node_makar_shop_lore' },
            { id: 'leave', text: '5. «Спасибо за работу, дед Макар!»', winLog: '> Вы попрощались с неутомимым механиком.' }
        ],
        nodes: {
            node_makar_shop_lore: {
                title: 'МАКАР: СОВЕТСКАЯ ЗАКАЛКА',
                text: '«Металл — он ласку любит и солидол. Еще до первого Самосбора нас на заводе учили: делай так, чтобы внукам служить осталось. Нынешние пластмассовые респираторы через три смены трескаются, а дедовский чугун и кислоту держит, и удар кувалды. Запомни: не выбрасывай старые болты. В Гигахруще каждый винтик — это чья-то спасенная жизнь.»',
                choices: [
                    { id: 'makar_shop_note', text: 'Записать наставление старого мастера (+60 XP)', winNotebook: '[МЕХАНИК МАКАР]: Чугунные узлы и советский металлопрокат выдерживают кислоту Самосбора лучше любого современного пластика.', winXp: 60, nextNode: 'node_makar_shop_main' },
                    { id: 'leave', text: '«Золотые слова, дед. Бывай!»', winLog: '> Вы вернулись в рабочий отсек.' }
                ]
            },
            node_makar_shop_main: {
                title: 'МАСТЕРСКАЯ: ДЕД МАКАР',
                text: '«Если заклинит замок или шестеренку сорвет — тащи ко мне, обстучим и смажем.»',
                choices: [
                    { id: 'leave', text: '«Обязательно, дед!»', winLog: '> Вы покинули мастерскую.' }
                ]
            }
        }
    },


    // ===== ВТОРАЯ ВОЛНА: 10 НОВЫХ ИНТЕРАКТИВНЫХ NPC ГИГАХРУЩА =====
    {
        id: 'npc_plumber_mikhalych',
        title: 'ВСТРЕЧА: КАПИТАН САНТЕХВЗВОДА МИХАЛЫЧ',
        npc: { name: 'Капитан Михалыч', role: 'Командир сантехнического заслона', portrait: 'npc_plumber_mikhalych.png' },
        text: 'Из сырого технического коллектора доносится глухой звон железа. Мужчина в резиновых броднях и вязаной шапочке со свистом затягивает тяжелый красный трубный ключ на фланце задвижки:\n«Стой, не наступай в эту лужу! Здесь сифон прорвало, живая слизь из стояка полезла. Мы со взводом уже пятый час стоки держим. Тебе куда, в жилые ячейки? Смотри под ноги: если труба вибрирует — сразу вали к сухому гермошлюзу!»',
        choices: [
            { id: 'mikh_reinforce', text: '1. «Обвари стыки моей брони и помоги с экипировкой!»', winDef: 2, winHp: 35, winLog: '> Михалыч затянул хомуты и промазал швы герметиком (+2 Брони, +35 HP)!' },
            { id: 'mikh_buy_wrench', text: '2. Купить Тяжелый сантехнический ключ №5 (80 талонов)', reqCost: 80, winLoot: 'weapon_pipe_wrench', winLog: '> Вы приобрели увесистый чугунный газовый ключ капитана Михалыча!' },
            { id: 'mikh_trade_slime', text: '3. Сдать 2 куска слизи в обмен на флягу очищенной воды', reqLoot: 'mat_slime', winHp: 80, winLog: '> Михалыч забрал слизь для анализа и выдал флягу кипяченой дистиллированной воды (+80 HP)!' },
            { id: 'mikh_lore', text: '4. «Куда на самом деле уходят сточные магистрали?»', nextNode: 'node_mikh_lore' },
            { id: 'leave', text: '5. «Держи напор, Михалыч!»', winLog: '> Вы оставили сантехников у ревущей магистрали.' }
        ],
        nodes: {
            node_mikh_lore: {
                title: 'МИХАЛЫЧ: КРУГОВОРОТ СТОКОВ В ГИГАХРУЩЕ',
                text: 'Михалыч сплевывает в ржавый желоб и вытирает лоб замасленной перчаткой:\n«Никуда они не уходят, парень. Гигахрущ — замкнутая колба. На минус шестидесятом этаже стоят седиментационные бассейны размером с целые города. Там ил с биомассой отстаивается, фильтруется через двадцать слоев гравия и снова подается в краны верхних этажей. Главное — чай без кипячения не пить, иначе в кишках полипы вырастут.»',
                choices: [
                    { id: 'mikh_note', text: 'Записать схему коллекторов в блокнот (+70 XP)', winNotebook: '[КАПИТАН МИХАЛЫЧ]: Сточные воды Гигахруща циркулируют по замкнутому циклу через гигантские подземные отстойники.', winXp: 70, nextNode: 'node_mikh_main' },
                    { id: 'leave', text: '«Понял... Чай буду кипятить трижды.»', winLog: '> Вы вернулись в коридор.' }
                ]
            },
            node_mikh_main: {
                title: 'САНТЕХНИЧЕСКИЙ ЗАСЛОН: МИХАЛЫЧ',
                text: '«Трубы не любят суеты. Держи давление в норме — и Самосбор пересидишь.»',
                choices: [
                    { id: 'leave', text: '«Бывай, капитан!»', winLog: '> Вы покинули коллектор.' }
                ]
            }
        }
    },
    {
        id: 'npc_librarian_zoya',
        title: 'ВСТРЕЧА: ЗОЯ ПАВЛОВНА ИЗ ТЕХБЮРО',
        npc: { name: 'Зоя Павловна', role: 'Хранитель перфокарт Техбюро', portrait: 'npc_librarian_zoya.png' },
        text: 'Среди уходящих под своды полок с перфокартами и катушками магнитных лент сидит пожилая женщина со строгим лицом и очками, замотанными синей изолентой:\n«Тише, гражданин! Вы находитесь в секторе учета технической документации. Каждая карточка здесь — это прочность бетонного перекрытия и ресурс лифтовой лебедки. Вы за чертежами или праздно шатаетесь по аварийному сектору?»',
        choices: [
            { id: 'zoya_study_plans', text: '1. Изучить строительные схемы блока (+90 XP, +30 талонов)', winXp: 90, winTalons: 30, winLog: '> Зоя Павловна показала вам засекреченные схемы перекрытий (+30 талонов, +90 XP)!' },
            { id: 'zoya_give_tape', text: '2. Сдать найденную магнитную ленту архива (+75 XP, +50 талонов)', reqQuestItem: 'quest_magnetic_tape', winXp: 75, winTalons: 50, winLog: '> Зоя Павловна бережно уложила ленту в несгораемый сейф (+50 т., +75 XP)!' },
            { id: 'zoya_buy_guide', text: '3. Купить Справочник инженера-строителя (65 талонов)', reqCost: 65, winLoot: 'quest_master_blueprint', winLog: '> Вы приобрели редкий технический справочник по узлам Гигахруща.' },
            { id: 'zoya_lore', text: '4. «Кто на самом деле возводил бесконечные этажи?»', nextNode: 'node_zoya_lore' },
            { id: 'leave', text: '5. «Извините за беспокойство, Зоя Павловна.»', winLog: '> Вы тихо прикрыли дубовую дверь архива.' }
        ],
        nodes: {
            node_zoya_lore: {
                title: 'ЗОЯ ПАВЛОВНА: ПЕРФОКАРТЫ ПЕРВОГО СТРОИТЕЛЬСТВА',
                text: 'Архивистка надевает белые хлопковые перчатки и извлекает пожелтевшую перфокарту с грифом "ОСОБАЯ ПАПКА":\n«В 1964 году строители запустили автоматический шагающий бетоноукладчик с самообучающимся контуром. Он должен был возвести ровно девять этажей типового блока. Но из-за скачка фазы в реле счетчик перешел в бесконечную рекурсию. Машина строила этаж за этажом, захватывая грунт, камень и воздух. Когда опомнились — над землей уже стояли километры бетона. И машина до сих пор где-то там... строит.»',
                choices: [
                    { id: 'zoya_note', text: 'Записать тайну бесконечной стройки (+85 XP)', winNotebook: '[ЗОЯ ПАВЛОВНА]: Гигахрущ порожден сбоем реле автоматического бетоноукладчика, ушедшего в бесконечную рекурсию строительства.', winXp: 85, nextNode: 'node_zoya_main' },
                    { id: 'leave', text: '«Это потрясающе и жутко... До свидания.»', winLog: '> Вы покинули архив Техбюро.' }
                ]
            },
            node_zoya_main: {
                title: 'ТЕХБЮРО: ЗОЯ ПАВЛОВНА',
                text: '«Берегите книги и формуляры. Бумага переживет и нас, и бетон.»',
                choices: [
                    { id: 'leave', text: '«Так точно.»', winLog: '> Вы вышли в коридор.' }
                ]
            }
        }
    },
    {
        id: 'npc_agronomist_serafima',
        title: 'ВСТРЕЧА: АГРОНОМ СЕРАФИМА',
        npc: { name: 'Серафима', role: 'Зав. оранжереей белковых культур', portrait: 'npc_agronomist_serafima.png' },
        text: 'Теплый влажный воздух гидропонной оранжереи пахнет сырой землей и озоном. Девушка с короткими темными волосами в резиновом фартуке аккуратно срезает светящиеся побеги фиолетового мха под ультрафиолетовыми лампами:\n«Осторожнее у стеллажей! Этот сорт мха поглощает тяжелые изотопы и очищает воздух. Если ты с нижних уровней — садись, я дам тебе настойку из очищенных спор. Она мгновенно выводит яды Самосбора из крови.»',
        choices: [
            { id: 'sera_heal_spores', text: '1. Выпить целебный отвар био-мха (исцеление +80 HP, снятие заражения)', winHp: 80, winLog: '> Отвар Серафимы приятно обжег горло: раны затянулись, слабость отступила (+80 HP)!' },
            { id: 'sera_buy_lichen', text: '2. Купить Сушеный антисептический лишайник (30 талонов)', reqCost: 30, winLoot: 'antidote_vial', winLog: '> Вы приобрели концентрированный растительный антисептик.' },
            { id: 'sera_trade_meat', text: '3. Сдать кусок плоти на питательный субстрат (+60 XP, +35 талонов)', reqLoot: 'mat_meat', winXp: 60, winTalons: 35, winLog: '> Серафима поместила биомассу в автоклав и отблагодарила вас талонами (+35 т., +60 XP)!' },
            { id: 'sera_lore', text: '4. «Как растения выживают под землей без солнца?»', nextNode: 'node_sera_lore' },
            { id: 'leave', text: '5. «Спасибо за заботу, Серафима!»', winLog: '> Вы покинули благоухающую оранжерею.' }
        ],
        nodes: {
            node_sera_lore: {
                title: 'СЕРАФИМА: БИОЛЮМИНЕСЦЕНТНАЯ ЖИЗНЬ',
                text: 'Серафима улыбается и подносит к свету колбу с пульсирующим изумрудным гелем:\n«Они не нуждаются в солнце. Эти культуры мутировали так, чтобы питаться электромагнитным полем бетонных плит и низкочастотным гулом силовых кабелей. Бетон Гигахруща — это живой минерал. Пока сквозь стены течет ток, наши оранжереи дают кислород и белок для целого сектора.»',
                choices: [
                    { id: 'sera_note', text: 'Записать ботаническое открытие в блокнот (+75 XP)', winNotebook: '[АГРОНОМ СЕРАФИМА]: Подземная флора питается электромагнитным полем бетона и питает кислородом жилые блоки.', winXp: 75, nextNode: 'node_sera_main' },
                    { id: 'leave', text: '«Удивительная природа... До встречи!»', winLog: '> Вы вернулись на холодный бетон коридора.' }
                ]
            },
            node_sera_main: {
                title: 'ОРАНЖЕРЕЯ: СЕРАФИМА',
                text: '«Если найдешь семена или споры в экспедициях — неси ко мне, высадим в инкубатор!»',
                choices: [
                    { id: 'leave', text: '«Договорились, буду собирать.»', winLog: '> Вы вышли в коридор.' }
                ]
            }
        }
    },
    {
        id: 'npc_projectionist_saveliy',
        title: 'ВСТРЕЧА: КИНОМЕХАНИК ДЕД САВЕЛИЙ',
        npc: { name: 'Дед Савелий', role: 'Старший киномеханик клуба «Маяк»', portrait: 'npc_projectionist_saveliy.png' },
        text: 'Среди рядов фанерных кресел в полутемном актовом зале мерно стрекочет объектив 35-мм кинопроектора "Украина". Седой старик в выцветшей жилетке с папиросой за ухом приветливо кивает на свободное место:\n«Заходи, боец, присаживайся. До смены еще двадцать минут. Я как раз зарядил учебную хронику ГО 1968 года. Посмотришь — узнаешь, как правильно герметизировать вентиляционный короб ветошью с суриком. Знание пленки жизнь бережет!»',
        choices: [
            { id: 'sav_watch_film', text: '1. Посмотреть учебную киноленту ГО (+85 XP, +15 к здоровью)', winHp: 50, winXp: 85, winLog: '> Просмотр учебного фильма укрепил ваш боевой дух (+15 макс. HP, +85 XP)!' },
            { id: 'sav_trade_bulb', text: '2. Передать найденный Предохранитель на ремонт проектора (+60 XP, +40 талонов)', reqQuestItem: 'quest_fuse', winXp: 60, winTalons: 40, winLog: '> Дед Савелий вставил предохранитель в блок питания киноаппарата (+40 т., +60 XP)!' },
            { id: 'sav_buy_poster', text: '3. Купить Агитационный плакат «Береги фильтр!» (25 талонов)', reqCost: 25, winFilter: 40, winLog: '> Плакат помог освежить правила ухода за противогазом (+40% к фильтру)!' },
            { id: 'sav_lore', text: '4. «Какие фильмы здесь крутили до первых тревог?»', nextNode: 'node_sav_lore' },
            { id: 'leave', text: '5. «Мне пора на пост, дед Савелий.»', winLog: '> Кинопроектор продолжил мерно шуршать в полумраке.' }
        ],
        nodes: {
            node_sav_lore: {
                title: 'САВЕЛИЙ: ХРОНИКИ ЗОЛОТОГО ВЕКА',
                text: 'Старик прикрывает объектив шторкой и затягивается дымком:\n«Крутили комедии Гайдая, "Белое солнце пустыни", выпуски киножурнала "Фитиль". Зал набивался до отказа — работяги после двенадцатичасовой смены сидели плечом к плечу, смеялись, лимонад пили. А потом впервые взвыла сирена... С тех пор крутим только инструктажи по ликвидации прорывов. Но я храню в ящике одну бобину с комедией. Когда-нибудь снова включим на весь блок.»',
                choices: [
                    { id: 'sav_note', text: 'Записать воспоминания киномеханика (+80 XP)', winNotebook: '[КИНОМЕХАНИК САВЕЛИЙ]: В клубе "Маяк" до сих пор хранится довоенная кинохроника, которую покажут после окончания Самосбора.', winXp: 80, nextNode: 'node_sav_main' },
                    { id: 'leave', text: '«Обязательно включим, дед. Держись!»', winLog: '> Вы вышли из зрительного зала.' }
                ]
            },
            node_sav_main: {
                title: 'КИНОБУДКА: ДЕД САВЕЛИЙ',
                text: '«Пленка не терпит пыли. Держи шаг ровно и береги глаза.»',
                choices: [
                    { id: 'leave', text: '«Спасибо, дед Савелий!»', winLog: '> Вы покинули клуб.' }
                ]
            }
        }
    },
    {
        id: 'npc_scavenger_syoma',
        title: 'ВСТРЕЧА: СЁМА «ШНИФЕР»',
        npc: { name: 'Сёма Шнифер', role: 'Скупщик артефактов катакомб', portrait: 'npc_scavenger_syoma.png' },
        text: 'В закутке за разобранным лифтовым противовесом разложена брезентовая скатерть. Щуплый вертлявый парень с ювелирными лупами на лбу протирает рукавом позеленевший вольтметр:\n«Та-а-ак, кто это у нас тут крадется? Сёма видит солидного человека с хабаром! Есть талоны — есть разговор. У Сёмы есть такое, чего даже комендант блока в глаза не видывал: довоенные реле, оптика, спецмонтировки. Интересуешься?»',
        choices: [
            { id: 'syoma_mystery_box', text: '1. Купить «Счастливый ящик утильщика» (55 талонов)', reqCost: 55, winLoot: 'food_medkit', winTalons: 30, winLog: '> В ящике утильщика оказалась армейская аптечка и 30 запечатанных талонов!' },
            { id: 'syoma_sell_scrap', text: '2. Сдать металлолом по выгодному курсу (обмен на 55 талонов)', reqLoot: 'mat_scrap', winTalons: 55, winXp: 45, winLog: '> Сёма ловко взвесил лом на безмене и отсчитал вам 55 талонов!' },
            { id: 'syoma_buy_crowbar', text: '3. Купить Заточенную монтировку с медной насечкой (45 талонов)', reqCost: 45, winLoot: 'weapon_crowbar_heavy', winLog: '> Вы приобрели отличную заточенную монтировку с балансиром!' },
            { id: 'syoma_lore', text: '4. «Откуда в заброшенных секторах берутся такие вещи?»', nextNode: 'node_syoma_lore' },
            { id: 'leave', text: '5. «В другой раз, Сёма.»', winLog: '> Сёма проводил вас прищуренным оценивающим взглядом.' }
        ],
        nodes: {
            node_syoma_lore: {
                title: 'СЁМА: СХРОНЫ В МЕЖЭТАЖНЫХ ПЕРЕКРЫТИЯХ',
                text: 'Сёма хитро подмигивает и наклоняется к самому уху:\n«Слушай сюда: строители в семидесятых годах оставляли технологические пустоты между этажами — "карманы". Туда сбрасывали неликвид: ящики с тушенкой, медный кабель, измерительные приборы. На картах их нет, а Сёма знает ходы через вентиляционные шахты. Главное — не шуметь, чтобы твари на запах меди не сползлись.»',
                choices: [
                    { id: 'syoma_note', text: 'Записать наводку на технологические карманы (+70 XP)', winNotebook: '[СЁМА ШНИФЕР]: Между этажами существуют скрытые технологические карманы с законсервированным советским оборудованием.', winXp: 70, nextNode: 'node_syoma_main' },
                    { id: 'leave', text: '«Ценные сведения, Сёма. Удачной торговли.»', winLog: '> Вы покинули барахолку.' }
                ]
            },
            node_syoma_main: {
                title: 'БАРАХОЛКА: СЁМА ШНИФЕР',
                text: '«Если найдешь что-то непонятное и блестящее — сразу тащи Сёме, сторгуемся!»',
                choices: [
                    { id: 'leave', text: '«Договорились!»', winLog: '> Вы вернулись на маршрут.' }
                ]
            }
        }
    },
    {
        id: 'npc_sniper_anna',
        title: 'ВСТРЕЧА: СНАЙПЕР АННА «СОВА»',
        npc: { name: 'Анна «Сова»', role: 'Снайпер смотровой башни ВОХР', portrait: 'npc_sniper_anna.png' },
        text: 'На высоком наблюдательном балконе сквозь узкую бронированную амбразуру смотрит в прицел девушка в камуфлированном шлеме с опущенной балаклавой. На парапете лежит тяжелая снайперская винтовка с длинным глушителем:\n«Не мельтеши в створе окна. Снаружи туман поднялся до 400-го уровня. Я держу сектор восточных воздухозаборников. Если оттуда полезет многоножка — сниму с одного выстрела в сочленение панциря. Зачем поднялся на вышку?»',
        choices: [
            { id: 'anna_marksmanship', text: '1. Пройти урок снайперской точности (+4 к постоянному Урону, +80 XP)', winDmg: 4, winXp: 80, winLog: '> Анна показала вам уязвимые сочленения мутантов (+4 к постоянному урону)!' },
            { id: 'anna_buy_scope', text: '2. Купить Снайперскую оптику ПСО-1 (70 талонов)', reqCost: 70, winLoot: 'weapon_pistol_rare', winLog: '> Вы приобрели прецизионный оптический прицел армейского образца!' },
            { id: 'anna_recon_data', text: '3. Запросить карту расположения гнезд тварей (+40 талонов, +60 XP)', winTalons: 40, winXp: 60, winLog: '> Анна отметила на вашей карте сектора скопления монстров (+40 т., +60 XP)!' },
            { id: 'anna_lore', text: '4. «Что ты видела за пределами внешних стен?»', nextNode: 'node_anna_lore' },
            { id: 'leave', text: '5. «Удачной охоты, Сова.»', winLog: '> Снайпер бесшумно вернулась к наблюдению за мглой.' }
        ],
        nodes: {
            node_anna_lore: {
                title: 'АННА: ВНЕШНЯЯ ПУСТОТА',
                text: 'Анна на секунду отрывается от окуляра и её серые глаза темнеют:\n«Земли нет. Леса нет. Неба нет. В оптику кратностью 24х видно только бесконечные серые циклопические башни, уходящие в свинцовый туман на сотни километров вокруг. Все одинаковые, все в окнах без стекол. Между ними в пустоте летают колонии фиолетовых спор размером с автобус. Наш блок — лишь одна песчинка в бесконечной бетонной пустыне.»',
                choices: [
                    { id: 'anna_note', text: 'Записать свидетельство о внешнем мире (+90 XP)', winNotebook: '[СНАЙПЕР АННА]: Снаружи Гигахруща нет земли — только бесконечные параллельные башни в фиолетовом тумане.', winXp: 90, nextNode: 'node_anna_main' },
                    { id: 'leave', text: '«Жуткое зрелище... Береги себя, Анна.»', winLog: '> Вы спустились с наблюдательного поста.' }
                ]
            },
            node_anna_main: {
                title: 'СМОТРОВАЯ БАШНЯ: АННА',
                text: '«Контролируй дыхание при спуске курка. Выстрел должен быть один.»',
                choices: [
                    { id: 'leave', text: '«Принял.»', winLog: '> Вы вышли в коридор.' }
                ]
            }
        }
    },
    {
        id: 'npc_flamethrower_boris',
        title: 'ВСТРЕЧА: ОГНЕМЁТЧИК БОРИС «ТОРЧ»',
        npc: { name: 'Борис «Торч»', role: 'Старший огнемётчик зачистки', portrait: 'npc_flamethrower_boris.png' },
        text: 'Лестничный пролет насквозь выжжен до черной стеклянной корки. Опершись на раскаленный ствол огнемета РОКС-3, стоит ликвидатор в закопченном асбестовом костюме:\n«Остынь, гражданский, здесь еще бетон дышит жаром. Мы только что выжгли гнездо слизневых пиявок на трех пролетах. Запах паленого белка режет глаза, но зато ни одна спора не шевелится. Хочешь, я твое оружие обработаю огневой закалкой?»',
        choices: [
            { id: 'boris_flame_temper', text: '1. Огневая закалка клинка (+3 к Урону, +70 XP)', winDmg: 3, winXp: 70, winLog: '> Борис прокалил ваше оружие направленной струей пламени (+3 к постоянному урону)!' },
            { id: 'boris_buy_napalm', text: '2. Купить Баллон с огнесмесью «Огонёк» (50 талонов)', reqCost: 50, winLoot: 'flare_gun', winLog: '> Вы приобрели мощный зажигательный баллон ликвидаторов!' },
            { id: 'boris_trade_scrap', text: '3. Сдать металлолом на обварку тепловых экранов (+3 Брони)', reqLoot: 'mat_scrap', winDef: 3, winLog: '> Борис наварил жаропрочные накладки на ваш бронежилет (+3 к Броне)!' },
            { id: 'boris_lore', text: '4. «Как слизь реагирует на огонь?»', nextNode: 'node_boris_lore' },
            { id: 'leave', text: '5. «Чистых коридоров, Борис!»', winLog: '> Ликвидатор поднял закопченную перчатку в прощальном салюте.' }
        ],
        nodes: {
            node_boris_lore: {
                title: 'БОРИС: ОГНЕВАЯ СТЕРИЛИЗАЦИЯ',
                text: 'Борис стучит стальной рукавицей по тяжелому соплу огнемета:\n«Обычные пули эту дрянь только дробят на куски — из одного ошметка через час три новых вырастает. Единственный способ — температура свыше тысячи двухсот градусов. Огнесмесь на основе фосфора и загущенного керосина выжигает псевдоплоть на клеточном уровне, оставляя только хрупкий шлак. В этом блоке закон один: где прошел огнемет — там снова советская власть.»',
                choices: [
                    { id: 'boris_note', text: 'Записать тактику огневой зачистки (+80 XP)', winNotebook: '[ОГНЕМЁТЧИК БОРИС]: Псевдоплоть Самосбора восстанавливается от пуль, но полностью уничтожается пламенем свыше 1200 градусов.', winXp: 80, nextNode: 'node_boris_main' },
                    { id: 'leave', text: '«Надежный метод. Спасибо, Борис.»', winLog: '> Вы вернулись на зачищенный этаж.' }
                ]
            },
            node_boris_main: {
                title: 'ЛЕСТНИЧНЫЙ ЗАСЛОН: БОРИС',
                text: '«Держи пламя в сердце, а палец — на спуске. Прорвемся!»',
                choices: [
                    { id: 'leave', text: '«Так точно!»', winLog: '> Вы покинули пожарный отсек.' }
                ]
            }
        }
    },
    {
        id: 'npc_clockmaker_arseniy',
        title: 'ВСТРЕЧА: ЧАСОВЩИК АРСЕНИЙ',
        npc: { name: 'Арсений Метролог', role: 'Мастер хронометров и реле времени', portrait: 'npc_clockmaker_arseniy.png' },
        text: 'В мастерской с тысячами тикающих маятников и бронзовых шестеренок сухощавый мужчина в белом халате тонким пинцетом выставляет стрелку на тяжелом циферблате:\n«Секунда... еще секунда... Время здесь — единственный абсолютный ориентир. В тумане теряется верх и низ, пропадает память о вчерашнем дне. Но хронометр не врет. Вы пришли настроить временное реле гермозатвора или проверить ход карманных часов?»',
        choices: [
            { id: 'arsen_tempo', text: '1. Калибровка тактического чувства времени (+80 XP, сокращение перезарядок)', winXp: 80, winLog: '> Арсений научил вас ловить тайминг между ударами монстров (+80 XP)!' },
            { id: 'arsen_buy_watch', text: '2. Купить Противоударный хронометр «Молния» (50 талонов)', reqCost: 50, winTalons: 20, winXp: 50, winLog: '> Вы приобрели точные противоударные часы аварийных служб!' },
            { id: 'arsen_repair_mech', text: '3. Ремонт и смазка часовым маслом механизмов (+2 урона, +2 брони)', winDmg: 2, winDef: 2, winLog: '> Механик очистил все подвижные узлы вашего оружия и брони (+2 Урона, +2 Брони)!' },
            { id: 'arsen_lore', text: '4. «Почему перед сиреной часы начинают спешить?»', nextNode: 'node_arsen_lore' },
            { id: 'leave', text: '5. «Точного хода вашим маятникам, мастер.»', winLog: '> Вы вышли под мерный перестук сотен хронометров.' }
        ],
        nodes: {
            node_arsen_lore: {
                title: 'АРСЕНИЙ: АНОМАЛИЯ ВРЕМЕННОЙ ДИЛАТАЦИИ',
                text: 'Часовщик опускает лупу и бережно протирает бархоткой латунный балансир:\n«Самосбор искажает не только пространство бетона, но и темпоральную ткань. За десять минут до сирены механические маятники начинают колебаться на 14% быстрее. Земная гравитация словно проседает, а время сгущается, как кисель. Если ваши часы вдруг побежали вперед — бросайте всё и бегите к ближайшей гермодвери. У вас осталось не более трехсот ударов пульса.»',
                choices: [
                    { id: 'arsen_note', text: 'Записать хронометрическую примету (+85 XP)', winNotebook: '[ЧАСОВЩИК АРСЕНИЙ]: За 10 минут до Самосбора механические часы ускоряют ход на 14% из-за гравитационного искажения.', winXp: 85, nextNode: 'node_arsen_main' },
                    { id: 'leave', text: '«Бесценное знание. Спасибо, Арсений!»', winLog: '> Вы покинули мастерскую времени.' }
                ]
            },
            node_arsen_main: {
                title: 'ЧАСОВАЯ МАСТЕРСКАЯ: АРСЕНИЙ',
                text: '«Каждая секунда на счету. Не тратьте время на пустые сомнения.»',
                choices: [
                    { id: 'leave', text: '«Принял к сведению.»', winLog: '> Вы вышли в коридор.' }
                ]
            }
        }
    },
    {
        id: 'npc_acoustician_gavrila',
        title: 'ВСТРЕЧА: СЛУХАЧ ГАВРИЛА',
        npc: { name: 'Слухач Гаврила', role: 'Акустик-настройщик гермомагистралей', portrait: 'npc_acoustician_gavrila.png' },
        text: 'У развилки гигантских паровых труб сидит человек с плотной черной повязкой на глазах. На голове — тяжелые медные наушники с витыми проводами. Он держит латунную воронку стетоскопа прямо у дрожащего металла:\n«Ш-ш-ш... Замри. Слышишь? На третьем горизонте плита просела на полмиллиметра. А по вентиляционной трубе в пятидесяти метрах перебирает лапами какая-то суставчатая тварь. Я Гаврила, слухач магистралей. Глаза мне без надобности, я ушами весь блок насквозь вижу.»',
        choices: [
            { id: 'gavr_listen_lair', text: '1. «Послушай трубу — где безопасный проход?» (+75 XP, +35 талонов)', winXp: 75, winTalons: 35, winLog: '> Гаврила указал на безопасный коридор в обход засады мутантов (+35 т., +75 XP)!' },
            { id: 'gavr_buy_padding', text: '2. Шумопоглощающая обмотка обуви (40 талонов, +10% к уклонению)', reqCost: 40, winLog: '> Гаврила обмотал ваши подошвы войлочной лентой — шаги стали абсолютно бесшумными!' },
            { id: 'gavr_give_wire', text: '3. Передать медный провод в обмен на звуковую гранату (+60 XP)', reqQuestItem: 'quest_lift_wire', winXp: 60, winLoot: 'antidote_vial', winLog: '> Гаврила собрал из провода и мембраны акустический резонатор (+60 XP)!' },
            { id: 'gavr_lore', text: '4. «О чем поет железобетон перед Самосбором?»', nextNode: 'node_gavr_lore' },
            { id: 'leave', text: '5. «Оставляю тебя наедине со звуками, Гаврила.»', winLog: '> Слухач снова припал ухом к вибрирующей трубе.' }
        ],
        nodes: {
            node_gavr_lore: {
                title: 'ГАВРИЛА: ИНФРАЗВУК БЕЗДНЫ',
                text: 'Слухач приподнимает край наушника и его лицо каменеет:\n«Перед самым началом сирены бетон начинает петь на частоте семь герц. Человеческое ухо этот звук не слышит, но его чует нутро: накатывает тошнота, волосы на затылке дыбом встают, а крысы в шахтах начинают в кровь разбивать морды о решетки. Это вибрирует вся несущая арматура Гигахруща. Так скрипит гигантский скелет нашего дома.»',
                choices: [
                    { id: 'gavr_note', text: 'Записать явление инфразвука бетона (+85 XP)', winNotebook: '[СЛУХАЧ ГАВРИЛА]: За 10 минут до Самосбора бетон вибрирует с частотой 7 Гц, вызывая животную панику и тошноту.', winXp: 85, nextNode: 'node_gavr_main' },
                    { id: 'leave', text: '«Спасибо за предупреждение, Гаврила.»', winLog: '> Вы тихо отошли от развилки труб.' }
                ]
            },
            node_gavr_main: {
                title: 'РАЗВИЛКА ТРУБ: ГАВРИЛА',
                text: '«Слушай тишину. Если в вентиляции смолк шум воздуха — ложись на пол и задраивай люк.»',
                choices: [
                    { id: 'leave', text: '«Понял.»', winLog: '> Вы покинули магистраль.' }
                ]
            }
        }
    },
    {
        id: 'npc_chemist_degas',
        title: 'ВСТРЕЧА: ХИМИК СТАНЦИИ ДЕГАЗАЦИИ СЕМЁН',
        npc: { name: 'Инженер Семён', role: 'Начальник станции дегазации', portrait: 'npc_chemist_degas.png' },
        text: 'Шлюзовая камера залита резким запахом хлорамина и щелочи. Мужчина в тяжелом герметичном комбинезоне с двумя массивными фильтрующими коробками переливает шипящую изумрудную жидкость в стеклянную колбу:\n«Стой в дезинфекционном лотке! Обувь в растворе сполосни, не разноси споры. Станция дегазации работает на полную мощность. Мы нейтрализуем кислотный осадок, который затягивает из вентиляционных шахт. Нужна дезактивация или свежий патрон для респиратора?»',
        choices: [
            { id: 'chem_decon_full', text: '1. Полная дегазация снаряжения (+100 HP, восстановление фильтра до 100%)', winHp: 100, winFilter: 100, winLog: '> Семён обработал вас горячей нейтрализующей пеной: фильтр и здоровье восстановлены до 100%!' },
            { id: 'chem_buy_filter', text: '2. Купить Угольный фильтрующий патрон повышенной емкости (35 талонов)', reqCost: 35, winFilter: 100, winLog: '> Вы приобрели свежий загерметизированный фильтр ГП-7!' },
            { id: 'chem_buy_cure', text: '3. Купить Флакон щелочного нейтрализатора био-слизи (40 талонов)', reqCost: 40, winLoot: 'antidote_vial', winLog: '> Вы приобрели концентрированный химический нейтрализатор слизи.' },
            { id: 'chem_lore', text: '4. «Из чего на самом деле состоит фиолетовый туман?»', nextNode: 'node_chem_lore' },
            { id: 'leave', text: '5. «Спасибо за очистку, инженер!»', winLog: '> Вы вышли из дезинфекционного шлюза в чистый коридор.' }
        ],
        nodes: {
            node_chem_lore: {
                title: 'СЕМЁН: ХИМИЧЕСКИЙ АНАЛИЗ САМОСБОРА',
                text: 'Семён ставит колбу в штатив и подкручивает регулировочный винт горелки:\n«Это не просто туман и не обычный газ. Наш спектрометр показывает полимерные белковые цепочки неизвестной структуры, насыщенные летучими энзимами. При контакте с воздухом они вызывают мгновенный некроз легочной ткани и растворяют железобетонную связку. Но концентрированный щелочной раствор разрывает эти связи за считанные секунды. Держи щелочь при себе — она спасает жизнь.»',
                choices: [
                    { id: 'chem_note', text: 'Записать химическую формулу нейтрализатора (+85 XP)', winNotebook: '[ХИМИК СЕМЁН]: Туман Самосбора состоит из полимерных белковых энзимов, которые мгновенно разрушаются щелочным раствором.', winXp: 85, nextNode: 'node_chem_main' },
                    { id: 'leave', text: '«Наука победит туман. Спасибо, Семён!»', winLog: '> Вы покинули станцию дегазации.' }
                ]
            },
            node_chem_main: {
                title: 'ДЕГАЗАЦИОННАЯ СТАНЦИЯ: СЕМЁН',
                text: '«Респиратор проверяй каждые полчаса на герметичность обтюратора. Чистого дыхания!»',
                choices: [
                    { id: 'leave', text: '«Так точно!»', winLog: '> Вы вышли в коридор.' }
                ]
            }
        }
    },


    // ===== 10 ЛОВУШЕК И ОПАСНЫХ НАХОДОК ГИГАХРУЩА =====
    {
        id: 'trap_tripwire_grenade',
        title: '⚠️ ЛОВУШКА: РАСТЯЖКА С ГРАНАТОЙ РГД-5',
        text: 'В полутемном проеме между стеллажами натянут тонкий стальной тросик. Внизу, замаскированная обломками кирпича, взведена осколочная граната РГД-5. Рядом лежит оброненная сумка ликвидатора с талонами.',
        choices: [
            { id: 'tripwire_disarm', text: '1. «Осторожно перекусить проволоку кусачками и обезвредить»', winLoot: 'special_grenade', winTalons: 60, winXp: 50, winLog: '> УСПЕХ! Вы сняли натяжение тросика и безопасно забрали боевую гранату и талоны (+60 т., +50 XP)!' },
            { id: 'tripwire_rush', text: '2. «Попытаться перешагнуть в темноте и выдернуть сумку»', loseHp: 45, winLog: '> ВЗРЫВ! Нога зацепила натянутый тросик, осколки гранаты пробили бронежилет!' },
            { id: 'leave', text: '3. Отойти назад и не рисковать', winLog: '> Вы благоразумно обошли заминированный проход.' }
        ]
    },
    {
        id: 'trap_electric_capacitor',
        title: '⚠️ ЛОВУШКА: ИСКРЯЩИЙ СИЛОВОЙ ЩИТ',
        text: 'В развороченном распределительном шкафу с гулом мерцает конденсаторная батарея. На оголенной медной шине лежит нетронутая запечатанная Военная аптечка и связка талонов.',
        choices: [
            { id: 'capac_isolate', text: '1. «Изолировать контакты диэлектрической планкой и достать аптечку»', winLoot: 'food_medkit', winTalons: 45, winXp: 45, winLog: '> УСПЕХ! Вы аккуратно сняли аптечку с контактов без замыкания (+45 т., +45 XP)!' },
            { id: 'capac_grab', text: '2. «Схватить аптечку резким движением руки»', loseHp: 40, winLog: '> УДАР ТОКОМ! Мощный разряд в 6000 вольт ударил через перчатку и отбросил вас на стену!' },
            { id: 'leave', text: '3. Обойти искрящий шкаф стороной', winLog: '> Вы решили не рисковать жизнью ради аптечки.' }
        ]
    },
    {
        id: 'trap_acid_pressure_pipe',
        title: '⚠️ ЛОВУШКА: КИСЛОТНЫЙ ПАРОПРОВОД',
        text: 'Из трещины в чугунной магистрали под давлением бьет струя едкого серного пара. За шипящей завесой виден стальной оружейный кейс с Закаленным мачете.',
        choices: [
            { id: 'acid_valve', text: '1. «Нащупать вентиль перекрытия ключом и стравить давление»', winLoot: 'weapon_machete_steel', winTalons: 50, winXp: 55, winLog: '> УСПЕХ! Вентиль затянут, струя угасла! В кейсе обнаружено отличное Закаленное мачете (+50 т.)!' },
            { id: 'acid_rush', text: '2. «Проскочить сквозь струю пара напролом»', loseHp: 40, winLog: '> КИСЛОТНЫЙ ОЖОГ! Концентрированный пар проел комбинезон и оставил глубокие ожоги кожи!' },
            { id: 'leave', text: '3. Отступить из загазованного отсека', winLog: '> Вы отошли в чистый коридор.' }
        ]
    },
    {
        id: 'trap_flesh_floor_maw',
        title: '⚠️ ЛОВУШКА: ПАСТЬ ПСЕВДОПЛОТИ В ПОЛУ',
        text: 'Бетонная плита пола разошлась живым разломом, в глубине которого часто дышит челюсть с зубами из острой арматуры. В глотке застрял кошелек с талонами.',
        choices: [
            { id: 'maw_brace', text: '1. «Забить стальную балку враспор челюстей и вытащить кошелек»', winTalons: 110, winXp: 60, winLog: '> УСПЕХ! Распорка выдержала бешеное смыкание пасти! Вы вытащили увесистый кошелек (+110 т., +60 XP)!' },
            { id: 'maw_grab', text: '2. «Быстро сунуть руку в пасть вслепую»', loseHp: 50, winLog: '> ХРУСТ КОСТЕЙ! Живая пасть мгновенно захлопнулась, вонзив зубы-арматуру в плечо!' },
            { id: 'leave', text: '3. Перепрыгнуть разлом и идти дальше', winLog: '> Вы поспешили удалиться от мерно дышащей дыры в бетоне.' }
        ]
    },
    {
        id: 'trap_infected_corpse',
        title: '⚠️ ЛОВУШКА: ЗАМИНИРОВАННЫЕ ОСТАНКИ',
        text: 'У стены сидит затихший конвоир в форме ВОХР. На поясе висит кобура с Редким пистолетом, но к спусковой скобе прикручена проволока натяжного взрывателя фугаса.',
        choices: [
            { id: 'corpse_cut', text: '1. «Осторожно срезать проволоку взрывателя скальпелем»', winLoot: 'weapon_pistol_rare', winTalons: 50, winXp: 50, winLog: '> УСПЕХ! Взрыватель деактивирован! Трофейный Редкий пистолет теперь ваш (+50 т., +50 XP)!' },
            { id: 'corpse_yank', text: '2. «Резко дернуть кобуру на себя»', loseHp: 45, winLog: '> ПОДРЫВ ФУГАСА! Взрывная волна и свинцовая шрапнель изрешетили ваше снаряжение!' },
            { id: 'leave', text: '3. Не трогать останки бойца', winLog: '> Вы оставили павшего конвоира в покое.' }
        ]
    },
    {
        id: 'trap_spore_container',
        title: '⚠️ ЛОВУШКА: КОНТЕЙНЕР СО СПОРАМИ «ШТАММ-14»',
        text: 'На столике заброшенной лаборатории стоит герметичный стеклянный цилиндр с надписью «ШТАММ-14. СМЕРТЕЛЬНО». Внутри покоится ценная ампула чистого Биоконцентрата.',
        choices: [
            { id: 'spore_drain', text: '1. «Открыть дренажный клапан и медленно стравить споры через фильтр»', winLoot: 'food_pure', winTalons: 70, winXp: 60, winLog: '> УСПЕХ! Штамм нейтрализован! Вы достали чистейший Биоконцентрат и талоны (+70 т., +60 XP)!' },
            { id: 'spore_smash', text: '2. «Разбить колбу рукоятью оружия»', loseHp: 35, winLog: '> ТОКСИЧЕСКИЙ ВЫБРОС! Ядовитые споры мгновенно обожгли дыхательные пути и разъели фильтр!' },
            { id: 'leave', text: '3. Оставить колбу на столике', winLog: '> Вы решили не связываться с биологическим оружием.' }
        ]
    },
    {
        id: 'trap_counterweight_cable',
        title: '⚠️ ЛОВУШКА: НАКРЕНИВШИЙСЯ ПРОТИВОВЕС',
        text: 'Многотонная чугунная болванка лифтового противовеса опасно накренилась на надорванном тросе. Под ней зажат выпавший армейский ящик со снабжением.',
        choices: [
            { id: 'weight_jack', text: '1. «Подпереть плиту стальным домкратом и извлечь ящик»', winLoot: 'food_mre', winTalons: 65, winXp: 50, winLog: '> УСПЕХ! Домкрат удержал вес! Вы вытащили армейский Сухпаек ВОХР и припасы (+65 т., +50 XP)!' },
            { id: 'weight_dive', text: '2. «Нырнуть под висящую махину и рвануть ящик»', loseHp: 50, winLog: '> ОБВАЛ! Трос лопнул с пушечным грохотом, чугунная плита сокрушила ваши плечи!' },
            { id: 'leave', text: '3. Обойти опасную балку', winLog: '> Вы благоразумно обошли висящую на волоске громадину.' }
        ]
    },
    {
        id: 'trap_auto_turret_motion',
        title: '⚠️ ЛОВУШКА: АВТОНОМНАЯ ТУРЕЛЬ ДИСПЕТЧЕРА',
        text: 'Под потолком коридора активировалась автоматическая турель с пулеметом. Её красный фотодиод медленно сканирует сектор. Рядом стоит брошенный сейф коменданта.',
        choices: [
            { id: 'turret_sneak', text: '1. «Обойти турель по вентиляционной балке сзади и перерезать кабель»', winTalons: 95, winLoot: 'food_medkit', winXp: 70, winLog: '> УСПЕХ! Турель обесточена! Сейф коменданта вскрыт: найдены талоны и аптечка (+95 т., +70 XP)!' },
            { id: 'turret_dash', text: '2. «Попытаться проскочить коридор зигзагом»', loseHp: 45, winLog: '> ПУЛЕМЕТНАЯ ОЧЕРЕДЬ! Бронебойные пули 7.62 нанесли тяжелые пулевые ранения!' },
            { id: 'leave', text: '3. Укрыться за гермодверью', winLog: '> Вы спрятались от прицела охранной турели.' }
        ]
    },
    {
        id: 'trap_radioactive_vent',
        title: '⚠️ ЛОВУШКА: ФОНЯЩИЙ ТЕПЛООБМЕННИК',
        text: 'Свинцовая крышка теплообменника сорвана, воздух дрожит от жара, а дозиметр надрывно верещит. В центре раскаленного узла лежит редкий Топливный элемент.',
        choices: [
            { id: 'rad_tongs', text: '1. «Извлечь элемент длинными свинцовыми клещами»', winQuestItem: 'quest_battery', winTalons: 80, winXp: 65, winLog: '> УСПЕХ! Топливный элемент извлечен без ожогов и помещен в контейнер (+80 т., +65 XP)!' },
            { id: 'rad_grab', text: '2. «Схватить элемент брезентовой рукавицей»', loseHp: 40, winLog: '> ТЕРМО-РАДИАЦИОННЫЙ УДАР! Рукавица вспыхнула, сильнейший лучевой ожог плоти!' },
            { id: 'leave', text: '3. Отойти от радиоактивной зоны', winLog: '> Вы поспешили уйти подальше от треска дозиметра.' }
        ]
    },
    {
        id: 'trap_suction_fan',
        title: '⚠️ ЛОВУШКА: ВАКУУМНЫЙ ВЕНТИЛЯТОР ОТКАЧКИ',
        text: 'Турбина дымоудаления бешено вращается за сорванной решеткой, создавая ураганную тягу. К лопастям присосало кожаный планшет офицера ВОХР с талонами.',
        choices: [
            { id: 'fan_jam', text: '1. «Забить стальной лом между зубьями крыльчатки и остановить вращение»', winTalons: 100, winLoot: 'antidote_vial', winXp: 60, winLog: '> УСПЕХ! Турбина заклинена со скрежетом! Планшет офицера с талонами и сывороткой у вас (+100 т.)!' },
            { id: 'fan_reach', text: '2. «Попытаться сорвать планшет голыми руками на лету»', loseHp: 45, winLog: '> ЛОПАСТИ ТУРБИНЫ! Пальцы затянуло во вращающиеся лезвия мясорубки!' },
            { id: 'leave', text: '3. Обойти гудящую шахту стороной', winLog: '> Вы оставили турбину завывать в темноте.' }
        ]
    },

    // --- ТАЙНИКИ И НАХОДКИ КВЕСТОВЫХ ПРЕДМЕТОВ (ЭТАЖИ 0-29) ---
    // Стартовые (Этаж 0)
    { id: 'cache_toolbox', title: 'НАХОДКА: РАЗБИТЫЙ ЯЩИК СЛЕСАРЯ', text: 'В технической нише валяется перевернутый ящик сантехников.', choices: [{ id: 'take_tools', text: 'Забрать Болторез', winQuestItem: 'quest_boltcutter', winTalons: 20, winLog: '> Найден Ржавый болторез!' }] },
    { id: 'cache_fusebox', title: 'НАХОДКА: РАСПРЕДЕЛИТЕЛЬНЫЙ ЩИТ', text: 'В обугленном щитке автоматики блестит керамический корпус.', choices: [{ id: 'take_fuse', text: 'Извлечь Предохранитель', winQuestItem: 'quest_fuse', winLog: '> Найден Предохранитель!' }] },
    { id: 'cache_corpse', title: 'НАХОДКА: ОСТАНКИ КОНВОИРА', text: 'У щитка лежат останки конвоира в разорванной шинели.', choices: [{ id: 'search_corpse', text: 'Осмотреть тело', winQuestItem: 'quest_battery', winLoot: 'special_knife', winLog: '> Найден Топливный элемент!' }] },
    { id: 'find_lift_repair', title: 'НАХОДКА: ЗАПЧАСТИ ЛИФТА', text: 'Опечатанный ящик со знаком службы главного лифта.', choices: [{ id: 'take_repair', text: 'Забрать Ремкомплект лифта', winQuestItem: 'quest_lift_repair', winLog: '> Найден Ремкомплект лифта!' }] },
    { id: 'find_lift_buttons', title: 'НАХОДКА: ПАНЕЛЬ УПРАВЛЕНИЯ', text: 'Сорванная панель диспетчера со связкой кнопок.', choices: [{ id: 'take_buttons', text: 'Снять Блок кнопок', winQuestItem: 'quest_lift_buttons', winLog: '> Найден Блок кнопок лифта!' }] },
    { id: 'find_lift_wire', title: 'НАХОДКА: СИЛОВОЙ КАБЕЛЬ', text: 'Из генератора торчит неповрежденный силовой кабель.', choices: [{ id: 'take_wire', text: 'Срезать Провод генератора', winQuestItem: 'quest_lift_wire', winLog: '> Найден Провод генератора!' }] },

    // Этажи 1-4 (Катакомбы ЖКХ)
    { id: 'cache_wrench_heavy', title: 'НАХОДКА: СЛЕСАРНЫЙ СТЕЛЛАЖ', text: 'На верстаке аварийной бригады лежит тяжелый разводной ключ.', choices: [{ id: 'take_wrench', text: 'Взять Разводной ключ', winQuestItem: 'quest_wrench_heavy', winLog: '> Найден Тяжелый разводной ключ!' }] },
    { id: 'cache_pressure_valve', title: 'НАХОДКА: ГИДРАВЛИЧЕСКИЙ УЗЕЛ', text: 'В разобранной трубе закреплен латунный клапан сброса давления.', choices: [{ id: 'take_valve', text: 'Скрутить Клапан сброса давления', winQuestItem: 'quest_pressure_valve', winLog: '> Найден Клапан сброса давления!' }] },
    { id: 'cache_coagulant', title: 'НАХОДКА: ХИМИЧЕСКИЙ СКЛАД', text: 'В герметичном контейнере сохранилась канистра реагента.', choices: [{ id: 'take_coag', text: 'Забрать Канистру коагулянта', winQuestItem: 'quest_coagulant', winLog: '> Найдена Канистра коагулянта!' }] },
    { id: 'cache_pipe_patch', title: 'НАХОДКА: АВАРИЙНЫЙ НАБОР', text: 'На полке лежит толстая свинцовая заплата для пробоин.', choices: [{ id: 'take_patch', text: 'Забрать Свинцовую заплату', winQuestItem: 'quest_pipe_patch', winLog: '> Найдена Свинцовая заплата!' }] },
    { id: 'cache_manometer', title: 'НАХОДКА: КОТЕЛЬНЫЙ ЩИТ', text: 'Среди осколков уцелел манометр сверхвысокого давления.', choices: [{ id: 'take_mano', text: 'Снять Манометр давления', winQuestItem: 'quest_manometer', winLog: '> Найден Манометр высокого давления!' }] },
    { id: 'cache_boiler_crank', title: 'НАХОДКА: МАГИСТРАЛЬНЫЙ ВЕНТИЛЬ', text: 'На полу валяется чугунный штурвал задвижки.', choices: [{ id: 'take_crank', text: 'Поднять Вентильную рукоять', winQuestItem: 'quest_boiler_crank', winLog: '> Найдена Вентильная рукоять!' }] },
    { id: 'cache_slime_sample', title: 'НАХОДКА: КОЛБА ИССЛЕДОВАТЕЛЯ', text: 'В сумке погибшего лаборанта лежит проба едкой слизи.', choices: [{ id: 'take_slime', text: 'Взять Пробу слизи', winQuestItem: 'quest_slime_sample', winLog: '> Найдена Проба едкой слизи!' }] },
    { id: 'find_elevator_gear_1', title: 'НАХОДКА: ЛЕБЕДОЧНЫЙ РЕДУКТОР', text: 'В разобранной лебедке блестит массивная зубчатая шестерня.', choices: [{ id: 'take_gear', text: 'Извлечь Зубчатую шестерню лебедки', winQuestItem: 'quest_elevator_gear_1', winLog: '> Найдена Зубчатая шестерня лебедки!' }] },

    // Этажи 5-9 (Спецархив и Бюрократия)
    { id: 'cache_punchcard', title: 'НАХОДКА: СЕЙФ ПЕРФОКАРТ', text: 'В стальном шкафу лежит секретная перфокарта с гербом.', choices: [{ id: 'take_pc', text: 'Забрать Секретную перфокарту', winQuestItem: 'quest_punchcard_secret', winLog: '> Найдена Секретная перфокарта!' }] },
    { id: 'cache_cipher_disc', title: 'НАХОДКА: ДЕШИФРАТОР НКВД', text: 'В тайнике машинистки спрятан латунный диск шифратора.', choices: [{ id: 'take_cd', text: 'Взять Диск шифратора', winQuestItem: 'quest_cipher_disc', winLog: '> Найден Диск шифратора!' }] },
    { id: 'cache_commissar_stamp', title: 'НАХОДКА: СТОЛ КОМИССАРА', text: 'На массивном столе лежит тяжелая печать политотдела.', choices: [{ id: 'take_stamp', text: 'Забрать Печать комиссара', winQuestItem: 'quest_commissar_stamp', winLog: '> Найдена Печать комиссара!' }] },
    { id: 'cache_magnetic_tape', title: 'НАХОДКА: БОБИНА СПЕЦВЕЩАНИЯ', text: 'В радиоаппаратной найдена пленка с записями директив.', choices: [{ id: 'take_tape', text: 'Забрать Бобину спецвещания', winQuestItem: 'quest_magnetic_tape', winLog: '> Найдена Бобина спецвещания!' }] },
    { id: 'cache_archive_keycard', title: 'НАХОДКА: КАРТА СПЕЦХРАНА', text: 'В опечатанном кейсе лежит карта доступа высшего уровня.', choices: [{ id: 'take_card', text: 'Забрать Ключ-карту Архивариуса', winQuestItem: 'quest_archive_keycard', winLog: '> Найдена Ключ-карта Архивариуса!' }] },
    { id: 'find_elevator_cable_2', title: 'НАХОДКА: БУХТА СТАЛЬНОГО ТРОСА', text: 'В шахте лежит неповрежденный бронированный трос.', choices: [{ id: 'take_cable', text: 'Срезать Бронированный трос', winQuestItem: 'quest_elevator_cable_2', winLog: '> Найден Бронированный трос!' }] },

    // Этажи 10-14 (Энергоблок и Реактор)
    { id: 'cache_coolant_rod', title: 'НАХОДКА: КАССЕТА ОХЛАДИТЕЛЯ', text: 'В защитном пенале светится стержень охладителя.', choices: [{ id: 'take_rod', text: 'Извлечь Стержень охладителя', winQuestItem: 'quest_coolant_rod', winLog: '> Найден Стержень охладителя!' }] },
    { id: 'cache_highvolt_relay', title: 'НАХОДКА: ВЫСОКОВОЛЬТНЫЙ ЩИТ', text: 'Среди оплавленных проводов уцелело мощное реле.', choices: [{ id: 'take_relay', text: 'Забрать Высоковольтное реле', winQuestItem: 'quest_highvolt_relay', winLog: '> Найдено Высоковольтное реле!' }] },
    { id: 'cache_copper_inductor', title: 'НАХОДКА: МЕДНЫЙ СТАТОР', text: 'В трансформаторе установлена массивная медная катушка.', choices: [{ id: 'take_ind', text: 'Снять Медную катушку', winQuestItem: 'quest_copper_inductor', winLog: '> Найдена Медная катушка индуктивности!' }] },
    { id: 'cache_dielectric_gloves', title: 'НАХОДКА: СТОЙКА ЭЛЕКТРИКА', text: 'На полке лежит надежный керамический диэлектрический изолятор.', choices: [{ id: 'take_iso', text: 'Взять Диэлектрический изолятор', winQuestItem: 'quest_dielectric_gloves', winLog: '> Найден Диэлектрический изолятор!' }] },
    { id: 'cache_lead_baffle', title: 'НАХОДКА: РАДИАЦИОННАЯ ЗАЩИТА', text: 'Тяжелая свинцовая заслонка с маркировкой радиации.', choices: [{ id: 'take_lead', text: 'Забрать Свинцовую заслонку', winQuestItem: 'quest_lead_baffle', winLog: '> Найдена Свинцовая заслонка!' }] },
    { id: 'find_elevator_motor_3', title: 'НАХОДКА: ТЯГОВЫЙ ПРИВОД', text: 'В технической нише лежит запасной электропривод клети.', choices: [{ id: 'take_motor', text: 'Погрузить Электропривод лифта', winQuestItem: 'quest_elevator_motor_3', winLog: '> Найден Электропривод лифта!' }] },

    // Этажи 15-19 (Цитадель ВОХР)
    { id: 'cache_vokhr_token', title: 'НАХОДКА: ЖЕТОН СТАРШИНЫ', text: 'На гильзах лежит стальной армейский личный жетон.', choices: [{ id: 'take_tok', text: 'Забрать Жетон старшины ВОХР', winQuestItem: 'quest_vokhr_token', winLog: '> Найден Жетон старшины ВОХР!' }] },
    { id: 'cache_officer_cipher', title: 'НАХОДКА: ПЛАНШЕТ ДЕЖУРНОГО', text: 'В командирской сумке лежит блокнот с кодами постов.', choices: [{ id: 'take_ciph', text: 'Взять Блокнот с шифрами взвода', winQuestItem: 'quest_officer_cipher', winLog: '> Найден Блокнот с шифрами взвода!' }] },
    { id: 'cache_decon_filter', title: 'НАХОДКА: АРМЕЙСКИЙ ФИЛЬТР', text: 'В ящике химзащиты лежит мощный дегазационный фильтр.', choices: [{ id: 'take_decon', text: 'Забрать Дегазационный фильтр', winQuestItem: 'quest_decon_filter', winLog: '> Найден Дегазационный фильтр!' }] },
    { id: 'cache_brass_keys', title: 'НАХОДКА: КЛЮЧИ НАДЗИРАТЕЛЯ', text: 'На поясе конвоира висит связка тяжелых латунных ключей.', choices: [{ id: 'take_bkeys', text: 'Снять Связку латунных ключей', winQuestItem: 'quest_brass_keys', winLog: '> Найдена Связка латунных ключей!' }] },
    { id: 'cache_commandant_seal', title: 'НАХОДКА: ПЛОМБА ШТАБА', text: 'Красная магнитная пломба с личной печатью Коменданта.', choices: [{ id: 'take_seal', text: 'Забрать Магнитную пломбу', winQuestItem: 'quest_commandant_seal', winLog: '> Найдена Магнитная пломба коменданта!' }] },
    { id: 'find_elevator_hydraulic_4', title: 'НАХОДКА: ГИДРАВЛИЧЕСКИЙ ПОРШЕНЬ', text: 'В ремонтной нише лежит гидроцилиндр подъемника.', choices: [{ id: 'take_hydra', text: 'Забрать Гидроцилиндр клети', winQuestItem: 'quest_elevator_hydraulic_4', winLog: '> Найден Гидроцилиндр клети!' }] },

    // Этажи 20-24 (Мясные Катакомбы)
    { id: 'cache_meat_relic', title: 'НАХОДКА: ОКАМЕНЕВШАЯ ПЛОТЬ', text: 'Кусок биомассы, затвердевший до прочности базальта.', choices: [{ id: 'take_mrelic', text: 'Взять Окаменевший мясной нарост', winQuestItem: 'quest_meat_relic', winLog: '> Найден Окаменевший мясной нарост!' }] },
    { id: 'cache_bone_chisel', title: 'НАХОДКА: РИТУАЛЬНЫЙ РЕЗЕЦ', text: 'Острое зубило, выточенное из бедренной кости мутанта.', choices: [{ id: 'take_chisel', text: 'Взять Костяное зубило', winQuestItem: 'quest_bone_chisel', winLog: '> Найдено Костяное зубило сектантов!' }] },
    { id: 'cache_ritual_chalice', title: 'НАХОДКА: ЧАША КРОВИ ТУМАНА', text: 'Медный кубок, наполненный темной шипящей влагой.', choices: [{ id: 'take_chalice', text: 'Взять Чашу крови тумана', winQuestItem: 'quest_ritual_chalice', winLog: '> Найдена Чаша крови тумана!' }] },
    { id: 'cache_cult_psalter', title: 'НАХОДКА: КНИГА ПСАЛМОВ', text: 'Переплетенный в сыромятную кожу псалтырь культа.', choices: [{ id: 'take_psalter', text: 'Забрать Псалтырь Тумана', winQuestItem: 'quest_cult_psalter', winLog: '> Найден Псалтырь Неизбежного Тумана!' }] },
    { id: 'cache_flesh_key', title: 'НАХОДКА: ЖИВОЙ КЛЮЧ-СИМБИОТ', text: 'Органический ключ с шевелящимися усиками на жале.', choices: [{ id: 'take_fkey', text: 'Взять Живой ключ-симбиот', winQuestItem: 'quest_flesh_key', winLog: '> Найден Живой ключ-симбиот!' }] },
    { id: 'find_elevator_seal_5', title: 'НАХОДКА: ОЧИСТИТЕЛЬНЫЙ ЗНАК', text: 'Свинцовая плита с вытравленной антибиотической руной.', choices: [{ id: 'take_seal5', text: 'Забрать Очистительный знак лифта', winQuestItem: 'quest_elevator_seal_5', winLog: '> Найден Очистительный знак лифта!' }] },

    // Этажи 25-29 (Чрево Чернобога)
    { id: 'cache_singularity_core', title: 'НАХОДКА: СГУСТОК ВРЕМЕНИ', text: 'В эпицентре пространственной воронки застыл сгусток времени.', choices: [{ id: 'take_core', text: 'Забрать Сгусток времени', winQuestItem: 'quest_singularity_core', winLog: '> Найден Сгусток времени!' }] },
    { id: 'cache_black_prism', title: 'НАХОДКА: ОБСИДИАНОВАЯ ПРИЗМА', text: 'Осколок зеркала из черного стекла, поглощающий свет.', choices: [{ id: 'take_prism', text: 'Взять Призму черного стекла', winQuestItem: 'quest_black_prism', winLog: '> Найдена Призма черного стекла!' }] },
    { id: 'cache_master_blueprint', title: 'НАХОДКА: ИСТИННЫЙ ЧЕРТЕЖ', text: 'Первородный свиток плана Гигахрущевки.', choices: [{ id: 'take_bp', text: 'Забрать Истинный чертеж', winQuestItem: 'quest_master_blueprint', winLog: '> Найден Истинный чертеж Гигахрущевки!' }] },
    { id: 'cache_reality_anchor', title: 'НАХОДКА: ЯКОРЬ РЕАЛЬНОСТИ', text: 'Латунный гироскоп, удерживающий границы материи.', choices: [{ id: 'take_anc', text: 'Забрать Якорь реальности', winQuestItem: 'quest_reality_anchor', winLog: '> Найден Якорь реальности!' }] },
    { id: 'cache_chernobog_key', title: 'НАХОДКА: КЛЮЧ РАЗРЫВА ЦИКЛА', text: 'Черный ключ, источающий темное пламя Самосбора.', choices: [{ id: 'take_ckey', text: 'Забрать Ключ разрыва цикла', winQuestItem: 'quest_chernobog_key', winLog: '> Найден Ключ разрыва цикла!' }] },
    { id: 'find_elevator_final_key', title: 'НАХОДКА: КЛЮЧ БЕЗДНЫ', text: 'Финальный ключ спуска в логово Чернобога на 30 этаж.', choices: [{ id: 'take_finkey', text: 'Принять Ключ Бездны', winQuestItem: 'quest_elevator_final_key', winLog: '> Найден Ключ Бездны!' }] }
];

function getRandomEventForPlayer(p, currentFloor) {
    let pool = [];
    let hasItem = (id) => (p.foundItems && p.foundItems.includes(id)) || (p.questItems && p.questItems.includes(id));
    const cfg = FLOOR_CONFIGS[currentFloor] || FLOOR_CONFIGS[0];

    // Приоритет: квестовые ключи текущего этажа и лифта
    const needed = [...(cfg.elevatorKeys || []), ...(cfg.keys || [])];
    const keyEventMap = {
        quest_lift_repair: 'find_lift_repair', quest_lift_buttons: 'find_lift_buttons', quest_lift_wire: 'find_lift_wire',
        quest_boltcutter: 'cache_toolbox', quest_fuse: 'cache_fusebox', quest_battery: 'cache_corpse', quest_red_card: 'cache_corpse',
        quest_wrench_heavy: 'cache_wrench_heavy', quest_pressure_valve: 'cache_pressure_valve', quest_coagulant: 'cache_coagulant',
        quest_pipe_patch: 'cache_pipe_patch', quest_manometer: 'cache_manometer', quest_boiler_crank: 'cache_boiler_crank',
        quest_slime_sample: 'cache_slime_sample', quest_elevator_gear_1: 'find_elevator_gear_1',
        quest_punchcard_secret: 'cache_punchcard', quest_cipher_disc: 'cache_cipher_disc', quest_commissar_stamp: 'cache_commissar_stamp',
        quest_magnetic_tape: 'cache_magnetic_tape', quest_archive_keycard: 'cache_archive_keycard', quest_elevator_cable_2: 'find_elevator_cable_2',
        quest_coolant_rod: 'cache_coolant_rod', quest_highvolt_relay: 'cache_highvolt_relay', quest_copper_inductor: 'cache_copper_inductor',
        quest_dielectric_gloves: 'cache_dielectric_gloves', quest_lead_baffle: 'cache_lead_baffle', quest_elevator_motor_3: 'find_elevator_motor_3',
        quest_vokhr_token: 'cache_vokhr_token', quest_officer_cipher: 'cache_officer_cipher', quest_decon_filter: 'cache_decon_filter',
        quest_brass_keys: 'cache_brass_keys', quest_commandant_seal: 'cache_commandant_seal', quest_elevator_hydraulic_4: 'find_elevator_hydraulic_4',
        quest_meat_relic: 'cache_meat_relic', quest_bone_chisel: 'cache_bone_chisel', quest_ritual_chalice: 'cache_ritual_chalice',
        quest_cult_psalter: 'cache_cult_psalter', quest_flesh_key: 'cache_flesh_key', quest_elevator_seal_5: 'find_elevator_seal_5',
        quest_singularity_core: 'cache_singularity_core', quest_black_prism: 'cache_black_prism', quest_master_blueprint: 'cache_master_blueprint',
        quest_reality_anchor: 'cache_reality_anchor', quest_chernobog_key: 'cache_chernobog_key', quest_elevator_final_key: 'find_elevator_final_key'
    };

    for (let k of needed) {
        if (!hasItem(k) && keyEventMap[k]) {
            let ev = RANDOM_EVENTS.find(e => e.id === keyEventMap[k]);
            if (ev) pool.push(ev);
        }
    }

    // NPC в зависимости от яруса этажей (полный ансамбль из 20 уникальных сюжетных персонажей)
    if (currentFloor <= 4) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_plumber_mikhalych'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_medic_klavdiya'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_cook_valya'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_projectionist_saveliy'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_mechanic_makar'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_scavenger_syoma'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_stalker'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_tripwire_grenade'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_electric_capacitor'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'meat_smell'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'toxic_steam'));
    } else if (currentFloor <= 9) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_librarian_zoya'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_radio_mayak'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_agronomist_serafima'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_inspector_kovalev'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_clockmaker_arseniy'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_archivist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_scientist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_acid_pressure_pipe'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_spore_container'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'whispering_concrete'));
    } else if (currentFloor <= 14) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_smelter_kuzma'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_flamethrower_boris'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_engineer_zaslavsky'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_plumber_mikhalych'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_chemist_degas'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_liquidator'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_counterweight_cable'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_radioactive_vent'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'toxic_steam'));
    } else if (currentFloor <= 19) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_sergeant_tarasov'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_sniper_anna'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_guide_erofey'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_acoustician_gavrila'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_flamethrower_boris'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_vokhr'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_infected_corpse'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_auto_turret_motion'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'whispering_concrete'));
    } else if (currentFloor <= 24) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_hermit_azariy'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_acoustician_gavrila'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_chemist_degas'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_clockmaker_arseniy'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_sniper_anna'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_cultist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_flesh_floor_maw'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_suction_fan'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'meat_smell'));
    } else {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_hermit_azariy'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_sniper_anna'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_acoustician_gavrila'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_flamethrower_boris'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_chemist_degas'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_cultist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_flesh_floor_maw'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'trap_auto_turret_motion'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'whispering_concrete'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'meat_smell'));
    }

    pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_trader'));
    pool = pool.filter(Boolean);
    return pool[Math.floor(Math.random() * pool.length)];
}

const LOCATION_TYPES = {
    elevator: { name: "Резервный лифт", bg: "bg_elevator.png", icon: "icon_elevator.png" },
    airlock: { name: "Гермошлюз", bg: "bg_airlock.png", icon: "icon_airlock.png" },
    vent: { name: "Вентшахта", bg: "bg_vent.png", icon: "icon_vent.png" },
    workshop: { name: "Цех", bg: "bg_workshop.png", icon: "icon_workshop.png" },
    corridor: { name: "Техкоридор", bg: "bg_corridor.png", icon: "icon_corridor.png" },
    comm: { name: "Узел связи", bg: "bg_comm.png", icon: "icon_comm.png" },
    pump: { name: "Насосная", bg: "bg_pump.png", icon: "icon_pump.png" },
    warehouse: { name: "Склад", bg: "bg_warehouse.png", icon: "icon_warehouse.png" },
    reservoir: { name: "Резервуар", bg: "bg_reservoir.png", icon: "icon_reservoir.png" },
    medbay: { name: "Медблок", bg: "bg_medbay.png", icon: "icon_medbay.png" },
    quarantine: { name: "Карантин", bg: "bg_quarantine.png", icon: "icon_quarantine.png" },
    boiler: { name: "Бойлерная", bg: "bg_boiler.png", icon: "icon_boiler.png" },
    generator: { name: "Генераторная", bg: "bg_generator.png", icon: "icon_generator.png" },
    cafeteria: { name: "Столовая", bg: "bg_cafeteria.png", icon: "icon_cafeteria.png" },
    freezer: { name: "Морозильники", bg: "bg_freezer.png", icon: "icon_freezer.png" },
    hydroponics: { name: "Гидропоника", bg: "bg_hydroponics.png", icon: "icon_hydroponics.png" },
    treatment: { name: "Очистные", bg: "bg_treatment.png", icon: "icon_treatment.png" },
    archive: { name: "Спецархив", bg: "bg_archive.png", icon: "icon_archive.png" },
    substation: { name: "Подстанция", bg: "bg_substation.png", icon: "icon_substation.png" },
    reactor: { name: "Реакторный зал", bg: "bg_reactor.png", icon: "icon_reactor.png" },
    armory: { name: "Арсенал ВОХР", bg: "bg_armory.png", icon: "icon_armory.png" },
    flesh_corridor: { name: "Мясной тоннель", bg: "bg_flesh_corridor.png", icon: "icon_flesh_corridor.png" },
    abyss_rift: { name: "Чертог Чернобога", bg: "bg_abyss_rift.png", icon: "icon_abyss_rift.png" }
};
const RANDOM_LOC_KEYS = Object.keys(LOCATION_TYPES).filter(k => k !== 'elevator' && k !== 'airlock');

function generateFloor(floorIndex) {
    if (db.map[floorIndex]) return;
    db.map[floorIndex] = {};
    const cfg = FLOOR_CONFIGS[floorIndex] || FLOOR_CONFIGS[0];
    const letters = ['A', 'B', 'C', 'D', 'E'];
    let allSectors = [];
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
            let id = `${letters[y]}${x}`;
            if (id !== 'A0' && id !== 'E4') allSectors.push(id);
        }
    }
    allSectors = shuffleArray(allSectors);
    let locks = [];
    (cfg.keys || ['quest_boltcutter', 'quest_battery', 'quest_red_card', 'quest_fuse']).forEach(item => {
        locks.push({ type: 'item', val: item });
    });
    // НА КАЖДОМ ЭТАЖЕ гарантированно:
    // 1 головоломка построения пути А->Б (электричество, газ, жидкость в стиле ASCII)
    // 1 интерактивная физическая задача (перепиливание замка / провода / вентиль)
    // 1 логический шифр / напряжение
    // 2 сюжетные атмосферные загадки Самосбора
    let mPool = [
        ...shuffleArray(CIRCUIT_MINIGAMES).slice(0, 1),
        ...shuffleArray(PHYSICAL_MINIGAMES).slice(0, 1),
        ...shuffleArray(LOGIC_MINIGAMES).slice(0, 1),
        ...shuffleArray(RIDDLES_150).slice(0, 2)
    ];
    mPool = shuffleArray(mPool);
    mPool.forEach(mg => locks.push({ type: 'minigame', val: mg }));
    
    let floorKeys = [...RANDOM_LOC_KEYS];
    if (floorIndex >= 5 && floorIndex < 10) {
        floorKeys.push('archive', 'archive', 'warehouse');
    } else if (floorIndex >= 10 && floorIndex < 15) {
        floorKeys.push('substation', 'reactor', 'generator', 'substation');
    } else if (floorIndex >= 15 && floorIndex < 20) {
        floorKeys.push('armory', 'armory', 'quarantine');
    } else if (floorIndex >= 20 && floorIndex < 25) {
        floorKeys.push('flesh_corridor', 'flesh_corridor', 'treatment');
    } else if (floorIndex >= 25) {
        floorKeys.push('abyss_rift', 'abyss_rift', 'flesh_corridor');
    }
    let pool = shuffleArray([...floorKeys, ...floorKeys]);
    let locIdx = 0;

    let floorThreat = 'Низкая';
    if (floorIndex >= 25) floorThreat = 'СМЕРТЕЛЬНАЯ';
    else if (floorIndex >= 15) floorThreat = 'Критическая';
    else if (floorIndex >= 5) floorThreat = 'Высокая';
    else if (floorIndex > 0) floorThreat = 'Средняя';

    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
            let sectorId = `${letters[y]}${x}`;
            let locType;
            if (sectorId === 'A0') {
                locType = 'airlock';
            } else if (sectorId === 'E4') {
                locType = 'elevator';
            } else {
                locType = pool[locIdx % pool.length];
                locIdx++;
            }
            let info = LOCATION_TYPES[locType];
            let reqType = null; let reqValue = null;
            if (sectorId !== 'A0' && sectorId !== 'E4') {
                let lockIdx = allSectors.indexOf(sectorId);
                if (lockIdx < locks.length) { reqType = locks[lockIdx].type; reqValue = locks[lockIdx].val; }
            }
            db.map[floorIndex][sectorId] = {
                id: sectorId,
                type: locType,
                name: `${info.name} [Эт.${floorIndex}]`,
                bg: info.bg,
                icon: info.icon,
                threat: floorThreat,
                reqType: reqType,
                reqValue: reqValue
            };
        }
    }
    saveDB();
}
if (!db.map) db.map = {};
if (!db.map[0]) generateFloor(0);

// Автоматическая миграция: обновляем сектор E4 в "Резервный лифт" и задаем иконки/задники для существующих локаций
if (db.map) {
    for (let f in db.map) {
        for (let secId in db.map[f]) {
            let sec = db.map[f][secId];
            if (secId === 'E4') {
                sec.name = `Резервный лифт [Эт.${f}]`;
                sec.type = 'elevator';
                sec.bg = 'bg_elevator.png';
                sec.icon = 'icon_elevator.png';
            } else if (secId === 'A0') {
                sec.name = `Гермошлюз [Эт.${f}]`;
                sec.type = 'airlock';
                sec.bg = 'bg_airlock.png';
                sec.icon = 'icon_airlock.png';
            } else {
                let matchedKey = Object.keys(LOCATION_TYPES).find(k => sec.name.includes(LOCATION_TYPES[k].name));
                if (matchedKey) {
                    sec.type = matchedKey;
                    sec.bg = LOCATION_TYPES[matchedKey].bg;
                    sec.icon = LOCATION_TYPES[matchedKey].icon;
                } else {
                    sec.bg = sec.bg || 'bg_corridor.png';
                    sec.icon = sec.icon || 'icon_corridor.png';
                }
            }
        }
    }
    saveDB();
}

function getPlayerStats(player) {
    let stats = { hp: player.hp, maxHp: player.maxHp, filter: player.filter, dmg: 1, def: 0 };
    if (player.equipment) {
        if (player.equipment.weapon && GAME_ITEMS[player.equipment.weapon]) stats.dmg += GAME_ITEMS[player.equipment.weapon].dmg || 0;
        if (player.equipment.clothes && GAME_ITEMS[player.equipment.clothes]) stats.def += GAME_ITEMS[player.equipment.clothes].def || 0;
        if (player.equipment.mask && GAME_ITEMS[player.equipment.mask]) stats.def += GAME_ITEMS[player.equipment.mask].def || 0;
        if (player.equipment.backpack && GAME_ITEMS[player.equipment.backpack]) stats.def += GAME_ITEMS[player.equipment.backpack].def || 0;
    }
    if (player.mutations && player.mutations.includes('mut_adrenaline')) stats.dmg = Math.floor(stats.dmg * 1.3);
    return stats;
}

function broadcastGameState() {
    let activeSocketIds = Object.keys(onlinePlayers);
    if (activeSocketIds.length === 0) return;

    let allPlayers = Object.values(db.players).filter(Boolean);
    allPlayers.forEach(p => { 
        if (!p) return;
        p.rating = (p.xp || 0) + ((p.monstersKilled || 0) * 10) + ((p.roomsCleared || 0) * 5) + (((p.floor || 0)) * 100) + Math.floor((p.playtime || 0) / 60); 
    });
    allPlayers.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    let leaderboard = allPlayers.slice(0, 15).map((p, idx) => { 
        return { 
            rank: idx + 1, 
            name: Object.keys(db.players).find(k => db.players[k] === p) || 'Неизвестный', 
            level: p.level || 1, 
            floor: p.floor || 0, 
            rating: p.rating || 0, 
            playtime: p.playtime || 0 
        }; 
    });

    for (let socketId of activeSocketIds) {
        let username = onlinePlayers[socketId]; 
        if (!username) continue;
        let p = db.players[username];
        if (!p) continue;
        if (!p.inventory) p.inventory = []; if (!p.questItems) p.questItems = []; if (!p.foundItems) p.foundItems = []; if (!p.quickSlots) p.quickSlots = [null, null];
        if (!p.perks) p.perks = []; if (!p.mutations) p.mutations = []; if (!p.unlockedSectors) p.unlockedSectors = { 0: ['A0'] }; if (Array.isArray(p.unlockedSectors)) p.unlockedSectors = { 0: p.unlockedSectors };
        if (!p.solvedGames) p.solvedGames = []; if (!p.bossDefeated) p.bossDefeated = {}; if (!p.robots) p.robots = {}; if (!p.playtime) p.playtime = 0;
        if (p.hunger === undefined) p.hunger = 100; if (p.tox === undefined) p.tox = 0;
        if (!p.notebook) p.notebook = ["[ВВОДНАЯ]: Я помню только лязг рвущегося троса..."];
        if (!p.level) { p.level = 1; p.xp = 0; p.maxHp = 100; p.monstersKilled = 0; p.roomsCleared = 0; p.rating = 0; }
        let rankPos = allPlayers.findIndex(pl => pl === p) + 1;
        let title = "Заключенный"; if (p.rating >= 10000) title = "Генеральный Секретарь"; else if (p.rating >= 1000) title = "Ударник Труда";
        let floor = p.floor || 0; generateFloor(floor);
        let playersInSector = [];
        for (let sId in onlinePlayers) {
            let u = onlinePlayers[sId];
            if (u && db.players[u] && db.players[u].location === p.location && (db.players[u].floor || 0) === floor) { 
                playersInSector.push({ id: sId, username: u, hp: db.players[u].hp }); 
            }
        }
        let locKey = `${floor}_${p.location}`;

        if (!p.achievements || typeof p.achievements !== 'object' || Array.isArray(p.achievements)) p.achievements = {};
        let sock = io.sockets.sockets.get(socketId);
        checkPlayerAchievements(p, sock || null);

        io.to(socketId).emit('gameState', {
            me: {
                username: username, talons: p.talons, location: p.location, floor: floor,
                maxFloor: Math.max(p.maxFloor || 0, floor),
                stats: getPlayerStats(p), equipment: p.equipment, inventory: p.inventory, storage: p.storage || [], maxInv: getMaxInv(p), maxStorage: 40,
                hunger: p.hunger, tox: p.tox, mutations: p.mutations,
                questItems: p.questItems, unlockedSectors: p.unlockedSectors[floor] || ['A0'], notebook: p.notebook,
                quickSlots: p.quickSlots, perks: p.perks, level: p.level, xp: p.xp, monstersKilled: p.monstersKilled, roomsCleared: p.roomsCleared,
                rating: p.rating, rankPos: rankPos, title: title, bossDefeated: p.bossDefeated,
                bossesKilled: Math.max(p.bossesKilled || 0, Object.keys(p.bossDefeated || {}).length),
                puzzlesSolved: Math.max(p.puzzlesSolved || 0, (p.solvedGames ? p.solvedGames.length : 0)),
                achievements: p.achievements || {},
                currentRobot: p.robots[locKey] !== undefined ? p.robots[locKey] : null, appearance: p.appearance, playtime: p.playtime,
                workbenchLevel: p.workbenchLevel || 1
            },
            sectorPlayers: playersInSector, map: db.map[floor], GAME_PERKS: GAME_PERKS, GAME_ITEMS: GAME_ITEMS, MUTATIONS: MUTATIONS, BESTIARY: BASE_MONSTERS,
            ACHIEVEMENTS_LIST: ACHIEVEMENTS_LIST,
            fleaMarket: db.fleaMarket || [],
            shopItems: currentShopItems, nextShopUpdate: nextShopUpdate, leaderboard: leaderboard,
            onlineList: getOnlinePlayersList(),
            chatHistory: (db.chatHistory || []),
            coopSquadsList: getPublicRaidSquads()
        });
    }
}

const VK_SECRET_KEY = process.env.VK_SECRET_KEY || process.env.VK_APP_SECRET || process.env.VK_CLIENT_SECRET || null;

function verifyVkLaunchParams(searchString, secretKey) {
    if (!searchString) return { valid: false, reason: 'Отсутствуют параметры запуска' };
    try {
        const raw = typeof searchString === 'string' && searchString.startsWith('?') ? searchString.slice(1) : String(searchString);
        const query = new URLSearchParams(raw);
        const sign = query.get('sign');
        const userId = query.get('vk_user_id');

        if (!secretKey) {
            // Если ключ VK_SECRET_KEY не установлен на сервере (режим локальной разработки)
            if (userId) {
                return { valid: true, userId, isDev: true };
            }
            return { valid: false, reason: 'Параметр vk_user_id не найден' };
        }

        if (!sign) return { valid: false, reason: 'Подпись sign отсутствует' };

        const vkParams = [];
        for (const [key, val] of query.entries()) {
            if (key.startsWith('vk_')) {
                vkParams.push([key, val]);
            }
        }

        if (vkParams.length === 0) return { valid: false, reason: 'Нет параметров vk_*' };

        vkParams.sort((a, b) => a[0].localeCompare(b[0]));
        const queryString = vkParams.map(([k, v]) => `${k}=${v}`).join('&');

        const calculatedHash = crypto
            .createHmac('sha256', secretKey)
            .update(queryString)
            .digest('base64url');

        const isValid = calculatedHash === sign;
        return { valid: isValid, userId: isValid ? userId : null, reason: isValid ? null : 'Недействительная подпись sign' };
    } catch (e) {
        return { valid: false, reason: e.message };
    }
}

// Товары и вознаграждения за поддержку проекта голосами ВКонтакте
const VK_DONATE_ITEMS = {
    'donate_1_vote': { title: '50 талонов снабжения', price: 1, bonusTalons: 50 },
    'donate_3_votes': { title: '200 талонов снабжения', price: 3, bonusTalons: 200 },
    'donate_5_votes': { title: '450 талонов снабжения', price: 5, bonusTalons: 450 },
    'donate_10_votes': { title: '1000 талонов снабжения', price: 10, bonusTalons: 1000 }
};

// Проверка подписи платежных уведомлений ВКонтакте (MD5 от отсортированных параметров + секретный ключ)
function verifyVkPaymentSignature(body, secretKey) {
    if (!secretKey) return true; // Режим разработки без установленного ключа
    if (!body || !body.sig) return false;
    const receivedSig = String(body.sig).toLowerCase().trim();
    const keys = Object.keys(body).filter(k => k !== 'sig').sort();
    let paramStr = '';
    for (const key of keys) {
        paramStr += `${key}=${body[key]}`;
    }
    const computedSig = crypto.createHash('md5').update(paramStr + secretKey).digest('hex').toLowerCase();
    return computedSig === receivedSig;
}

// GET-заглушка для проверки доступности эндпоинта браузером / чекерами
app.get('/vk-payment', (req, res) => {
    res.status(200).send('VK Payment Webhook Endpoint is Active');
});

// Официальный эндпоинт обработки платежей от ВКонтакте
app.post('/vk-payment', (req, res) => {
    try {
        const body = req.body || {};
        const notificationType = body.notification_type;
        writeLog(`[VK ПЛАТЕЖ ВХОДЯЩИЙ] notification_type=${notificationType}, item=${body.item}, user_id=${body.user_id || body.receiver_id}, order_id=${body.order_id}`);

        // Валидация подписи запроса
        if (!verifyVkPaymentSignature(body, VK_SECRET_KEY)) {
            writeLog(`[VK ПЛАТЕЖ ОШИБКА] Несовпадение подписи платежа sig: ${body.sig}`);
            return res.json({
                error: {
                    error_code: 10,
                    error_msg: 'Несовпадение вычисленной и переданной подписи',
                    critical: true
                }
            });
        }

        // Запрос информации о товаре
        if (notificationType === 'get_item' || notificationType === 'get_item_test') {
            const itemKey = body.item;
            const itemData = VK_DONATE_ITEMS[itemKey];
            if (!itemData) {
                return res.json({
                    error: {
                        error_code: 20,
                        error_msg: 'Товар не найден',
                        critical: true
                    }
                });
            }
            return res.json({
                response: {
                    title: itemData.title,
                    price: itemData.price,
                    item_id: itemKey
                }
            });
        }

        // Изменение статуса заказа (успешная оплата / возврат)
        if (notificationType === 'order_status_change' || notificationType === 'order_status_change_test') {
            const status = body.status;
            const orderId = String(body.order_id || '');
            const userId = String(body.user_id || body.receiver_id || '').trim();
            const itemKey = body.item;

            if (status === 'chargeable') {
                if (!db.processedOrders) db.processedOrders = {};

                // Защита от повторной обработки одного и того же заказа
                if (db.processedOrders[orderId]) {
                    writeLog(`[VK ПЛАТЕЖ ПОВТОР] Заказ #${orderId} уже был обработан ранее`);
                    return res.json({
                        response: {
                            order_id: Number(orderId),
                            app_order_id: Number(orderId)
                        }
                    });
                }

                const itemData = VK_DONATE_ITEMS[itemKey] || { bonusTalons: 50 };
                const bonus = itemData.bonusTalons || 50;

                // Поиск игрока по vkUserId
                let username = (db.vkMap && db.vkMap[userId]) || null;
                if (!username) {
                    username = Object.keys(db.players).find(k => String(db.players[k].vkUserId) === userId);
                }

                if (username && db.players[username]) {
                    let p = db.players[username];
                    p.talons = (p.talons || 0) + bonus;
                    if (!p.notebook.some(e => e.includes('МЕЦЕНАТ'))) {
                        p.notebook.push(`[МЕЦЕНАТ]: Вы поддержали проект голосами VK. Партия выражает благодарность! (+${bonus} талонов)`);
                    }

                    db.processedOrders[orderId] = {
                        time: Date.now(),
                        item: itemKey,
                        userId: userId,
                        username: username,
                        bonus: bonus
                    };

                    saveDB(true);
                    broadcastGameState();

                    // Если игрок в этот момент онлайн в игре — звуковой эффект и уведомление
                    const userSocketId = Object.keys(onlinePlayers).find(sid => onlinePlayers[sid] === username);
                    if (userSocketId) {
                        io.to(userSocketId).emit('playSound', 'buy');
                        io.to(userSocketId).emit('terminalError', `БЛАГОДАРИМ ЗА ПОДДЕРЖКУ! ПОЛУЧЕНО: +${bonus} ТАЛОНОВ.`);
                    }

                    // Системное сообщение в общий чат
                    let donateMsg = {
                        user: "СИСТЕМА",
                        text: `⭐ Заключенный [${username}] поддержал проект голосами VK (+${bonus} талонов)! Спасибо!`,
                        time: new Date().toLocaleTimeString().slice(0, 5)
                    };
                    chatHistory.push(donateMsg);
                    if (chatHistory.length > MAX_CHAT_MESSAGES) chatHistory.shift();
                    io.emit('chatMessage', donateMsg);

                    writeLog(`[VK ПЛАТЕЖ УСПЕШНО] Заказ #${orderId}, игрок ${username} (VK ${userId}), начислено +${bonus} талонов`);
                } else {
                    writeLog(`[VK ПЛАТЕЖ ВНИМАНИЕ] Заказ #${orderId}, игрок с VK ID ${userId} не найден в БД`);
                }

                return res.json({
                    response: {
                        order_id: Number(orderId),
                        app_order_id: Number(orderId)
                    }
                });
            }

            if (status === 'refunded') {
                writeLog(`[VK ПЛАТЕЖ ВОЗВРАТ] Заказ #${orderId} возвращен пользователю`);
                return res.json({
                    response: {
                        order_id: Number(orderId),
                        app_order_id: Number(orderId)
                    }
                });
            }

            return res.json({
                response: {
                    order_id: Number(orderId),
                    app_order_id: Number(orderId)
                }
            });
        }

        return res.status(400).json({
            error: {
                error_code: 1,
                error_msg: 'Неизвестный тип уведомления',
                critical: false
            }
        });
    } catch (err) {
        writeLog(`[VK ПЛАТЕЖ ОШИБКА ИСКЛЮЧЕНИЯ] ${err.message}`);
        return res.status(500).json({
            error: {
                error_code: 1,
                error_msg: 'Внутренняя ошибка сервера',
                critical: true
            }
        });
    }
});

io.on('connection', (socket) => {
    if (!Array.isArray(db.chatHistory)) db.chatHistory = [];
    chatHistory = db.chatHistory;
    socket.emit('chatHistory', db.chatHistory);
    socket.emit('onlineList', getOnlinePlayersList());
    socket.emit('raidSquadsList', getPublicRaidSquads());

    let lastChatTime = 0;
    let lastWorkTime = 0;
    let lastPvpTime = 0;
    let lastCoopTime = 0;

    function getAuthPlayer() {
        let username = onlinePlayers[socket.id];
        if (!username || !db.players[username]) {
            socket.emit('requireAuth');
            return null;
        }
        return { username, p: db.players[username] };
    }

    socket.on('login', (data) => {
        if (!data || !data.username) return;
        const { username, password, vkUserId } = data;
        writeLog(`Вход: ${username}`);
        try {
            if (db.players[username]) {
                if (!verifyPassword(password, db.players[username].password)) {
                    socket.emit('terminalError', 'ОШИБКА ДОСТУПА: НЕВЕРНЫЙ ПАРОЛЬ');
                    return;
                }
                // Автоматическая миграция открытого пароля в scrypt-хеш
                if (typeof db.players[username].password === 'string' && !db.players[username].password.startsWith('scrypt:')) {
                    db.players[username].password = hashPassword(password);
                    saveDB();
                }
                // Если передан vkUserId — связываем аккаунт с профилем VK
                if (vkUserId) {
                    db.players[username].vkUserId = String(vkUserId);
                    if (!db.vkMap) db.vkMap = {};
                    db.vkMap[String(vkUserId)] = username;
                    saveDB(true);
                }
            } else if (!db.players[username]) {
                writeLog(`Регистрация: ${username}`);
                db.players[username] = {
                    password: hashPassword(password), talons: 0, hp: 100, maxHp: 100, filter: 100, hunger: 100, tox: 0, level: 1, xp: 0, monstersKilled: 0, roomsCleared: 0, rating: 0, playtime: 0,
                    appearance: { skin: 'skin_1' }, location: 'safe_room', floor: 0, activeEvent: null, workbenchLevel: 1,
                    unlockedSectors: { 0: ['A0'] }, questItems: [], foundItems: [], quickSlots: [null, null], solvedGames: [], bossDefeated: {}, perks: [], mutations: [], robots: {},
                    notebook: [
                        "[ВВОДНАЯ]: Приговор приведён в исполнение. Нас, двадцать три заключённых, погрузили в клеть и отправили вниз, на нулевой этаж, в самое пекло Самосбора.",
                        "[ВВОДНАЯ]: Мы почти достигли дна, когда лопнул трос. Клеть рухнула вниз.",
                        "[ВВОДНАЯ]: Я очнулся среди обломков. Рядом — растерзанный конвоир.",
                        "[ВВОДНАЯ]: Остальные выжившие разбежались кто куда. Я сорвал с конвоира противогаз и заперся в жилячейке.",
                        "[ЦЕЛЬ]: Найти Главный Лифт в секторе E4 и подняться наверх.",
                        "[СОВЕТ]: Не забывай про фильтр. Туман здесь живой."
                    ],
                    equipment: { weapon: 'weapon_wood', clothes: 'clothes_robe', mask: 'mask_cloth', backpack: null }, inventory: ['food_ration']
                };
                if (vkUserId) {
                    db.players[username].vkUserId = String(vkUserId);
                    if (!db.vkMap) db.vkMap = {};
                    db.vkMap[String(vkUserId)] = username;
                }
                saveDB(true);
            }
            onlinePlayers[socket.id] = username;
            if (activeCombats[username]) {
                let c = activeCombats[username];
                if (!c.isGlobal || !c.enemy || c.enemy.hp <= 0 || db.players[username].hp <= 0) {
                    delete activeCombats[username];
                }
            }
            if (db.players[username].hp <= 0) {
                db.players[username].hp = db.players[username].maxHp || 100;
                db.players[username].location = 'safe_room';
            }
            socket.emit('loginSuccess', { username, showIntro: db.players[username].appearance === null });
            if (db.players[username].appearance !== null) socket.emit('startGame');
            broadcastGameState();
        } catch (err) { writeLog(`ОШИБКА LOGIN: ${err.message}`); }
    });

    socket.on('vkLogin', (data) => {
        if (!data) return;

        let vkUserId = null;
        if (data.search || data.sign) {
            const check = verifyVkLaunchParams(data.search || '', VK_SECRET_KEY);
            if (!check.valid) {
                writeLog(`[VK БЕЗОПАСНОСТЬ] Отклонена авторизация сокета ${socket.id}: ${check.reason}`);
                socket.emit('terminalError', 'ОШИБКА АВТОРИЗАЦИИ: недействительная подпись VK!');
                return;
            }
            vkUserId = check.userId;
        } else if (!VK_SECRET_KEY && data.vkUserId) {
            // Режим разработки: ключ приложения не настроен в process.env
            writeLog(`[VK DEV] Вход без подписи (VK_SECRET_KEY не задан): ID ${data.vkUserId}`);
            vkUserId = String(data.vkUserId).replace(/[^0-9]/g, '');
        } else {
            writeLog(`[VK БЕЗОПАСНОСТЬ] Отклонена попытка входа без подписи сокета ${socket.id}`);
            socket.emit('terminalError', 'ОШИБКА АВТОРИЗАЦИИ: требуются параметры запуска VK!');
            return;
        }

        if (!vkUserId) {
            socket.emit('terminalError', 'ОШИБКА АВТОРИЗАЦИИ: невозможно определить VK ID');
            return;
        }

        if (!db.vkMap) db.vkMap = {};

        // 1. Поиск в db.vkMap
        let username = db.vkMap[vkUserId];

        // 2. Поиск по полю vkUserId среди существующих игроков
        if (!username || !db.players[username]) {
            const foundByVkId = Object.keys(db.players).find(k => {
                const pl = db.players[k];
                return pl && String(pl.vkUserId) === String(vkUserId);
            });
            if (foundByVkId) {
                username = foundByVkId;
                db.vkMap[vkUserId] = username;
            }
        }

        // 3. Если игрок не привязан, но имя совпадает с cleanFirst (например PagavaMT или Pagava) — привязываем к существующему
        if (!username || !db.players[username]) {
            let cleanFirst = (data.firstName || '').trim().replace(/[^a-zA-Zа-яА-Я0-9_]/g, '');
            if (cleanFirst && db.players[cleanFirst] && (!db.players[cleanFirst].vkUserId || String(db.players[cleanFirst].vkUserId) === String(vkUserId))) {
                username = cleanFirst;
                db.players[username].vkUserId = vkUserId;
                if (data.photo && !db.players[username].vkPhoto) db.players[username].vkPhoto = data.photo;
                db.vkMap[vkUserId] = username;
                writeLog(`[VK] Существующий персонаж ${username} успешно привязан к VK ID ${vkUserId}`);
                saveDB(true);
            }
        }

        try {
            if (!username || !db.players[username]) {
                let cleanFirst = (data.firstName || '').trim().replace(/[^a-zA-Zа-яА-Я0-9_]/g, '');
                let candidate = cleanFirst ? cleanFirst : `ЗК_${vkUserId.slice(-4)}`;
                
                // Никогда не затираем существующего игрока, если имя уже занято
                if (db.players[candidate] && String(db.players[candidate].vkUserId) !== String(vkUserId)) {
                    candidate = `${candidate}_${vkUserId.slice(-4)}`;
                }
                while (db.players[candidate] && String(db.players[candidate].vkUserId) !== String(vkUserId)) {
                    candidate = `${cleanFirst || 'ЗК'}_${Math.floor(Math.random() * 9000 + 1000)}`;
                }
                username = candidate;

                writeLog(`Регистрация через VK: ${username} (VK ID: ${vkUserId})`);
                db.players[username] = {
                    password: 'vk_auth_' + vkUserId,
                    vkUserId: vkUserId,
                    vkPhoto: data.photo || null,
                    talons: 0, hp: 100, maxHp: 100, filter: 100, hunger: 100, tox: 0, level: 1, xp: 0, monstersKilled: 0, roomsCleared: 0, rating: 0, playtime: 0,
                    appearance: null, location: 'safe_room', floor: 0, activeEvent: null, workbenchLevel: 1,
                    unlockedSectors: { 0: ['A0'] }, questItems: [], foundItems: [], quickSlots: [null, null], solvedGames: [], bossDefeated: {}, perks: [], mutations: [], robots: {},
                    notebook: [
                        "[ВВОДНАЯ]: Приговор приведён в исполнение. Нас, двадцать три заключённых, погрузили в клеть и отправили вниз, на нулевой этаж, в самое пекло Самосбора.",
                        "[ВВОДНАЯ]: Мы почти достигли дна, когда лопнул трос. Клеть рухнула вниз.",
                        "[ВВОДНАЯ]: Я очнулся среди обломков. Рядом — растерзанный конвоир.",
                        "[ВВОДНАЯ]: Остальные выжившие разбежались кто куда. Я сорвал с конвоира противогаз и заперся в жилячейке.",
                        "[ЦЕЛЬ]: Найти Главный Лифт в секторе E4 и подняться наверх.",
                        "[СОВЕТ]: Не забывай про фильтр. Туман здесь живой."
                    ],
                    equipment: { weapon: 'weapon_wood', clothes: 'clothes_robe', mask: 'mask_cloth', backpack: null }, inventory: ['food_ration']
                };
                db.vkMap[vkUserId] = username;
                saveDB(true);
            } else {
                writeLog(`Вход через VK: ${username} (VK ID: ${vkUserId})`);
            }
            onlinePlayers[socket.id] = username;
            if (activeCombats[username]) {
                let c = activeCombats[username];
                if (!c.isGlobal || !c.enemy || c.enemy.hp <= 0 || db.players[username].hp <= 0) {
                    delete activeCombats[username];
                }
            }
            if (db.players[username].hp <= 0) {
                db.players[username].hp = db.players[username].maxHp || 100;
                db.players[username].location = 'safe_room';
            }
            socket.emit('loginSuccess', { username, showIntro: db.players[username].appearance === null });
            if (db.players[username].appearance !== null) socket.emit('startGame');
            broadcastGameState();
        } catch (err) { writeLog(`ОШИБКА VK LOGIN: ${err.message}`); }
    });

    socket.on('pkbLogin', (data) => {
        if (!data || !data.pkbUserId) return;
        try {
            let pkbUserId = String(data.pkbUserId).trim();
            if (!db.pkbMap) db.pkbMap = {};

            // 1. Поиск в db.pkbMap
            let username = db.pkbMap[pkbUserId];

            // 2. Поиск по полю pkbUserId среди существующих игроков
            if (!username || !db.players[username]) {
                const foundByPkbId = Object.keys(db.players).find(k => {
                    const pl = db.players[k];
                    return pl && String(pl.pkbUserId) === String(pkbUserId);
                });
                if (foundByPkbId) {
                    username = foundByPkbId;
                    db.pkbMap[pkbUserId] = username;
                }
            }

            // 3. Поиск по чистому имени игрока (если еще не привязан)
            if (!username || !db.players[username]) {
                let cleanName = (data.name || '').trim().replace(/[^a-zA-Zа-яА-Я0-9_]/g, '');
                if (cleanName && db.players[cleanName] && (!db.players[cleanName].pkbUserId || String(db.players[cleanName].pkbUserId) === String(pkbUserId))) {
                    username = cleanName;
                    db.players[username].pkbUserId = pkbUserId;
                    if (data.avatar && !db.players[username].avatar) db.players[username].avatar = data.avatar;
                    db.pkbMap[pkbUserId] = username;
                    writeLog(`[Pikabu] Существующий персонаж ${username} привязан к Пикабу ID ${pkbUserId}`);
                    saveDB(true);
                }
            }

            // 4. Регистрация нового игрока Пикабу
            if (!username || !db.players[username]) {
                let cleanName = (data.name || '').trim().replace(/[^a-zA-Zа-яА-Я0-9_]/g, '');
                let candidate = cleanName ? cleanName : `Пикабушник_${pkbUserId.slice(-4)}`;
                if (db.players[candidate] && String(db.players[candidate].pkbUserId) !== String(pkbUserId)) {
                    candidate = `${candidate}_${pkbUserId.slice(-4)}`;
                }
                while (db.players[candidate] && String(db.players[candidate].pkbUserId) !== String(pkbUserId)) {
                    candidate = `${cleanName || 'Пикабушник'}_${Math.floor(Math.random() * 9000 + 1000)}`;
                }
                username = candidate;

                writeLog(`Регистрация через Пикабу Игры: ${username} (ID: ${pkbUserId})`);
                db.players[username] = {
                    password: 'pkb_auth_' + pkbUserId,
                    pkbUserId: pkbUserId,
                    avatar: data.avatar || null,
                    talons: 0, hp: 100, maxHp: 100, filter: 100, hunger: 100, tox: 0, level: 1, xp: 0, monstersKilled: 0, roomsCleared: 0, rating: 0, playtime: 0,
                    appearance: null, location: 'safe_room', floor: 0, activeEvent: null, workbenchLevel: 1,
                    unlockedSectors: { 0: ['A0'] }, questItems: [], foundItems: [], quickSlots: [null, null], solvedGames: [], bossDefeated: {}, perks: [], mutations: [], robots: {},
                    notebook: [
                        "[ВВОДНАЯ]: Приговор приведён в исполнение. Нас, двадцать три заключённых, погрузили в клеть и отправили вниз, на нулевой этаж, в самое пекло Самосбора.",
                        "[ВВОДНАЯ]: Мы почти достигли дна, когда лопнул трос. Клеть рухнула вниз.",
                        "[ВВОДНАЯ]: Я очнулся среди обломков. Рядом — растерзанный конвоир.",
                        "[ВВОДНАЯ]: Остальные выжившие разбежались кто куда. Я сорвал с конвоира противогаз и заперся в жилячейке.",
                        "[ЦЕЛЬ]: Найти Главный Лифт в секторе E4 и подняться наверх.",
                        "[СОВЕТ]: Не забывай про фильтр. Туман здесь живой."
                    ],
                    equipment: { weapon: 'weapon_wood', clothes: 'clothes_robe', mask: 'mask_cloth', backpack: null }, inventory: ['food_ration']
                };
                db.pkbMap[pkbUserId] = username;
                saveDB(true);
            } else {
                writeLog(`Вход через Пикабу Игры: ${username} (ID: ${pkbUserId})`);
            }

            onlinePlayers[socket.id] = username;
            if (activeCombats[username]) {
                let c = activeCombats[username];
                if (!c.isGlobal || !c.enemy || c.enemy.hp <= 0 || db.players[username].hp <= 0) {
                    delete activeCombats[username];
                }
            }
            if (db.players[username].hp <= 0) {
                db.players[username].hp = db.players[username].maxHp || 100;
                db.players[username].location = 'safe_room';
            }
            socket.emit('loginSuccess', { username, showIntro: db.players[username].appearance === null });
            if (db.players[username].appearance !== null) socket.emit('startGame');
            broadcastGameState();
        } catch (err) {
            writeLog(`ОШИБКА PKB LOGIN: ${err.message}`);
        }
    });

    socket.on('linkAccount', (data) => {
        if (!data || !data.targetUsername || !data.password) return;
        const { targetUsername, password } = data;
        let currentU = onlinePlayers[socket.id];
        let p = db.players[targetUsername];
        if (!p) {
            socket.emit('terminalError', 'АККАУНТ НЕ НАЙДЕН');
            return;
        }
        if (!verifyPassword(password, p.password)) {
            socket.emit('terminalError', 'НЕВЕРНЫЙ ПАРОЛЬ');
            return;
        }
        let vkId = (currentU && db.players[currentU] && db.players[currentU].vkUserId) || (data.vkUserId ? String(data.vkUserId) : null);
        if (vkId) {
            p.vkUserId = vkId;
            if (!db.vkMap) db.vkMap = {};
            db.vkMap[vkId] = targetUsername;
            saveDB(true);
            writeLog(`[СВЯЗКА] Игрок ${targetUsername} успешно привязан к VK ID ${vkId}`);
            onlinePlayers[socket.id] = targetUsername;
            socket.emit('terminalError', `ПРОФИЛЬ УСПЕШНО ПРИВЯЗАН: ${targetUsername}`);
            socket.emit('loginSuccess', { username: targetUsername, showIntro: false });
            socket.emit('startGame');
            broadcastGameState();
        }
    });

    socket.on('saveCharacter', () => {
        let u = onlinePlayers[socket.id];
        if (u && db.players[u]) {
            let p = db.players[u];
            let randomSkinNum = Math.floor(Math.random() * 10) + 1;
            p.appearance = { skin: 'skin_' + randomSkinNum };
            saveDB(); socket.emit('startGame'); broadcastGameState();
        }
    });
    let lastFeedbackTime = 0;

    socket.on('sendChatMessage', (msg) => {
        let u = onlinePlayers[socket.id]; if (!u) return;
        let now = Date.now();
        if (now - lastChatTime < 2000) { socket.emit('terminalError', 'СЕТЬ: Ожидайте 2 сек.'); return; }
        lastChatTime = now;
        let cleanMsg = String(msg || '').trim().substring(0, 100);
        if (!cleanMsg) return;
        let p = db.players[u];
        let entry = {
            user: u,
            level: p ? p.level : 1,
            title: p ? (p.title || 'Заключенный') : 'Заключенный',
            text: cleanMsg,
            time: new Date().toLocaleTimeString('ru-RU', { hour12: false, hour: '2-digit', minute:'2-digit' })
        };
        if (!Array.isArray(db.chatHistory)) db.chatHistory = [];
        db.chatHistory.push(entry);
        if (db.chatHistory.length > MAX_CHAT_MESSAGES) db.chatHistory.shift();
        chatHistory = db.chatHistory;
        saveDB();
        io.emit('chatMessage', entry);
    });

    // ===== СОВМЕСТНАЯ ВЫЛАЗКА: ОБРАБОТЧИКИ ОТРЯДА И РЕЙДА =====
    socket.on('getRaidSquads', () => {
        socket.emit('raidSquadsList', getPublicRaidSquads());
        let u = onlinePlayers[socket.id];
        if (u) {
            let mySquad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === u));
            socket.emit('myRaidSquad', mySquad ? getSquadClientData(mySquad) : null);
        }
    });

    socket.on('createRaidSquad', (data) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let existing = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (existing) {
            // Если игрок уже единственный участник в лобби - просто переименуем и вернем его отряд
            if (existing.status === 'lobby' && existing.members.length === 1 && existing.leader === username) {
                if (data && typeof data.name === 'string' && data.name.trim()) {
                    existing.name = data.name.trim().slice(0, 24);
                }
                socket.emit('myRaidSquad', getSquadClientData(existing));
                io.emit('raidSquadsList', getPublicRaidSquads());
                return;
            }
            // Иначе безопасно покидаем предыдущий/зависший отряд
            existing.members = existing.members.filter(m => m.username !== username);
            if (existing.members.length === 0) {
                delete coopSquads[existing.id];
            } else {
                if (existing.leader === username) existing.leader = existing.members[0].username;
                broadcastToSquad(existing, 'myRaidSquad', getSquadClientData(existing));
            }
        }
        let sName = (data && typeof data.name === 'string' && data.name.trim()) ? data.name.trim().slice(0, 24) : ('Штурм ' + username);
        let squadId = 'squad_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        let newSquad = {
            id: squadId,
            name: sName,
            leader: username,
            members: [{
                username: username,
                level: p.level || 1,
                title: p.title || 'Заключенный',
                hp: p.hp || 100,
                maxHp: p.maxHp || 100,
                isReady: true,
                isDowned: false,
                pDodging: false,
                pTimer: 2.0
            }],
            status: 'lobby',
            currentWave: 1,
            maxWaves: 11,
            enemy: null,
            eTimer: 2.2,
            chat: [{ user: 'ШТАБ', text: 'Штурмовой отряд сформирован командиром ' + username + '. Ожидание бойцов...', time: new Date().toLocaleTimeString('ru-RU', { hour12: false, hour: '2-digit', minute:'2-digit' }) }],
            logs: [],
            vfx: [],
            votes: {},
            intermissionTimer: 0
        };
        coopSquads[squadId] = newSquad;
        socket.emit('myRaidSquad', getSquadClientData(newSquad));
        io.emit('raidSquadsList', getPublicRaidSquads());
        socket.emit('playSound', 'equip');
        broadcastGameState();
    });

    socket.on('joinRaidSquad', (squadId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let existing = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (existing) { socket.emit('terminalError', 'СНАЧАЛА ВЫЙДИТЕ ИЗ ТЕКУЩЕГО ОТРЯДА!'); return; }
        let squad = coopSquads[squadId];
        if (!squad) { socket.emit('terminalError', 'ОТРЯД НЕ НАЙДЕН!'); return; }
        if (squad.status !== 'lobby') { socket.emit('terminalError', 'ОТРЯД УЖЕ В БОЮ!'); return; }
        if (squad.members.length >= 4) { socket.emit('terminalError', 'ОТРЯД ПОЛОН (МАКС. 4 БОЙЦА)!'); return; }
        squad.members.push({
            username: username,
            level: p.level || 1,
            title: p.title || 'Заключенный',
            hp: p.hp || 100,
            maxHp: p.maxHp || 100,
            isReady: false,
            isDowned: false,
            pDodging: false,
            pTimer: 2.0
        });
        squad.chat.push({ user: 'ШТАБ', text: 'Боец ' + username + ' [Ур. ' + p.level + '] вступил в отряд!', time: new Date().toLocaleTimeString('ru-RU', { hour12: false, hour: '2-digit', minute:'2-digit' }) });
        broadcastToSquad(squad, 'myRaidSquad', getSquadClientData(squad));
        io.emit('raidSquadsList', getPublicRaidSquads());
        socket.emit('playSound', 'buy');
        broadcastGameState();
    });

    socket.on('leaveRaidSquad', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let squad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (!squad) return;
        let wasLeader = (squad.leader === username);
        squad.members = squad.members.filter(m => m.username !== username);
        if (squad.status === 'combat' || squad.status === 'intermission') {
            p.location = 'safe_room';
            if (p.hp <= 0) p.hp = 50;
        }
        if (squad.members.length === 0) {
            delete coopSquads[squad.id];
        } else {
            if (wasLeader) squad.leader = squad.members[0].username;
            squad.chat.push({ user: 'ШТАБ', text: 'Боец ' + username + ' покинул отряд.', time: new Date().toLocaleTimeString('ru-RU', { hour12: false, hour: '2-digit', minute:'2-digit' }) });
            broadcastToSquad(squad, 'myRaidSquad', getSquadClientData(squad));
        }
        socket.emit('myRaidSquad', null);
        io.emit('raidSquadsList', getPublicRaidSquads());
        socket.emit('terminalError', 'ВЫ ПОКИНУЛИ ОТРЯД.');
        broadcastGameState();
    });

    socket.on('toggleRaidReady', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username } = auth;
        let squad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (!squad || squad.status !== 'lobby') return;
        let member = squad.members.find(m => m.username === username);
        if (member) {
            member.isReady = !member.isReady;
            broadcastToSquad(squad, 'myRaidSquad', getSquadClientData(squad));
            io.emit('raidSquadsList', getPublicRaidSquads());
        }
    });

    socket.on('startRaidSortie', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username } = auth;
        let squad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (!squad || squad.status !== 'lobby') return;
        if (squad.leader !== username) { socket.emit('terminalError', 'ТОЛЬКО КОМАНДИР МОЖЕТ НАЧАТЬ ВЫЛАЗКУ!'); return; }
        let notReady = squad.members.filter(m => m.username !== squad.leader && !m.isReady);
        if (notReady.length > 0) {
            socket.emit('terminalError', 'НЕ ВСЕ БОЙЦЫ ГОТОВЫ (' + notReady.map(m=>m.username).join(', ') + ')!');
            return;
        }
        squad.status = 'combat';
        squad.currentWave = 1;
        let mob = RAID_WAVE_MONSTERS[0];
        let hpMult = 1 + (squad.members.length - 1) * 0.45;
        squad.enemy = {
            name: mob.name,
            hp: Math.floor(mob.hp * hpMult),
            maxHp: Math.floor(mob.hp * hpMult),
            dmg: mob.dmg,
            def: mob.def,
            reward: mob.reward,
            xp: mob.xp,
            img: mob.img,
            tier: mob.tier
        };
        squad.eTimer = 2.5;
        squad.logs = ['[ШТУРМ НАЧАТ] Отряд вошёл в опасный сектор! Волна 1/11: ' + squad.enemy.name + '!'];
        squad.members.forEach(m => {
            let mp = db.players[m.username];
            if (mp) {
                m.hp = mp.hp || 100;
                m.maxHp = mp.maxHp || 100;
                m.isDowned = (m.hp <= 0);
                m.pDodging = false;
                m.pTimer = 2.0;
            }
        });
        let sData = getSquadClientData(squad);
        broadcastToSquad(squad, 'raidSortieStarted', {
            squad: sData,
            members: sData ? sData.members : [],
            enemy: squad.enemy,
            currentWave: squad.currentWave,
            maxWaves: squad.maxWaves
        });
        io.emit('raidSquadsList', getPublicRaidSquads());
        broadcastGameState();
    });

    socket.on('raidPlayerAttack', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let squad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (!squad || squad.status !== 'combat' || !squad.enemy) return;
        let member = squad.members.find(m => m.username === username);
        if (!member || member.isDowned || member.hp <= 0) {
            socket.emit('terminalError', 'ВЫ ТЯЖЕЛО РАНЕНЫ! Ждите помощи медика.');
            return;
        }
        let now = Date.now();
        member.lastAttackTime = member.lastAttackTime || 0;
        if (now - member.lastAttackTime < 1100) {
            return;
        }
        member.lastAttackTime = now;
        let stats = getPlayerStats(p);
        let pDmg = Math.max(4, stats.dmg - Math.floor((squad.enemy.def || 0) / 2));
        let isCrit = (Math.random() < (stats.crit || 0.1));
        if (isCrit) {
            pDmg = Math.floor(pDmg * 1.8);
            squad.logs.push('> 💥 КРИТИЧЕСКИЙ УДАР! ' + username + ' наносит ' + pDmg + ' урона по ' + squad.enemy.name + '!');
        } else {
            squad.logs.push('> ' + username + ' атакует: -' + pDmg + ' HP у ' + squad.enemy.name + '.');
        }
        squad.enemy.hp = Math.max(0, squad.enemy.hp - pDmg);
        squad.vfx = squad.vfx || [];
        squad.vfx.push({ type: 'enemy_hit', dmg: pDmg, isCrit: isCrit, from: username });
        socket.emit('playSound', 'hit_enemy');
    });

    socket.on('raidPlayerDodge', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username } = auth;
        let squad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (!squad || squad.status !== 'combat') return;
        let member = squad.members.find(m => m.username === username);
        if (!member || member.isDowned) return;
        let now = Date.now();
        member.lastDodgeTime = member.lastDodgeTime || 0;
        if (now - member.lastDodgeTime < 2400) {
            return;
        }
        member.lastDodgeTime = now;
        member.pDodging = true;
        squad.vfx = squad.vfx || [];
        squad.vfx.push({ type: 'player_dodge', target: username });
        squad.logs.push('> 🛡️ ' + username + ' приготовился к уклонению!');
        socket.emit('playSound', 'dodge');
    });

    socket.on('reviveRaidTeammate', (data) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let targetUsername = data && data.targetUsername;
        if (!targetUsername) return;
        let squad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (!squad || squad.status !== 'combat') return;
        let healerMember = squad.members.find(m => m.username === username);
        if (!healerMember || healerMember.isDowned || healerMember.hp <= 0) {
            socket.emit('terminalError', 'ВЫ НЕ МОЖЕТЕ ЛЕЧИТЬ В БЕССОЗНАТЕЛЬНОМ СОСТОЯНИИ!');
            return;
        }
        let targetMember = squad.members.find(m => m.username === targetUsername);
        if (!targetMember) { socket.emit('terminalError', 'ЦЕЛЬ НЕ НАЙДЕНА В ОТРЯДЕ.'); return; }
        if (!targetMember.isDowned && targetMember.hp > 0) {
            socket.emit('terminalError', targetUsername + ' НЕ ТРЕБУЕТ РЕАНИМАЦИИ.');
            return;
        }
        let targetP = db.players[targetUsername];
        if (!targetP) return;
        let medIndex = p.inventory.findIndex(id => id === 'food_medkit' || id === 'food_pure' || id === 'food_ration' || id === 'mat_chem');
        if (medIndex === -1) {
            socket.emit('terminalError', 'НЕТ МЕДИЦИНЫ! Нужна Военная аптечка или Биоконцентрат в рюкзаке.');
            socket.emit('playSound', 'defeat');
            return;
        }
        let consumedItem = p.inventory.splice(medIndex, 1)[0];
        let itemName = (GAME_ITEMS[consumedItem] && GAME_ITEMS[consumedItem].name) || consumedItem;
        let healHp = Math.max(45, Math.floor((targetP.maxHp || 100) * 0.45));
        targetP.hp = healHp;
        targetMember.hp = healHp;
        targetMember.isDowned = false;
        let reviveMsg = '[САНИТАР] 💉 ' + username + ' применил «' + itemName + '» и ПОДНЯЛ НА НОГИ бойца ' + targetUsername + '! (+' + healHp + ' HP)';
        squad.logs.push(reviveMsg);
        squad.vfx = squad.vfx || [];
        squad.vfx.push({ type: 'heal', target: targetUsername, amt: healHp });
        broadcastToSquad(squad, 'playSound', 'potion');
        broadcastToSquad(squad, 'raidTeammateRevived', {
            healer: username,
            target: targetUsername,
            item: itemName,
            hp: healHp
        });
        saveDB();
        broadcastGameState();
    });

    socket.on('voteRaidIntermission', (choice) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username } = auth;
        let squad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (!squad || squad.status !== 'intermission') return;

        // Одиночная эвакуация бойца (если один в отряде или выбрана эвакуация)
        if (choice === 'evacuate' && squad.members.length <= 1) {
            let mp = db.players[username];
            if (mp) {
                mp.location = 'safe_room';
                if (mp.hp <= 0) mp.hp = 50;
            }
            delete coopSquads[squad.id];
            socket.emit('raidSortieEnded', {
                win: true,
                evacuated: true,
                clearedWave: squad.clearedWave || 1,
                reason: 'ВЫ УСПЕШНО ЭВАКУИРОВАЛИСЬ В ЖИЛЯЧЕЙКУ СО ВСЕМИ ТРОФЕЯМИ!'
            });
            socket.emit('myRaidSquad', null);
            io.emit('raidSquadsList', getPublicRaidSquads());
            saveDB();
            broadcastGameState();
            return;
        }

        squad.votes = squad.votes || {};
        squad.votes[username] = (choice === 'evacuate') ? 'evacuate' : 'continue';
        broadcastToSquad(squad, 'raidIntermissionVotesUpdated', getIntermissionData(squad));
        if (Object.keys(squad.votes).length >= squad.members.length) {
            resolveRaidIntermission(squad);
        }
    });

    socket.on('sendRaidChatMessage', (data) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let text = typeof data === 'string' ? data : (data && data.text ? data.text : '');
        text = String(text || '').trim().slice(0, 120);
        if (!text) return;
        let squad = Object.values(coopSquads).find(sq => sq.members.some(m => m.username === username));
        if (!squad) return;
        let member = squad.members.find(m => m.username === username);
        let entry = {
            user: username,
            level: p.level || 1,
            title: p.title || 'Заключенный',
            isDowned: member ? !!member.isDowned : false,
            text: text,
            time: new Date().toLocaleTimeString('ru-RU', { hour12: false, hour: '2-digit', minute: '2-digit' })
        };
        squad.chat = squad.chat || [];
        squad.chat.push(entry);
        if (squad.chat.length > 40) squad.chat.shift();
        broadcastToSquad(squad, 'raidChatMessage', entry);
    });

    socket.on('submitFeedback', (data) => {
        let u = onlinePlayers[socket.id] || 'Аноним';
        let now = Date.now();
        if (now - lastFeedbackTime < 5000) {
            socket.emit('terminalError', 'ОТЧЕТ: Подождите 5 секунд перед повторной отправкой.');
            return;
        }
        if (!data || typeof data !== 'object') return;
        let type = data.type === 'suggestion' ? 'ПРЕДЛОЖЕНИЕ' : 'БАГ-РЕПОРТ';
        let text = (typeof data.text === 'string' ? data.text.trim() : '').substring(0, 500);
        if (!text) {
            socket.emit('terminalError', 'ОТЧЕТ: Текст обращения не может быть пустым.');
            return;
        }
        lastFeedbackTime = now;
        let p = db.players[u];
        let report = {
            id: 'rep_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            user: u,
            type: type,
            text: text,
            floor: p ? (p.floor || 0) : 0,
            location: p ? (p.location || 'unknown') : 'unknown',
            createdAt: new Date().toISOString(),
            timeStr: new Date().toLocaleString('ru-RU')
        };
        if (!Array.isArray(db.feedback)) db.feedback = [];
        db.feedback.push(report);
        if (db.feedback.length > 200) db.feedback.shift();
        saveDB();

        writeLog(`[${type}] от #${u} (Эт.${report.floor}, Сектор ${report.location}): "${text}"`);
        socket.emit('feedbackSentSuccess', { message: 'Обращение успешно доставлено в диспетчерскую блока!' });
        io.emit('feedbackList', db.feedback || []);
    });

    socket.on('getFeedbackList', () => {
        socket.emit('feedbackList', db.feedback || []);
    });

    socket.on('deleteFeedback', (data) => {
        if (!data || data.devCode !== '2847') {
            socket.emit('terminalError', 'ОШИБКА: Неверный код разработчика.');
            return;
        }
        if (!Array.isArray(db.feedback)) db.feedback = [];
        if (data.id === 'ALL') {
            db.feedback = [];
            saveDB();
            io.emit('feedbackList', db.feedback);
            socket.emit('terminalError', 'Журнал обращений полностью очищен.');
            return;
        }
        let beforeLen = db.feedback.length;
        db.feedback = db.feedback.filter(item => item.id !== data.id);
        if (db.feedback.length !== beforeLen) {
            saveDB();
            io.emit('feedbackList', db.feedback);
            socket.emit('terminalError', 'Обращение удалено из журнала.');
        }
    });

    socket.on('replyFeedback', (data) => {
        if (!data || data.devCode !== '2847') {
            socket.emit('terminalError', 'ОШИБКА: Неверный код разработчика.');
            return;
        }
        let text = (typeof data.replyText === 'string' ? data.replyText.trim() : '').substring(0, 500);
        if (!text) {
            socket.emit('terminalError', 'ОТВЕТ: Текст не может быть пустым.');
            return;
        }
        if (!Array.isArray(db.feedback)) db.feedback = [];
        let report = db.feedback.find(item => item.id === data.id);
        if (!report) {
            socket.emit('terminalError', 'ОШИБКА: Обращение не найдено.');
            return;
        }
        report.reply = {
            text: text,
            author: (data.author && typeof data.author === 'string') ? data.author.trim() : 'Диспетчер',
            timeStr: new Date().toLocaleString('ru-RU')
        };
        saveDB();
        io.emit('feedbackList', db.feedback);
        socket.emit('terminalError', 'Ответ опубликован в журнале.');
    });

    socket.on('selectPerk', (perkId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!p.perks.includes(perkId)) {
            p.perks.push(perkId);
            if (perkId === 'perk_health') { p.maxHp += 25; p.hp += 25; }
            saveDB(); broadcastGameState();
        }
    });

    

function getSectorNpc(floor, locId) {
    if (!locId || locId === 'safe_room' || locId === 'E4') return null;
    let f = parseInt(floor, 10) || 0;
    let l = String(locId).toLowerCase();

    // 10 исходных секторов
    if (l.includes('med') || l.includes('сан')) {
        return { id: 'npc_medic_klavdiya', titleRu: '👩‍⚕️ ФЕЛЬДШЕР КЛАВДИЯ (МЕДПУНКТ)', titleEn: '👩‍⚕️ MEDIC KLAVDIYA (MEDBAY)', color: '#00ffaa' };
    }
    if (l.includes('стол') || l.includes('кух') || l.includes('пищ') || l.includes('cafe')) {
        return { id: 'npc_cook_valya', titleRu: '🍲 ТЁТЯ ВАЛЯ (ПИЩЕБЛОК)', titleEn: '🍲 AUNT VALYA (CAFETERIA)', color: '#ffbb33' };
    }
    if (l.includes('радио') || l.includes('связ') || l.includes('comm')) {
        return { id: 'npc_radio_mayak', titleRu: '📻 РАДИСТ МАЯК (РАДИОУЗЕЛ)', titleEn: '📻 RADIO MAYAK (COMMS)', color: '#33d4ff' };
    }
    if (l.includes('плав') || l.includes('печ') || l.includes('домн') || l.includes('furnace')) {
        return { id: 'npc_smelter_kuzma', titleRu: '🔥 СТАЛЕВАР КУЗЬМА (ДОМНА)', titleEn: '🔥 SMELTER KUZMA (FURNACE)', color: '#ff6622' };
    }
    if (l.includes('вент') || l.includes('шахт') || l.includes('vent')) {
        return { id: 'npc_guide_erofey', titleRu: '🧗 ПРОВОДНИК ЕРОФЕЙ (ВЕНТИЛЯЦИЯ)', titleEn: '🧗 GUIDE EROFEY (VENT)', color: '#aaff66' };
    }
    if (l.includes('архив') || l.includes('канц') || l.includes('дело') || l.includes('arch')) {
        return { id: 'npc_inspector_kovalev', titleRu: '📜 ИНСПЕКТОР КОВАЛЁВ (АРХИВ)', titleEn: '📜 INSPECTOR KOVALEV (ARCHIVE)', color: '#ffd700' };
    }
    if (l.includes('щит') || l.includes('подст') || l.includes('энерг') || l.includes('power')) {
        return { id: 'npc_engineer_zaslavsky', titleRu: '⚡ ЭНЕРГЕТИК ЗАСЛАВСКИЙ (ЩИТОВАЯ)', titleEn: '⚡ ENG. ZASLAVSKY (SUBSTATION)', color: '#ffff33' };
    }
    if (l.includes('вохр') || l.includes('заслон') || l.includes('оруж') || l.includes('armory')) {
        return { id: 'npc_sergeant_tarasov', titleRu: '🎖️ СЕРЖАНТ ТАРАСОВ (ЗАСЛОН ВОХР)', titleEn: '🎖️ SGT. TARASOV (ARMORY)', color: '#ff4444' };
    }
    if (l.includes('плот') || l.includes('алтар') || l.includes('flesh')) {
        return { id: 'npc_hermit_azariy', titleRu: '🕯️ ОТШЕЛЬНИК АЗАРИЙ (РАЗЛОМ ПЛОТИ)', titleEn: '🕯️ HERMIT AZARIY (FLESH RIFT)', color: '#dd55ff' };
    }
    if (l.includes('мастер') || l.includes('рем') || l.includes('цех') || l.includes('work')) {
        return { id: 'npc_mechanic_makar', titleRu: '🔧 ДЕД МАКАР (МАСТЕРСКАЯ)', titleEn: '🔧 MECHANIC MAKAR (WORKSHOP)', color: '#00e5ff' };
    }

    // 10 новых секторов второй волны
    if (l.includes('сток') || l.includes('коллектор') || l.includes('сифон') || l.includes('pipe') || l.includes('sewer') || l.includes('drain')) {
        return { id: 'npc_plumber_mikhalych', titleRu: '🪠 КАПИТАН МИХАЛЫЧ (КОЛЛЕКТОР)', titleEn: '🪠 CAPTAIN MIKHALYCH (DRAINS)', color: '#33ccaa' };
    }
    if (l.includes('техбюро') || l.includes('библиот') || l.includes('чертеж') || l.includes('бюро')) {
        return { id: 'npc_librarian_zoya', titleRu: '📚 ЗОЯ ПАВЛОВНА (ТЕХБЮРО)', titleEn: '📚 ZOYA PAVLOVNA (TECH-BUREAU)', color: '#a0c4ff' };
    }
    if (l.includes('оранж') || l.includes('гидропон') || l.includes('теплиц') || l.includes('сад') || l.includes('greenhouse')) {
        return { id: 'npc_agronomist_serafima', titleRu: '🌱 СЕРАФИМА (ГИДРОПОНИКА)', titleEn: '🌱 SERAFIMA (HYDROPONICS)', color: '#70e000' };
    }
    if (l.includes('клуб') || l.includes('кино') || l.includes('зал') || l.includes('cinema')) {
        return { id: 'npc_projectionist_saveliy', titleRu: '🎬 ДЕД САВЕЛИЙ (КИНОКЛУБ)', titleEn: '🎬 SAVELIY (CINEMA CLUB)', color: '#ffaa00' };
    }
    if (l.includes('утиль') || l.includes('свалк') || l.includes('барах') || l.includes('junk') || l.includes('scrap')) {
        return { id: 'npc_scavenger_syoma', titleRu: '🕵️ СЁМА ШНИФЕР (УТИЛЬ-СХРОН)', titleEn: '🕵️ SYOMA SHNIFER (SCAVENGER)', color: '#ffd166' };
    }
    if (l.includes('башн') || l.includes('вышк') || l.includes('смотр') || l.includes('пост') || l.includes('tower')) {
        return { id: 'npc_sniper_anna', titleRu: '🎯 АННА «СОВА» (СМОТРОВАЯ)', titleEn: '🎯 ANNA OWL (SNIPER TOWER)', color: '#ef476f' };
    }
    if (l.includes('пожар') || l.includes('гарь') || l.includes('огон') || l.includes('пролет') || l.includes('stairs')) {
        return { id: 'npc_flamethrower_boris', titleRu: '🔥 БОРИС «ТОРЧ» (ОГНЕВОЙ ЗАСЛОН)', titleEn: '🔥 BORIS TORCH (FLAMETHROWER)', color: '#f77f00' };
    }
    if (l.includes('час') || l.includes('реле') || l.includes('тайм') || l.includes('clock')) {
        return { id: 'npc_clockmaker_arseniy', titleRu: '🕰️ АРСЕНИЙ (ЧАСОВАЯ)', titleEn: '🕰️ ARSENIY (CLOCKMAKER)', color: '#e0aaff' };
    }
    if (l.includes('слух') || l.includes('акуст') || l.includes('трасс')) {
        return { id: 'npc_acoustician_gavrila', titleRu: '🎧 ГАВРИЛА (СЛУХОВОЙ УЗЕЛ)', titleEn: '🎧 GAVRILA (ACOUSTICS)', color: '#38b000' };
    }
    if (l.includes('дегаз') || l.includes('хим') || l.includes('шлюз') || l.includes('decon')) {
        return { id: 'npc_chemist_degas', titleRu: '🧪 СЕМЁН (СТАНЦИЯ ДЕГАЗАЦИИ)', titleEn: '🧪 SEMYON (DECONTAMINATION)', color: '#06d6a0' };
    }
    return null;
}

function getLifterIdForFloor(floor) {
    let f = parseInt(floor, 10) || 0;
    if (f >= 25) return 'npc_lifter_abyss';
    if (f >= 20) return 'npc_lifter_cult';
    if (f >= 15) return 'npc_lifter_vokhr';
    if (f >= 10) return 'npc_lifter_reactor';
    if (f >= 5) return 'npc_lifter_archive';
    return 'npc_lifter';
}

function checkLifterTrigger(player, sock, loc) {
        if (loc === 'E4' && !player.talkedToLifter) {
            player.talkedToLifter = true;
            let evLifter = RANDOM_EVENTS.find(e => e.id === 'npc_lifter');
            if (evLifter) {
                player.activeEvent = evLifter.id;
                player.activeEventNode = null;
                setTimeout(() => { sock.emit('triggerEvent', evLifter); }, 350);
            }
        }
    }

    socket.on('talkToNpc', (npcId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        if (activeCombats[username]) return;
        let targetId = npcId;
        if (!targetId || targetId === 'npc_lifter') {
            targetId = getLifterIdForFloor(p.floor || 0);
        }
        let ev = RANDOM_EVENTS.find(e => e.id === targetId) || RANDOM_EVENTS.find(e => e.id === 'npc_lifter');
        if (ev) {
            p.activeEvent = ev.id;
            p.activeEventNode = null;
            saveDB();
            socket.emit('triggerEvent', ev);
            broadcastGameState();
        }
    });

    socket.on('changeLocation', (locId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        if (activeCombats[username]) {
            let c = activeCombats[username];
            let isDead = (c.enemy && c.enemy.hp <= 0) || p.hp <= 0;
            let isGlobalBossDead = false;
            if (c.isGlobal) {
                let bossKey = (typeof c.floor === 'string' && c.floor.startsWith('coop_')) ? c.floor : `boss_${c.floor}`;
                let gb = globalBosses[bossKey];
                if (!gb || gb.hp <= 0) isGlobalBossDead = true;
            }
            if (isDead || isGlobalBossDead || locId === 'safe_room') {
                if (locId === 'safe_room' && !isDead && !isGlobalBossDead) {
                    p.hp = Math.max(1, Math.floor(p.hp * 0.7)); // штраф за экстренное отступление
                }
                if (c.isGlobal) {
                    let bossKey = (typeof c.floor === 'string' && c.floor.startsWith('coop_')) ? c.floor : `boss_${c.floor}`;
                    if (globalBosses[bossKey] && globalBosses[bossKey].participants) {
                        globalBosses[bossKey].participants.delete(username);
                    }
                }
                delete activeCombats[username];
            } else {
                socket.emit('terminalError', 'НЕЛЬЗЯ ПЕРЕМЕЩАТЬСЯ ВО ВРЕМЯ БОЯ!');
                return;
            }
        }
        let currentFloor = p.floor || 0;
        if (!p.unlockedSectors || typeof p.unlockedSectors !== 'object') p.unlockedSectors = { 0: ['A0'] };
        if (Array.isArray(p.unlockedSectors)) p.unlockedSectors = { 0: p.unlockedSectors };
        if (!Array.isArray(p.unlockedSectors[currentFloor])) p.unlockedSectors[currentFloor] = ['A0'];

        p.hunger = Math.max(0, p.hunger - 1);
        if (p.hunger === 0) p.hp = Math.max(1, p.hp - 2);

        if (locId === 'safe_room') {
            p.location = locId;
            saveDB();
            socket.emit('transition', {to: locId, text: "ВХОД В ЖИЛЯЧЕЙКУ..."});
            broadcastGameState();
            return;
        }

        if (!db.map || !db.map[currentFloor] || !db.map[currentFloor][locId]) {
            socket.emit('terminalError', 'СЕКТОР НЕДОСТУПЕН');
            return;
        }

        if (p.unlockedSectors[currentFloor].includes(locId)) {
            p.location = locId;
            checkLifterTrigger(p, socket, locId);
            saveDB();
            socket.emit('transition', {to: locId, text: `ВХОД В СЕКТОР ${locId}...`});
            broadcastGameState();
            return;
        }

        let sectorData = db.map[currentFloor][locId];
        if (sectorData.reqType === 'item') {
            let reqItem = sectorData.reqValue;
            let hasItem = (p.questItems && p.questItems.includes(reqItem)) || (p.foundItems && p.foundItems.includes(reqItem));
            if (hasItem) {
                if (reqItem === 'quest_fuse' || reqItem === 'quest_battery') {
                    let idx = p.questItems.indexOf(reqItem);
                    if (idx !== -1) p.questItems.splice(idx, 1);
                }
                if (!p.unlockedSectors[currentFloor].includes(locId)) {
                    p.unlockedSectors[currentFloor].push(locId);
                }
                p.location = locId;
                checkLifterTrigger(p, socket, locId);
                p.roomsCleared = (p.roomsCleared || 0) + 1;
                p.notebook.push(`[ЭТАЖ ${currentFloor}]: Открыл сектор ${locId} с помощью ${GAME_ITEMS[reqItem] ? GAME_ITEMS[reqItem].name : reqItem}.`);
                checkPlayerAchievements(p, socket);
                socket.emit('playSound', 'victory');
                saveDB();
                socket.emit('transition', {to: locId, text: `ЗАМОК ОТКРЫТ...`});
                broadcastGameState();
            } else {
                socket.emit('terminalError', `НУЖЕН ПРЕДМЕТ: ${GAME_ITEMS[reqItem] ? GAME_ITEMS[reqItem].name : reqItem}`);
                socket.emit('playSound', 'click');
            }
        }
        else if (sectorData.reqType === 'minigame') {
            socket.emit('startMinigame', { locId: locId, gameData: sectorData.reqValue });
        }
        else {
            if (!p.unlockedSectors[currentFloor].includes(locId)) {
                p.unlockedSectors[currentFloor].push(locId);
            }
            p.location = locId;
            checkLifterTrigger(p, socket, locId);
            saveDB();
            socket.emit('transition', {to: locId, text: `ВХОД В СЕКТОР ${locId}...`});
            broadcastGameState();
        }
    });

    socket.on('minigameWon', (locId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        let currentFloor = p.floor || 0;
        if (!p.unlockedSectors || typeof p.unlockedSectors !== 'object') p.unlockedSectors = { 0: ['A0'] };
        if (Array.isArray(p.unlockedSectors)) p.unlockedSectors = { 0: p.unlockedSectors };
        if (!Array.isArray(p.unlockedSectors[currentFloor])) p.unlockedSectors[currentFloor] = ['A0'];

        if (!p.unlockedSectors[currentFloor].includes(locId)) {
            p.unlockedSectors[currentFloor].push(locId);
        }
        p.location = locId;
        p.puzzlesSolved = (p.puzzlesSolved || 0) + 1;
        checkLifterTrigger(p, socket, locId);
        p.roomsCleared = (p.roomsCleared || 0) + 1;
        p.notebook.push(`[ЭТАЖ ${currentFloor}]: Взломал гермодверь в ${locId}.`);
        checkPlayerAchievements(p, socket);
        socket.emit('playSound', 'victory');
        saveDB();
        socket.emit('transition', {to: locId, text: `ВЗЛОМ УСПЕШЕН...`});
        broadcastGameState();
    });

    socket.on('minigameCancel', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        p.location = 'safe_room';
        saveDB();
        socket.emit('transition', {to: 'safe_room', text: "ОТСТУПЛЕНИЕ..."});
        broadcastGameState();
    });

    socket.on('changeFloor', (dir) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        let currentFloor = p.floor || 0;
        if (dir === 'down') {
            if (!p.bossDefeated || !p.bossDefeated[currentFloor]) { socket.emit('terminalError', 'ЛИФТ НЕ АКТИВИРОВАН.'); return; }
            if (currentFloor >= 30) { socket.emit('terminalError', 'ДНО ГИГАХРУЩЕВКИ.'); return; }
            p.floor = currentFloor + 1;
            p.maxFloor = Math.max(p.maxFloor || 0, p.floor);
            p.location = 'A0';
            if (!p.unlockedSectors[p.floor]) p.unlockedSectors[p.floor] = ['A0'];
            p.notebook.push(`[ЭТАЖ ${p.floor}]: Лифт опустился на этаж ${p.floor}.`);
            checkPlayerAchievements(p, socket);
            generateFloor(p.floor); saveDB(); socket.emit('transition', {to: 'map', text: `СПУСК НА ЭТАЖ ${p.floor}...`}); broadcastGameState();
        } else if (dir === 'up') {
            if (currentFloor <= 0) { socket.emit('terminalError', 'ЭТО ВЕРХНИЙ ЭТАЖ.'); return; }
            p.floor = currentFloor - 1;
            p.location = 'E4';
            if (!p.unlockedSectors[p.floor]) p.unlockedSectors[p.floor] = ['A0'];
            generateFloor(p.floor); saveDB(); socket.emit('transition', {to: 'map', text: `ПОДЪЕМ НА ЭТАЖ ${p.floor}...`}); broadcastGameState();
        }
    });

    socket.on('selectFloor', (targetFloor) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        let tf = parseInt(targetFloor, 10);
        let maxAllowed = Math.max(p.maxFloor || 0, p.floor || 0);
        if (isNaN(tf) || tf < 0 || tf > maxAllowed) {
            socket.emit('terminalError', 'ЭТАЖ ЗАБЛОКИРОВАН.');
            return;
        }
        p.floor = tf;
        p.maxFloor = Math.max(p.maxFloor || 0, tf);
        if (!p.unlockedSectors[p.floor]) p.unlockedSectors[p.floor] = ['A0'];
        if (p.location !== 'safe_room') {
            p.location = 'A0';
        }
        generateFloor(p.floor);
        saveDB();
        socket.emit('transition', { to: 'map', text: `ПЕРЕХОД НА ЭТАЖ ${p.floor}...` });
        broadcastGameState();
    });

    socket.on('buyItem', (itemId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        let item = GAME_ITEMS[itemId];
        if (item && p.talons >= item.cost && currentShopItems.includes(itemId)) {
            if (item.reqLevel && p.level < item.reqLevel) {
                socket.emit('terminalError', `ТРЕБУЕТСЯ УРОВЕНЬ ${item.reqLevel}!`);
                socket.emit('playSound', 'defeat');
                return;
            }
            if (p.inventory.length >= getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
            p.talons -= item.cost; p.inventory.push(itemId); socket.emit('playSound', 'buy'); socket.emit('terminalError', `ПОЛУЧЕНО: ${item.name}`); saveDB(); broadcastGameState();
        }
    });

    // ===== ПРОДАЖА (материалы, экипировка, припасы) =====
    socket.on('sellItem', (invIndex) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!p.inventory[invIndex]) return;
        let itemId = p.inventory[invIndex]; let itemData = GAME_ITEMS[itemId]; if (!itemData) return;
        if (itemData.type === 'quest') { socket.emit('terminalError', 'КВЕСТОВЫЙ ПРЕДМЕТ НЕЛЬЗЯ СДАТЬ.'); return; }
        let price = Math.max(1, Math.floor((itemData.cost || 5) * 0.4));
        if (itemData.type === 'material') {
            price = Math.max(2, Math.floor((itemData.cost || 5) * 0.5));
        }
        p.inventory.splice(invIndex, 1); p.talons = (p.talons || 0) + price;
        socket.emit('playSound', 'buy'); socket.emit('terminalError', `СДАНО: ${itemData.name} (+${price} т.)`);
        saveDB(); broadcastGameState();
    });

    // ===== БАРАХОЛКА ЗАКЛЮЧЕННЫХ (РЫНОК ИГРОКОВ) =====
    socket.on('listMarketItem', (data) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p, username } = auth;
        if (!data || data.invIndex === undefined) return;
        let invIndex = parseInt(data.invIndex, 10);
        let price = parseInt(data.price, 10);
        if (isNaN(invIndex) || !p.inventory || !p.inventory[invIndex]) {
            socket.emit('terminalError', 'ПРЕДМЕТ НЕ НАЙДЕН В РЮКЗАКЕ.');
            return;
        }
        if (isNaN(price) || price < 1 || price > 1000000) {
            socket.emit('terminalError', 'УКАЖИТЕ ЦЕНУ ОТ 1 ДО 1 000 000 ТАЛОНОВ.');
            socket.emit('playSound', 'defeat');
            return;
        }

        let itemId = p.inventory[invIndex];
        let itemData = GAME_ITEMS[itemId];
        if (!itemData || itemData.type === 'quest') {
            socket.emit('terminalError', 'ЭТОТ ПРЕДМЕТ НЕЛЬЗЯ ВЫСТАВИТЬ НА БАРАХОЛКУ.');
            socket.emit('playSound', 'defeat');
            return;
        }

        if (!Array.isArray(db.fleaMarket)) db.fleaMarket = [];
        let userLots = db.fleaMarket.filter(l => l.seller === username);
        if (userLots.length >= 12) {
            socket.emit('terminalError', 'ЛИМИТ ЛОТОВ: МАКСИМУМ 12 ОДНОВРЕМЕННО.');
            socket.emit('playSound', 'defeat');
            return;
        }

        p.inventory.splice(invIndex, 1);
        let lotId = 'lot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        db.fleaMarket.unshift({
            id: lotId,
            seller: username,
            sellerTitle: p.title || 'Заключенный',
            sellerLevel: p.level || 1,
            itemId: itemId,
            price: price,
            createdAt: Date.now()
        });

        if (!p.notebook) p.notebook = [];
        p.notebook.push(`[БАРАХОЛКА]: Выставил на продажу «${itemData.name}» за ${price} талонов.`);
        socket.emit('playSound', 'equip');
        socket.emit('terminalError', `ЛОТ «${itemData.name}» ВЫСТАВЛЕН НА БАРАХОЛКУ (+${price} т.)!`);
        saveDB();
        broadcastGameState();
    });

    socket.on('buyMarketItem', (lotId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p, username } = auth;
        if (!lotId || !Array.isArray(db.fleaMarket)) return;

        let lotIdx = db.fleaMarket.findIndex(l => l.id === lotId);
        if (lotIdx === -1) {
            socket.emit('terminalError', 'ЛОТ УЖЕ КУПЛЕН ИЛИ СНЯТ.');
            socket.emit('playSound', 'defeat');
            broadcastGameState();
            return;
        }

        let lot = db.fleaMarket[lotIdx];
        if (lot.seller === username) {
            socket.emit('terminalError', 'ВЫ НЕ МОЖЕТЕ КУПИТЬ СВОЙ СОБСТВЕННЫЙ ЛОТ.');
            return;
        }

        if (p.inventory.length >= getMaxInv(p)) {
            socket.emit('terminalError', 'СУНДУК ПОЛОН! НЕТ МЕСТА В РЮКЗАКЕ.');
            socket.emit('playSound', 'defeat');
            return;
        }

        if ((p.talons || 0) < lot.price) {
            socket.emit('terminalError', `НЕ ХВАТАЕТ ТАЛОНОВ! ЦЕНА: ${lot.price}`);
            socket.emit('playSound', 'defeat');
            return;
        }

        let itemData = GAME_ITEMS[lot.itemId];
        if (!itemData) {
            db.fleaMarket.splice(lotIdx, 1);
            saveDB();
            broadcastGameState();
            return;
        }

        // Оплата и передача товара покупателю
        p.talons -= lot.price;
        p.inventory.push(lot.itemId);
        db.fleaMarket.splice(lotIdx, 1);

        if (!p.notebook) p.notebook = [];
        p.notebook.push(`[БАРАХОЛКА]: Купил лот «${itemData.name}» у ${lot.seller} за ${lot.price} талонов.`);

        // Зачисление талонов продавцу (даже если он оффлайн)
        let sellerUser = db.players[lot.seller];
        if (sellerUser) {
            sellerUser.talons = (sellerUser.talons || 0) + lot.price;
            if (!sellerUser.notebook) sellerUser.notebook = [];
            sellerUser.notebook.push(`[БАРАХОЛКА]: Заключенный ${username} купил ваш лот «${itemData.name}» (+${lot.price} талонов)!`);

            let sellerSocketId = Object.keys(onlinePlayers).find(k => onlinePlayers[k] === lot.seller);
            if (sellerSocketId) {
                io.to(sellerSocketId).emit('terminalError', `ВАШ ЛОТ «${itemData.name}» КУПЛЕН ИГРОКОМ ${username}! (+${lot.price} ТАЛОНОВ)`);
                io.to(sellerSocketId).emit('playSound', 'buy');
            }
        }

        socket.emit('playSound', 'buy');
        socket.emit('terminalError', `КУПЛЕНО: «${itemData.name}» ЗА ${lot.price} ТАЛОНОВ!`);
        checkPlayerAchievements(p, socket);
        saveDB();
        broadcastGameState();
    });

    socket.on('cancelMarketItem', (lotId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p, username } = auth;
        if (!lotId || !Array.isArray(db.fleaMarket)) return;

        let lotIdx = db.fleaMarket.findIndex(l => l.id === lotId && l.seller === username);
        if (lotIdx === -1) {
            socket.emit('terminalError', 'ЛОТ НЕ НАЙДЕН ИЛИ НЕ ПРИНАДЛЕЖИТ ВАМ.');
            return;
        }

        let lot = db.fleaMarket[lotIdx];
        let itemData = GAME_ITEMS[lot.itemId];

        if (p.inventory.length < getMaxInv(p)) {
            p.inventory.push(lot.itemId);
        } else if (p.location === 'safe_room' && (p.storage || []).length < 40) {
            p.storage = p.storage || [];
            p.storage.push(lot.itemId);
            socket.emit('terminalError', `РЮКЗАК ПОЛОН! ПРЕДМЕТ ВЕРНУЛСЯ НА СКЛАД БАЗЫ.`);
        } else {
            socket.emit('terminalError', 'НЕТ СВОБОДНОГО МЕСТА В РЮКЗАКЕ ЧТОБЫ СНЯТЬ ЛОТ!');
            socket.emit('playSound', 'defeat');
            return;
        }

        db.fleaMarket.splice(lotIdx, 1);
        socket.emit('playSound', 'equip');
        socket.emit('terminalError', `ЛОТ «${itemData ? itemData.name : lot.itemId}» СНЯТ С ПРОДАЖИ.`);
        saveDB();
        broadcastGameState();
    });

    socket.on('dropItem', (invIndex) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!p.inventory[invIndex]) return;
        p.inventory.splice(invIndex, 1); socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
    });

    // ===== СКЛАД БАЗЫ (ЖИЛЯЧЕЙКА) =====
    socket.on('moveToStorage', (invIndex) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (p.location !== 'safe_room') { socket.emit('terminalError', 'СКЛАД ДОСТУПЕН ТОЛЬКО В ЖИЛЯЧЕЙКЕ.'); return; }
        if (!p.inventory[invIndex]) return;
        p.storage = p.storage || [];
        if (p.storage.length >= 40) { socket.emit('terminalError', 'СКЛАД БАЗЫ ПОЛОН (МАКС. 40).'); return; }
        let item = p.inventory.splice(invIndex, 1)[0];
        p.storage.push(item);
        socket.emit('playSound', 'equip');
        saveDB(); broadcastGameState();
    });

    socket.on('moveFromStorage', (storageIndex) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (p.location !== 'safe_room') { socket.emit('terminalError', 'СКЛАД ДОСТУПЕН ТОЛЬКО В ЖИЛЯЧЕЙКЕ.'); return; }
        p.storage = p.storage || [];
        if (!p.storage[storageIndex]) return;
        if (p.inventory.length >= getMaxInv(p)) { socket.emit('terminalError', 'РЮКЗАК ПОЛОН!'); return; }
        let item = p.storage.splice(storageIndex, 1)[0];
        p.inventory.push(item);
        socket.emit('playSound', 'equip');
        saveDB(); broadcastGameState();
    });

    socket.on('dropStorageItem', (storageIndex) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (p.location !== 'safe_room') return;
        p.storage = p.storage || [];
        if (!p.storage[storageIndex]) return;
        p.storage.splice(storageIndex, 1);
        socket.emit('playSound', 'equip');
        saveDB(); broadcastGameState();
    });

    socket.on('equipItem', (invIndex) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!p.inventory[invIndex]) return;
        let itemId = p.inventory[invIndex]; let itemData = GAME_ITEMS[itemId];
        if (itemData && (itemData.type === 'weapon' || itemData.type === 'clothes' || itemData.type === 'mask' || itemData.type === 'backpack')) {
            if (itemData.reqLevel && p.level < itemData.reqLevel) { socket.emit('terminalError', `НУЖЕН УРОВЕНЬ ${itemData.reqLevel}`); socket.emit('playSound', 'defeat'); return; }
            if (p.equipment[itemData.type]) p.inventory.push(p.equipment[itemData.type]);
            p.equipment[itemData.type] = itemId; p.inventory.splice(invIndex, 1);
            if (p.inventory.length > getMaxInv(p)) { socket.emit('terminalError', `ПРЕВЫШЕН ЛИМИТ ВЕСА!`); }
            checkPlayerAchievements(p, socket);
            socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
        }
    });

    socket.on('unequipItem', (slot) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!p.equipment[slot]) return;
        if (p.inventory.length >= getMaxInv(p) && slot !== 'backpack') { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
        p.inventory.push(p.equipment[slot]); p.equipment[slot] = null;
        socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
    });

    // ===== БЫСТРЫЕ СЛОТЫ (пояс) — было пропущено =====
    socket.on('setQuickSlot', (data) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!data) return;
        let { invIndex, slotIndex } = data;
        if (!p.inventory[invIndex]) return;
        let itemId = p.inventory[invIndex]; let itemData = GAME_ITEMS[itemId]; if (!itemData) return;
        if (itemData.type !== 'consumable' && itemData.type !== 'special' && !itemData.isCure) {
            socket.emit('terminalError', 'ЭТОТ ПРЕДМЕТ НЕЛЬЗЯ ПОЛОЖИТЬ НА ПОЯС.'); return;
        }
        if (!p.quickSlots) p.quickSlots = [null, null];
        if (p.quickSlots[slotIndex]) {
            if (p.inventory.length >= getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПОЛОН.'); return; }
            p.inventory.push(p.quickSlots[slotIndex]);
        }
        p.quickSlots[slotIndex] = itemId; p.inventory.splice(invIndex, 1);
        socket.emit('playSound', 'equip'); socket.emit('terminalError', `НА ПОЯС: ${itemData.name}`);
        saveDB(); broadcastGameState();
    });

    socket.on('unequipQuickSlot', (idx) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!p.quickSlots) p.quickSlots = [null, null];
        if (p.quickSlots[idx]) {
            if (p.inventory.length >= getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
            p.inventory.push(p.quickSlots[idx]); p.quickSlots[idx] = null;
            socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
        }
    });

    socket.on('useQuickSlot', (idx) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let combat = activeCombats[username];
        if (!p.quickSlots || !p.quickSlots[idx]) return;
        let itemId = p.quickSlots[idx]; let itemData = GAME_ITEMS[itemId]; if (!itemData) return;
        if (itemData.type === 'consumable') {
            p.filter = Math.min(100, p.filter + (itemData.restoreFilter||0));
            p.hp = Math.min(p.maxHp, p.hp + (itemData.restoreHp||0));
            p.hunger = Math.min(100, p.hunger + (itemData.restoreHunger||0));
            p.quickSlots[idx] = null;
            if (combat) { combat.logs.push(`> ПРИМЕНЕНО: ${itemData.name}.`); combat.sounds.push('heal'); combat.vfx.push('heal'); }
            else { socket.emit('terminalError', `ИСПОЛЬЗОВАНО: ${itemData.name}`); socket.emit('playSound', 'heal'); socket.emit('vfxHeal'); }
            saveDB(); broadcastGameState();
        } else if (itemData.type === 'special' && combat) {
            let dmg = itemData.combatDmg || 30;
            if (combat.isGlobal) {
                let bossKey = (typeof combat.floor === 'string' && combat.floor.startsWith('coop_')) ? combat.floor : `boss_${combat.floor}`;
                let gb = globalBosses[bossKey];
                if (gb) gb.hp -= dmg;
            } else if (combat.isPvP) {
                let opponent = combat.opponent;
                let po = db.players[opponent];
                let oppCombat = activeCombats[opponent];
                if (po) po.hp -= dmg;
                if (oppCombat) {
                    oppCombat.logs.push(`> [ДУЭЛЬ] ${username} применил спецсредство ${itemData.name}: -${dmg} HP!`);
                    oppCombat.sounds.push('hit_enemy');
                    oppCombat.vfx.push('player_hit');
                }
            } else if (combat.enemy) {
                combat.enemy.hp -= dmg;
            }
            combat.logs.push(`> БРОШЕНО: ${itemData.name}! Урон: ${dmg}.`);
            combat.sounds.push('special'); combat.vfx.push('enemy_crit');
            p.quickSlots[idx] = null;
            saveDB(); broadcastGameState();
        }
    });

    socket.on('useItem', (invIndex) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let combat = activeCombats[username];
        if (!p.inventory[invIndex]) return;
        let itemData = GAME_ITEMS[p.inventory[invIndex]];
        if (itemData && itemData.type === 'consumable') {
            p.filter = Math.min(100, p.filter + (itemData.restoreFilter||0));
            p.hp = Math.min(p.maxHp, p.hp + (itemData.restoreHp||0));
            p.hunger = Math.min(100, p.hunger + (itemData.restoreHunger||0));
            p.inventory.splice(invIndex, 1);
            if (combat) { combat.logs.push(`> ПРИМЕНЕНО: ${itemData.name}.`); combat.sounds.push('heal'); combat.vfx.push('heal'); }
            else { socket.emit('terminalError', `ИСПОЛЬЗОВАНО: ${itemData.name}`); socket.emit('playSound', 'heal'); socket.emit('vfxHeal'); }
            saveDB(); broadcastGameState();
        } else if (itemData && itemData.isCure) {
            p.tox = Math.max(0, p.tox - 50); p.inventory.splice(invIndex, 1);
            socket.emit('terminalError', `ЗАРАЖЕНИЕ СНИЖЕНО!`); socket.emit('playSound', 'heal'); socket.emit('vfxHeal');
            saveDB(); broadcastGameState();
        }
    });

    socket.on('modWeapon', (data) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!data) return;
        let { wIdx, mIdx } = data;
        if (!p.inventory[wIdx] || !p.inventory[mIdx]) return;
        let wId = p.inventory[wIdx]; let matId = p.inventory[mIdx];
        let wData = GAME_ITEMS[wId]; let mData = GAME_ITEMS[matId];
        if (wData.type !== 'weapon' || mData.type !== 'material') return;
        if (wData.isFire || wData.isElectro || wData.isBleed) { socket.emit('terminalError', 'УЖЕ МОДИФИЦИРОВАНО!'); return; }
        let el = '';
        if (matId === 'mat_chem') el = '_fire';
        else if (matId === 'mat_electro') el = '_electro';
        else if (matId === 'mat_scrap') el = '_bleed';
        else { socket.emit('terminalError', 'НЕПОДХОДЯЩИЙ МАТЕРИАЛ.'); return; }
        let newWId = wId + el;
        if (GAME_ITEMS[newWId]) {
            p.inventory.splice(Math.max(wIdx, mIdx), 1); p.inventory.splice(Math.min(wIdx, mIdx), 1);
            p.inventory.push(newWId);
            socket.emit('terminalError', `МОДИФИКАЦИЯ: ${GAME_ITEMS[newWId].name}!`); socket.emit('playSound', 'equip');
            saveDB(); broadcastGameState();
        }
    });

    // ===== МОДЕРНИЗАЦИЯ БРОНИ И ПРОТИВОГАЗОВ В ВЕРСТАКЕ (ПОГЛОЩЕНИЕ ДОНОРСКОЙ ОДЕЖДЫ) =====
    socket.on('upgradeGear', (data) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        if (!data) return;
        let { targetIdx, donorIdx, type } = data; // type: 'clothes' | 'mask'
        if (typeof targetIdx !== 'number' || typeof donorIdx !== 'number') return;
        if (targetIdx === donorIdx) {
            socket.emit('terminalError', 'НЕЛЬЗЯ ВЫБРАТЬ ОДИН И ТОТ ЖЕ ПРЕДМЕТ!');
            return;
        }
        if (!p.inventory[targetIdx] || !p.inventory[donorIdx]) {
            socket.emit('terminalError', 'ПРЕДМЕТЫ НЕ НАЙДЕНЫ В ИНВЕНТАРЕ!');
            return;
        }

        let targetId = p.inventory[targetIdx];
        let donorId = p.inventory[donorIdx];
        let targetItem = GAME_ITEMS[targetId];
        let donorItem = GAME_ITEMS[donorId];

        if (!targetItem || !donorItem) return;

        // Проверяем тип улучшаемого предмета
        if (type === 'clothes' && targetItem.type !== 'clothes') {
            socket.emit('terminalError', 'ОСНОВНОЙ ПРЕДМЕТ ДОЛЖЕН БЫТЬ ОДЕЖДОЙ/БРОНЕЙ!');
            return;
        }
        if (type === 'mask' && targetItem.type !== 'mask') {
            socket.emit('terminalError', 'ОСНОВНОЙ ПРЕДМЕТ ДОЛЖЕН БЫТЬ ПРОТИВОГАЗОМ/МАСКОЙ!');
            return;
        }

        // В верстак на разбор/ткань ОБЯЗАТЕЛЬНО вкладывается другая одежда (или маска)
        if (donorItem.type !== 'clothes' && donorItem.type !== 'mask') {
            socket.emit('terminalError', 'В КАЧЕСТВЕ МАТЕРИАЛА НЕОБХОДИМО ВЛОЖИТЬ ОДЕЖДУ!');
            return;
        }

        // Прогрессия рангов редкости: common -> uncommon -> rare -> epic -> legendary
        const RARITY_ORDER = ['', 'uncommon', 'rare', 'epic', 'legendary'];
        let baseId = targetId;
        let currentRarity = '';
        for (let r of ['_legendary', '_epic', '_rare', '_uncommon']) {
            if (targetId.endsWith(r)) {
                currentRarity = r.slice(1);
                baseId = targetId.slice(0, -r.length);
                break;
            }
        }

        let curRarityIdx = RARITY_ORDER.indexOf(currentRarity);
        if (curRarityIdx === -1 || curRarityIdx >= RARITY_ORDER.length - 1) {
            socket.emit('terminalError', 'ЭКИПИРОВКА УЖЕ МАКСИМАЛЬНОГО РАНГА (ЛЕГЕНДАРНЫЙ)!');
            return;
        }

        let nextRarity = RARITY_ORDER[curRarityIdx + 1];
        let nextId = nextRarity === '' ? baseId : `${baseId}_${nextRarity}`;

        if (!GAME_ITEMS[nextId]) {
            socket.emit('terminalError', 'ОШИБКА: РЕЦЕПТ МОДЕРНИЗАЦИИ НЕ НАЙДЕН.');
            return;
        }

        let upgradedItem = GAME_ITEMS[nextId];
        let highIdx = Math.max(targetIdx, donorIdx);
        let lowIdx = Math.min(targetIdx, donorIdx);
        p.inventory.splice(highIdx, 1);
        p.inventory.splice(lowIdx, 1);
        p.inventory.push(nextId);

        socket.emit('playSound', 'equip');
        socket.emit('terminalError', `⚙️ УЛУЧШЕНО: ${upgradedItem.name}! Защита: ${upgradedItem.def} DEF.`);
        saveDB();
        broadcastGameState();
    });

    // ===== МОДЕРНИЗАЦИЯ ВЕРСТАКА И КРАФТ =====
    socket.on('upgradeWorkbench', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        p.workbenchLevel = p.workbenchLevel || 1;
        if (p.workbenchLevel >= 5) {
            socket.emit('terminalError', 'ВЕРСТАК УЖЕ МАКСИМАЛЬНОГО УРОВНЯ (УР. 5)!');
            return;
        }
        let cost = Math.floor(2500 * Math.pow(2, p.workbenchLevel - 1));
        if ((p.talons || 0) < cost) {
            socket.emit('terminalError', `НЕДОСТАТОЧНО ТАЛОНОВ! ТРЕБУЕТСЯ: ${cost} ТАЛОНОВ.`);
            return;
        }
        p.talons -= cost;
        p.workbenchLevel++;
        socket.emit('playSound', 'equip');
        socket.emit('terminalError', `⚙️ ВЕРСТАК МОДЕРНИЗИРОВАН ДО УРОВНЯ ${p.workbenchLevel}!`);
        saveDB();
        broadcastGameState();
    });

    socket.on('craftItem', (itemId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        p.workbenchLevel = p.workbenchLevel || 1;
        const RECIPES = {
            // Уровень 1 (Базовый)
            weapon_pipe: { reqLvl: 1, reqs: ['mat_scrap', 'mat_tape'] },
            food_medkit: { reqLvl: 1, reqs: ['mat_chem', 'food_ration'] },
            special_shocker: { reqLvl: 1, reqs: ['mat_electro', 'mat_scrap'] },
            tool_robot: { reqLvl: 1, reqs: ['mat_electro', 'mat_scrap', 'mat_tape'] },

            // Уровень 2 (Модернизация за 2500 талонов)
            weapon_crowbar: { reqLvl: 2, reqs: ['mat_scrap', 'mat_scrap', 'mat_tape'] },
            special_knife: { reqLvl: 2, reqs: ['mat_scrap', 'mat_tape'] },
            backpack_small: { reqLvl: 2, reqs: ['mat_scrap', 'mat_scrap', 'mat_tape', 'mat_tape'] },

            // Уровень 3 (Модернизация за 5000 талонов)
            weapon_axe: { reqLvl: 3, reqs: ['mat_scrap', 'mat_scrap', 'mat_scrap', 'mat_tape'] },
            food_pure: { reqLvl: 3, reqs: ['food_ration', 'food_ration', 'mat_chem'] },
            backpack_med: { reqLvl: 3, reqs: ['mat_scrap', 'mat_scrap', 'mat_chem', 'mat_tape', 'mat_tape'] },

            // Уровень 4 (Модернизация за 10000 талонов)
            weapon_shotgun: { reqLvl: 4, reqs: ['mat_scrap', 'mat_scrap', 'mat_electro', 'mat_electro', 'mat_tape'] },
            special_grenade: { reqLvl: 4, reqs: ['mat_scrap', 'mat_chem', 'mat_electro'] },
            backpack_large: { reqLvl: 4, reqs: ['mat_scrap', 'mat_scrap', 'mat_electro', 'mat_electro', 'mat_tape', 'mat_tape'] },

            // Уровень 5 (Модернизация за 20000 талонов)
            weapon_flamethrower: { reqLvl: 5, reqs: ['mat_scrap', 'mat_chem', 'mat_chem', 'mat_electro', 'mat_electro', 'mat_tape'] },
            clothes_liquidator: { reqLvl: 5, reqs: ['mat_chem', 'mat_chem', 'mat_scrap', 'mat_scrap', 'mat_electro', 'mat_tape'] }
        };
        let recipe = RECIPES[itemId];
        if (!recipe) { socket.emit('terminalError', 'РЕЦЕПТ НЕ НАЙДЕН.'); return; }
        if (p.workbenchLevel < recipe.reqLvl) {
            socket.emit('terminalError', `ТРЕБУЕТСЯ ВЕРСТАК УРОВНЯ ${recipe.reqLvl}!`);
            return;
        }
        let tempInv = [...p.inventory];
        let tempStorage = [...(p.storage || [])];
        let takeFromInv = [];
        let takeFromStorage = [];

        for (let ing of recipe.reqs) {
            let idxInv = tempInv.indexOf(ing);
            if (idxInv !== -1) {
                tempInv.splice(idxInv, 1);
                takeFromInv.push(ing);
            } else {
                let idxStorage = tempStorage.indexOf(ing);
                if (idxStorage !== -1) {
                    tempStorage.splice(idxStorage, 1);
                    takeFromStorage.push(ing);
                } else {
                    let name = GAME_ITEMS[ing] ? GAME_ITEMS[ing].name : ing;
                    socket.emit('terminalError', `НУЖНО: ${name}`);
                    return;
                }
            }
        }
        if (p.inventory.length - takeFromInv.length + 1 > getMaxInv(p)) {
            socket.emit('terminalError', 'РЮКЗАК ПЕРЕПОЛНЕН.');
            return;
        }
        for (let ing of takeFromInv) {
            let idx = p.inventory.indexOf(ing);
            if (idx !== -1) p.inventory.splice(idx, 1);
        }
        for (let ing of takeFromStorage) {
            p.storage = p.storage || [];
            let idx = p.storage.indexOf(ing);
            if (idx !== -1) p.storage.splice(idx, 1);
        }
        p.inventory.push(itemId);
        socket.emit('playSound', 'equip');
        socket.emit('terminalError', `СОБРАНО: ${GAME_ITEMS[itemId] ? GAME_ITEMS[itemId].name : itemId}`);
        saveDB();
        broadcastGameState();
    });

    // ===== ФАРМ СЛИЗИ (было пропущено) =====
    socket.on('work', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        if (activeCombats[username]) { socket.emit('terminalError', 'В БОЮ НЕЛЬЗЯ ФАРМИТЬ.'); return; }
        let now = Date.now();
        if (now - lastWorkTime < 250) return;
        lastWorkTime = now;
        let farmAmount = 1;
        if (p.inventory) {
            if (p.inventory.includes('tool_scraper')) farmAmount = 2;
            if (p.inventory.includes('tool_pump')) farmAmount = 4;
            if (p.inventory.includes('tool_harvester')) farmAmount = 8;
        }
        if (p.inventory.length + farmAmount > getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
        for (let i = 0; i < farmAmount; i++) p.inventory.push('food_ration');
        p.hunger = Math.max(0, p.hunger - 1);
        socket.emit('playSound', 'farm'); socket.emit('vfxFarm', farmAmount);
        socket.emit('terminalError', `+${farmAmount} СЛИЗЬ`);
        saveDB(); broadcastGameState();
    });

    // ===== РОБОТЫ (было пропущено) =====
    socket.on('installRobot', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        let idx = p.inventory.indexOf('tool_robot');
        if (idx === -1) { socket.emit('terminalError', 'НЕТ АВТОСБОРЩИКА В СУНДУКЕ.'); return; }
        let currentFloor = p.floor || 0;
        let locKey = `${currentFloor}_${p.location}`;
        p.inventory.splice(idx, 1); p.robots[locKey] = 0;
        socket.emit('playSound', 'equip'); socket.emit('terminalError', 'АВТОСБОРЩИК УСТАНОВЛЕН.');
        saveDB(); broadcastGameState();
    });
    socket.on('collectRobot', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { p } = auth;
        let currentFloor = p.floor || 0;
        let locKey = `${currentFloor}_${p.location}`;
        if (p.robots[locKey] === undefined) return;
        let amount = p.robots[locKey];
        if (amount <= 0) { socket.emit('terminalError', 'РОБОТ ПУСТ.'); return; }
        p.robots[locKey] = 0;
        p.talons = (p.talons || 0) + amount;
        let addedSlime = false;
        if (p.inventory.length < getMaxInv(p)) {
            p.inventory.push('food_ration');
            addedSlime = true;
        }
        socket.emit('playSound', 'buy');
        if (addedSlime) {
            socket.emit('terminalError', `СОБРАНО: +${amount} ТАЛОНОВ, +1 СЛИЗЬ`);
        } else {
            socket.emit('terminalError', `СОБРАНО: +${amount} ТАЛОНОВ`);
        }
        saveDB(); broadcastGameState();
    });

    // ===== PVP / COOP СИСТЕМА =====
    socket.on('pvpBattleStart', (targetId) => {
        let attacker = onlinePlayers[socket.id];
        let defender = onlinePlayers[targetId];
        if (!attacker || !defender || attacker === defender) return;
        let pa = db.players[attacker];
        let pd = db.players[defender];
        if (!pa || !pd) return;
        if (pa.location !== pd.location || (pa.floor || 0) !== (pd.floor || 0)) return;
        if (pa.location === 'safe_room') { socket.emit('terminalError', 'В ЖИЛЯЧЕЙКЕ НЕЛЬЗЯ НАПАДАТЬ.'); return; }
        if (activeCombats[attacker] || activeCombats[defender]) { socket.emit('terminalError', 'ОДИН ИЗ ИГРОКОВ УЖЕ В БОЮ.'); return; }
        if (pa.hp <= 0 || pd.hp <= 0) { socket.emit('terminalError', 'ИГРОК БЕЗ СОЗНАНИЯ.'); return; }

        let now = Date.now();
        if (now - lastPvpTime < 2000) { socket.emit('terminalError', 'ОЖИДАНИЕ ДУЭЛИ (2 сек).'); return; }
        lastPvpTime = now;

        let pvpCombatAttacker = {
            isPvP: true,
            floor: pa.floor || 0,
            opponent: defender,
            oppSocket: targetId,
            pTimer: 2.0 / getSpeedMult(pa.filter),
            pDodging: false,
            pCritNext: false,
            logs: [`> ВЫ НАПАЛИ НА ЗАКЛЮЧЕННОГО ${defender}!`],
            sounds: ['roar'],
            vfx: []
        };
        let pvpCombatDefender = {
            isPvP: true,
            floor: pd.floor || 0,
            opponent: attacker,
            oppSocket: socket.id,
            pTimer: 2.0 / getSpeedMult(pd.filter),
            pDodging: false,
            pCritNext: false,
            logs: [`> ТРЕВОГА! НА ВАС НАПАЛ ${attacker}!`],
            sounds: ['roar'],
            vfx: []
        };

        activeCombats[attacker] = pvpCombatAttacker;
        activeCombats[defender] = pvpCombatDefender;

        socket.emit('transition', { to: 'combat', text: `ДУЭЛЬ: ВЫ АТАКОВАЛИ ${defender}!` });
        io.to(targetId).emit('transition', { to: 'combat', text: `НАПАДЕНИЕ: ВАС АТАКОВАЛ ${attacker}!` });

        setTimeout(() => {
            let currentPa = db.players[attacker];
            let currentPd = db.players[defender];
            if (!currentPa || !currentPd) return;
            socket.emit('combatStart', {
                enemy: {
                    name: `[ЗАКЛЮЧЕННЫЙ] ${defender}`,
                    hp: currentPd.hp,
                    maxHp: currentPd.maxHp,
                    dmg: getPlayerStats(currentPd).dmg,
                    isPlayer: true,
                    skin: currentPd.appearance ? currentPd.appearance.skin : 'skin_1',
                    equipment: currentPd.equipment || {}
                }
            });
            io.to(targetId).emit('combatStart', {
                enemy: {
                    name: `[ЗАКЛЮЧЕННЫЙ] ${attacker}`,
                    hp: currentPa.hp,
                    maxHp: currentPa.maxHp,
                    dmg: getPlayerStats(currentPa).dmg,
                    isPlayer: true,
                    skin: currentPa.appearance ? currentPa.appearance.skin : 'skin_1',
                    equipment: currentPa.equipment || {}
                }
            });
            broadcastGameState();
        }, 1200);
    });

    socket.on('coopRaidInvite', (targetId) => {
        let inviter = onlinePlayers[socket.id];
        let target = onlinePlayers[targetId];
        if (!inviter || !target || inviter === target) return;
        let pi = db.players[inviter];
        let pt = db.players[target];
        if (!pi || !pt || pi.location !== pt.location || (pi.floor || 0) !== (pt.floor || 0)) return;
        if (activeCombats[inviter] || activeCombats[target]) { socket.emit('terminalError', 'КТО-ТО УЖЕ В БОЮ.'); return; }
        if (pi.filter < 10 || pt.filter < 10) { socket.emit('terminalError', 'НЕДОСТАТОЧНО ФИЛЬТРА ДЛЯ ВЫЛАЗКИ.'); return; }

        socket.emit('terminalError', `ПРИГЛАШЕНИЕ В РЕЙД ОТПРАВЛЕНО ${target}...`);
        io.to(targetId).emit('coopRaidInvitePrompt', { fromId: socket.id, fromUser: inviter });
    });

    socket.on('acceptCoopRaid', (inviterSocketId) => {
        let accepter = onlinePlayers[socket.id];
        let inviter = onlinePlayers[inviterSocketId];
        if (!accepter || !inviter) return;
        let pa = db.players[accepter];
        let pi = db.players[inviter];
        if (!pa || !pi || pa.location !== pi.location || (pa.floor || 0) !== (pi.floor || 0)) return;
        if (activeCombats[accepter] || activeCombats[inviter]) return;
        if (pa.filter < 10 || pi.filter < 10) return;

        let currentFloor = pa.floor || 0;
        pa.filter -= 10;
        pi.filter -= 10;

        let isFloorBoss = (pa.location === 'E4');
        let raidKey = isFloorBoss ? `boss_${currentFloor}` : `coop_${Date.now()}`;
        let monster;

        if (isFloorBoss) {
            let bossBase = getBossForFloor(currentFloor);
            let coopHpMult = 2.0;
            let coopDmgMult = 1.3;
            monster = {
                name: `[РЕЙД x2] ${bossBase.name}`,
                hp: Math.floor(bossBase.hp * coopHpMult),
                maxHp: Math.floor(bossBase.hp * coopHpMult),
                dmg: Math.floor(bossBase.dmg * coopDmgMult),
                reward: Math.floor(bossBase.reward * 1.5),
                xp: Math.floor(bossBase.xp * 1.5),
                img: bossBase.img,
                isElevatorBoss: true,
                lore: bossBase.lore,
                isCoopRaid: true,
                isScaledForCoop: true,
                loot: [
                    { id: rollItemWithRarity('food_medkit'), chance: 0.8 },
                    { id: rollItemWithRarity('mat_chem'), chance: 0.7 },
                    { id: rollItemWithRarity('mat_electro'), chance: 0.6 }
                ]
            };
        } else {
            let possibleMonsters = BASE_MONSTERS.filter(m => currentFloor >= m.minFloor && currentFloor <= m.minFloor + 10);
            if (possibleMonsters.length === 0) possibleMonsters = [BASE_MONSTERS[BASE_MONSTERS.length - 1]];
            let baseMob = Object.assign({}, possibleMonsters[Math.floor(Math.random() * possibleMonsters.length)]);
            let multiplier = (1 + (currentFloor * 0.4)) * 3.0;
            let coopHpMult = 2.0;
            let coopDmgMult = 1.3;
            monster = {
                name: `[РЕЙД x2] ${baseMob.name} [Lvl ${currentFloor + 1}]`,
                hp: Math.floor(baseMob.hp * multiplier * coopHpMult),
                maxHp: Math.floor(baseMob.hp * multiplier * coopHpMult),
                dmg: Math.floor(baseMob.dmg * (1 + currentFloor * 0.3) * coopDmgMult),
                reward: Math.floor(baseMob.reward * multiplier * 1.5),
                xp: Math.floor(baseMob.xp * multiplier * 1.5),
                img: baseMob.img,
                isCoopRaid: true,
                isScaledForCoop: true,
                loot: [
                    { id: rollItemWithRarity('food_medkit'), chance: 0.7 },
                    { id: rollItemWithRarity('mat_chem'), chance: 0.6 },
                    { id: rollItemWithRarity('mat_electro'), chance: 0.5 }
                ]
            };
        }

        globalBosses[raidKey] = {
            name: monster.name,
            hp: monster.hp,
            maxHp: monster.maxHp,
            dmg: monster.dmg,
            reward: monster.reward,
            xp: monster.xp,
            img: monster.img,
            isElevatorBoss: monster.isElevatorBoss || false,
            lore: monster.lore || null,
            isCoopRaid: true,
            isScaledForCoop: true,
            loot: monster.loot,
            participants: new Set([inviter, accepter]),
            eTimer: 2.0,
            pTimers: {
                [inviter]: 2.0 / getSpeedMult(pi.filter),
                [accepter]: 2.0 / getSpeedMult(pa.filter)
            }
        };

        activeCombats[inviter] = { isGlobal: true, floor: isFloorBoss ? currentFloor : raidKey, pDodging: false, pCritNext: false, logs: [], sounds: [], vfx: [], paused: false };
        activeCombats[accepter] = { isGlobal: true, floor: isFloorBoss ? currentFloor : raidKey, pDodging: false, pCritNext: false, logs: [], sounds: [], vfx: [], paused: false };

        socket.emit('transition', { to: 'combat', text: `СОВМЕСТНЫЙ РЕЙД С ${inviter}!` });
        io.to(inviterSocketId).emit('transition', { to: 'combat', text: `СОВМЕСТНЫЙ РЕЙД С ${accepter}!` });

        setTimeout(() => {
            socket.emit('combatStart', { enemy: globalBosses[raidKey] });
            io.to(inviterSocketId).emit('combatStart', { enemy: globalBosses[raidKey] });
            broadcastGameState();
        }, 1200);
    });

    socket.on('coopHeal', (targetId) => {
        let healer = onlinePlayers[socket.id]; let target = onlinePlayers[targetId];
        if (!healer || !target) return;
        let ph = db.players[healer];
        let pt = db.players[target];
        if (!ph || !pt || ph.location !== pt.location || (ph.floor || 0) !== (pt.floor || 0)) return;
        let now = Date.now();
        if (now - lastCoopTime < 1000) { socket.emit('terminalError', 'ПЕРЕЗАРЯДКА ЛЕЧЕНИЯ (1 сек).'); return; }
        lastCoopTime = now;
        pt.hp = Math.min(pt.maxHp, pt.hp + 15);
        let targetSocket = Object.keys(onlinePlayers).find(k => onlinePlayers[k] === target);
        if (targetSocket) io.to(targetSocket).emit('terminalError', `ВАС ПОДЛЕЧИЛ ${healer}: +15 HP.`);
        socket.emit('terminalError', `ВЫ ПОДЛЕЧИЛИ ${target}.`);
        saveDB(); broadcastGameState();
    });

    socket.on('vkDonationSuccess', (data) => {
        let username = onlinePlayers[socket.id];
        let p = db.players[username];
        if (!p || !data) return;

        // Если задан защищенный ключ VK, начисление производится СТРОГО через серверный эндпоинт /vk-payment
        if (VK_SECRET_KEY) {
            writeLog(`[VK СОКЕТ] Игрок ${username} сообщил об оплате заказа #${data.orderId || 'н/д'}. Ожидание подтверждения от /vk-payment.`);
            if (data.orderId && db.processedOrders && db.processedOrders[String(data.orderId)]) {
                socket.emit('terminalError', 'ПЛАТЕЖ ПОДТВЕРЖДЕН СЕРВЕРОМ VK!');
            }
            return;
        }

        // Режим локальной разработки без секретного ключа
        const bonusMap = {
            'donate_1_vote': 50,
            'donate_3_votes': 200,
            'donate_5_votes': 450,
            'donate_10_votes': 1000
        };
        let bonus = bonusMap[data.item] || 50;

        p.talons += bonus;
        if (!p.notebook.some(e => e.includes('МЕЦЕНАТ'))) {
            p.notebook.push(`[МЕЦЕНАТ]: Вы поддержали проект голосами VK. Партия выражает благодарность! (+${bonus} талонов)`);
        }

        socket.emit('playSound', 'buy');
        socket.emit('terminalError', `БЛАГОДАРИМ ЗА ПОДДЕРЖКУ (DEV)! ПОЛУЧЕНО: +${bonus} ТАЛОНОВ.`);

        let donateMsg = {
            user: "СИСТЕМА",
            text: `⭐ Заключенный [${username}] поддержал проект голосами VK (+${bonus} талонов)! Спасибо!`,
            time: new Date().toLocaleTimeString().slice(0, 5)
        };
        chatHistory.push(donateMsg);
        if (chatHistory.length > MAX_CHAT_MESSAGES) chatHistory.shift();
        io.emit('chatMessage', donateMsg);

        saveDB();
        broadcastGameState();
    });

    socket.on('rewardAdWatched', () => {
        let username = onlinePlayers[socket.id];
        let p = db.players[username];
        if (!p) return;
        p.talons = (p.talons || 0) + 50;
        if (!p.notebook) p.notebook = [];
        p.notebook.push(`[СНАБЖЕНИЕ]: Получена гуманитарная помощь блока (+50 талонов).`);
        saveDB();
        socket.emit('terminalError', 'НАГРАДА ЗА ПРОСМОТР РЕКЛАМЫ: +50 ТАЛОНОВ!');
        socket.emit('playSound', 'buy');
        broadcastGameState();
    });

    socket.on('explore', () => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let currentFloor = p.floor || 0;
        if (p.location === 'safe_room') {
            socket.emit('terminalError', 'ВЫ В ЖИЛЯЧЕЙКЕ. ВЫЙДИТЕ В СЕКТОР ЧЕРЕЗ КАРТУ.');
            return;
        }
        if (p.hp <= 0) { socket.emit('terminalError', 'КРИТИЧЕСКОЕ СОСТОЯНИЕ.'); return; }
        if (p.filter < 10) { socket.emit('terminalError', 'НЕДОСТАТОЧНО ФИЛЬТРА.'); return; }

        if (activeCombats[username]) {
            let combat = activeCombats[username];
            if (combat.isGlobal) {
                let bossKey = (typeof combat.floor === 'string' && combat.floor.startsWith('coop_')) ? combat.floor : `boss_${combat.floor}`;
                let gb = globalBosses[bossKey];
                if (!gb || gb.hp <= 0 || p.hp <= 0) {
                    delete activeCombats[username];
                } else {
                    socket.emit('transition', { to: 'combat', text: "ВОЗВРАТ В РЕЙД..." });
                    socket.emit('combatStart', { enemy: gb });
                    return;
                }
            } else if (combat.enemy && combat.enemy.hp > 0 && p.hp > 0) {
                socket.emit('transition', { to: 'combat', text: "ВОЗВРАТ В БОЙ..." });
                socket.emit('combatStart', { enemy: combat.enemy });
                return;
            } else {
                delete activeCombats[username];
            }
        }
        if (p.location === 'E4') {
            if (p.bossDefeated && p.bossDefeated[currentFloor]) { socket.emit('terminalError', 'ЛИФТ УЖЕ ЗАПУЩЕН.'); return; }
            const cfg = FLOOR_CONFIGS[currentFloor] || FLOOR_CONFIGS[0];
            const neededKeys = cfg.elevatorKeys || ['quest_lift_repair', 'quest_lift_buttons', 'quest_lift_wire'];
            let missing = [];
            for (let k of neededKeys) {
                let hasKey = p.liftRepaired || (p.foundItems && p.foundItems.includes(k)) || (p.questItems && p.questItems.includes(k));
                if (!hasKey) missing.push(GAME_ITEMS[k] ? GAME_ITEMS[k].name : k);
            }
            if (missing.length > 0) {
                let hint = cfg.elevatorHint || `ЛИФТ НЕ АКТИВИРОВАН. Требуются: ${missing.join(', ')}.`;
                socket.emit('terminalError', hint);
                socket.emit('playSound', 'click');
                let lifterId = getLifterIdForFloor(currentFloor);
                let evLifter = RANDOM_EVENTS.find(e => e.id === lifterId) || RANDOM_EVENTS.find(e => e.id === 'npc_lifter');
                if (evLifter) {
                    p.activeEvent = evLifter.id;
                    p.activeEventNode = null;
                    saveDB();
                    socket.emit('triggerEvent', evLifter);
                }
                return;
            }
            let bossKey = `boss_${currentFloor}`;
            if (!globalBosses[bossKey]) {
                let bossBase = getBossForFloor(currentFloor);
                globalBosses[bossKey] = { name: bossBase.name, hp: bossBase.hp, maxHp: bossBase.hp, dmg: bossBase.dmg, reward: bossBase.reward, xp: bossBase.xp, img: bossBase.img, isElevatorBoss: true, lore: bossBase.lore, participants: new Set([username]), eTimer: 2.0, pTimers: {} };
            } else {
                globalBosses[bossKey].participants.add(username);
                if (!globalBosses[bossKey].isScaledForCoop && globalBosses[bossKey].participants.size >= 2) {
                    globalBosses[bossKey].isScaledForCoop = true;
                    let coopHpMult = 2.0;
                    let coopDmgMult = 1.3;
                    globalBosses[bossKey].maxHp = Math.floor(globalBosses[bossKey].maxHp * coopHpMult);
                    globalBosses[bossKey].hp = Math.floor(globalBosses[bossKey].hp * coopHpMult);
                    globalBosses[bossKey].dmg = Math.floor(globalBosses[bossKey].dmg * coopDmgMult);
                    globalBosses[bossKey].reward = Math.floor(globalBosses[bossKey].reward * 1.5);
                    globalBosses[bossKey].xp = Math.floor(globalBosses[bossKey].xp * 1.5);
                    if (!globalBosses[bossKey].name.includes('[РЕЙД x2]')) {
                        globalBosses[bossKey].name = `[РЕЙД x2] ${globalBosses[bossKey].name}`;
                    }
                    globalBosses[bossKey].participants.forEach(u => {
                        let c = activeCombats[u];
                        if (c) c.logs.push(`> [РЕЙД x2] В битву вступил второй заключенный! Множитель рейда активирован: HP x2, Урон x1.3!`);
                    });
                }
            }
            globalBosses[bossKey].pTimers[username] = 2.0 / getSpeedMult(p.filter);
            activeCombats[username] = { isGlobal: true, floor: currentFloor, pDodging: false, pCritNext: false, logs: [], sounds: [], vfx: [], paused: false };
            p.questItems = p.questItems.filter(i => !neededKeys.includes(i));
            saveDB(); socket.emit('transition', {to: 'combat', text: "ВХОД В ЗОНУ РЕЙДА..."});
            setTimeout(() => { socket.emit('combatStart', { enemy: globalBosses[bossKey] }); broadcastGameState(); }, 2000);
            return;
        }

        // Шанс встретить случайное событие, NPC или тайник с квестовым предметом (28%)
        if (Math.random() < 0.28) {
            let ev = getRandomEventForPlayer(p, currentFloor);
            if (ev) {
                p.activeEvent = ev.id;
                p.activeEventNode = null;
                let fCost = p.perks.includes('perk_lungs') ? 7 : 10;
                let pRate = p.mutations && p.mutations.includes('mut_thick_skin') ? 2.0 : 1.0;
                p.filter -= Math.floor(fCost * pRate);
                saveDB();
                socket.emit('triggerEvent', ev);
                broadcastGameState();
                return;
            }
        }

        let fCost = p.perks.includes('perk_lungs') ? 7 : 10;
        let pRate = p.mutations && p.mutations.includes('mut_thick_skin') ? 2.0 : 1.0;
        p.filter -= Math.floor(fCost * pRate);
        let possibleMonsters = BASE_MONSTERS.filter(m => currentFloor >= m.minFloor && currentFloor <= m.minFloor + 10);
        if (possibleMonsters.length === 0) possibleMonsters = [BASE_MONSTERS[BASE_MONSTERS.length - 1]];
        let baseMob = Object.assign({}, possibleMonsters[Math.floor(Math.random() * possibleMonsters.length)]);
        let multiplier = 1 + (currentFloor * 0.4);
        let lootPool = [ {id: 'food_ration', chance: 0.3}, {id: 'mat_scrap', chance: 0.3}, {id: 'mat_tape', chance: 0.2}, {id: 'mat_chem', chance: 0.15}, {id: 'mat_electro', chance: 0.1} ];
        if (currentFloor > 5) lootPool.push({id: 'special_knife', chance: 0.05});
        if (currentFloor > 10) lootPool.push({id: 'weapon_pipe', chance: 0.03});
        let rolledLoot = lootPool.map(l => ({ id: rollItemWithRarity(l.id), chance: l.chance }));
        let monster = { name: `${baseMob.name} [Lvl ${currentFloor + 1}]`, hp: Math.floor(baseMob.hp * multiplier), maxHp: Math.floor(baseMob.hp * multiplier), dmg: Math.floor(baseMob.dmg * multiplier), reward: Math.floor(baseMob.reward * multiplier), xp: Math.floor(baseMob.xp * multiplier), img: baseMob.img, loot: rolledLoot };
        activeCombats[username] = { enemy: monster, pTimer: 2.0 / getSpeedMult(p.filter), eTimer: 2.0, pDodging: false, eDodging: false, pCritNext: false, logs: [], sounds: [], vfx: [], paused: false };
        saveDB(); socket.emit('transition', {to: 'combat', text: "ВХОД В ТУМАН..."});
        setTimeout(() => { socket.emit('combatStart', { enemy: monster }); broadcastGameState(); }, 1200);
    });

    socket.on('combatAction', (actionType) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let combat = activeCombats[username];
        if (!combat || !p || combat.paused) return;
        let stats = getPlayerStats(p);
        if (combat.isGlobal) {
            let bossKey = (typeof combat.floor === 'string' && combat.floor.startsWith('coop_')) ? combat.floor : `boss_${combat.floor}`;
            let gb = globalBosses[bossKey]; if (!gb) return;
            if (actionType === 'dodge') { combat.pDodging = true; combat.logs.push(`> УКЛОНЕНИЕ...`); combat.sounds.push('dodge'); }
            else if (actionType === 'attack') { gb.pTimers[username] = 2.0 / getSpeedMult(p.filter); executePlayerAttackGlobal(username, combat, gb, stats, p); }
            else if (actionType === 'aimed_success') { gb.pTimers[username] = 2.0 / getSpeedMult(p.filter); let cb = p.perks.includes('perk_butcher') ? 2.3 : 2.0; let dmg = Math.floor(stats.dmg * cb); combat.logs.push(`> КРИТ! ${dmg} урона.`); combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit'); gb.hp -= dmg; }
            else if (actionType === 'aimed_fail') { gb.pTimers[username] = 2.0 / getSpeedMult(p.filter); let eDmg = Math.max(1, gb.dmg - Math.floor(stats.def / 5)); combat.logs.push(`> ПРОМАХ! -${eDmg} HP.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); }
        } else if (combat.isPvP) {
            let opponent = combat.opponent;
            let po = db.players[opponent];
            let oppCombat = activeCombats[opponent];
            if (!po || !oppCombat) return;
            if (actionType === 'dodge') { combat.pDodging = true; combat.logs.push(`> УКЛОНЕНИЕ...`); combat.sounds.push('dodge'); }
            else if (actionType === 'attack') { combat.pTimer = 2.0 / getSpeedMult(p.filter); executePvPAttack(username, opponent, combat, oppCombat, stats, p, po); }
            else if (actionType === 'aimed_success') {
                combat.pTimer = 2.0 / getSpeedMult(p.filter);
                let cb = p.perks.includes('perk_butcher') ? 2.3 : 2.0;
                let dmg = Math.floor(stats.dmg * cb);
                combat.logs.push(`> КРИТ ПО ${opponent}! ${dmg} урона.`);
                combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit');
                oppCombat.logs.push(`> [ДУЭЛЬ] ${username} нанес вам КРИТ: -${dmg} HP!`);
                oppCombat.sounds.push('hit_enemy'); oppCombat.vfx.push('player_hit');
                po.hp -= dmg; applyToxicity(po, oppCombat);
            } else if (actionType === 'aimed_fail') {
                combat.pTimer = 2.0 / getSpeedMult(p.filter);
                let oppStats = getPlayerStats(po);
                let eDmg = Math.max(1, oppStats.dmg - Math.floor(stats.def / 5));
                combat.logs.push(`> ПРОМАХ! Контрудар ${opponent}: -${eDmg} HP.`);
                combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit');
                oppCombat.logs.push(`> [ДУЭЛЬ] Вы контратаковали промахнувшегося ${username}: ${eDmg} урона.`);
                oppCombat.sounds.push('hit_player');
                p.hp -= eDmg; applyToxicity(p, combat);
            }
        } else {
            if (actionType === 'dodge') { combat.pDodging = true; combat.logs.push(`> УКЛОНЕНИЕ...`); combat.sounds.push('dodge'); }
            else if (actionType === 'attack') { combat.pTimer = 2.0 / getSpeedMult(p.filter); executePlayerAttack(username, combat, stats, p); }
            else if (actionType === 'aimed_success') { combat.pTimer = 2.0 / getSpeedMult(p.filter); let cb = p.perks.includes('perk_butcher') ? 2.3 : 2.0; let dmg = Math.floor(stats.dmg * cb); combat.logs.push(`> КРИТ! ${dmg} урона.`); combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit'); combat.enemy.hp -= dmg; }
            else if (actionType === 'aimed_fail') { combat.pTimer = 2.0 / getSpeedMult(p.filter); let eDmg = Math.max(1, combat.enemy.dmg - Math.floor(stats.def / 5)); combat.logs.push(`> ПРОМАХ! -${eDmg} HP.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); }
        }
    });

    socket.on('combatMinigameResult', (success) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        let combat = activeCombats[username];
        if (!combat) return;
        combat.paused = false;
        if (success) { combat.logs.push(`> [УСПЕХ] РЕАКТОР СТАБИЛИЗИРОВАН!`); combat.sounds.push('victory'); }
        else { combat.logs.push(`> [ПРОМАХ] ВЗРЫВ!`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= 40; }
    });

    socket.on('resolveEvent', (choiceId) => {
        let auth = getAuthPlayer(); if (!auth) return;
        let { username, p } = auth;
        if (!p.activeEvent) return;
        let ev = RANDOM_EVENTS.find(e => e.id === p.activeEvent);
        if (!ev) { p.activeEvent = null; p.activeEventNode = null; return; }

        let activeNode = (p.activeEventNode && ev.nodes && ev.nodes[p.activeEventNode]) ? ev.nodes[p.activeEventNode] : ev;
        let choice = activeNode.choices ? activeNode.choices.find(c => c.id === choiceId) : null;
        if (!choice && ev.choices) {
            choice = ev.choices.find(c => c.id === choiceId);
        }
        if (!choice) { p.activeEvent = null; p.activeEventNode = null; return; }

        if (choice.reqCost && p.talons < choice.reqCost) {
            socket.emit('terminalError', `НЕ ХВАТАЕТ ТАЛОНОВ (${choice.reqCost} т.).`);
            return;
        }
        if (choice.reqItem) {
            let hasItem = (p.inventory && p.inventory.includes(choice.reqItem)) || (p.questItems && p.questItems.includes(choice.reqItem));
            if (!hasItem) {
                let itemName = GAME_ITEMS[choice.reqItem] ? GAME_ITEMS[choice.reqItem].name : choice.reqItem;
                socket.emit('terminalError', `ТРЕБУЕТСЯ: ${itemName}`);
                return;
            }
            if (p.inventory && p.inventory.includes(choice.reqItem)) {
                let idx = p.inventory.indexOf(choice.reqItem);
                p.inventory.splice(idx, 1);
            }
        }
        if (choice.reqElevatorKeys) {
            let curF = p.floor || 0;
            let cfg = FLOOR_CONFIGS[curF] || FLOOR_CONFIGS[0];
            let neededKeys = cfg.elevatorKeys || ['quest_lift_repair', 'quest_lift_buttons', 'quest_lift_wire'];
            let missing = [];
            for (let rItem of neededKeys) {
                let has = (p.inventory && p.inventory.includes(rItem)) || (p.questItems && p.questItems.includes(rItem)) || (p.foundItems && p.foundItems.includes(rItem));
                if (!has) {
                    missing.push(GAME_ITEMS[rItem] ? GAME_ITEMS[rItem].name : rItem);
                }
            }
            if (missing.length > 0) {
                socket.emit('terminalError', `НЕ ХВАТАЕТ ДЕТАЛЕЙ ДЛЯ ЛИФТА: ${missing.join(', ')}`);
                return;
            }
            for (let rItem of neededKeys) {
                if (p.inventory && p.inventory.includes(rItem)) {
                    let idx = p.inventory.indexOf(rItem);
                    p.inventory.splice(idx, 1);
                }
                if (p.questItems && p.questItems.includes(rItem)) {
                    let idx = p.questItems.indexOf(rItem);
                    p.questItems.splice(idx, 1);
                }
            }
        }
        if (choice.reqItems && Array.isArray(choice.reqItems)) {
            let missing = [];
            for (let rItem of choice.reqItems) {
                let has = (p.inventory && p.inventory.includes(rItem)) || (p.questItems && p.questItems.includes(rItem)) || (p.foundItems && p.foundItems.includes(rItem));
                if (!has) {
                    missing.push(GAME_ITEMS[rItem] ? GAME_ITEMS[rItem].name : rItem);
                }
            }
            if (missing.length > 0) {
                socket.emit('terminalError', `НЕ ХВАТАЕТ ДЕТАЛЕЙ: ${missing.join(', ')}`);
                return;
            }
            for (let rItem of choice.reqItems) {
                if (p.inventory && p.inventory.includes(rItem)) {
                    let idx = p.inventory.indexOf(rItem);
                    p.inventory.splice(idx, 1);
                }
                if (p.questItems && p.questItems.includes(rItem)) {
                    let idx = p.questItems.indexOf(rItem);
                    p.questItems.splice(idx, 1);
                }
            }
        }
        if (choice.reqCost) p.talons -= choice.reqCost;

        let isWin = Math.random() <= (choice.chance !== undefined ? choice.chance : 1);
        let log = "";
        if (isWin) {
            log = choice.winLog || "> Успех.";
            if (choice.activateElevator) {
                p.liftRepaired = true;
                if (!p.foundItems) p.foundItems = [];
                let curF = p.floor || 0;
                let cfg = FLOOR_CONFIGS[curF] || FLOOR_CONFIGS[0];
                let neededKeys = cfg.elevatorKeys || ['quest_lift_repair', 'quest_lift_buttons', 'quest_lift_wire'];
                neededKeys.forEach(k => {
                    if (!p.foundItems.includes(k)) p.foundItems.push(k);
                });
                socket.emit('playSound', 'victory');
            }
            if (choice.winLoot) {
                let gl = rollItemWithRarity(choice.winLoot);
                if (p.inventory.length < getMaxInv(p)) {
                    p.inventory.push(gl);
                    log += ` (+${GAME_ITEMS[gl] ? GAME_ITEMS[gl].name : gl})`;
                } else {
                    log += `\n> Добыча брошена: сундук переполнен!`;
                }
            }
            if (choice.winQuestItem) {
                if (!p.questItems.includes(choice.winQuestItem)) p.questItems.push(choice.winQuestItem);
                if (!p.foundItems) p.foundItems = [];
                if (!p.foundItems.includes(choice.winQuestItem)) p.foundItems.push(choice.winQuestItem);
                let qName = GAME_ITEMS[choice.winQuestItem] ? GAME_ITEMS[choice.winQuestItem].name : choice.winQuestItem;
                log += ` (+${qName})`;
                socket.emit('playSound', 'victory');
            }
            if (choice.winTalons) { p.talons += choice.winTalons; log += ` (+${choice.winTalons} т.)`; }
            if (choice.winHp) p.hp = Math.min(p.maxHp, p.hp + choice.winHp);
            if (choice.loseHp) {
                let dmg = Math.abs(choice.loseHp);
                p.hp = Math.max(0, p.hp - dmg);
                log += ` (💥 -${dmg} HP)`;
                socket.emit('playSound', 'hit');
            }
            if (choice.winXp) { p.xp += choice.winXp; log += ` (+${choice.winXp} XP)`; }
            if (choice.winNotebook) {
                if (!p.notebook) p.notebook = [];
                if (!p.notebook.includes(choice.winNotebook)) {
                    p.notebook.push(choice.winNotebook);
                    log += `\n> Новая запись в блокноте!`;
                }
            }
        } else {
            log = choice.failLog || "> Провал.";
            if (choice.failHp) p.hp += choice.failHp;
        }

        if (p.hp <= 0) {
            p.hp = 0;
            p.talons = Math.floor(p.talons / 2);
            p.location = 'safe_room';
            p.activeEvent = null;
            p.activeEventNode = null;
            log += "\n> КРИТИЧЕСКИЙ УРОН: ЭВАКУАЦИЯ В ЖИЛЯЧЕЙКУ.";
            saveDB();
            socket.emit('combatEventResult', log);
            broadcastGameState();
            return;
        }

        // Ветвление диалога (переход к следующей реплике)
        if (isWin && choice.nextNode && ev.nodes && ev.nodes[choice.nextNode]) {
            p.activeEventNode = choice.nextNode;
            let nextData = ev.nodes[choice.nextNode];
            let payload = {
                id: ev.id,
                title: nextData.title || ev.title,
                npc: ev.npc,
                text: nextData.text,
                choices: nextData.choices
            };
            saveDB();
            socket.emit('triggerEvent', payload);
            if (log && log.trim() !== "> Успех.") {
                socket.emit('terminalError', log.replace(/^>\s*/, ''));
            }
            broadcastGameState();
            return;
        }

        // Завершение события / диалога
        p.activeEvent = null;
        p.activeEventNode = null;
        saveDB();
        socket.emit('combatEventResult', log);
        broadcastGameState();
    });

    // ===== РОГАЛИК-РЕЙД В ГИГАХРУЩ: СОХРАНЕНИЕ ОПЫТА, ТАЛОНОВ И ХАБАРА ПРИ ЭВАКУАЦИИ / СМЕРТИ =====
    socket.on('radarRaidComplete', (data) => {
        let auth = getAuthPlayer();
        if (!auth) return;
        let { username, p } = auth;
        if (!data || typeof data !== 'object') return;

        let won = Boolean(data.won);
        let earnedXP = Math.max(0, Math.min(20000, Number(data.xp) || 0));
        let earnedTalons = won ? Math.max(0, Math.min(50000, Number(data.talons) || 0)) : 0;
        let kills = Math.max(0, Math.min(1000, Number(data.kills) || 0));

        p.talons = (p.talons || 0) + earnedTalons;
        p.xp = (p.xp || 0) + earnedXP;
        p.monstersKilled = (p.monstersKilled || 0) + kills;
        if (won) {
            p.roomsCleared = (p.roomsCleared || 0) + 1;
        }

        // Автоматический пересчет уровня и максимального здоровья
        let nextLevelXp = (p.level || 1) * 100;
        while (p.xp >= nextLevelXp) {
            p.xp -= nextLevelXp;
            p.level = (p.level || 1) + 1;
            p.maxHp = (p.maxHp || 100) + 10;
            if (won) p.hp = p.maxHp;
            nextLevelXp = p.level * 100;
        }

        // Зачисление найденных предметов в инвентарь сундука/рюкзака
        if (won && Array.isArray(data.lootItems)) {
            if (!p.inventory) p.inventory = [];
            let maxInv = getMaxInv(p);
            data.lootItems.forEach(itemId => {
                if (p.inventory.length < maxInv && (GAME_ITEMS[itemId] || BASE_EQUIP[itemId])) {
                    p.inventory.push(itemId);
                }
            });
        }

        // Возврат ликвидатора в безопасную жилячейку
        p.location = 'safe_room';
        if (won) {
            p.hp = p.maxHp; // Восстанавливаем HP только при успешной эвакуации!
        } else {
            p.hp = 0; // Когда бежим / ранены — HP остается 0!
        }

        if (!p.notebook) p.notebook = [];
        if (won) {
            p.notebook.push(`[РЕЙД // ЭВАКУАЦИЯ]: Успешный выход через шахту лифта. Зачислено: +${earnedTalons} талонов, +${earnedXP} XP.`);
        } else {
            p.notebook.push(`[РЕЙД // РАНЕНИЕ]: Ликвидатор эвакуирован в Жилячейку. Спасено опыта: +${earnedXP} XP.`);
        }

        checkPlayerAchievements(p, socket);
        saveDB(true);
        broadcastGameState();
    });

    socket.on('disconnect', () => {
        let u = onlinePlayers[socket.id];
        if (u) {
            writeLog(`[СЕССИЯ] Отключение сокета ${socket.id} (игрок: ${u}) - сохранение прогресса`);
            saveDB(true);
            if (activeCombats[u]) {
                let c = activeCombats[u];
                if (c && c.isPvP && c.opponent) {
                    let opp = c.opponent;
                    let oppSocketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === opp);
                    if (oppSocketId && activeCombats[opp]) {
                        io.to(oppSocketId).emit('combatEnd', {
                            log: `> Противник ${u} отключился от сети. Победа за вами!`,
                            enemy: { name: u, hp: 0, maxHp: 100, isPlayer: true },
                            win: true
                        });
                        delete activeCombats[opp];
                    }
                }
                if (c && c.isGlobal) {
                    let bossKey = (typeof c.floor === 'string' && c.floor.startsWith('coop_')) ? c.floor : `boss_${c.floor ?? 0}`;
                    if (globalBosses[bossKey] && globalBosses[bossKey].participants) {
                        globalBosses[bossKey].participants.delete(u);
                    }
                }
                delete activeCombats[u];
            }
            // Очистка бойца из отряда рейда
            for (let sqId in coopSquads) {
                let sq = coopSquads[sqId];
                if (sq.members.some(m => m.username === u)) {
                    if (sq.status === 'lobby') {
                        sq.members = sq.members.filter(m => m.username !== u);
                        if (sq.members.length === 0) {
                            delete coopSquads[sqId];
                        } else {
                            if (sq.leader === u) sq.leader = sq.members[0].username;
                            broadcastToSquad(sq, 'myRaidSquad', getSquadClientData(sq));
                        }
                    } else if (sq.status === 'combat') {
                        let m = sq.members.find(mem => mem.username === u);
                        if (m) m.isDowned = true;
                        if (sq.members.every(mem => mem.isDowned || mem.hp <= 0)) {
                            sq.status = 'ended';
                            delete coopSquads[sqId];
                        }
                    }
                }
            }
            delete onlinePlayers[socket.id];
            broadcastGameState();
        }
    });
});

function applyToxicity(p, combat) {
    if (p.mutations && p.mutations.includes('mut_toxic_blood')) return;
    p.tox += 5;
    if (p.tox >= 100) {
        p.tox = 0; let availableMut = MUTATIONS.filter(m => !p.mutations.includes(m.id));
        if (availableMut.length > 0) {
            let m = availableMut[Math.floor(Math.random() * availableMut.length)];
            p.mutations.push(m.id);
            if (combat) combat.logs.push(`\n>>> МУТАЦИЯ: [${m.name}] <<<\n`);
        }
    }
}

function executePvPAttack(username, opponent, combat, oppCombat, stats, p, po) {
    let dmg = stats.dmg;
    if (combat.pCritNext) {
        let cb = 1 + (Math.floor(Math.random() * 16) + 10) / 100;
        if (p.perks.includes('perk_butcher')) cb += 0.3;
        dmg = Math.floor(dmg * cb);
        combat.pCritNext = false;
        combat.logs.push(`> КРИТ ПО ${opponent}! ${dmg} урона.`);
        combat.sounds.push('hit_crit');
        combat.vfx.push('enemy_crit');
    } else {
        combat.logs.push(`> Атака по ${opponent}: ${dmg} урона.`);
        combat.sounds.push('hit_player');
        combat.vfx.push('enemy_hit');
    }

    let oppStats = getPlayerStats(po);
    if (oppCombat.pDodging) {
        if (Math.random() < 0.65) {
            combat.logs.push(`> ПРОМАХ! ${opponent} уклонился!`);
            combat.sounds.push('dodge');
            oppCombat.logs.push(`> [ДУЭЛЬ] Вы уклонились от атаки ${username}!`);
            oppCombat.sounds.push('dodge');
            oppCombat.vfx.push('player_dodge');
            oppCombat.pCritNext = true;
            oppCombat.pDodging = false;
            return;
        } else {
            oppCombat.pDodging = false;
        }
    }

    let finalDmg = Math.max(1, dmg - Math.floor(oppStats.def / 5));
    po.hp -= finalDmg;
    oppCombat.logs.push(`> [ДУЭЛЬ] ${username} нанес вам урон: -${finalDmg} HP.`);
    oppCombat.sounds.push('hit_enemy');
    oppCombat.vfx.push('player_hit');
    applyToxicity(po, oppCombat);
}

function executePlayerAttack(username, combat, stats, p) {
    let dmg = stats.dmg;
    if (combat.pCritNext) { let cb = 1 + (Math.floor(Math.random() * 16) + 10) / 100; if(p.perks.includes('perk_butcher')) cb += 0.3; dmg = Math.floor(dmg * cb); combat.pCritNext = false; combat.logs.push(`> КРИТ! ${dmg} урона.`); combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit'); }
    else { combat.logs.push(`> Атака. ${dmg} урона.`); combat.sounds.push('hit_player'); combat.vfx.push('enemy_hit'); }
    if (combat.eDodging) { if (Math.random() < 0.6) { combat.logs.push(`> ПРОМАХ! Враг уклонился.`); combat.sounds.push('dodge'); combat.eDodging = false; return; } else { combat.eDodging = false; } }
    combat.enemy.hp -= dmg;
}

function executePlayerAttackGlobal(username, combat, gb, stats, p) {
    let dmg = stats.dmg;
    if (combat.pCritNext) { let cb = 1 + (Math.floor(Math.random() * 16) + 10) / 100; if(p.perks.includes('perk_butcher')) cb += 0.3; dmg = Math.floor(dmg * cb); combat.pCritNext = false; combat.logs.push(`> КРИТ! ${dmg} урона.`); combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit'); }
    else { combat.logs.push(`> Атака босса. ${dmg} урона.`); combat.sounds.push('hit_player'); combat.vfx.push('enemy_hit'); }
    gb.hp -= dmg;
}

setInterval(() => {
    for (let bossKey in globalBosses) {
        let gb = globalBosses[bossKey];
        gb.eTimer -= 0.25;
        if (gb.eTimer <= 0) {
            gb.eTimer = 2.0;
            let isSpecialAttack = Math.random() < 0.25; // 25% шанс спец-приема босса
            let specialName = 'СОКРУШИТЕЛЬНЫЙ ТАРАН';
            if (gb.name.includes('СЛИЗИ') || gb.name.includes('Смотритель')) specialName = 'КИСЛОТНЫЙ ШКВАЛ САМОСБОРА';
            else if (gb.name.includes('ТРУПОРЕЗ')) specialName = 'ГИДРАВЛИЧЕСКИЙ РАЗРЫВ';
            else if (gb.name.includes('УТОПЛЕННИК')) specialName = 'ЕДКИЙ ВОДОВОРОТ СТОКОВ';
            else if (gb.name.includes('ИФРИТ')) specialName = 'ПАРОВОЙ ВЗРЫВ СВЕРХДАВЛЕНИЯ';
            else if (gb.name.includes('МЯСОРОД')) specialName = 'ВЫБРОС МЯСНЫХ СПОР';
            else if (gb.name.includes('АРХИВАРИУС')) specialName = 'ПСИХИЧЕСКИЙ РАЗРЫВ ПАМЯТИ';
            else if (gb.name.includes('РЕАКТОР')) specialName = 'ТЕРМОЯДЕРНЫЙ ВЫБРОС';
            else if (gb.name.includes('КОМЕНДАНТ')) specialName = 'ШТРАФНОЙ ЗАЛП КАРТЕЧЬЮ';
            else if (gb.name.includes('ЧЕРНОБОГ')) specialName = 'СИНГУЛЯРНОСТЬ ТУМАНА';

            gb.participants.forEach(u => {
                let combat = activeCombats[u]; let p = db.players[u]; let socketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === u);
                if (combat && p && socketId && !combat.paused) {
                    let bossPower = gb.dmg;
                    if (isSpecialAttack) {
                        bossPower = Math.floor(bossPower * 1.85) + 8;
                    }
                    let eDmg = Math.max(2, bossPower - Math.floor(getPlayerStats(p).def / 5));
                    if (combat.pDodging) {
                        if (Math.random() < 0.70) {
                            combat.logs.push(`> 💨 УКЛОНЕНИЕ ОТ ${isSpecialAttack ? ('СПЕЦПРИЕМА «' + specialName + '»') : 'АТАКИ БОССА'}!`);
                            combat.sounds.push('dodge'); combat.vfx.push('player_dodge'); combat.pCritNext = true; combat.pDodging = false; eDmg = 0;
                        } else {
                            combat.logs.push(`> ⚠️ Не удалось уйти от ${isSpecialAttack ? ('спецприема «' + specialName + '»!') : 'удара босса!'}`);
                        }
                    }
                    if (eDmg > 0) {
                        if (isSpecialAttack) {
                            combat.logs.push(`> ⚡ [БОСС: СПЕЦПРИЕМ!] ${gb.name} обрушивает «${specialName}»! КРИТИЧЕСКИЙ УРОН -${eDmg} HP!`);
                            combat.sounds.push('explosion');
                            combat.vfx.push('boss_special');
                            combat.vfx.push('crit_hit');
                        } else {
                            combat.logs.push(`> 💥 [БОСС] ${gb.name} атакует! -${eDmg} HP.`);
                            combat.sounds.push('hit_enemy');
                            combat.vfx.push('player_hit');
                        }
                        p.hp = Math.max(0, p.hp - eDmg);
                        applyToxicity(p, combat);
                        combat.pDodging = false;
                    }
                }
            });
        }
        if (gb.hp <= 0) {
            gb.participants.forEach(u => {
                let combat = activeCombats[u]; let p = db.players[u]; let socketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === u);
                if (combat && p) {
                    let log = (combat.logs || []).join('\n') + '\n';
                    p.talons += gb.reward; p.xp += gb.xp; p.monstersKilled = (p.monstersKilled || 0) + 1;
                    p.bossesKilled = (p.bossesKilled || 0) + 1;
                    log += `> БОСС ${gb.name} ПОВЕРЖЕН! +${gb.reward} талонов, +${gb.xp} XP.\n`;
                    if (gb.isElevatorBoss) {
                        if (!p.bossDefeated) p.bossDefeated = {}; p.bossDefeated[p?.floor ?? 0] = true;
                        log += `\n>>> ПУТЬ ВНИЗ ОТКРЫТ! <<<\n`;
                    }
                    if (gb.lore) { p.notebook.push(gb.lore); log += `>>> ЗАПИСЬ В БЛОКНОТ! <<<\n`; }
                    if (gb.loot) {
                        gb.loot.forEach(drop => {
                            if (Math.random() < drop.chance) {
                                if (p.inventory.length < getMaxInv(p)) {
                                    p.inventory.push(drop.id);
                                    log += `> НАЙДЕНО В РЕЙДЕ: ${GAME_ITEMS[drop.id] ? GAME_ITEMS[drop.id].name : drop.id}.\n`;
                                }
                            }
                        });
                    }
                    if (socketId) {
                        let sock = io.sockets.sockets.get(socketId);
                        checkPlayerAchievements(p, sock || null);
                        io.to(socketId).emit('combatEnd', { log: log, enemy: gb, win: true });
                    }
                    delete activeCombats[u];
                } else if (combat) {
                    delete activeCombats[u];
                }
            });
            delete globalBosses[bossKey]; saveDB(); broadcastGameState();
            continue;
        }
        gb.participants.forEach(u => {
            let combat = activeCombats[u]; let p = db.players[u]; let socketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === u);
            if (!p || !combat) {
                gb.participants.delete(u);
                if (activeCombats[u]) delete activeCombats[u];
                return;
            }
            if (p.hp <= 0) {
                let log = (combat.logs || []).join('\n') + '\n> ЭВАКУАЦИЯ.';
                p.hp = 0; p.talons = Math.floor(p.talons / 2); p.location = 'safe_room';
                if (socketId) io.to(socketId).emit('combatEnd', { log: log, enemy: gb, win: false });
                delete activeCombats[u]; gb.participants.delete(u);
                return;
            }
            if (!socketId) return;
            if (!combat.paused) {
                gb.pTimers[u] -= 0.25;
                if (gb.pTimers[u] <= 0) { gb.pTimers[u] = 2.0 / getSpeedMult(p.filter); executePlayerAttackGlobal(u, combat, gb, getPlayerStats(p), p); }
                if (combat.logs.length > 0) {
                    io.to(socketId).emit('combatTick', { enemyHp: gb.hp, enemyMaxHp: gb.maxHp, logs: combat.logs, sounds: combat.sounds, vfx: combat.vfx }); combat.logs = []; combat.sounds = []; combat.vfx = [];
                }
            }
        });
    }
    for (let username in activeCombats) {
        let combat = activeCombats[username]; if (combat.isGlobal) continue;
        let p = db.players[username]; let socketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === username);
        if (!p || !socketId) {
            if (combat && combat.isPvP && combat.opponent) {
                let opponent = combat.opponent;
                let oppCombat = activeCombats[opponent];
                let oppSocketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === opponent);
                if (oppCombat && oppSocketId) {
                    io.to(oppSocketId).emit('combatEnd', {
                        log: `> Противник ${username} покинул бой. Победа за вами!`,
                        enemy: { name: username, hp: 0, maxHp: 100, isPlayer: true },
                        win: true
                    });
                    delete activeCombats[opponent];
                }
            }
            delete activeCombats[username];
            continue;
        }
        if (combat.paused) continue;

        if (combat.isPvP) {
            let opponent = combat.opponent;
            let po = db.players[opponent];
            let oppCombat = activeCombats[opponent];
            let oppSocketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === opponent);

            if (!po || !oppCombat || !oppSocketId) {
                let log = combat.logs.join('\n') + `\n> ПРОТИВНИК ${opponent} ПОКИНУЛ БОЙ.`;
                io.to(socketId).emit('combatEnd', { log: log, enemy: { name: opponent, hp: 0, maxHp: 100, isPlayer: true }, win: true });
                delete activeCombats[username];
                saveDB(); broadcastGameState();
                continue;
            }

            combat.pTimer -= 0.25;
            if (combat.pTimer <= 0 && !combat.paused) {
                combat.pTimer = 2.0 / getSpeedMult(p.filter);
                executePvPAttack(username, opponent, combat, oppCombat, getPlayerStats(p), p, po);
            }

            if (p.hp <= 0 || po.hp <= 0) {
                let winner = p.hp > 0 ? username : opponent;
                let loser = p.hp > 0 ? opponent : username;
                let pw = db.players[winner];
                let pl = db.players[loser];
                let winnerCombat = activeCombats[winner];
                let loserCombat = activeCombats[loser];
                let winSocketId = Object.keys(onlinePlayers).find(k => onlinePlayers[k] === winner);
                let loseSocketId = Object.keys(onlinePlayers).find(k => onlinePlayers[k] === loser);

                let lootTalons = Math.max(10, Math.floor(pl.talons * 0.25));
                pl.talons = Math.max(0, pl.talons - lootTalons);
                pw.talons += lootTalons;
                pw.xp += 60;
                pl.hp = 0;
                pl.location = 'safe_room';

                let stolenItemsNames = [];
                if (Array.isArray(pl.inventory) && pl.inventory.length > 0) {
                    let numItemsToSteal = Math.min(pl.inventory.length, Math.floor(Math.random() * 2) + 1); // 1-2 предмета
                    for (let s = 0; s < numItemsToSteal; s++) {
                        if (pl.inventory.length === 0) break;
                        let randIdx = Math.floor(Math.random() * pl.inventory.length);
                        let stolenId = pl.inventory.splice(randIdx, 1)[0];
                        let itemData = GAME_ITEMS[stolenId];
                        let itemName = itemData ? itemData.name : stolenId;
                        stolenItemsNames.push(itemName);

                        if (pw.inventory.length < getMaxInv(pw)) {
                            pw.inventory.push(stolenId);
                        } else {
                            // Если у победителя склад переполнен, возвращаем в талоны
                            let compensation = Math.max(5, itemData ? Math.floor((itemData.cost || 10) * 0.5) : 5);
                            pw.talons += compensation;
                        }
                    }
                }

                let stolenLogWin = stolenItemsNames.length > 0 ? `> Захвачено трофеев со склада: ${stolenItemsNames.join(', ')}\n` : '';
                let stolenLogLose = stolenItemsNames.length > 0 ? `> Потеряно предметов со склада: ${stolenItemsNames.join(', ')}\n` : '';

                let winLog = (winnerCombat ? winnerCombat.logs.join('\n') : '') + `\n>>> ПОБЕДА НАД ${loser}! <<<\n> Захвачено талонов: +${lootTalons}\n${stolenLogWin}> Получено опыта: +60 XP\n`;
                let loseLog = (loserCombat ? loserCombat.logs.join('\n') : '') + `\n>>> ПОРАЖЕНИЕ В ДУЭЛИ ПРОТИВ ${winner}! <<<\n> Потеряно талонов: -${lootTalons}\n${stolenLogLose}> ЭВАКУАЦИЯ В ЖИЛЯЧЕЙКУ.\n`;

                if (winSocketId) io.to(winSocketId).emit('combatEnd', { log: winLog, enemy: { name: loser, hp: 0, maxHp: pl.maxHp, isPlayer: true, skin: pl.appearance ? pl.appearance.skin : 'skin_1', equipment: pl.equipment || {} }, win: true });
                if (loseSocketId) io.to(loseSocketId).emit('combatEnd', { log: loseLog, enemy: { name: winner, hp: pw.hp, maxHp: pw.maxHp, isPlayer: true, skin: pw.appearance ? pw.appearance.skin : 'skin_1', equipment: pw.equipment || {} }, win: false });

                delete activeCombats[winner];
                delete activeCombats[loser];
                saveDB(); broadcastGameState();
                continue;
            }

            if (combat.logs.length > 0) {
                io.to(socketId).emit('combatTick', {
                    enemyHp: Math.max(0, po.hp),
                    enemyMaxHp: po.maxHp,
                    logs: combat.logs,
                    sounds: combat.sounds,
                    vfx: combat.vfx
                });
                combat.logs = []; combat.sounds = []; combat.vfx = [];
            }
            continue;
        }

        // Обычный бой с монстром тумана
        if (!combat.enemy) {
            delete activeCombats[username];
            continue;
        }
        combat.pTimer -= 0.25; combat.eTimer -= 0.25; combat.logs = []; combat.sounds = []; combat.vfx = [];
        if (combat.eTimer <= 0) {
            combat.eTimer = 2.0;
            if (Math.random() < 0.18) {
                combat.eDodging = true;
                combat.logs.push(`> Враг готовит резкий рывок.`);
            } else {
                let isMobSpecial = Math.random() < 0.20; // 20% шанс спецприема у обычных врагов
                let mobDmg = (combat.enemy ? combat.enemy.dmg : 10);
                let mobSpecName = 'ЯРОСТНЫЙ ВЫПАД';
                let mName = combat.enemy ? combat.enemy.name : '';
                if (mName.includes('Хлюп')) mobSpecName = 'КИСЛОТНЫЙ ПЛЕВОК';
                else if (mName.includes('Комар')) mobSpecName = 'ТОКСИЧНЫЙ ПРОКОЛ';
                else if (mName.includes('Крыса')) mobSpecName = 'БЕШЕНЫЙ УКУС';
                else if (mName.includes('Паразит')) mobSpecName = 'НЕЙРОИНФЕКЦИЯ';
                else if (mName.includes('Ликвидатор')) mobSpecName = 'КАРТЕЧНЫЙ ЗАЛП';
                else if (mName.includes('Культист')) mobSpecName = 'ТЕМНОЕ ПРОКЛЯТИЕ';
                else if (mName.includes('Биомасса')) mobSpecName = 'РАЗРЫВ ПСЕВДОПЛОТИ';

                if (isMobSpecial) mobDmg = Math.floor(mobDmg * 1.7) + 4;
                let eDmg = Math.max(1, mobDmg - Math.floor(getPlayerStats(p).def / 5));

                if (combat.pDodging) {
                    if (Math.random() < 0.75) {
                        combat.logs.push(`> 💨 УКЛОНЕНИЕ ОТ ${isMobSpecial ? ('СПЕЦПРИЕМА «' + mobSpecName + '»') : 'АТАКИ'}!`);
                        combat.sounds.push('dodge'); combat.vfx.push('player_dodge'); combat.pCritNext = true; combat.pDodging = false; eDmg = 0;
                    } else {
                        combat.logs.push(`> ⚠️ Не успел уклониться!`);
                    }
                }
                if (eDmg > 0) {
                    if (isMobSpecial) {
                        combat.logs.push(`> ⚡ [СПЕЦПРИЕМ ВРАГА!] «${mobSpecName}» наносит -${eDmg} HP!`);
                        combat.sounds.push('explosion');
                        combat.vfx.push('enemy_special');
                    } else {
                        combat.logs.push(`> ВРАГ АТАКУЕТ! -${eDmg} HP.`);
                        combat.sounds.push('hit_enemy');
                        combat.vfx.push('player_hit');
                    }
                    p.hp = Math.max(0, p.hp - eDmg);
                    applyToxicity(p, combat);
                    combat.pDodging = false;
                }
            }
        }
        if (combat.pTimer <= 0 && !combat.paused) { combat.pTimer = 2.0 / getSpeedMult(p.filter); executePlayerAttack(username, combat, getPlayerStats(p), p); }
        if (p.hp <= 0 || !combat.enemy || combat.enemy.hp <= 0) {
            let log = (combat.logs || []).join('\n') + '\n';
            if (p.hp > 0 && combat.enemy) {
                if (p.perks.includes('perk_vampire')) { p.hp = Math.min(p.maxHp, p.hp + 5); log += `> +5 HP (вампиризм).\n`; }
                p.talons += combat.enemy.reward; p.xp += combat.enemy.xp; p.monstersKilled = (p.monstersKilled || 0) + 1;
                log += `> ВРАГ ПОВЕРЖЕН! +${combat.enemy.reward} талонов, +${combat.enemy.xp} XP.\n`;
                if (socketId) {
                    let sock = io.sockets.sockets.get(socketId);
                    checkPlayerAchievements(p, sock || null);
                }
                let nextLevelXp = p.level * 100;
                if (p.xp >= nextLevelXp) {
                    p.level += 1; p.xp -= nextLevelXp; p.maxHp += 10; p.hp = p.maxHp; log += `>>> УРОВЕНЬ ${p.level}! <<<\n`;
                    let availablePerks = GAME_PERKS.filter(pk => !p.perks.includes(pk.id));
                    if(availablePerks.length > 0) { let shuffled = shuffleArray(availablePerks); io.to(socketId).emit('showLevelUp', shuffled.slice(0, 3)); }
                }
                if (combat.enemy.loot) {
                    combat.enemy.loot.forEach(drop => {
                        let dropC = p.perks.includes('perk_hoarder') ? drop.chance * 1.5 : drop.chance;
                        if (Math.random() < dropC) {
                            if(p.inventory.length < getMaxInv(p)) { p.inventory.push(drop.id); log += `> НАЙДЕНО: ${GAME_ITEMS[drop.id] ? GAME_ITEMS[drop.id].name : drop.id}.\n`; }
                            else { log += `> НАЙДЕНО: ${GAME_ITEMS[drop.id] ? GAME_ITEMS[drop.id].name : drop.id}, но Сундук полон!\n`; }
                        }
                    });
                }
            } else { p.hp = 0; p.talons = Math.floor(p.talons / 2); p.location = 'safe_room'; log += `> ЭВАКУАЦИЯ.`; }
            io.to(socketId).emit('combatEnd', { log: log, enemy: combat.enemy, win: p.hp > 0 }); delete activeCombats[username]; saveDB(); broadcastGameState();
        } else if (combat.logs.length > 0) {
            io.to(socketId).emit('combatTick', { enemyHp: combat.enemy.hp, enemyMaxHp: combat.enemy.maxHp, logs: combat.logs, sounds: combat.sounds, vfx: combat.vfx });
            combat.logs = []; combat.sounds = []; combat.vfx = [];
        }
    }



    // ===== ТАКТИЧЕСКИЙ ЦИКЛ БОЯ СОВМЕСТНОЙ ВЫЛАЗКИ =====
    for (let squadId in coopSquads) {
        let squad = coopSquads[squadId];
        if (!squad) continue;
        if (squad.status !== 'combat' && squad.status !== 'intermission') continue;

        // Если отряд на тактическом перерыве между волнами
        if (squad.status === 'intermission') {
            squad.intermissionTimer = (squad.intermissionTimer || 15) - 0.25;
            let currentSec = Math.max(0, Math.ceil(squad.intermissionTimer));
            if (currentSec !== squad.lastTimerSec) {
                squad.lastTimerSec = currentSec;
                broadcastToSquad(squad, 'raidIntermissionTimerTick', { timer: currentSec });
            }
            if (squad.intermissionTimer <= 0) {
                resolveRaidIntermission(squad);
            }
            continue;
        }

        squad.eTimer = (squad.eTimer || 2.5) - 0.25;

        // 1. Атака монстра по живому члену отряда
        if (squad.eTimer <= 0 && squad.enemy && squad.enemy.hp > 0) {
            squad.eTimer = 2.2;
            let aliveMembers = squad.members.filter(m => !m.isDowned && m.hp > 0);
            if (aliveMembers.length === 0) {
                // ВЕСЬ ОТРЯД ПАЛ: ВАЙП И ЭВАКУАЦИЯ В ЖИЛЯЧЕЙКУ
                squad.status = 'ended';
                squad.members.forEach(m => {
                    let mp = db.players[m.username];
                    if (mp) {
                        mp.location = 'safe_room';
                        mp.hp = Math.max(25, Math.floor((mp.maxHp || 100) * 0.25));
                    }
                });
                broadcastToSquad(squad, 'raidSortieEnded', {
                    win: false,
                    wiped: true,
                    reason: '💀 ВЕСЬ ОТРЯД ПАЛ В БОЮ! Аварийная эвакуация в жилячейку.'
                });
                delete coopSquads[squadId];
                saveDB();
                broadcastGameState();
                continue;
            }

            let targetMember = aliveMembers[Math.floor(Math.random() * aliveMembers.length)];
            let targetP = db.players[targetMember.username];
            let targetDef = targetP ? getPlayerStats(targetP).def : 0;
            let isSpecialAttack = Math.random() < 0.22; // 22% шанс спец-приема у врагов
            let specialName = 'СОКРУШИТЕЛЬНЫЙ УДАР';
            if (squad.enemy.name.includes('Хлюп')) specialName = 'КИСЛОТНЫЙ ВСПЛЕСК';
            else if (squad.enemy.name.includes('Комар')) specialName = 'ТОКСИЧНЫЙ ПРОКОЛ';
            else if (squad.enemy.name.includes('Крыса')) specialName = 'БЕШЕНЫЙ УКУС';
            else if (squad.enemy.name.includes('Паразит')) specialName = 'НЕЙРОИНФЕКЦИЯ';
            else if (squad.enemy.name.includes('Ликвидатор')) specialName = 'ТАКТИЧЕСКИЙ ЗАЛП';
            else if (squad.enemy.name.includes('Культист')) specialName = 'ТЕМНЫЙ РИТУАЛ';
            else if (squad.enemy.name.includes('Биомасса')) specialName = 'БЕЛКОВЫЙ РАЗРЫВ';
            else if (squad.enemy.name.includes('Химера')) specialName = 'РАЗРЫВАЮЩИЙ ТАРАН';

            let enemyAttackPower = squad.enemy.dmg;
            if (isSpecialAttack) {
                enemyAttackPower = Math.floor(enemyAttackPower * 1.9) + 6; // Высокий критический урон
            }
            let rawDmg = Math.max(8, enemyAttackPower - Math.floor(targetDef / 4));

            if (targetMember.pDodging) {
                if (Math.random() < 0.75) {
                    rawDmg = 0;
                    squad.logs.push('> 💨 ' + targetMember.username + ' УСПЕШНО УКЛОНИЛСЯ от ' + (isSpecialAttack ? ('спец-приема «' + specialName + '»') : 'удара') + '!');
                    squad.vfx = squad.vfx || [];
                    squad.vfx.push({ type: 'player_dodge', target: targetMember.username });
                    broadcastToSquad(squad, 'playSound', 'dodge');
                } else {
                    squad.logs.push('> ⚠️ ' + targetMember.username + ' не успел отскочить от ' + (isSpecialAttack ? ('спец-приема «' + specialName + '»!') : 'удара!'));
                }
                targetMember.pDodging = false;
            }

            if (rawDmg > 0) {
                targetMember.hp = Math.max(0, targetMember.hp - rawDmg);
                if (targetP) targetP.hp = targetMember.hp;
                squad.vfx = squad.vfx || [];
                if (isSpecialAttack) {
                    squad.logs.push('> ⚡ [СПЕЦ-ПРИЕМ!] ' + squad.enemy.name + ' применяет «' + specialName + '» по ' + targetMember.username + '! КРИТИЧЕСКИЙ УРОН -' + rawDmg + ' HP!');
                    squad.vfx.push({ type: 'enemy_special', target: targetMember.username, skill: specialName, dmg: rawDmg });
                    broadcastToSquad(squad, 'playSound', 'explosion');
                } else {
                    squad.logs.push('> 💥 ' + squad.enemy.name + ' АТАКУЕТ ' + targetMember.username + '! -' + rawDmg + ' HP.');
                    squad.vfx.push({ type: 'player_hit', target: targetMember.username, dmg: rawDmg });
                    broadcastToSquad(squad, 'playSound', 'hit_enemy');
                }

                if (targetMember.hp <= 0) {
                    targetMember.isDowned = true;
                    targetMember.hp = 0;
                    if (targetP) targetP.hp = 0;
                    squad.logs.push('> ⚠️ [ТЯЖЕЛО РАНЕН] Боец ' + targetMember.username + ' ПАЛ БЕЗ СОЗНАНИЯ! Нужна помощь санитара (аптечка)!');
                    broadcastToSquad(squad, 'playSound', 'defeat');

                    if (squad.members.every(m => m.isDowned || m.hp <= 0)) {
                        squad.status = 'ended';
                        squad.members.forEach(m => {
                            let mp = db.players[m.username];
                            if (mp) {
                                mp.location = 'safe_room';
                                mp.hp = Math.max(25, Math.floor((mp.maxHp || 100) * 0.25));
                            }
                        });
                        broadcastToSquad(squad, 'raidSortieEnded', {
                            win: false,
                            wiped: true,
                            reason: '💀 ВЕСЬ ОТРЯД ПАЛ В БОЮ! Аварийная эвакуация в жилячейку.'
                        });
                        delete coopSquads[squadId];
                        saveDB();
                        broadcastGameState();
                        continue;
                    }
                }
            }
        }

        // 2. Проверка гибели монстра волны
        if (squad.enemy && squad.enemy.hp <= 0) {
            let enemyReward = squad.enemy.reward || 35;
            let enemyXp = squad.enemy.xp || 45;
            squad.members.forEach(m => {
                let mp = db.players[m.username];
                if (mp) {
                    mp.talons = (mp.talons || 0) + enemyReward;
                    mp.xp = (mp.xp || 0) + enemyXp;
                    mp.monstersKilled = (mp.monstersKilled || 0) + 1;
                    let nextXp = mp.level * 100;
                    if (mp.xp >= nextXp) {
                        mp.level += 1;
                        mp.xp -= nextXp;
                        mp.maxHp += 10;
                        mp.hp = mp.maxHp;
                        squad.logs.push('>>> БОЕЦ ' + m.username + ' ПОЛУЧИЛ УРОВЕНЬ ' + mp.level + '! <<<');
                    }
                }
            });

            if (squad.currentWave < 11) {
                // ВОЛНА ПРОЙДЕНА: ВЫХОД В ТАКТИЧЕСКИЙ ПЕРЕРЫВ ДЛЯ ГОЛОСОВАНИЯ (ЭВАКУАЦИЯ ИЛИ СЛЕДУЮЩАЯ ВОЛНА)
                squad.status = 'intermission';
                squad.clearedWave = squad.currentWave;
                squad.intermissionTimer = 15.0;
                squad.votes = {};
                squad.vfx = [];
                squad.logs.push('[ВОЛНА ' + squad.clearedWave + ' ЗАЧИЩЕНА] +' + enemyReward + ' т., +' + enemyXp + ' XP! Открыто голосование отряда: продолжить или эвакуироваться.');
                broadcastToSquad(squad, 'playSound', 'buy');
                broadcastToSquad(squad, 'raidIntermissionStarted', getIntermissionData(squad));
                continue;
            } else if (squad.currentWave === 11) {
                // ФИНАЛЬНЫЙ БОСС 11 ВОЛНЫ ПОВЕРЖЕН! ПОЛНАЯ ПОБЕДА!
                squad.logs.push('[ЛЕГЕНДАРНАЯ ПОБЕДА] Финальный босс ' + squad.enemy.name + ' ПОВЕРЖЕН! Штурмовая операция успешно завершена!');
                let droppedItems = {};
                squad.members.forEach(m => {
                    let mp = db.players[m.username];
                    if (mp) {
                        let lootItem = squad.enemy.lootTable[Math.floor(Math.random() * squad.enemy.lootTable.length)];
                        if (mp.inventory.length < getMaxInv(mp)) {
                            mp.inventory.push(lootItem);
                            droppedItems[m.username] = (GAME_ITEMS[lootItem] && GAME_ITEMS[lootItem].name) || lootItem;
                        }
                        if (!mp.bossDefeated) mp.bossDefeated = {};
                        mp.bossDefeated['raid_' + squad.enemy.tier] = true;
                        mp.location = 'safe_room';
                        if (mp.hp <= 0) mp.hp = 50;
                    }
                });
                broadcastToSquad(squad, 'raidSortieEnded', {
                    win: true,
                    wiped: false,
                    bossName: squad.enemy.name,
                    bossTier: squad.enemy.tier,
                    reward: squad.enemy.reward,
                    xp: squad.enemy.xp,
                    droppedItems: droppedItems
                });
                delete coopSquads[squadId];
                saveDB();
                broadcastGameState();
                continue;
            }
        }

        // Отправка тика боя всем бойцам отряда (включая VFX и снаряжение для отображения)
        let tickVfx = squad.vfx || [];
        squad.vfx = [];

        broadcastToSquad(squad, 'raidCombatTick', {
            currentWave: squad.currentWave,
            maxWaves: squad.maxWaves,
            enemy: squad.enemy,
            members: squad.members.map(m => {
                let mp = db.players[m.username];
                return {
                    username: m.username,
                    level: m.level || (mp ? mp.level : 1),
                    title: m.title || (mp ? mp.title : 'Заключенный'),
                    hp: m.hp,
                    maxHp: m.maxHp,
                    isDowned: m.isDowned,
                    pDodging: m.pDodging,
                    skin: mp && mp.appearance ? mp.appearance.skin : 'skin_1',
                    equipment: mp ? (mp.equipment || {}) : {}
                };
            }),
            logs: squad.logs.slice(-15),
            vfx: tickVfx
        });
    }
}, 250);

let tickCount = 0;
setInterval(() => {
    tickCount++; let updated = false;
    let activeUsers = Object.values(onlinePlayers);
    activeUsers.forEach(u => {
        if (db.players[u]) {
            db.players[u].playtime = (db.players[u].playtime || 0) + 1;
            if (tickCount % 60 === 0) {
                db.players[u].hunger = Math.max(0, db.players[u].hunger - 1);
                if (db.players[u].hunger === 0) db.players[u].hp -= 2;
                updated = true;
            }
        }
    });
    for (let id in db.players) {
        let p = db.players[id];
        if (p.location === 'safe_room') {
            if (tickCount % 4 === 0 && p.filter < 100) { p.filter++; updated = true; }
            if (tickCount % 6 === 0 && p.hp < p.maxHp && p.hp > 0 && p.hunger > 0) { p.hp++; updated = true; }
        }
        if (tickCount % 10 === 0 && p.robots) {
            for (let rLoc in p.robots) {
                if (p.robots[rLoc] < 250) { p.robots[rLoc]++; updated = true; }
            }
        }
    }
    if (updated) { saveDB(); broadcastGameState(); }
}, 1000);

const PORT = parseInt(process.env.PORT || process.env.ALWAYSDATA_HTTPD_PORT || 3000, 10);
const HOST = process.env.IP || process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    writeLog(`Сервер успешно запущен. Хост: ${HOST}, Порт: ${PORT}`);
    console.log(`[СИСТЕМА] Сервер активен: http://${HOST}:${PORT}`);
});