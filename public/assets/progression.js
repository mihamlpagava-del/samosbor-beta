/**
 * ============================================================================
 * MODULE: progression.js (Hero Level & Dynamic Bestiary Scaling)
 * ============================================================================
 * Manages player level progression and dynamic scaling of the Samosbor Bestiary:
 * - Tier 1 (Hero Lvl 1-2): «Первичная органика»
 *   * Черная слизь (Black Slime): slow, leaves slowing trail, splits on death
 *   * Одичавшие жильцы (Feral Inhabitants): weak melee, run towards flashlight beam
 * - Tier 2 (Hero Lvl 3-5): «Деформанты и мутации»
 *   * Голосовые имитаторы (Voice Mimics): fast, disguised as neutral radar blips
 *   * Псевдоплоть / Споровики (Spore Pods): stationary turrets spitting purple fuzz
 * - Tier 3 (Hero Lvl 6+): «Тяжелые аномалии»
 *   * Ликвидаторы-отступники (Rogue Liquidators): armored, shotgun/flame range attacks
 *   * Аномальные деформанты («Шестижопые»): high dmg, leap attacks, flanking AI
 * - Threat budget formula: threatBudget = 10 + playerLevel * 6
 */

(function (global) {
  'use strict';

  const BESTIARY = {
    // TIER 1: ПЕРВИЧНАЯ ОРГАНИКА (Lvl 1-2)
    black_slime: {
      id: 'black_slime',
      name: 'Черная слизь',
      tier: 1,
      minLevel: 1,
      cost: 2,
      hp: 45,
      maxHp: 45,
      dmg: 10,
      speed: 1.3,
      radius: 12,
      color: '#33cc55',
      behavior: 'slime_split',
      glyph: 's',
      desc: 'Аморфный сгусток плоти. Оставляет след и делится надвое при гибели.'
    },
    feral_inhabitant: {
      id: 'feral_inhabitant',
      name: 'Одичавший жилец',
      tier: 1,
      minLevel: 1,
      cost: 3,
      hp: 60,
      maxHp: 60,
      dmg: 14,
      speed: 2.1,
      radius: 13,
      color: '#ffaa44',
      behavior: 'rush_flashlight',
      glyph: 'h',
      desc: 'Обезумевший жилец хрущевки. Инстинктивно бежит на луч фонарика.'
    },

    // TIER 2: ДЕФОРМАНТЫ И МУТАЦИИ (Lvl 3-5)
    voice_mimic: {
      id: 'voice_mimic',
      name: 'Голосовой имитатор',
      tier: 2,
      minLevel: 3,
      cost: 6,
      hp: 95,
      maxHp: 95,
      dmg: 24,
      speed: 1.8,
      sprintSpeed: 3.6,
      radius: 14,
      color: '#00e5ff',
      combatColor: '#ff3366',
      behavior: 'radar_disguise',
      glyph: 'm',
      desc: 'Имитирует сигналы ликвидаторов на радаре, затем резко срывается в рывок.'
    },
    spore_pod: {
      id: 'spore_pod',
      name: 'Псевдоплоть / Споровик',
      tier: 2,
      minLevel: 3,
      cost: 5,
      hp: 130,
      maxHp: 130,
      dmg: 22,
      speed: 0,
      radius: 16,
      color: '#bb44ee',
      behavior: 'turret_spore',
      glyph: 'T',
      desc: 'Неподвижная биомасса в полу. Плюется облаками токсичной фиолетовой ваты.'
    },

    // TIER 3: ТЯЖЕЛЫЕ АНОМАЛИИ (Lvl 6+)
    rogue_liquidator: {
      id: 'rogue_liquidator',
      name: 'Ликвидатор-отступник',
      tier: 3,
      minLevel: 6,
      cost: 10,
      hp: 190,
      maxHp: 190,
      dmg: 32,
      armor: 25,
      speed: 2.0,
      radius: 15,
      color: '#ff6600',
      behavior: 'ranged_shotgun',
      glyph: 'L',
      desc: 'Предатель в тяжелом ОЗК. Ведет прицельный огонь картечью из засады.'
    },
    six_legged_horror: {
      id: 'six_legged_horror',
      name: 'Аномальный деформант («Шестижопый»)',
      tier: 3,
      minLevel: 6,
      cost: 12,
      hp: 260,
      maxHp: 260,
      dmg: 44,
      speed: 2.8,
      radius: 18,
      color: '#ff0044',
      behavior: 'leap_flank',
      glyph: 'X',
      desc: 'Кошмарная многоногая масса. Прыгает через препятствия и обходит с фланга.'
    }
  };

  const Progression = {
    BESTIARY,

    /**
     * Get player level from client profile or default to 1
     */
    getPlayerLevel() {
      if (typeof clientMe !== 'undefined' && clientMe && clientMe.level) {
        return Math.max(1, clientMe.level);
      }
      return 1;
    },

    /**
     * Get unlocked enemies available for the given level
     * @param {number} level Hero level
     */
    getAvailableTiers(level) {
      const pLevel = Math.max(1, level || 1);
      const unlocked = [];

      // Tier 1 always available
      unlocked.push(BESTIARY.black_slime);
      unlocked.push(BESTIARY.feral_inhabitant);

      // Tier 2 unlocked at level 3+
      if (pLevel >= 3) {
        unlocked.push(BESTIARY.voice_mimic);
        unlocked.push(BESTIARY.spore_pod);
      }

      // Tier 3 unlocked at level 6+
      if (pLevel >= 6) {
        unlocked.push(BESTIARY.rogue_liquidator);
        unlocked.push(BESTIARY.six_legged_horror);
      }

      return unlocked;
    },

    /**
     * Mathematical threat budget monster generation
     * ThreatBudget = 10 + playerLevel * 6
     * @param {number} playerLevel Current hero level
     * @param {Array} roomList Available rooms
     * @param {number} tileSize Grid tile size (32px)
     */
    generateEnemiesForLevel(playerLevel, roomList, tileSize = 32) {
      const pLevel = Math.max(1, playerLevel || 1);
      let threatBudget = 10 + pLevel * 6;
      const available = this.getAvailableTiers(pLevel);
      const spawned = [];

      // Exclude Room 0 (safe start room!)
      const spawnRooms = (roomList && roomList.length > 1) ? roomList.slice(1) : (roomList || []);
      if (spawnRooms.length === 0) return spawned;

      let safety = 0;
      while (threatBudget > 0 && available.length > 0 && safety++ < 80) {
        // Find monsters affordable with remaining budget
        const affordable = available.filter(e => e.cost <= threatBudget);
        const pool = affordable.length > 0 ? affordable : [available[0]];
        const template = pool[Math.floor(Math.random() * pool.length)];

        // Choose random spawn room
        const room = spawnRooms[Math.floor(Math.random() * spawnRooms.length)];
        const rx = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2));
        const ry = room.y + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2));

        const enemy = Object.assign({}, template, {
          uid: 'mon_' + Math.random().toString(36).substr(2, 9),
          x: rx * tileSize + tileSize / 2,
          y: ry * tileSize + tileSize / 2,
          tileX: rx,
          tileY: ry,
          type: 'monster',
          state: 'IDLE',
          target: null,
          angle: Math.random() * Math.PI * 2,
          lastAttackTime: 0,
          damageFlashTimer: 0,
          patrolTimer: Math.floor(Math.random() * 80),
          isMimicDisguised: template.behavior === 'radar_disguise',
          leapCooldown: 0,
          sporeCooldown: 0
        });

        spawned.push(enemy);
        threatBudget -= template.cost;
      }

      return spawned;
    },

    /**
     * Create split slime children on death
     */
    createSlimeChildren(parentSlime) {
      if (!parentSlime || parentSlime.behavior !== 'slime_split') return [];
      if (parentSlime.isSplitChild) return []; // Baby slimes don't split again

      const children = [];
      for (let i = 0; i < 2; i++) {
        const offsetAng = (i === 0 ? 1 : -1) * 0.8;
        children.push({
          id: 'black_slime_child',
          name: 'Осколок слизи',
          uid: 'mon_' + Math.random().toString(36).substr(2, 9),
          tier: 1,
          isSplitChild: true,
          hp: 22,
          maxHp: 22,
          dmg: 6,
          speed: 1.6,
          radius: 9,
          color: '#44ff77',
          behavior: 'wander_skitter',
          glyph: 's',
          x: parentSlime.x + Math.cos(offsetAng) * 16,
          y: parentSlime.y + Math.sin(offsetAng) * 16,
          tileX: Math.floor(parentSlime.x / 32),
          tileY: Math.floor(parentSlime.y / 32),
          type: 'monster',
          state: 'CHASE',
          target: null,
          angle: offsetAng,
          lastAttackTime: 0,
          damageFlashTimer: 6,
          patrolTimer: 30
        });
      }
      return children;
    }
  };

  global.Progression = Progression;
})(typeof window !== 'undefined' ? window : this);
