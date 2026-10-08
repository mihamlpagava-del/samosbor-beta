const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.enable('trust proxy');

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

function flushDBSync() {
    if (!isDbDirty) return;
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
        isDbDirty = false;
    } catch (err) {
        writeLog(`Ошибка синхронной записи БД: ${err.message}`);
    }
}

function flushDBAsync() {
    if (!isDbDirty || isSavingDb) return;
    isSavingDb = true;
    try {
        const data = JSON.stringify(db, null, 2);
        fs.writeFile(DB_FILE, data, 'utf8', (err) => {
            isSavingDb = false;
            if (err) {
                writeLog(`Ошибка асинхронной записи БД: ${err.message}`);
            } else {
                isDbDirty = false;
            }
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
    quest_lift_wire: { name: "Провод генератора", type: "quest", color: '#ffaa00', paperColor: '#a65300' }
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
    { id: 'mg_1', type: 'password', title: 'СТЕРТАЯ КЛАВИАТУРА', text: 'Стерты цифры 2, 5, 8, 9. Сумма первых двух = 7, вторая больше первой, последняя наибольшая.', answer: '2589' },
    { id: 'mg_2', type: 'password', title: 'СЕЙФ КОМЕНДАНТА', text: 'Записка: «Самосбор был 14 июля. Код дата спустя неделю (ДДММ)».', answer: '2107' },
    { id: 'mg_9', type: 'voltage', title: 'ПОДСТАНЦИЯ', text: 'Откалибровать напряжение на 80W.', target: 80 }
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
        5: { name: "СМОТРИТЕЛЬ СЛИЗИ [РЕЙД-БОСС]", hp: 1500, dmg: 25, reward: 300, xp: 800, img: "boss_slime.png", lore: "[ДНЕВНИК]: Смотритель пал." },
        10: { name: "АРХИВАРИУС [РЕЙД-БОСС]", hp: 3000, dmg: 45, reward: 700, xp: 1500, img: "boss_arch.png", lore: "[ДНЕВНИК]: Самосбор — обновление здания." },
        15: { name: "ЖИВОЙ РЕАКТОР [РЕЙД-БОСС]", hp: 5000, dmg: 80, reward: 1200, xp: 3000, img: "boss_reactor.png", lore: "[ДНЕВНИК]: Ядро остыло." },
        20: { name: "КОМЕНДАНТ БЛОКА [РЕЙД-БОСС]", hp: 8000, dmg: 120, reward: 2000, xp: 5000, img: "boss_com.png", lore: "[ДНЕВНИК]: Комендант мертв." },
        30: { name: "ЧЕРНОБОГ [ФИНАЛ]", hp: 15000, dmg: 250, reward: 5000, xp: 15000, img: "boss_final.png", lore: "[ДНЕВНИК]: Цикл разорван." }
    };
    if (storyBosses[f]) return storyBosses[f];
    return { name: `АНОМАЛИЯ [РЕЙД ЭТ.${f}]`, hp: 500 + (f*200), dmg: 15 + (f*4), reward: 100 + (f*10), xp: 300 + (f*60), img: "m_hive.png", lore: `[ДНЕВНИК]: Путь на этаж ${f+1} очищен.` };
}

const RANDOM_EVENTS = [
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
        id: 'npc_stalker',
        title: 'ВСТРЕЧА: СТАЛКЕР ГЛЕБ',
        text: 'У самодельной печурки греется сталкер. «Садись к огню. В этом блоке Туман злой... Могу рассказать байку о том, что творится ниже, а могу обменяться хабаром».',
        choices: [
            { id: 'listen_story', text: 'Послушать историю о Самосборе', winXp: 35, winNotebook: '[СТАЛКЕР ГЛЕБ]: «Самосбор — это не болезнь, а дыхание гигахрущевки. Не пытайся с ним спорить, учись вовремя задраивать люки».', winLog: '> Вы выслушали сталкера и узнали о повадках Тумана (+35 XP).' },
            { id: 'share_food', text: 'Угостить Слизью (нужен 1 брикет)', reqItem: 'food_ration', winQuestItem: 'quest_fuse', winLog: '> Сталкер поблагодарил: «Держи Предохранитель, мне без надобности, а тебе дверь в щитовую откроет! (+Предохранитель)».', failLog: '> У вас нет брикета слизи.' },
            { id: 'leave', text: 'Пожелать удачи и уйти', winLog: '> Вы продолжили путь.' }
        ]
    },
    {
        id: 'npc_liquidator',
        title: 'ВСТРЕЧА: РАНЕНЫЙ ЛИКВИДАТОР',
        text: 'Боец в тяжелой броне сидит у стены. Стекло шлема треснуло, дыхание с хрипом: «Брат... Наш отряд накрыло в цеху. Фильтр пробит. Помоги сбить токсин, отдам снаряжение!»',
        choices: [
            { id: 'cure_liquidator', text: 'Помочь Химикатами (нужны Химикаты)', reqItem: 'mat_chem', winQuestItem: 'quest_red_card', winXp: 50, winLog: '> Ликвидатор принял состав: «Спасибо, выкарабкаюсь... Держи Красную ключ-карту от поста ВОХР! (+Красная ключ-карта, +50 XP)».', failLog: '> У вас нет Химикатов.' },
            { id: 'loot_liquidator', text: '[РИСК] Обыскать карманы бойца', chance: 0.65, winLoot: 'clothes_guard_rare', winTalons: 40, winLog: '> Вы забрали форму ВОХР и 40 талонов.', failHp: -30, failLog: '> Ликвидатор отбился прикладом и сорвал маску! (-30 HP)' },
            { id: 'leave', text: 'Оставить его', winLog: '> Вы тихо удалились.' }
        ]
    },
    {
        id: 'npc_scientist',
        title: 'ВСТРЕЧА: ОБЕЗУМЕВШИЙ УЧЕНЫЙ',
        text: 'Человек в рваном халате НИИ чертит формулы мелом: «Они не понимают! Самосбор можно подчинить! Хочешь испытать экспериментальную сыворотку Партии?»',
        choices: [
            { id: 'take_stim', text: '[РИСК] Принять сыворотку', chance: 0.5, winHp: 50, winXp: 60, winLog: '> Прилив сил! Здоровье восстановилось, разум обострился! (+50 HP, +60 XP)', failHp: -25, failLog: '> Препарат вызвал токсический шок! (-25 HP)' },
            { id: 'buy_notes', text: 'Выкупить детали генератора (60 т.)', reqCost: 60, winQuestItem: 'quest_battery', winLog: '> Ученый отдал вам Топливный элемент от лабораторного генератора! (+Топливный элемент)' },
            { id: 'leave', text: 'Пройти мимо сумасшедшего', winLog: '> Вы прошли мимо.' }
        ]
    },
    {
        id: 'cache_toolbox',
        title: 'НАХОДКА: РАЗБИТЫЙ ЯЩИК СЛЕСАРЯ',
        text: 'В технической нише валяется перевернутый ящик аварийной сантехнической бригады.',
        choices: [
            { id: 'take_tools', text: 'Обыскать ящик', winQuestItem: 'quest_boltcutter', winTalons: 20, winLog: '> Вы нашли Ржавый болторез и 20 талонов! (+Болторез)' }
        ]
    },
    {
        id: 'cache_corpse',
        title: 'НАХОДКА: ОСТАНКИ КОНВОИРА',
        text: 'У развороченного электрощитка лежат останки конвоира в разорванной шинели.',
        choices: [
            { id: 'search_corpse', text: 'Осмотреть тело', winQuestItem: 'quest_battery', winLoot: 'special_knife', winLog: '> Найден Топливный элемент и Метательный нож!' }
        ]
    },
    {
        id: 'find_lift_repair',
        title: 'НАХОДКА: ЗАПЧАСТИ ЛИФТА',
        text: 'Среди груды механизмов виднеется опечатанный ящик со знаком службы главного лифта.',
        choices: [
            { id: 'take_repair', text: 'Забрать Ремкомплект лифта', winQuestItem: 'quest_lift_repair', winLog: '> Найден Ремкомплект лифта!' }
        ]
    },
    {
        id: 'find_lift_buttons',
        title: 'НАХОДКА: ПАНЕЛЬ УПРАВЛЕНИЯ',
        text: 'На стене сорванная панель диспетчера со связкой проводов и кнопок.',
        choices: [
            { id: 'take_buttons', text: 'Снять Блок кнопок', winQuestItem: 'quest_lift_buttons', winLog: '> Найден Блок кнопок лифта!' }
        ]
    },
    {
        id: 'cache_fusebox',
        title: 'НАХОДКА: РАСПРЕДЕЛИТЕЛЬНЫЙ ЩИТ',
        text: 'На обугленной стене висит полуоткрытый щиток автоматики. Внутри тускло блестит керамический корпус.',
        choices: [
            { id: 'take_fuse', text: 'Извлечь Предохранитель', winQuestItem: 'quest_fuse', winLog: '> Вы аккуратно вытащили рабочий Предохранитель! (+Предохранитель)' }
        ]
    },
    {
        id: 'find_lift_wire',
        title: 'НАХОДКА: СИЛОВОЙ КАБЕЛЬ',
        text: 'Из резервного генератора торчит неповрежденный медный силовой кабель.',
        choices: [
            { id: 'take_wire', text: 'Срезать Провод генератора', winQuestItem: 'quest_lift_wire', winLog: '> Найден Провод генератора!' }
        ]
    }
];

function getRandomEventForPlayer(p, currentFloor) {
    let pool = [];
    let hasFound = (id) => (p.foundItems && p.foundItems.includes(id)) || (p.questItems && p.questItems.includes(id));

    if (!hasFound('quest_lift_repair')) pool.push(RANDOM_EVENTS.find(e => e.id === 'find_lift_repair'));
    if (!hasFound('quest_lift_buttons')) pool.push(RANDOM_EVENTS.find(e => e.id === 'find_lift_buttons'));
    if (!hasFound('quest_lift_wire')) pool.push(RANDOM_EVENTS.find(e => e.id === 'find_lift_wire'));
    if (!hasFound('quest_boltcutter')) pool.push(RANDOM_EVENTS.find(e => e.id === 'cache_toolbox'));
    if (!hasFound('quest_fuse')) pool.push(RANDOM_EVENTS.find(e => e.id === 'cache_fusebox'));
    if (!hasFound('quest_battery') || !hasFound('quest_red_card')) pool.push(RANDOM_EVENTS.find(e => e.id === 'cache_corpse'));

    pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_trader'));
    pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_stalker'));
    pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_liquidator'));
    pool.push(RANDOM_EVENTS.find(e => e.id === 'npc_scientist'));
    pool.push(RANDOM_EVENTS.find(e => e.id === 'meat_smell'));

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
    const letters = ['A', 'B', 'C', 'D', 'E'];
    let allSectors = [];
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
            let id = `${letters[y]}${x}`;
            if(id !== 'A0' && id !== 'E4') allSectors.push(id);
        }
    }
    allSectors = shuffleArray(allSectors);
    let locks = [];
    ['quest_boltcutter', 'quest_battery', 'quest_red_card', 'quest_fuse'].forEach(item => { locks.push({ type: 'item', val: item }); });
    let mPool = shuffleArray(MINIGAME_POOL).slice(0, 5);
    mPool.forEach(mg => locks.push({ type: 'minigame', val: mg }));
    
    let pool = shuffleArray([...RANDOM_LOC_KEYS, ...RANDOM_LOC_KEYS]);
    let locIdx = 0;

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
                threat: floorIndex === 0 ? 'Низкая' : 'Высокая',
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
        if (!data || !data.vkUserId) return;
        const vkUserId = String(data.vkUserId).replace(/[^0-9]/g, '');
        if (!vkUserId) return;

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

        let possibleMonsters = BASE_MONSTERS.filter(m => currentFloor >= m.minFloor && currentFloor <= m.minFloor + 10);
        if (possibleMonsters.length === 0) possibleMonsters = [BASE_MONSTERS[BASE_MONSTERS.length - 1]];
        let baseMob = Object.assign({}, possibleMonsters[Math.floor(Math.random() * possibleMonsters.length)]);
        let multiplier = (1 + (currentFloor * 0.4)) * 1.8;
        let monster = {
            name: `[ЭЛИТА] ${baseMob.name} [Lvl ${currentFloor + 1}]`,
            hp: Math.floor(baseMob.hp * multiplier),
            maxHp: Math.floor(baseMob.hp * multiplier),
            dmg: Math.floor(baseMob.dmg * (1 + currentFloor * 0.3)),
            reward: Math.floor(baseMob.reward * multiplier * 1.5),
            xp: Math.floor(baseMob.xp * multiplier * 1.5),
            img: baseMob.img,
            isCoopRaid: true,
            loot: [ {id: rollItemWithRarity('food_medkit'), chance: 0.6}, {id: rollItemWithRarity('mat_chem'), chance: 0.5}, {id: rollItemWithRarity('mat_electro'), chance: 0.4} ]
        };

        let raidKey = `coop_${Date.now()}`;
        globalBosses[raidKey] = {
            name: monster.name,
            hp: monster.hp,
            maxHp: monster.maxHp,
            dmg: monster.dmg,
            reward: monster.reward,
            xp: monster.xp,
            img: monster.img,
            isCoopRaid: true,
            loot: monster.loot,
            participants: new Set([inviter, accepter]),
            eTimer: 2.0,
            pTimers: {
                [inviter]: 2.0 / getSpeedMult(pi.filter),
                [accepter]: 2.0 / getSpeedMult(pa.filter)
            }
        };

        activeCombats[inviter] = { isGlobal: true, floor: raidKey, pDodging: false, pCritNext: false, logs: [], sounds: [], vfx: [], paused: false };
        activeCombats[accepter] = { isGlobal: true, floor: raidKey, pDodging: false, pCritNext: false, logs: [], sounds: [], vfx: [], paused: false };

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

    socket.on('explore', () => {
        let username = onlinePlayers[socket.id]; let p = db.players[username]; let currentFloor = p.floor || 0;
        if (!p || p.location === 'safe_room' || activeCombats[username]) return;
        if (p.hp <= 0) { socket.emit('terminalError', 'КРИТИЧЕСКОЕ СОСТОЯНИЕ.'); return; }
        if (p.filter < 10) { socket.emit('terminalError', 'НЕДОСТАТОЧНО ФИЛЬТРА.'); return; }
        if (p.location === 'E4') {
            if (p.bossDefeated && p.bossDefeated[currentFloor]) { socket.emit('terminalError', 'ЛИФТ УЖЕ ЗАПУЩЕН.'); return; }
            let hasRepair = (p.foundItems && p.foundItems.includes('quest_lift_repair')) || (p.questItems && p.questItems.includes('quest_lift_repair'));
            let hasButtons = (p.foundItems && p.foundItems.includes('quest_lift_buttons')) || (p.questItems && p.questItems.includes('quest_lift_buttons'));
            let hasWire = (p.foundItems && p.foundItems.includes('quest_lift_wire')) || (p.questItems && p.questItems.includes('quest_lift_wire'));
            if (!hasRepair || !hasButtons || !hasWire) { socket.emit('terminalError', 'ЛИФТ РАЗБИТ. Нужны: Ремкомплект, Блок кнопок, Провод.'); socket.emit('playSound', 'click'); return; }
            let bossKey = `boss_${currentFloor}`;
            if (!globalBosses[bossKey]) {
                let bossBase = getBossForFloor(currentFloor);
                globalBosses[bossKey] = { name: bossBase.name, hp: bossBase.hp, maxHp: bossBase.hp, dmg: bossBase.dmg, reward: bossBase.reward, xp: bossBase.xp, img: bossBase.img, isElevatorBoss: true, lore: bossBase.lore, participants: new Set([username]), eTimer: 2.0, pTimers: {} };
            } else { globalBosses[bossKey].participants.add(username); }
            globalBosses[bossKey].pTimers[username] = 2.0 / getSpeedMult(p.filter);
            activeCombats[username] = { isGlobal: true, floor: currentFloor, pDodging: false, pCritNext: false, logs: [], sounds: [], vfx: [], paused: false };
            p.questItems = p.questItems.filter(i => !['quest_lift_repair', 'quest_lift_buttons', 'quest_lift_wire'].includes(i));
            saveDB(); socket.emit('transition', {to: 'combat', text: "ВХОД В ЗОНУ РЕЙДА..."});
            setTimeout(() => { socket.emit('combatStart', { enemy: globalBosses[bossKey] }); broadcastGameState(); }, 2000);
            return;
        }

        // Шанс встретить случайное событие, NPC или тайник с квестовым предметом (28%)
        if (Math.random() < 0.28) {
            let ev = getRandomEventForPlayer(p, currentFloor);
            if (ev) {
                p.activeEvent = ev.id;
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
        p.activeEvent = null;
        let log = "";
        if (ev) {
            let choice = ev.choices.find(c => c.id === choiceId);
            if (choice) {
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

                if (Math.random() <= (choice.chance !== undefined ? choice.chance : 1)) {
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
                        p.notebook.push(choice.winNotebook);
                        log += `\n> Новая запись в блокноте!`;
                    }
                } else {
                    log = choice.failLog || "> Провал.";
                    if (choice.failHp) p.hp += choice.failHp;
                }
            }
        }
        if (p.hp <= 0) {
            p.hp = 0;
            p.talons = Math.floor(p.talons / 2);
            p.location = 'safe_room';
            log += "\n> КРИТИЧЕСКИЙ УРОН: ЭВАКУАЦИЯ В ЖИЛЯЧЕЙКУ.";
        }
        saveDB();
        socket.emit('combatEventResult', log);
        broadcastGameState();
    });

    socket.on('disconnect', () => {
        let u = onlinePlayers[socket.id];
        if (activeCombats[u]) {
            if(activeCombats[u].isGlobal && globalBosses[`boss_${activeCombats[u].floor}`]) globalBosses[`boss_${activeCombats[u].floor}`].participants.delete(u);
            delete activeCombats[u];
        }
        delete onlinePlayers[socket.id];
        broadcastGameState();
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
        if (!p || !socketId || combat.paused) continue;

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