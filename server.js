const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const LOG_FILE = 'server_logs.txt';
function writeLog(message) {
    const time = new Date().toLocaleString('ru-RU');
    const logMsg = `[${time}] ${message}\n`;
    console.log(`[LOG] ${message}`);
    try { fs.appendFileSync(LOG_FILE, logMsg); } catch (err) {}
}

process.on('uncaughtException', (err) => { writeLog(`КРИТИЧЕСКАЯ ОШИБКА: ${err.message}\n${err.stack}`); });
process.on('unhandledRejection', (reason) => { writeLog(`НЕОБРАБОТАННОЕ ОТКЛОНЕНИЕ: ${reason}`); });

const DB_FILE = 'database.json';
let db = { players: {}, map: {} };

if (fs.existsSync(DB_FILE)) {
    try {
        let loadedData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (loadedData.players && loadedData.map) db = loadedData;
        else { db.players = loadedData; db.map = {}; saveDB(); }
    } catch (err) { writeLog(`Ошибка чтения БД: ${err.message}`); }
} else { saveDB(); }

function saveDB() { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (err) {} }

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
    
    quest_hint_1: { name: "Журнал Дегазации", type: "hint", lore: "Вентиляционная шахта. «Сначала открыл тот, что не левый и не правый, потом левый, последним правый».", color: '#ccc', paperColor: '#333' },
    quest_hint_2: { name: "Свечной огарок", type: "hint", lore: "Блэкаут. Свечные огарки: красный 10 см, синий 25, белый 15, чёрный 5. «Зажигай от высокого к низкому».", color: '#ccc', paperColor: '#333' },
    quest_hint_3: { name: "Обрывок схемы", type: "hint", lore: "Манометры показывают 40, 15 и 70. «Давление растёт постепенно».", color: '#ccc', paperColor: '#333' },
    quest_hint_4: { name: "Записка коменданта", type: "hint", lore: "Код сейфа: «Самосбор был 14 июля. Код — дата спустя неделю (ДДММ)».", color: '#ccc', paperColor: '#333' }
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
                color: r.color, 
                paperColor: r.paperColor, 
                iconId: key,
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
    { id: 'perk_lungs', name: 'Луженые Легкие', desc: 'Расход фильтра в Тумане снижен до 7%.' },
    { id: 'perk_butcher', name: 'Мясник', desc: 'Урон от Прицельной атаки (Крита) увеличен на 30%.' },
    { id: 'perk_hoarder', name: 'Барахольщик', desc: 'Шанс выпадения лута с врагов увеличен.' },
    { id: 'perk_vampire', name: 'Вампиризм', desc: 'Восстанавливает 5 HP при убийстве врага.' }
];

const MINIGAME_POOL = [
    { id: 'mg_1', type: 'password', title: 'СТЕРТАЯ КЛАВИАТУРА', text: 'Стерты цифры 2, 5, 8, 9. Сумма первых двух = 7, вторая больше первой, последняя наибольшая.', answer: '2589' },
    { id: 'mg_2', type: 'password', title: 'СЕЙФ КОМЕНДАНТА', text: 'Записка: «Самосбор был 14 июля. Код дата спустя неделю (ДДММ)».', answer: '2107' },
    { id: 'mg_9', type: 'voltage', title: 'ПОДСТАНЦИЯ', text: 'Вам нужно откалибровать напряжение ровно на 80W.', target: 80 }
];

// ==========================================
// БЕСТИАРИЙ САМОСБОРА (30 врагов)
// ==========================================
const BASE_MONSTERS = [
    { id: "m_1", minFloor: 0, name: "Плесень-ползун", hp: 10, dmg: 2, reward: 1, xp: 5, img: "m_mold.png", lore: "Простейшая форма жизни, порожденная испарениями. Не опасна, если не наступать." },
    { id: "m_2", minFloor: 0, name: "Слизневик", hp: 15, dmg: 4, reward: 2, xp: 8, img: "m_slime.png", lore: "Бесформенный сгусток слизи, медленно ползущий по трубам." },
    { id: "m_3", minFloor: 1, name: "Ржавый паразит", hp: 20, dmg: 5, reward: 3, xp: 12, img: "m_parasite.png", lore: "Насекомое-переросток, чьи жвала способны прокусить бетон." },
    { id: "m_4", minFloor: 2, name: "Трубный трупоед", hp: 30, dmg: 7, reward: 5, xp: 15, img: "m_corpse.png", lore: "Питается неудачливыми сталкерами. Часто застревает в вентиляции." },
    { id: "m_5", minFloor: 3, name: "Обезумевший жилец", hp: 45, dmg: 10, reward: 8, xp: 20, img: "m_madman.png", lore: "Человек, забывший закрыть гермодверь. Разум полностью уничтожен туманом." },
    { id: "m_6", minFloor: 4, name: "Туманный утопленник", hp: 60, dmg: 12, reward: 10, xp: 25, img: "m_drowned.png", lore: "Разбухшее тело, источающее запах озона и хлорки." },
    { id: "m_7", minFloor: 5, name: "Безглазый конвоир", hp: 80, dmg: 15, reward: 12, xp: 35, img: "m_guard.png", lore: "Бывший сотрудник Партии. Оружие давно сгнило, но рефлексы остались." },
    { id: "m_8", minFloor: 6, name: "Червеобразный нарост", hp: 90, dmg: 18, reward: 15, xp: 45, img: "m_worm.png", lore: "Пульсирующая биомасса, проросшая сквозь арматуру." },
    { id: "m_9", minFloor: 7, name: "Мясной культист", hp: 110, dmg: 22, reward: 18, xp: 55, img: "m_cultist.png", lore: "Они поклоняются Самосбору как очищающему божеству." },
    { id: "m_10", minFloor: 8, name: "Адепт Чернобога", hp: 130, dmg: 25, reward: 22, xp: 70, img: "m_adept.png", lore: "Одет в рваные ризы. Пытается общаться с туманом на неизвестном языке." },
    { id: "m_11", minFloor: 9, name: "Паук-арматурщик", hp: 150, dmg: 30, reward: 25, xp: 85, img: "m_spider.png", lore: "Соткан из кусков бетона, плоти и стальных прутьев." },
    { id: "m_12", minFloor: 10, name: "Гончая Тумана", hp: 180, dmg: 35, reward: 30, xp: 100, img: "m_hound.png", lore: "Быстрая, смертоносная тварь. Появляется только при густом тумане." },
    { id: "m_13", minFloor: 11, name: "Мутировавший сварщик", hp: 210, dmg: 40, reward: 35, xp: 120, img: "m_welder.png", lore: "Баллон с газом врос в его спину. Очень опасен вблизи." },
    { id: "m_14", minFloor: 12, name: "Свинорыл из столовой", hp: 250, dmg: 45, reward: 40, xp: 140, img: "m_pig.png", lore: "Ужасающая мутация поваров из пищеблока." },
    { id: "m_15", minFloor: 13, name: "Некро-сантехник", hp: 280, dmg: 50, reward: 45, xp: 160, img: "m_plumber.png", lore: "Сжимает в руках огромный разводной ключ." },
    { id: "m_16", minFloor: 14, name: "Зараженный Ликвидатор", hp: 320, dmg: 55, reward: 55, xp: 180, img: "m_liquidator.png", lore: "Их посылали зачищать этажи. Теперь они сами стали угрозой." },
    { id: "m_17", minFloor: 15, name: "Токсичный плевун", hp: 350, dmg: 60, reward: 65, xp: 210, img: "m_spitter.png", lore: "Плюется концентрированной слизью, разъедающей фильтры." },
    { id: "m_18", minFloor: 16, name: "Бронированный мясник", hp: 400, dmg: 65, reward: 75, xp: 240, img: "m_butcher.png", lore: "Покрыт панцирем из запекшегося цемента." },
    { id: "m_19", minFloor: 17, name: "Ходячий улей слизи", hp: 450, dmg: 70, reward: 85, xp: 280, img: "m_hive.png", lore: "Носитель тысяч мелких паразитов." },
    { id: "m_20", minFloor: 18, name: "Проповедник Бетона", hp: 500, dmg: 80, reward: 100, xp: 320, img: "m_preacher.png", lore: "Читает леденящие душу мантры, от которых лопаются лампочки." },
    { id: "m_21", minFloor: 19, name: "Искаженный дезертир", hp: 550, dmg: 90, reward: 115, xp: 360, img: "m_deserter.png", lore: "Тот, кто попытался сбежать из Блока, но заблудился в лабиринтах." },
    { id: "m_22", minFloor: 20, name: "Амальгама плоти", hp: 620, dmg: 100, reward: 130, xp: 400, img: "m_amalgam.png", lore: "Слияние десятков тел в единую пульсирующую массу." },
    { id: "m_23", minFloor: 21, name: "Гигантская сколопендра", hp: 700, dmg: 110, reward: 150, xp: 450, img: "m_centipede.png", lore: "Обитатель самых глубоких вентиляционных шахт." },
    { id: "m_24", minFloor: 22, name: "Биомеханический страж", hp: 800, dmg: 125, reward: 180, xp: 520, img: "m_biomech.png", lore: "Проект Партии, вышедший из-под контроля." },
    { id: "m_25", minFloor: 23, name: "Пожиратель фильтров", hp: 900, dmg: 140, reward: 210, xp: 600, img: "m_eater.png", lore: "Охотится исключительно за свежим углем и воздухом." },
    { id: "m_26", minFloor: 24, name: "Тень Самосбора", hp: 1050, dmg: 160, reward: 250, xp: 700, img: "m_shadow.png", lore: "Нематериальная сущность. Поглощает свет вокруг себя." },
    { id: "m_27", minFloor: 25, name: "Сросшиеся близнецы", hp: 1200, dmg: 180, reward: 300, xp: 850, img: "m_twins.png", lore: "Ужасающая аномалия, разделяющая один разум на два тела." },
    { id: "m_28", minFloor: 26, name: "Жрец Кровавого Цемента", hp: 1400, dmg: 210, reward: 350, xp: 1000, img: "m_priest.png", lore: "Хранитель нижних уровней. Его шепот сводит с ума." },
    { id: "m_29", minFloor: 27, name: "Архитектор плоти", hp: 1650, dmg: 250, reward: 420, xp: 1250, img: "m_architect.png", lore: "Тот, кто лепит стены Гигахрущевки из останков." },
    { id: "m_30", minFloor: 28, name: "Истинный обитатель Тумана", hp: 2000, dmg: 300, reward: 550, xp: 1600, img: "m_true.png", lore: "Абсолютный кошмар. Встреча с ним — верная смерть." }
];

function generateShop() {
    let pool = ['food_ration', 'food_pure', 'food_medkit', 'mat_chem', 'mat_electro', 'mat_scrap', 'mat_tape', 'special_knife', 'special_shocker', 'backpack_small', 'backpack_med', ...Object.keys(BASE_EQUIP).filter(k=>BASE_EQUIP[k].type!=='backpack')];
    pool.sort(() => 0.5 - Math.random());
    currentShopItems = pool.slice(0, 6).map(id => rollItemWithRarity(id));
    nextShopUpdate = Date.now() + 10 * 60 * 1000;
    broadcastGameState(); 
}
setInterval(generateShop, 10 * 60 * 1000);
generateShop(); 

function getBossForFloor(f) {
    const storyBosses = {
        5: { name: "СМОТРИТЕЛЬ СЛИЗИ [РЕЙД-БОСС]", hp: 1500, dmg: 25, reward: 300, xp: 800, img: "boss_slime.png", lore: "[ДНЕВНИК]: Смотритель пал. Блок строит сам себя. Мы просто ресурс." },
        10: { name: "АРХИВАРИУС [РЕЙД-БОСС]", hp: 3000, dmg: 45, reward: 700, xp: 1500, img: "boss_arch.png", lore: "[ДНЕВНИК]: Самосбор — это процесс 'обновления' здания." },
        15: { name: "ЖИВОЙ РЕАКТОР [РЕЙД-БОСС]", hp: 5000, dmg: 80, reward: 1200, xp: 3000, img: "boss_reactor.png", lore: "[ДНЕВНИК]: Ядро остыло. Гигахрущевка не имеет выхода наружу." },
        20: { name: "КОМЕНДАНТ БЛОКА [РЕЙД-БОСС]", hp: 8000, dmg: 120, reward: 2000, xp: 5000, img: "boss_com.png", lore: "[ДНЕВНИК]: Комендант мертв. Он сам запер нас здесь сотни лет назад." },
        30: { name: "ЧЕРНОБОГ [ФИНАЛ]", hp: 15000, dmg: 250, reward: 5000, xp: 15000, img: "boss_final.png", lore: "[ДНЕВНИК]: Цикл разорван. Двери Главного Шлюза открыты..." }
    };
    if (storyBosses[f]) return storyBosses[f];
    return { name: `АНОМАЛИЯ [РЕЙД ЭТ.${f}]`, hp: 500 + (f*200), dmg: 15 + (f*4), reward: 100 + (f*10), xp: 300 + (f*60), img: "m_hive.png", lore: `[ДНЕВНИК]: Путь на этаж ${f+1} очищен.` };
}

const RANDOM_EVENTS = [
    { id: 'meat_smell', title: 'ЗАПАХ СЫРОГО МЯСА', text: 'Резкий запах озона бьет в нос.', choices: [{ id: 'run', text: '[РИСК] Бежать', chance: 0.6, winHp: 0, failHp: -20 }, { id: 'hide', text: 'Спрятаться', chance: 0.8, winHp: 0, failHp: -10 }] },
    { id: 'npc_trader', title: 'ВСТРЕЧА: БАРЫГА ИЗ ТУМАНА', text: 'Незнакомец предлагает редкую вещь за 150 талонов.', choices: [
        { id: 'buy', text: 'Купить (150 т.)', chance: 1, reqCost: 150, winLoot: 'weapon_pistol_rare', winLog: '> Вы купили Редкий Пистолет.' },
        { id: 'leave', text: 'Отказаться', chance: 1, winLog: '> Вы прошли мимо.' }
    ]}
];

const SECTOR_NAMES = ["Гермошлюз", "Вентшахта", "Цех", "Техкоридор", "Узел связи", "Насосная", "Склад", "Резервуар", "Медблок", "Карантин", "Бойлерная", "Генераторная", "Столовая", "Морозильники", "Гидропоника", "Очистные"];
const LOC_TEMPLATES = [{ bg: 'bg_corridor.png' }, { bg: 'bg_hydro.png' }, { bg: 'bg_shaft.png' }, { bg: 'bg_flesh.png' }];

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
    allSectors.sort(() => 0.5 - Math.random());
    
    let locks = [];
    ['quest_boltcutter', 'quest_battery', 'quest_red_card', 'quest_fuse'].forEach(item => { locks.push({ type: 'item', val: item }); });
    let mPool = [...MINIGAME_POOL].sort(() => 0.5 - Math.random()).slice(0, 5);
    mPool.forEach(mg => locks.push({ type: 'minigame', val: mg }));

    let nameIndex = 0;
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
            let sectorId = `${letters[y]}${x}`;
            let sName = SECTOR_NAMES[nameIndex % SECTOR_NAMES.length];
            let reqType = null; let reqValue = null;
            if (sectorId !== 'A0' && sectorId !== 'E4') {
                let lockIdx = allSectors.indexOf(sectorId);
                if (lockIdx < locks.length) { reqType = locks[lockIdx].type; reqValue = locks[lockIdx].val; }
            }
            db.map[floorIndex][sectorId] = { id: sectorId, name: `${sName} [Эт.${floorIndex}]`, bg: LOC_TEMPLATES[Math.floor(Math.random() * LOC_TEMPLATES.length)].bg, threat: floorIndex === 0 ? 'Низкая' : 'Высокая', reqType: reqType, reqValue: reqValue };
            nameIndex++;
        }
    }
    saveDB();
}
db.map = {}; generateFloor(0);

function getPlayerStats(player) {
    let stats = { hp: player.hp, maxHp: player.maxHp, filter: player.filter, dmg: 1, def: 0 };
    if (player.equipment) {
        if (player.equipment.weapon && GAME_ITEMS[player.equipment.weapon]) stats.dmg += GAME_ITEMS[player.equipment.weapon].dmg || 0;
        if (player.equipment.clothes && GAME_ITEMS[player.equipment.clothes]) stats.def += GAME_ITEMS[player.equipment.clothes].def || 0;
        if (player.equipment.mask && GAME_ITEMS[player.equipment.mask]) stats.def += GAME_ITEMS[player.equipment.mask].def || 0;
        if (player.equipment.backpack && GAME_ITEMS[player.equipment.backpack]) stats.def += GAME_ITEMS[player.equipment.backpack].def || 0;
    }
    if (player.mutations && player.mutations.includes('mut_strong')) { stats.dmg = Math.floor(stats.dmg * 1.2); stats.def = Math.floor(stats.def * 0.5); }
    if (player.mutations && player.mutations.includes('mut_skin')) { stats.def = Math.floor(stats.def * 1.5); }
    return stats;
}

function broadcastGameState() {
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

    socket.on('login', (data) => {
        const { username, password } = data;
        writeLog(`Вход: Пользователь ${username} пытается подключиться.`);
        try {
            if (db.players[username] && db.players[username].password !== password) { 
                writeLog(`Вход отклонён: неверный пароль для ${username}.`);
                socket.emit('terminalError', 'ОШИБКА ДОСТУПА: НЕВЕРНЫЙ ПАРОЛЬ'); 
                return; 
            } 
            else if (!db.players[username]) {
                writeLog(`Регистрация: создан новый профиль ${username}.`);
                db.players[username] = {
                    password: password, talons: 0, hp: 100, maxHp: 100, filter: 100, hunger: 100, tox: 0, level: 1, xp: 0, monstersKilled: 0, roomsCleared: 0, rating: 0, playtime: 0,
                    appearance: null, location: 'safe_room', floor: 0, activeEvent: null,
                    unlockedSectors: { 0: ['A0'] }, questItems: [], foundItems: [], quickSlots: [null, null], solvedGames: [], bossDefeated: {}, perks: [], mutations: [], robots: {},
                    notebook: ["[ВВОДНАЯ]: Я помню только лязг рвущегося троса. Путь наверх отрезан. Придется спускаться вниз, к Главному Лифту в секторе E4."], 
                    equipment: { weapon: 'weapon_wood', clothes: 'clothes_robe', mask: 'mask_cloth', backpack: null }, inventory: ['food_ration'] 
                };
                saveDB();
            }
            onlinePlayers[socket.id] = username;
            socket.emit('loginSuccess', { username, showIntro: db.players[username].appearance === null });
            if (db.players[username].appearance !== null) socket.emit('startGame');
            broadcastGameState();
            writeLog(`Успешный вход: ${username}`);
        } catch (err) {
            writeLog(`ОШИБКА LOGIN: ${err.message}`);
        }
    });

    socket.on('saveCharacter', (appData) => { 
        if (onlinePlayers[socket.id]) { 
            let p = db.players[onlinePlayers[socket.id]];
            let randomSkinNum = Math.floor(Math.random() * 10) + 1;
            p.appearance = { skin: 'skin_' + randomSkinNum };
            saveDB(); socket.emit('startGame'); broadcastGameState(); 
            writeLog(`Пользователь ${onlinePlayers[socket.id]} завершил интро. Скин: skin_${randomSkinNum}`);
        } 
    });
    
    let lastChatTime = 0;
    socket.on('sendChatMessage', (msg) => {
        let u = onlinePlayers[socket.id]; if (!u) return;
        let now = Date.now();
        if (now - lastChatTime < 2000) { socket.emit('terminalError', 'СЕТЬ: Ожидайте 2 сек. перед отправкой.'); return; }
        lastChatTime = now; let cleanMsg = msg.substring(0, 100); 
        let entry = { user: u, text: cleanMsg, time: new Date().toLocaleTimeString('ru-RU', { hour12: false, hour: '2-digit', minute:'2-digit' }) };
        chatHistory.push(entry); if (chatHistory.length > MAX_CHAT_MESSAGES) chatHistory.shift();
        io.emit('chatMessage', entry);
    });

    socket.on('selectPerk', (perkId) => { let p = db.players[onlinePlayers[socket.id]]; if(p && !p.perks.includes(perkId)) { p.perks.push(perkId); if(perkId === 'perk_health') { p.maxHp += 25; p.hp += 25; } saveDB(); broadcastGameState(); } });

    socket.on('changeLocation', (locId) => { 
        let p = db.players[onlinePlayers[socket.id]]; if (!p) return;
        if (activeCombats[onlinePlayers[socket.id]]) return; 
        
        let currentFloor = p.floor || 0;
        if (!p.unlockedSectors[currentFloor]) p.unlockedSectors[currentFloor] = ['A0'];

        p.hunger = Math.max(0, p.hunger - 1);
        if (p.hunger === 0) p.hp -= 2;

        if (locId === 'safe_room') { p.location = locId; saveDB(); socket.emit('transition', {to: locId, text: "ВХОД В ЖИЛЯЧЕЙКУ..."}); broadcastGameState(); return; }
        if (p.unlockedSectors[currentFloor].includes(locId)) { p.location = locId; saveDB(); socket.emit('transition', {to: locId, text: `ВХОД В СЕКТОР ${locId}...`}); broadcastGameState(); return; }
        
        let sectorData = db.map[currentFloor][locId];
        if (sectorData.reqType === 'item') {
            let reqItem = sectorData.reqValue;
            if (p.questItems.includes(reqItem)) {
                p.questItems.splice(p.questItems.indexOf(reqItem), 1);
                p.unlockedSectors[currentFloor].push(locId); p.location = locId; p.roomsCleared = (p.roomsCleared || 0) + 1;
                p.notebook.push(`[ЭТАЖ ${currentFloor}]: Я применил ${GAME_ITEMS[reqItem].name} и открыл дверь в сектор ${locId}.`);
                saveDB(); socket.emit('transition', {to: locId, text: `ОТКРЫТИЕ ЗАМКА ПРЕДМЕТОМ...`}); broadcastGameState();
            } else { socket.emit('terminalError', `ДВЕРЬ ЗАБЛОКИРОВАНА. Требуется: ${GAME_ITEMS[reqItem].name}`); socket.emit('playSound', 'click'); }
        } 
        else if (sectorData.reqType === 'minigame') { socket.emit('startMinigame', { locId: locId, gameData: sectorData.reqValue }); } 
        else { p.unlockedSectors[currentFloor].push(locId); p.location = locId; saveDB(); socket.emit('transition', {to: locId, text: `ВХОД В СЕКТОР ${locId}...`}); broadcastGameState(); }
    });

    socket.on('minigameWon', (locId) => {
        let p = db.players[onlinePlayers[socket.id]]; let currentFloor = p.floor || 0;
        if (!p || p.unlockedSectors[currentFloor].includes(locId)) return;
        p.unlockedSectors[currentFloor].push(locId); p.location = locId; p.roomsCleared = (p.roomsCleared || 0) + 1;
        p.notebook.push(`[ЭТАЖ ${currentFloor}]: Я успешно взломал систему гермодвери и прошел в сектор ${locId}. Идем дальше.`);
        socket.emit('playSound', 'victory'); saveDB(); socket.emit('transition', {to: locId, text: `ВЗЛОМ УСПЕШЕН. ВХОД В ${locId}...`}); broadcastGameState();
    });

    socket.on('minigameCancel', () => { let p = db.players[onlinePlayers[socket.id]]; if (p) { p.location = 'safe_room'; saveDB(); socket.emit('transition', {to: 'safe_room', text: "ОТСТУПЛЕНИЕ В ЯЧЕЙКУ..."}); broadcastGameState(); } });

    socket.on('changeFloor', (dir) => { 
        let username = onlinePlayers[socket.id]; let p = db.players[username]; if (!p) return;
        let currentFloor = p.floor || 0;
        if (dir === 'down') {
            if (!p.bossDefeated || !p.bossDefeated[currentFloor]) { socket.emit('terminalError', 'ЛИФТ НЕ АКТИВИРОВАН. Сначала запустите лифт в секторе E4.'); return; }
            if (currentFloor >= 30) { socket.emit('terminalError', 'ВЫ ДОСТИГЛИ ДНА ГИГАХРУЩЕВКИ.'); return; }
            p.floor = currentFloor + 1; p.location = 'A0'; 
            if (!p.unlockedSectors[p.floor]) p.unlockedSectors[p.floor] = ['A0'];
            p.notebook.push(`[ЭТАЖ ${p.floor}]: Лифт со скрежетом опустился ниже. Тьма стала плотнее.`);
            generateFloor(p.floor); saveDB(); socket.emit('transition', {to: 'map', text: `СПУСК НА ЭТАЖ ${p.floor}...`}); broadcastGameState();
        }
    });

    socket.on('buyItem', (itemId) => { 
        let p = db.players[onlinePlayers[socket.id]]; let item = GAME_ITEMS[itemId]; 
        if (item && p.talons >= item.cost && currentShopItems.includes(itemId)) { 
            if (p.inventory.length >= getMaxInv(p)) { socket.emit('terminalError', 'СУНДУК ПОЛОН! Выбросьте вещи.'); return; }
            p.talons -= item.cost; p.inventory.push(itemId); socket.emit('playSound', 'buy'); socket.emit('terminalError', `ПОЛУЧЕНО: ${item.name}`); saveDB(); broadcastGameState(); 
        } 
    });

    socket.on('dropItem', (invIndex) => {
        let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.inventory[invIndex]) return; 
        p.inventory.splice(invIndex, 1); socket.emit('playSound', 'equip'); saveDB(); broadcastGameState();
    });

    socket.on('equipItem', (invIndex) => { 
        let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.inventory[invIndex]) return; 
        let itemId = p.inventory[invIndex]; let itemData = GAME_ITEMS[itemId]; 
        if (itemData && (itemData.type === 'weapon' || itemData.type === 'clothes' || itemData.type === 'mask' || itemData.type === 'backpack')) { 
            if (itemData.reqLevel && p.level < itemData.reqLevel) { socket.emit('terminalError', `ОТКАЗ: ТРЕБУЕТСЯ УРОВЕНЬ ${itemData.reqLevel}`); socket.emit('playSound', 'defeat'); return; }
            if (p.equipment[itemData.type]) p.inventory.push(p.equipment[itemData.type]); 
            p.equipment[itemData.type] = itemId; p.inventory.splice(invIndex, 1); 
            if (p.inventory.length > getMaxInv(p)) { socket.emit('terminalError', `ПРЕДУПРЕЖДЕНИЕ: ВЫ ПРЕВЫСИЛИ ЛИМИТ ВЕСА!`); }
            socket.emit('playSound', 'equip'); saveDB(); broadcastGameState(); 
        } 
    });
    
    socket.on('unequipItem', (slot) => { 
        let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.equipment[slot]) return; 
        if (p.inventory.length >= getMaxInv(p) && slot !== 'backpack') { socket.emit('terminalError', 'СУНДУК ПОЛОН!'); return; }
        p.inventory.push(p.equipment[slot]); p.equipment[slot] = null; 
        if (p.inventory.length > getMaxInv(p)) { socket.emit('terminalError', `ПРЕДУПРЕЖДЕНИЕ: ВЫ ПРЕВЫСИЛИ ЛИМИТ ВЕСА!`); }
        socket.emit('playSound', 'equip'); saveDB(); broadcastGameState(); 
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
            if (combat) { combat.logs.push(`> ВЫ ПРИМЕНИЛИ: ${itemData.name}.`); combat.sounds.push('heal'); combat.vfx.push('heal'); } 
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
        if (wData.isFire || wData.isElectro || wData.isBleed) { socket.emit('terminalError', 'ОРУЖИЕ УЖЕ МОДИФИЦИРОВАНО!'); return; }
        
        let el = '';
        if (matId === 'mat_chem') el = '_fire';
        else if (matId === 'mat_electro') el = '_electro';
        else if (matId === 'mat_scrap') el = '_bleed';
        else { socket.emit('terminalError', 'ЭТОТ МАТЕРИАЛ НЕ ПОДХОДИТ ДЛЯ МОДДИНГА.'); return; }
        
        let newWId = wId + el;
        if (GAME_ITEMS[newWId]) {
            p.inventory.splice(Math.max(wIdx, mIdx), 1); p.inventory.splice(Math.min(wIdx, mIdx), 1);
            p.inventory.push(newWId);
            socket.emit('terminalError', `МОДИФИКАЦИЯ УСПЕШНА: ${GAME_ITEMS[newWId].name}!`); socket.emit('playSound', 'equip');
            saveDB(); broadcastGameState();
        }
    });

    socket.on('explore', () => {
        let username = onlinePlayers[socket.id]; let p = db.players[username]; let currentFloor = p.floor || 0;
        if (!p || p.location === 'safe_room' || activeCombats[username]) return;
        if (p.hp <= 0) { socket.emit('terminalError', 'КРИТИЧЕСКОЕ СОСТОЯНИЕ.'); return; }
        if (p.filter < 10) { socket.emit('terminalError', 'НЕДОСТАТОЧНО ФИЛЬТРА.'); return; }

        if (p.location === 'E4') {
            if (p.bossDefeated && p.bossDefeated[currentFloor]) { socket.emit('terminalError', 'ЛИФТ УЖЕ ЗАПУЩЕН. Используйте кнопку спуска на карте.'); return; }
            let hasRepair = p.foundItems.includes('quest_lift_repair'); let hasButtons = p.foundItems.includes('quest_lift_buttons'); let hasWire = p.foundItems.includes('quest_lift_wire');
            if (!hasRepair || !hasButtons || !hasWire) { socket.emit('terminalError', 'ЛИФТ ОБЕСТОЧЕН И РАЗБИТ. Требуется собрать: Ремкомплект, Блок кнопок, Провод генератора (Ищите в Тумане на этаже).'); socket.emit('playSound', 'click'); return; }

            let bossKey = `boss_${currentFloor}`;
            if (!globalBosses[bossKey]) {
                let bossBase = getBossForFloor(currentFloor);
                globalBosses[bossKey] = { name: bossBase.name, hp: bossBase.hp, maxHp: bossBase.hp, dmg: bossBase.dmg, reward: bossBase.reward, xp: bossBase.xp, img: bossBase.img, isElevatorBoss: true, lore: bossBase.lore, bossMechanic: bossBase.bossMechanic, participants: new Set([username]), eTimer: 2.0, pTimers: {} };
            } else { globalBosses[bossKey].participants.add(username); }
            
            globalBosses[bossKey].pTimers[username] = 2.0 / getSpeedMult(p.filter);
            activeCombats[username] = { isGlobal: true, floor: currentFloor, pDodging: false, pCritNext: false, logs: [], sounds: [], vfx: [], paused: false };
            
            p.questItems = p.questItems.filter(i => !['quest_lift_repair', 'quest_lift_buttons', 'quest_lift_wire'].includes(i));
            saveDB(); socket.emit('transition', {to: 'combat', text: "ВХОД В ЗОНУ РЕЙДА..."});
            setTimeout(() => { socket.emit('combatStart', { enemy: globalBosses[bossKey] }); broadcastGameState(); }, 2000);
            return;
        }

        let fCost = p.perks.includes('perk_lungs') ? 7 : 10;
        let pRate = p.mutations && p.mutations.includes('mut_lungs') ? 0.5 : (p.mutations && p.mutations.includes('mut_thick_skin') ? 2.0 : 1.0);
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
            let bossKey = `boss_${combat.floor}`; let gb = globalBosses[bossKey]; if (!gb) return;
            if (actionType === 'dodge') { combat.pDodging = true; combat.logs.push(`> ВЫ ПРИГОТОВИЛИСЬ К УКЛОНЕНИЮ...`); combat.sounds.push('dodge'); } 
            else if (actionType === 'attack') { gb.pTimers[username] = 2.0 / getSpeedMult(p.filter); executePlayerAttackGlobal(username, combat, gb, stats, p); }
            else if (actionType === 'aimed_success') { gb.pTimers[username] = 2.0 / getSpeedMult(p.filter); let cb = p.perks.includes('perk_butcher') ? 2.3 : 2.0; let dmg = Math.floor(stats.dmg * cb); combat.logs.push(`> ПРИЦЕЛЬНАЯ АТАКА! Вы наносите сокрушительный удар: ${dmg} ед. урона (КРИТ).`); combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit'); gb.hp -= dmg; }
            else if (actionType === 'aimed_fail') { gb.pTimers[username] = 2.0 / getSpeedMult(p.filter); let eDmg = Math.max(1, gb.dmg - Math.floor(stats.def / 5)); combat.logs.push(`> ПРОМАХ ПРИЦЕЛИВАНИЯ! Вы открылись для удара и получаете ${eDmg} урона.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); }
        } else {
            if (actionType === 'dodge') { combat.pDodging = true; combat.logs.push(`> ВЫ ПРИГОТОВИЛИСЬ К УКЛОНЕНИЮ...`); combat.sounds.push('dodge'); } 
            else if (actionType === 'attack') { combat.pTimer = 2.0 / getSpeedMult(p.filter); executePlayerAttack(username, combat, stats, p); }
            else if (actionType === 'aimed_success') { combat.pTimer = 2.0 / getSpeedMult(p.filter); let cb = p.perks.includes('perk_butcher') ? 2.3 : 2.0; let dmg = Math.floor(stats.dmg * cb); combat.logs.push(`> ПРИЦЕЛЬНАЯ АТАКА! Вы наносите сокрушительный удар: ${dmg} ед. урона (КРИТ).`); combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit'); combat.enemy.hp -= dmg; }
            else if (actionType === 'aimed_fail') { combat.pTimer = 2.0 / getSpeedMult(p.filter); let eDmg = Math.max(1, combat.enemy.dmg - Math.floor(stats.def / 5)); combat.logs.push(`> ПРОМАХ ПРИЦЕЛИВАНИЯ! Вы открылись для удара и получаете ${eDmg} урона.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); }
        }
    });

    socket.on('combatMinigameResult', (success) => {
        let username = onlinePlayers[socket.id]; let combat = activeCombats[username]; let p = db.players[username];
        if (!combat || !p) return;
        combat.paused = false;
        if (success) { combat.logs.push(`> [УСПЕХ] ВЫ СТАБИЛИЗИРОВАЛИ РЕАКТОР!`); combat.sounds.push('victory'); } 
        else { combat.logs.push(`> [ПРОМАХ] ВЗРЫВ ПЕРЕНАПРЯЖЕНИЯ!`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= 40; }
    });

    socket.on('resolveEvent', (choiceId) => {
        let p = db.players[onlinePlayers[socket.id]]; if (!p || !p.activeEvent) return;
        
        let allEvents = [...RANDOM_EVENTS, 
            { id: 'find_lift_repair', choices: [{id:'take', winQuestItem:'quest_lift_repair', winLog: '> Вы нашли Ремкомплект лифта!'}] }, 
            { id: 'find_lift_buttons', choices: [{id:'take', winQuestItem:'quest_lift_buttons', winLog: '> Вы нашли Блок кнопок!'}] }, 
            { id: 'find_lift_wire', choices: [{id:'take', winQuestItem:'quest_lift_wire', winLog: '> Вы получили Провод генератора!'}] }
        ];
        
        let ev = allEvents.find(e => e.id === p.activeEvent); p.activeEvent = null; let log = "";
        
        if (ev) {
            let choice = ev.choices.find(c => c.id === choiceId);
            if (choice) {
                if (choice.reqItem) {
                    let idx = p.inventory.indexOf(choice.reqItem);
                    if (idx === -1) { socket.emit('terminalError', `НЕ ХВАТАЕТ ПРЕДМЕТА: ${GAME_ITEMS[choice.reqItem].name}`); return; }
                    p.inventory.splice(idx, 1);
                }
                if (choice.reqCost) {
                    if (p.talons < choice.reqCost) { socket.emit('terminalError', `НЕДОСТАТОЧНО ТАЛОНОВ.`); return; }
                    p.talons -= choice.reqCost;
                }

                if (Math.random() <= (choice.chance !== undefined ? choice.chance : 1)) {
                    log = choice.winLog || "> Успех.";
                    if (choice.winLoot) {
                        let givenLoot = rollItemWithRarity(choice.winLoot);
                        p.inventory.push(givenLoot);
                        log += ` (Получено: ${GAME_ITEMS[givenLoot].name})`;
                    }
                    if (choice.winQuestItem) { p.questItems.push(choice.winQuestItem); if (!p.foundItems) p.foundItems = []; p.foundItems.push(choice.winQuestItem); socket.emit('playSound', 'victory'); }
                    if (choice.winTalons) p.talons += choice.winTalons;
                    if (choice.winHp) p.hp = Math.min(p.maxHp, p.hp + choice.winHp);
                    if (choice.winFilter) p.filter = Math.min(100, p.filter + choice.winFilter);
                    if (choice.winXp) { p.xp += choice.winXp; log += ` (+${choice.winXp} XP)`; }
                    p.roomsCleared = (p.roomsCleared || 0) + 1; 
                } else { 
                    log = choice.failLog || "> Провал."; 
                    if (choice.failHp) p.hp += choice.failHp; 
                }
            }
        }
        
        if (p.hp <= 0) { p.hp = 0; p.talons = Math.floor(p.talons / 2); p.location = 'safe_room'; log += "\n> ВЫ ПОТЕРЯЛИ СОЗНАНИЕ! Эвакуация в ячейку."; }
        saveDB(); socket.emit('combatEventResult', log); broadcastGameState();
    });

    socket.on('disconnect', () => { let u = onlinePlayers[socket.id]; if (activeCombats[u]) { if(activeCombats[u].isGlobal && globalBosses[`boss_${activeCombats[u].floor}`]) { globalBosses[`boss_${activeCombats[u].floor}`].participants.delete(u); } delete activeCombats[u]; } delete onlinePlayers[socket.id]; writeLog(`Отключение: ${u || socket.id}`); broadcastGameState(); });
});

function applyToxicity(p, combat) {
    if (p.mutations && p.mutations.includes('mut_toxic_blood')) return;
    p.tox += 5;
    if (p.tox >= 100) {
        p.tox = 0; let availableMut = MUTATIONS.filter(m => !p.mutations.includes(m.id));
        if (availableMut.length > 0) {
            let m = availableMut[Math.floor(Math.random() * availableMut.length)];
            p.mutations.push(m.id); combat.logs.push(`\n>>> ВНИМАНИЕ! КРИТИЧЕСКОЕ ЗАРАЖЕНИЕ! Вы получили мутацию: [${m.name}] <<<\n`);
        }
    }
}

function executePlayerAttack(username, combat, stats, p) {
    let dmg = stats.dmg; let wData = p.equipment.weapon ? GAME_ITEMS[p.equipment.weapon] : null;
    if (combat.pCritNext) { let cb = 1 + (Math.floor(Math.random() * 16) + 10) / 100; if(p.perks.includes('perk_butcher')) cb += 0.3; dmg = Math.floor(dmg * cb); combat.pCritNext = false; combat.logs.push(`> КРИТИЧЕСКИЙ УДАР! Нанесено ${dmg} ед. урона.`); combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit'); } 
    else { combat.logs.push(`> Вы бьете врага. Нанесено ${dmg} ед. урона.`); combat.sounds.push('hit_player'); combat.vfx.push('enemy_hit'); }
    if (wData && wData.isElectro && Math.random() < 0.2) { combat.logs.push(`> ШОК! Враг оглушен и пропустит ход!`); combat.eDodging = false; combat.enemy.hp -= dmg; return; }
    if (combat.eDodging) { if (Math.random() < 0.6) { combat.logs.push(`> ПРОМАХ! Враг увернулся.`); combat.sounds.push('dodge'); combat.eDodging = false; return; } else { combat.eDodging = false; } }
    combat.enemy.hp -= dmg;
}

function executePlayerAttackGlobal(username, combat, gb, stats, p) {
    let dmg = stats.dmg; let wData = p.equipment.weapon ? GAME_ITEMS[p.equipment.weapon] : null;
    if (combat.pCritNext) { let cb = 1 + (Math.floor(Math.random() * 16) + 10) / 100; if(p.perks.includes('perk_butcher')) cb += 0.3; dmg = Math.floor(dmg * cb); combat.pCritNext = false; combat.logs.push(`> КРИТИЧЕСКИЙ УДАР! Нанесено ${dmg} ед. урона.`); combat.sounds.push('hit_crit'); combat.vfx.push('enemy_crit'); } 
    else { combat.logs.push(`> Вы бьете босса. Нанесено ${dmg} ед. урона.`); combat.sounds.push('hit_player'); combat.vfx.push('enemy_hit'); }
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
                        if (Math.random() < 0.75) { combat.logs.push(`> УСПЕХ! Вы уклонились от атаки БОССА.`); combat.sounds.push('dodge'); combat.vfx.push('player_dodge'); combat.pCritNext = true; combat.pDodging = false; eDmg = 0; } 
                        else { combat.logs.push(`> Босс оказался быстрее! Получено: ${eDmg} урона.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); combat.pDodging = false; }
                    } else { combat.logs.push(`> [БОСС] атакует! Получено: ${eDmg} урона.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); }
                }
            });
        }

        if (gb.hp <= 0) {
            gb.participants.forEach(u => {
                let combat = activeCombats[u]; let p = db.players[u]; let socketId = Object.keys(onlinePlayers).find(key => onlinePlayers[key] === u);
                if (combat && p && socketId) {
                    let log = combat.logs.join('\n') + '\n';
                    p.talons += gb.reward; p.xp += gb.xp; p.monstersKilled = (p.monstersKilled || 0) + 1;
                    log += `> РЕЙД ЗАВЕРШЕН! БОСС ПОВЕРЖЕН! Талоны: +${gb.reward}, XP: +${gb.xp}.\n`;
                    if (!p.bossDefeated) p.bossDefeated = {}; p.bossDefeated[p.floor || 0] = true;
                    if (gb.lore) { p.notebook.push(gb.lore); log += `>>> ДОБАВЛЕНА НОВАЯ ЗАПИСЬ В БЛОКНОТ! <<<\n`; }
                    log += `\n>>> ПУТЬ ВНИЗ СВОБОДЕН! Откройте Карту, чтобы спуститься. <<<\n`;
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
                    let log = combat.logs.join('\n') + '\n> ВЫ ПОТЕРЯЛИ СОЗНАНИЕ! Эвакуация в ячейку.';
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
        
        combat.pTimer -= 0.25; combat.eTimer -= 0.25; combat.logs = []; combat.sounds = []; combat.vfx = [];

        if (combat.eTimer <= 0) {
            combat.eTimer = 2.0;
            if (Math.random() < 0.2) { combat.eDodging = true; combat.logs.push(`> Враг [${combat.enemy.name}] готовится совершить рывок.`); } 
            else {
                let eDmg = Math.max(1, combat.enemy.dmg - Math.floor(getPlayerStats(p).def / 5));
                if (combat.pDodging) {
                    if (Math.random() < 0.75) { combat.logs.push(`> УСПЕХ! Вы уклонились от атаки.`); combat.sounds.push('dodge'); combat.vfx.push('player_dodge'); combat.pCritNext = true; combat.pDodging = false; eDmg = 0; } 
                    else { combat.logs.push(`> Враг оказался быстрее уклонения! Получено: ${eDmg} урона.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); combat.pDodging = false; }
                } else { combat.logs.push(`> Враг атакует! Получено: ${eDmg} урона.`); combat.sounds.push('hit_enemy'); combat.vfx.push('player_hit'); p.hp -= eDmg; applyToxicity(p, combat); }
            }
        }

        if (combat.pTimer <= 0 && !combat.paused) { combat.pTimer = 2.0 / getSpeedMult(p.filter); executePlayerAttack(username, combat, getPlayerStats(p), p); }

        if (p.hp <= 0 || combat.enemy.hp <= 0) {
            let log = combat.logs.join('\n') + '\n';
            if (p.hp > 0) {
                if (p.perks.includes('perk_vampire')) { p.hp = Math.min(p.maxHp, p.hp + 5); log += `> ВАМПИРИЗМ: Вы поглотили 5 HP врага.\n`; }
                p.talons += combat.enemy.reward; p.xp += combat.enemy.xp; p.monstersKilled = (p.monstersKilled || 0) + 1;
                log += `> ВРАГ ПОВЕРЖЕН! Талоны: +${combat.enemy.reward}, XP: +${combat.enemy.xp}.\n`;

                let nextLevelXp = p.level * 100;
                if (p.xp >= nextLevelXp) { 
                    p.level += 1; p.xp -= nextLevelXp; p.maxHp += 10; p.hp = p.maxHp; log += `>>> УРОВЕНЬ ПОВЫШЕН! Текущий уровень: ${p.level}. <<<\n`; 
                    let availablePerks = GAME_PERKS.filter(pk => !p.perks.includes(pk.id));
                    if(availablePerks.length > 0) { let shuffled = availablePerks.sort(() => 0.5 - Math.random()); io.to(socketId).emit('showLevelUp', shuffled.slice(0, 3)); }
                }
                
                if (combat.enemy.loot) { 
                    combat.enemy.loot.forEach(drop => { 
                        let dropC = p.perks.includes('perk_hoarder') ? drop.chance * 1.5 : drop.chance;
                        if (Math.random() < dropC) { 
                            if(p.inventory.length < getMaxInv(p)) { p.inventory.push(drop.id); log += `> НАЙДЕН ПРЕДМЕТ: ${GAME_ITEMS[drop.id] ? GAME_ITEMS[drop.id].name : drop.id} (В сундуке).\n`; }
                            else { log += `> НАЙДЕН ПРЕДМЕТ: ${GAME_ITEMS[drop.id] ? GAME_ITEMS[drop.id].name : drop.id}, но Сундук переполнен!\n`; }
                        } 
                    }); 
                }
            } else { p.hp = 0; p.talons = Math.floor(p.talons / 2); p.location = 'safe_room'; log += `> ВЫ ПОТЕРЯЛИ СОЗНАНИЕ! Эвакуация в ячейку.`; }
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    writeLog(`Сервер успешно запущен. Порт: ${PORT}`);
    console.log(`[СИСТЕМА] Сервер активен. Порт: ${PORT}`);
});