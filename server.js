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

const DB_FILE = path.join(__dirname, 'database.json');
let db = { players: {}, map: {} };
let isDbDirty = false;
let isSavingDb = false;

// Атомарная запись БД (защита от повреждения файла при сбоях/перезагрузке)
function flushDBSync() {
    if (!isDbDirty) return;
    const tempFile = DB_FILE + '.tmp';
    try {
        fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf8');
        fs.renameSync(tempFile, DB_FILE);
        isDbDirty = false;
    } catch (err) {
        writeLog(`Ошибка синхронной записи БД: ${err.message}`);
    }
}

function flushDBAsync() {
    if (!isDbDirty || isSavingDb) return;
    isSavingDb = true;
    const tempFile = DB_FILE + '.tmp';
    try {
        const data = JSON.stringify(db, null, 2);
        fs.writeFile(tempFile, data, 'utf8', (err) => {
            if (err) {
                isSavingDb = false;
                writeLog(`Ошибка записи темп-файла БД: ${err.message}`);
                return;
            }
            fs.rename(tempFile, DB_FILE, (renameErr) => {
                isSavingDb = false;
                if (!renameErr) {
                    isDbDirty = false;
                } else {
                    writeLog(`Ошибка переименования темп-файла БД: ${renameErr.message}`);
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

if (fs.existsSync(DB_FILE)) {
    try {
        let loadedData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (loadedData.players && loadedData.map) db = loadedData;
        else { db.players = loadedData.players || loadedData || {}; db.map = loadedData.map || {}; saveDB(true); }
        if (!Array.isArray(db.feedback)) db.feedback = [];
    } catch (err) { writeLog(`Ошибка чтения БД: ${err.message}`); }
} else { 
    if (!Array.isArray(db.feedback)) db.feedback = [];
    saveDB(true); 
}

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
let currentShopItems = [];
let nextShopUpdate = 0;
let chatHistory = [];
const MAX_CHAT_MESSAGES = 50;

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
    food_ration: { name: "Брикет слизи", type: "consumable", cost: 10, restoreFilter: 20, restoreHp: 10, restoreHunger: 40, color: '#fff', paperColor: '#222' },
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

const MINIGAME_POOL = [
    // --- ПАРОЛИ И ЛОГИЧЕСКИЕ ЗАГАДКИ ---
    { id: 'mg_1', type: 'password', title: 'СТЕРТАЯ КЛАВИАТУРА', text: 'Стерты цифры 2, 5, 8, 9. Сумма первых двух = 7, вторая больше первой, последняя наибольшая.', answer: '2589' },
    { id: 'mg_2', type: 'password', title: 'СЕЙФ КОМЕНДАНТА', text: 'Записка: «Самосбор был 14 июля. Код дата спустя неделю (ДДММ)».', answer: '2107' },
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

    // --- ПОДСТАНЦИИ И КАЛИБРОВКА НАПРЯЖЕНИЯ ---
    { id: 'mg_9', type: 'voltage', title: 'ПОДСТАНЦИЯ: НИЗКИЙ ТОК', text: 'Откалибровать напряжение на 80W.', target: 80 },
    { id: 'mg_v_40', type: 'voltage', title: 'СЛАБОТОЧНЫЙ ЩИТОК', text: 'Откалибровать напряжение на 40W для запуска аварийного реле.', target: 40 },
    { id: 'mg_v_60', type: 'voltage', title: 'ОСВЕЩЕНИЕ СЕКТОРА', text: 'Откалибровать напряжение на 60W для включения прожекторов.', target: 60 },
    { id: 'mg_v_100', type: 'voltage', title: 'ТРАНСФОРМАТОР ТЕХБЛОКА', text: 'Откалибровать напряжение ровно на 100W.', target: 100 },
    { id: 'mg_v_120', type: 'voltage', title: 'СИЛОВАЯ МАГИСТРАЛЬ', text: 'Откалибровать напряжение на 120W для открытия электрогермодвери.', target: 120 }
];

const BASE_MONSTERS = [
    { id: "m_1", minFloor: 0, name: "Плесень-ползун", hp: 10, dmg: 2, reward: 1, xp: 5, img: "m_mold.png", lore: "Простейшая форма жизни." },
    { id: "m_2", minFloor: 0, name: "Слизневик", hp: 15, dmg: 4, reward: 2, xp: 8, img: "m_slime.png", lore: "Сгусток слизи." },
    { id: "m_3", minFloor: 1, name: "Ржавый паразит", hp: 20, dmg: 5, reward: 3, xp: 12, img: "m_parasite.png", lore: "Насекомое-переросток." },
    { id: "m_4", minFloor: 2, name: "Трубный трупоед", hp: 30, dmg: 7, reward: 5, xp: 15, img: "m_corpse.png", lore: "Питается сталкерами." },
    { id: "m_5", minFloor: 3, name: "Обезумевший жилец", hp: 45, dmg: 10, reward: 8, xp: 20, img: "m_madman.png", lore: "Разум уничтожен туманом." },
    { id: "m_6", minFloor: 4, name: "Туманный утопленник", hp: 60, dmg: 12, reward: 10, xp: 25, img: "m_drowned.png", lore: "Пахнет хлоркой." },
    { id: "m_7", minFloor: 5, name: "Безглазый конвоир", hp: 80, dmg: 15, reward: 12, xp: 35, img: "m_guard.png", lore: "Бывший сотрудник Партии." },
    { id: "m_8", minFloor: 6, name: "Червеобразный нарост", hp: 90, dmg: 18, reward: 15, xp: 45, img: "m_worm.png", lore: "Пульсирующая биомасса." },
    { id: "m_9", minFloor: 7, name: "Мясной культист", hp: 110, dmg: 22, reward: 18, xp: 55, img: "m_cultist.png", lore: "Поклоняется Самосбору." },
    { id: "m_10", minFloor: 8, name: "Адепт Чернобога", hp: 130, dmg: 25, reward: 22, xp: 70, img: "m_adept.png", lore: "Общается с туманом." },
    { id: "m_11", minFloor: 9, name: "Паук-арматурщик", hp: 150, dmg: 30, reward: 25, xp: 85, img: "m_spider.png", lore: "Из бетона и стали." },
    { id: "m_12", minFloor: 10, name: "Гончая Тумана", hp: 180, dmg: 35, reward: 30, xp: 100, img: "m_hound.png", lore: "Быстрая тварь." },
    { id: "m_13", minFloor: 11, name: "Мутировавший сварщик", hp: 210, dmg: 40, reward: 35, xp: 120, img: "m_welder.png", lore: "Баллон в спине." },
    { id: "m_14", minFloor: 12, name: "Свинорыл", hp: 250, dmg: 45, reward: 40, xp: 140, img: "m_pig.png", lore: "Мутация повара." },
    { id: "m_15", minFloor: 13, name: "Некро-сантехник", hp: 280, dmg: 50, reward: 45, xp: 160, img: "m_plumber.png", lore: "С разводным ключом." },
    { id: "m_16", minFloor: 14, name: "Зараженный Ликвидатор", hp: 320, dmg: 55, reward: 55, xp: 180, img: "m_liquidator.png", lore: "Зачищал этажи." },
    { id: "m_17", minFloor: 15, name: "Токсичный плевун", hp: 350, dmg: 60, reward: 65, xp: 210, img: "m_spitter.png", lore: "Плюется слизью." },
    { id: "m_18", minFloor: 16, name: "Бронированный мясник", hp: 400, dmg: 65, reward: 75, xp: 240, img: "m_butcher.png", lore: "Панцирь из цемента." },
    { id: "m_19", minFloor: 17, name: "Ходячий улей слизи", hp: 450, dmg: 70, reward: 85, xp: 280, img: "m_hive.png", lore: "Улей паразитов." },
    { id: "m_20", minFloor: 18, name: "Проповедник Бетона", hp: 500, dmg: 80, reward: 100, xp: 320, img: "m_preacher.png", lore: "Читает мантры." },
    { id: "m_21", minFloor: 19, name: "Искаженный дезертир", hp: 550, dmg: 90, reward: 115, xp: 360, img: "m_deserter.png", lore: "Заблудился." },
    { id: "m_22", minFloor: 20, name: "Амальгама плоти", hp: 620, dmg: 100, reward: 130, xp: 400, img: "m_amalgam.png", lore: "Слияние тел." },
    { id: "m_23", minFloor: 21, name: "Гигантская сколопендра", hp: 700, dmg: 110, reward: 150, xp: 450, img: "m_centipede.png", lore: "Обитатель шахт." },
    { id: "m_24", minFloor: 22, name: "Биомеханический страж", hp: 800, dmg: 125, reward: 180, xp: 520, img: "m_biomech.png", lore: "Проект Партии." },
    { id: "m_25", minFloor: 23, name: "Пожиратель фильтров", hp: 900, dmg: 140, reward: 210, xp: 600, img: "m_eater.png", lore: "Охотится за углем." },
    { id: "m_26", minFloor: 24, name: "Тень Самосбора", hp: 1050, dmg: 160, reward: 250, xp: 700, img: "m_shadow.png", lore: "Поглощает свет." },
    { id: "m_27", minFloor: 25, name: "Сросшиеся близнецы", hp: 1200, dmg: 180, reward: 300, xp: 850, img: "m_twins.png", lore: "Два тела — разум один." },
    { id: "m_28", minFloor: 26, name: "Жрец Кровавого Цемента", hp: 1400, dmg: 210, reward: 350, xp: 1000, img: "m_priest.png", lore: "Шепот сводит с ума." },
    { id: "m_29", minFloor: 27, name: "Архитектор плоти", hp: 1650, dmg: 250, reward: 420, xp: 1250, img: "m_architect.png", lore: "Лепит стены из останков." },
    { id: "m_30", minFloor: 28, name: "Истинный обитатель Тумана", hp: 2000, dmg: 300, reward: 550, xp: 1600, img: "m_true.png", lore: "Абсолютный кошмар." }
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
        5: { name: "СМОТРИТЕЛЬ СЛИЗИ [РЕЙД-БОСС]", hp: 4500, dmg: 35, reward: 600, xp: 1600, img: "boss_slime.png", lore: "[ДНЕВНИК]: Смотритель пал." },
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

    // NPC в зависимости от яруса этажей
    if (currentFloor <= 4) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_stalker'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_liquidator'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'meat_smell'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'toxic_steam'));
    } else if (currentFloor <= 9) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_archivist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_scientist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_stalker'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'whispering_concrete'));
    } else if (currentFloor <= 14) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_scientist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_liquidator'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'toxic_steam'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'meat_smell'));
    } else if (currentFloor <= 19) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_vokhr'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_liquidator'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'whispering_concrete'));
    } else if (currentFloor <= 24) {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_cultist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'meat_smell'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'whispering_concrete'));
    } else {
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_cultist'));
        pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_scientist'));
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
    treatment: { name: "Очистные", bg: "bg_treatment.png", icon: "icon_treatment.png" }
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
    let mPool = shuffleArray(MINIGAME_POOL).slice(0, 5);
    mPool.forEach(mg => locks.push({ type: 'minigame', val: mg }));
    
    let pool = shuffleArray([...RANDOM_LOC_KEYS, ...RANDOM_LOC_KEYS]);
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

    let allPlayers = Object.values(db.players);
    allPlayers.forEach(p => { p.rating = (p.xp || 0) + ((p.monstersKilled||0) * 10) + ((p.roomsCleared||0) * 5) + ((p.floor||0) * 100) + Math.floor((p.playtime||0) / 60); });
    allPlayers.sort((a, b) => b.rating - a.rating);
    let leaderboard = allPlayers.slice(0, 15).map((p, idx) => { return { rank: idx + 1, name: Object.keys(db.players).find(k => db.players[k] === p), level: p.level, floor: p.floor || 0, rating: p.rating, playtime: p.playtime || 0 }; });

    for (let socketId in onlinePlayers) {
        let username = onlinePlayers[socketId]; let p = db.players[username];
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
            if (db.players[u].location === p.location && (db.players[u].floor || 0) === floor) { playersInSector.push({ id: sId, username: u, hp: db.players[u].hp }); }
        }
        let locKey = `${floor}_${p.location}`;
        io.to(socketId).emit('gameState', {
            me: {
                username: username, talons: p.talons, location: p.location, floor: floor,
                stats: getPlayerStats(p), equipment: p.equipment, inventory: p.inventory, maxInv: getMaxInv(p),
                hunger: p.hunger, tox: p.tox, mutations: p.mutations,
                questItems: p.questItems, unlockedSectors: p.unlockedSectors[floor] || ['A0'], notebook: p.notebook,
                quickSlots: p.quickSlots, perks: p.perks, level: p.level, xp: p.xp, monstersKilled: p.monstersKilled, roomsCleared: p.roomsCleared,
                rating: p.rating, rankPos: rankPos, title: title, bossDefeated: p.bossDefeated,
                currentRobot: p.robots[locKey] !== undefined ? p.robots[locKey] : null, appearance: p.appearance, playtime: p.playtime
            },
            sectorPlayers: playersInSector, map: db.map[floor], GAME_PERKS: GAME_PERKS, GAME_ITEMS: GAME_ITEMS, MUTATIONS: MUTATIONS, BESTIARY: BASE_MONSTERS,
            shopItems: currentShopItems, nextShopUpdate: nextShopUpdate, leaderboard: leaderboard
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
    socket.emit('chatHistory', chatHistory);

    let lastChatTime = 0;
    let lastWorkTime = 0;
    let lastPvpTime = 0;
    let lastCoopTime = 0;

    socket.on('login', (data) => {
        const { username, password } = data;
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
            } else if (!db.players[username]) {
                writeLog(`Регистрация: ${username}`);
                db.players[username] = {
                    password: hashPassword(password), talons: 0, hp: 100, maxHp: 100, filter: 100, hunger: 100, tox: 0, level: 1, xp: 0, monstersKilled: 0, roomsCleared: 0, rating: 0, playtime: 0,
                    appearance: null, location: 'safe_room', floor: 0, activeEvent: null,
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
                saveDB(true);
            }
            onlinePlayers[socket.id] = username;
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

        let username = db.vkMap[vkUserId];

        try {
            if (!username || !db.players[username]) {
                let cleanFirst = (data.firstName || '').trim().replace(/[^a-zA-Zа-яА-Я0-9_]/g, '');
                let candidate = cleanFirst ? cleanFirst : `ЗК_${vkUserId.slice(-4)}`;
                
                if (db.players[candidate] && db.players[candidate].vkUserId !== vkUserId) {
                    candidate = `${candidate}_${vkUserId.slice(-4)}`;
                }
                username = candidate;

                writeLog(`Регистрация через VK: ${username} (VK ID: ${vkUserId})`);
                db.players[username] = {
                    password: 'vk_auth_' + vkUserId,
                    vkUserId: vkUserId,
                    vkPhoto: data.photo || null,
                    talons: 0, hp: 100, maxHp: 100, filter: 100, hunger: 100, tox: 0, level: 1, xp: 0, monstersKilled: 0, roomsCleared: 0, rating: 0, playtime: 0,
                    appearance: null, location: 'safe_room', floor: 0, activeEvent: null,
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
            socket.emit('loginSuccess', { username, showIntro: db.players[username].appearance === null });
            if (db.players[username].appearance !== null) socket.emit('startGame');
            broadcastGameState();
        } catch (err) { writeLog(`ОШИБКА VK LOGIN: ${err.message}`); }
    });

    socket.on('saveCharacter', () => {
        if (onlinePlayers[socket.id]) {
            let p = db.players[onlinePlayers[socket.id]];
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
        lastChatTime = now; let cleanMsg = msg.substring(0, 100);
        let entry = { user: u, text: cleanMsg, time: new Date().toLocaleTimeString('ru-RU', { hour12: false, hour: '2-digit', minute:'2-digit' }) };
        chatHistory.push(entry); if (chatHistory.length > MAX_CHAT_MESSAGES) chatHistory.shift();
        io.emit('chatMessage', entry);
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

    socket.on('selectPerk', (perkId) => { let p = db.players[onlinePlayers[socket.id]]; if(p && !p.perks.includes(perkId)) { p.perks.push(perkId); if(perkId === 'perk_health') { p.maxHp += 25; p.hp += 25; } saveDB(); broadcastGameState(); } });

    socket.on('changeLocation', (locId) => {
        let username = onlinePlayers[socket.id];
        let p = db.players[username]; if (!p) return;
        if (activeCombats[username]) {
            let c = activeCombats[username];
            if ((c.enemy && c.enemy.hp <= 0) || p.hp <= 0) {
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
                p.roomsCleared = (p.roomsCleared || 0) + 1;
                p.notebook.push(`[ЭТАЖ ${currentFloor}]: Открыл сектор ${locId} с помощью ${GAME_ITEMS[reqItem] ? GAME_ITEMS[reqItem].name : reqItem}.`);
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
            saveDB();
            socket.emit('transition', {to: locId, text: `ВХОД В СЕКТОР ${locId}...`});
            broadcastGameState();
        }
    });

    socket.on('minigameWon', (locId) => {
        let username = onlinePlayers[socket.id];
        let p = db.players[username]; let currentFloor = p.floor || 0;
        if (!p) return;
        if (!p.unlockedSectors || typeof p.unlockedSectors !== 'object') p.unlockedSectors = { 0: ['A0'] };
        if (Array.isArray(p.unlockedSectors)) p.unlockedSectors = { 0: p.unlockedSectors };
        if (!Array.isArray(p.unlockedSectors[currentFloor])) p.unlockedSectors[currentFloor] = ['A0'];

        if (!p.unlockedSectors[currentFloor].includes(locId)) {
            p.unlockedSectors[currentFloor].push(locId);
        }
        p.location = locId;
        p.roomsCleared = (p.roomsCleared || 0) + 1;
        p.notebook.push(`[ЭТАЖ ${currentFloor}]: Взломал гермодверь в ${locId}.`);
        socket.emit('playSound', 'victory');
        saveDB();
        socket.emit('transition', {to: locId, text: `ВЗЛОМ УСПЕШЕН...`});
        broadcastGameState();
    });

    socket.on('minigameCancel', () => { let p = db.players[onlinePlayers[socket.id]]; if (p) { p.location = 'safe_room'; saveDB(); socket.emit('transition', {to: 'safe_room', text: "ОТСТУПЛЕНИЕ..."}); broadcastGameState(); } });

    socket.on('changeFloor', (dir) => {
        let username = onlinePlayers[socket.id]; let p = db.players[username]; if (!p) return;
        let currentFloor = p.floor || 0;
        if (dir === 'down') {
            if (!p.bossDefeated || !p.bossDefeated[currentFloor]) { socket.emit('terminalError', 'ЛИФТ НЕ АКТИВИРОВАН.'); return; }
            if (currentFloor >= 30) { socket.emit('terminalError', 'ДНО ГИГАХРУЩЕВКИ.'); return; }
            p.floor = currentFloor + 1; p.location = 'A0';
            if (!p.unlockedSectors[p.floor]) p.unlockedSectors[p.floor] = ['A0'];
            p.notebook.push(`[ЭТАЖ ${p.floor}]: Лифт опустился ниже.`);
            generateFloor(p.floor); saveDB(); socket.emit('transition', {to: 'map', text: `СПУСК НА ЭТАЖ ${p.floor}...`}); broadcastGameState();
        }
    });

    socket.on('buyItem', (itemId) => {
        let p = db.players[onlinePlayers[socket.id]]; let item = GAME_ITEMS[itemId];
        if (item && p.talons >= item.cost && currentShopItems.includes(itemId)) {
            if (p.inventory.length >= getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
            p.talons -= item.cost; p.inventory.push(itemId); socket.emit('playSound', 'buy'); socket.emit('terminalError', `ПОЛУЧЕНО: ${item.name}`); saveDB(); broadcastGameState();
        }
    });

    // ===== ПРОДАЖА (было пропущено) =====
    socket.on('sellItem', (invIndex) => {
        let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.inventory[invIndex]) return;
        let itemId = p.inventory[invIndex]; let itemData = GAME_ITEMS[itemId]; if (!itemData) return;
        if (itemData.type === 'material' || itemData.type === 'tool') { socket.emit('terminalError', 'ЭТО НЕЛЬЗЯ СДАТЬ.'); return; }
        let price = Math.min(35, Math.max(3, Math.floor((itemData.cost || 5) * 0.4)));
        p.inventory.splice(invIndex, 1); p.talons += price;
        socket.emit('playSound', 'buy'); socket.emit('terminalError', `СДАНО: ${itemData.name} (+${price} т.)`);
        saveDB(); broadcastGameState();
    });

    socket.on('dropItem', (invIndex) => {
        let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.inventory[invIndex]) return;
        p.inventory.splice(invIndex, 1); socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
    });

    socket.on('equipItem', (invIndex) => {
        let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.inventory[invIndex]) return;
        let itemId = p.inventory[invIndex]; let itemData = GAME_ITEMS[itemId];
        if (itemData && (itemData.type === 'weapon' || itemData.type === 'clothes' || itemData.type === 'mask' || itemData.type === 'backpack')) {
            if (itemData.reqLevel && p.level < itemData.reqLevel) { socket.emit('terminalError', `НУЖЕН УРОВЕНЬ ${itemData.reqLevel}`); socket.emit('playSound', 'defeat'); return; }
            if (p.equipment[itemData.type]) p.inventory.push(p.equipment[itemData.type]);
            p.equipment[itemData.type] = itemId; p.inventory.splice(invIndex, 1);
            if (p.inventory.length > getMaxInv(p)) { socket.emit('terminalError', `ПРЕВЫШЕН ЛИМИТ ВЕСА!`); }
            socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
        }
    });

    socket.on('unequipItem', (slot) => {
        let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.equipment[slot]) return;
        if (p.inventory.length >= getMaxInv(p) && slot !== 'backpack') { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
        p.inventory.push(p.equipment[slot]); p.equipment[slot] = null;
        socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
    });

    // ===== БЫСТРЫЕ СЛОТЫ (пояс) — было пропущено =====
    socket.on('setQuickSlot', (data) => {
        let p = db.players[onlinePlayers[socket.id]]; if (!p) return;
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
        let p = db.players[onlinePlayers[socket.id]]; if (!p) return;
        if (!p.quickSlots) p.quickSlots = [null, null];
        if (p.quickSlots[idx]) {
            if (p.inventory.length >= getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
            p.inventory.push(p.quickSlots[idx]); p.quickSlots[idx] = null;
            socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
        }
    });

    socket.on('useQuickSlot', (idx) => {
        let p = db.players[onlinePlayers[socket.id]]; let combat = activeCombats[onlinePlayers[socket.id]];
        if (!p || !p.quickSlots || !p.quickSlots[idx]) return;
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
                    let u = onlinePlayers[socket.id];
                    oppCombat.logs.push(`> [ДУЭЛЬ] ${u} применил спецсредство ${itemData.name}: -${dmg} HP!`);
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
        let username = onlinePlayers[socket.id]; let p = db.players[username]; let combat = activeCombats[username];
        if (!p || !p.inventory[invIndex]) return;
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
        let { wIdx, mIdx } = data; let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.inventory[wIdx] || !p.inventory[mIdx]) return;
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

    // ===== КРАФТ (было пропущено) =====
    socket.on('craftItem', (itemId) => {
        let p = db.players[onlinePlayers[socket.id]]; if (!p) return;
        const RECIPES = {
            weapon_pipe: ['mat_scrap', 'mat_tape'],
            food_medkit: ['mat_chem', 'food_ration'],
            special_shocker: ['mat_electro', 'mat_scrap'],
            tool_robot: ['mat_electro', 'mat_scrap', 'mat_tape']
        };
        let recipe = RECIPES[itemId];
        if (!recipe) { socket.emit('terminalError', 'РЕЦЕПТ НЕ НАЙДЕН.'); return; }
        let tempInv = [...p.inventory];
        for (let ing of recipe) {
            let idx = tempInv.indexOf(ing);
            if (idx === -1) { socket.emit('terminalError', `НУЖНО: ${GAME_ITEMS[ing] ? GAME_ITEMS[ing].name : ing}`); return; }
            tempInv.splice(idx, 1);
        }
        if (p.inventory.length - recipe.length + 1 > getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПЕРЕПОЛНЕН.'); return; }
        for (let ing of recipe) {
            let idx = p.inventory.indexOf(ing);
            if (idx !== -1) p.inventory.splice(idx, 1);
        }
        p.inventory.push(itemId);
        socket.emit('playSound', 'equip'); socket.emit('terminalError', `СОБРАНО: ${GAME_ITEMS[itemId].name}`);
        saveDB(); broadcastGameState();
    });

    // ===== ФАРМ СЛИЗИ (было пропущено) =====
    socket.on('work', () => {
        let username = onlinePlayers[socket.id]; let p = db.players[username]; if (!p) return;
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
        let username = onlinePlayers[socket.id]; let p = db.players[username]; if (!p) return;
        let idx = p.inventory.indexOf('tool_robot');
        if (idx === -1) { socket.emit('terminalError', 'НЕТ АВТОСБОРЩИКА В СУНДУКЕ.'); return; }
        let currentFloor = p.floor || 0;
        let locKey = `${currentFloor}_${p.location}`;
        p.inventory.splice(idx, 1); p.robots[locKey] = 0;
        socket.emit('playSound', 'equip'); socket.emit('terminalError', 'АВТОСБОРЩИК УСТАНОВЛЕН.');
        saveDB(); broadcastGameState();
    });
    socket.on('collectRobot', () => {
        let username = onlinePlayers[socket.id]; let p = db.players[username]; if (!p) return;
        let currentFloor = p.floor || 0;
        let locKey = `${currentFloor}_${p.location}`;
        if (p.robots[locKey] === undefined) return;
        let amount = p.robots[locKey];
        if (amount <= 0) { socket.emit('terminalError', 'РОБОТ ПУСТ.'); return; }
        if (p.inventory.length + 1 > getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
        p.talons += amount; p.robots[locKey] = 0;
        socket.emit('playSound', 'buy'); socket.emit('terminalError', `СОБРАНО ТАЛОНОВ: ${amount}`);
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
            socket.emit('combatStart', {
                enemy: {
                    name: `[ЗАКЛЮЧЕННЫЙ] ${defender}`,
                    hp: pd.hp,
                    maxHp: pd.maxHp,
                    dmg: getPlayerStats(pd).dmg,
                    isPlayer: true,
                    skin: pd.appearance ? pd.appearance.skin : 'skin_1',
                    equipment: pd.equipment || {}
                }
            });
            io.to(targetId).emit('combatStart', {
                enemy: {
                    name: `[ЗАКЛЮЧЕННЫЙ] ${attacker}`,
                    hp: pa.hp,
                    maxHp: pa.maxHp,
                    dmg: getPlayerStats(pa).dmg,
                    isPlayer: true,
                    skin: pa.appearance ? pa.appearance.skin : 'skin_1',
                    equipment: pa.equipment || {}
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
        if (!pi || !pt || pi.location !== pt.location) return;
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
        if (!pa || !pi || pa.location !== pi.location) return;
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
        let now = Date.now();
        if (now - lastCoopTime < 1000) { socket.emit('terminalError', 'ПЕРЕЗАРЯДКА ЛЕЧЕНИЯ (1 сек).'); return; }
        lastCoopTime = now;
        let pt = db.players[target]; if (!pt) return;
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

    socket.on('explore', () => {
        let username = onlinePlayers[socket.id]; let p = db.players[username]; let currentFloor = p.floor || 0;
        if (!p || p.location === 'safe_room' || activeCombats[username]) return;
        if (p.hp <= 0) { socket.emit('terminalError', 'КРИТИЧЕСКОЕ СОСТОЯНИЕ.'); return; }
        if (p.filter < 10) { socket.emit('terminalError', 'НЕДОСТАТОЧНО ФИЛЬТРА.'); return; }
        if (p.location === 'E4') {
            if (p.bossDefeated && p.bossDefeated[currentFloor]) { socket.emit('terminalError', 'ЛИФТ УЖЕ ЗАПУЩЕН.'); return; }
            const cfg = FLOOR_CONFIGS[currentFloor] || FLOOR_CONFIGS[0];
            const neededKeys = cfg.elevatorKeys || ['quest_lift_repair', 'quest_lift_buttons', 'quest_lift_wire'];
            let missing = [];
            for (let k of neededKeys) {
                let hasKey = (p.foundItems && p.foundItems.includes(k)) || (p.questItems && p.questItems.includes(k));
                if (!hasKey) missing.push(GAME_ITEMS[k] ? GAME_ITEMS[k].name : k);
            }
            if (missing.length > 0) {
                let hint = cfg.elevatorHint || `ЛИФТ НЕ АКТИВИРОВАН. Требуются: ${missing.join(', ')}.`;
                socket.emit('terminalError', hint);
                socket.emit('playSound', 'click');
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
        let username = onlinePlayers[socket.id]; let combat = activeCombats[username]; let p = db.players[username];
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
        let username = onlinePlayers[socket.id]; let combat = activeCombats[username]; let p = db.players[username];
        if (!combat || !p) return;
        combat.paused = false;
        if (success) { combat.logs.push(`> [УСПЕХ] РЕАКТОР СТАБИЛИЗИРОВАН!`); combat.sounds.push('victory'); }
        else { combat.logs.push(`> [ПРОМАХ] ВЗРЫВ!`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= 40; }
    });

    socket.on('resolveEvent', (choiceId) => {
        let username = onlinePlayers[socket.id];
        let p = db.players[username];
        if (!p || !p.activeEvent) return;
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
        if (choice.reqCost) p.talons -= choice.reqCost;

        let isWin = Math.random() <= (choice.chance !== undefined ? choice.chance : 1);
        let log = "";
        if (isWin) {
            log = choice.winLog || "> Успех.";
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

    socket.on('disconnect', () => {
        let u = onlinePlayers[socket.id];
        if (u) {
            if (activeCombats[u]) {
                let c = activeCombats[u];
                if (c.isPvP && c.opponent) {
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
                if (c.isGlobal && globalBosses[`boss_${c.floor}`]) {
                    globalBosses[`boss_${c.floor}`].participants.delete(u);
                }
                delete activeCombats[u];
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
            gb.participants.forEach(u => {
                let combat = activeCombats[u]; let p = db.players[u]; let socketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === u);
                if (combat && p && socketId && !combat.paused) {
                    let eDmg = Math.max(1, gb.dmg - Math.floor(getPlayerStats(p).def / 5));
                    if (combat.pDodging) {
                        if (Math.random() < 0.75) { combat.logs.push(`> УКЛОНЕНИЕ ОТ БОССА!`); combat.sounds.push('dodge'); combat.vfx.push('player_dodge'); combat.pCritNext = true; combat.pDodging = false; eDmg = 0; }
                        else { combat.logs.push(`> БОСС ПОПАЛ! -${eDmg} HP.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); combat.pDodging = false; }
                    } else { combat.logs.push(`> [БОСС] АТАКА! -${eDmg} HP.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); }
                }
            });
        }
        if (gb.hp <= 0) {
            gb.participants.forEach(u => {
                let combat = activeCombats[u]; let p = db.players[u]; let socketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === u);
                if (combat && p && socketId) {
                    let log = combat.logs.join('\n') + '\n';
                    p.talons += gb.reward; p.xp += gb.xp; p.monstersKilled = (p.monstersKilled || 0) + 1;
                    log += `> БОСС ${gb.name} ПОВЕРЖЕН! +${gb.reward} талонов, +${gb.xp} XP.\n`;
                    if (gb.isElevatorBoss) {
                        if (!p.bossDefeated) p.bossDefeated = {}; p.bossDefeated[p.floor || 0] = true;
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
                    io.to(socketId).emit('combatEnd', { log: log, enemy: gb, win: true }); delete activeCombats[u];
                }
            });
            delete globalBosses[bossKey]; saveDB(); broadcastGameState();
            continue;
        }
        gb.participants.forEach(u => {
            let combat = activeCombats[u]; let p = db.players[u]; let socketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === u);
            if (combat && p && socketId && !combat.paused) {
                gb.pTimers[u] -= 0.25;
                if (gb.pTimers[u] <= 0) { gb.pTimers[u] = 2.0 / getSpeedMult(p.filter); executePlayerAttackGlobal(u, combat, gb, getPlayerStats(p), p); }
                if (p.hp <= 0) {
                    let log = combat.logs.join('\n') + '\n> ЭВАКУАЦИЯ.';
                    p.hp = 0; p.talons = Math.floor(p.talons / 2); p.location = 'safe_room';
                    io.to(socketId).emit('combatEnd', { log: log, enemy: gb, win: false }); delete activeCombats[u]; gb.participants.delete(u);
                } else if (combat.logs.length > 0) {
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
        combat.pTimer -= 0.25; combat.eTimer -= 0.25; combat.logs = []; combat.sounds = []; combat.vfx = [];
        if (combat.eTimer <= 0) {
            combat.eTimer = 2.0;
            if (Math.random() < 0.2) { combat.eDodging = true; combat.logs.push(`> Враг готовит рывок.`); }
            else {
                let eDmg = Math.max(1, combat.enemy.dmg - Math.floor(getPlayerStats(p).def / 5));
                if (combat.pDodging) {
                    if (Math.random() < 0.75) { combat.logs.push(`> УКЛОНЕНИЕ!`); combat.sounds.push('dodge'); combat.vfx.push('player_dodge'); combat.pCritNext = true; combat.pDodging = false; eDmg = 0; }
                    else { combat.logs.push(`> ВРАГ ПОПАЛ! -${eDmg} HP.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); combat.pDodging = false; }
                } else { combat.logs.push(`> ВРАГ АТАКУЕТ! -${eDmg} HP.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); }
            }
        }
        if (combat.pTimer <= 0 && !combat.paused) { combat.pTimer = 2.0 / getSpeedMult(p.filter); executePlayerAttack(username, combat, getPlayerStats(p), p); }
        if (p.hp <= 0 || combat.enemy.hp <= 0) {
            let log = combat.logs.join('\n') + '\n';
            if (p.hp > 0) {
                if (p.perks.includes('perk_vampire')) { p.hp = Math.min(p.maxHp, p.hp + 5); log += `> +5 HP (вампиризм).\n`; }
                p.talons += combat.enemy.reward; p.xp += combat.enemy.xp; p.monstersKilled = (p.monstersKilled || 0) + 1;
                log += `> ВРАГ ПОВЕРЖЕН! +${combat.enemy.reward} талонов, +${combat.enemy.xp} XP.\n`;
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
            io.to(socketId).emit('combatTick', { enemyHp: combat.enemy.hp, enemyMaxHp: combat.enemy.maxHp, logs: combat.logs, sounds: combat.sounds, vfx: combat.vfx }); broadcastGameState();
        }
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