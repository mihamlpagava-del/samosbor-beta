/**
 * SAMOSBOR - G-MODE TEXTURE & MATERIAL MANAGER
 * Universal caching & delivery system for Raycaster environment textures.
 */
(function(global) {
  'use strict';

  const MATERIAL_DEFS = {
    // 1. Red & Old Brick
    'brick_red': {
      src: 'assets/radar/tiles/wall_brick_red.png',
      fallback: [140, 55, 45],
      name: 'Красный кирпич'
    },
    // 2. Broken Brick
    'brick_broken': {
      src: 'assets/radar/tiles/wall_brick_broken.png',
      fallback: [115, 52, 42],
      name: 'Разрушенный кирпич'
    },
    // 3. Old Concrete
    'concrete_old': {
      src: 'assets/radar/tiles/wall_concrete_old.png',
      fallback: [55, 65, 62],
      name: 'Старый бетон'
    },
    // 3b. Wall Graffiti & Variations
    'concrete_ussr': {
      src: 'assets/radar/tiles/wall_concrete_old.png',
      fallback: [90, 45, 45],
      name: 'Бетон: Граффити СССР'
    },
    'concrete_warning': {
      src: 'assets/radar/tiles/wall_concrete_old.png',
      fallback: [160, 140, 30],
      name: 'Бетон: Предупреждающие полосы'
    },
    'concrete_vent': {
      src: 'assets/radar/tiles/wall_grate_industrial.png',
      fallback: [38, 48, 52],
      name: 'Вентиляционная решётка'
    },
    // 4. Reinforced Concrete
    'concrete_reinforced': {
      src: 'assets/radar/tiles/wall_concrete_reinforced.png',
      fallback: [48, 56, 60],
      name: 'Железобетон'
    },
    // 5. Metal Panels
    'metal_panels': {
      src: 'assets/radar/tiles/wall_metal_panels.png',
      fallback: [52, 62, 68],
      name: 'Металлические панели'
    },
    // 6. Rusty Metal
    'metal_rusty': {
      src: 'assets/radar/tiles/wall_metal_rusty.png',
      fallback: [130, 65, 30],
      name: 'Ржавый металл'
    },
    // 7. Industrial Grates
    'grate_industrial': {
      src: 'assets/radar/tiles/wall_grate_industrial.png',
      fallback: [32, 40, 44],
      name: 'Промышленные решётки'
    },
    // 8. Technical Tile
    'tile_tech': {
      src: 'assets/radar/tiles/wall_tile_tech.png',
      fallback: [120, 138, 135],
      name: 'Техническая плитка'
    },
    // 9. Damaged Painted Plaster
    'plaster_damaged': {
      src: 'assets/radar/tiles/wall_plaster_damaged.png',
      fallback: [45, 80, 70],
      name: 'Повреждённая штукатурка'
    },
    // 10. Laboratory Walls
    'lab_clean': {
      src: 'assets/radar/tiles/wall_lab_clean.png',
      fallback: [150, 160, 165],
      name: 'Стены лаборатории'
    },
    // 11. Airtight Hermetic Blast Door
    'door_blast': {
      src: 'assets/radar/tiles/door_blast_heavy.png',
      fallback: [165, 135, 45],
      name: 'Гермодверь'
    },
    'door_exit': {
      src: 'assets/radar/tiles/door_exit_heavy.png',
      fallback: [180, 140, 50],
      name: 'Аварийный выход'
    },
    'door_exit_heavy': {
      src: 'assets/radar/tiles/door_exit_heavy.png',
      fallback: [180, 140, 50],
      name: 'Тяжелый гермовыход'
    },
    'elevator_pad': {
      src: 'assets/radar/tiles/elevator_s_pad.png',
      fallback: [0, 200, 150],
      name: 'Шахта лифта // Эвакуация S'
    },
    // Floor & Ceiling Materials
    'floor_concrete': {
      src: 'assets/radar/tiles/floor_concrete.png',
      fallback: [40, 46, 43],
      name: 'Бетонный пол'
    },
    'floor_grate': {
      src: 'assets/radar/tiles/floor_metal_grate.png',
      fallback: [30, 36, 40],
      name: 'Металлический настил'
    },
    'ceil_concrete': {
      src: 'assets/radar/tiles/ceil_concrete.png',
      fallback: [28, 32, 30],
      name: 'Бетонное перекрытие'
    }
  };

    const SPRITE_DEFS = {
    // Complete Samosbor Bestiary
    'black_slime': 'assets/monsters/m_slime.png',
    'feral_inhabitant': 'assets/monsters/m_madman.png',
    'voice_mimic': 'assets/monsters/m_cultist.png',
    'spore_pod': 'assets/monsters/m_mold.png',
    'rogue_liquidator': 'assets/monsters/m_liquidator.png',
    'six_legged_horror': 'assets/monsters/m_centipede.png',
    'arachnid': 'assets/monsters/m_spider.png',
    'concrete_hound': 'assets/monsters/m_hound.png',
    'acid_spitter': 'assets/monsters/m_spitter.png',
    'corpse_feeder': 'assets/monsters/m_corpse.png',
    'hive_carrier': 'assets/monsters/m_hive.png',
    'sludge_worm': 'assets/monsters/m_worm.png',
    'drowned_worker': 'assets/monsters/m_drowned.png',
    'parasite_carrier': 'assets/monsters/m_parasite.png',
    'biomech_horror': 'assets/monsters/m_biomech.png',
    'flesh_amalgam': 'assets/monsters/m_amalgam.png',
    'mutated_plumber': 'assets/monsters/m_plumber.png',
    'mutated_butcher': 'assets/monsters/m_butcher.png',
    'giga_architect': 'assets/monsters/m_architect.png',
    'boss_slime': 'assets/monsters/boss_slime.png',
    'boss_reactor': 'assets/monsters/boss_reactor.png',
    'boss_com': 'assets/monsters/boss_com.png',
    'boss_arch': 'assets/monsters/boss_arch.png',
    'boss_final': 'assets/monsters/boss_final.png',
    'mutant_default': 'assets/monsters/m_slime.png',

    // Allies & NPCs
    'liquidator': 'assets/monsters/m_liquidator.png',
    'npc_liquidator': 'assets/monsters/m_liquidator.png',
    'npc_medic': 'assets/monsters/m_liquidator.png',

    // Items & Loot
    'weapon_pipe': 'assets/icons/weapon_pipe.png',
    'weapon_shotgun': 'assets/icons/weapon_shotgun.png',
    'weapon_pistol': 'assets/icons/weapon_pistol.png',
    'weapon_ak74': 'assets/icons/weapon_pistol.png',
    'weapon_axe': 'assets/icons/weapon_axe.png',
    'weapon_crowbar': 'assets/icons/weapon_crowbar.png',
    'weapon_default': 'assets/icons/weapon_pipe.png',
    'food_medkit': 'assets/icons/food_medkit.png',
    'ammo_box': 'assets/icons/ammo_box.png',
    'keycard': 'assets/radar/props/keycard_pass.png',
    'food_ration': 'assets/icons/food_ration.png',
    'chest_military': 'assets/radar/props/chest_military_box.png',
    'keycard_pass': 'assets/radar/props/keycard_pass.png',
    'loot_crate': 'assets/radar/tiles/crate_tech.png',
    'crate_tech': 'assets/radar/tiles/crate_tech.png',
    'crate_med': 'assets/radar/tiles/crate_med.png',
    'crate_ammo': 'assets/radar/tiles/crate_ammo.png',
    'crate_supply': 'assets/radar/tiles/crate_supply.png',
    'crate_wood': 'assets/radar/tiles/crate_wood.png'
  };

  class TextureManagerClass {
    constructor() {
      this.textures = {};
      this.sprites = {};
      this.patterns = {};
      this.loadedCount = 0;
      this.totalCount = Object.keys(MATERIAL_DEFS).length + Object.keys(SPRITE_DEFS).length;
      this.isReady = false;
      this.init();
    }

    init() {
      if (typeof window === 'undefined') return;

      // 1. Load Environment Material Textures
      for (const [key, def] of Object.entries(MATERIAL_DEFS)) {
        const img = new Image();
        img.onload = () => {
          this.loadedCount++;
          if (this.loadedCount >= this.totalCount) {
            this.isReady = true;
          }
        };
        img.onerror = () => {
          console.warn(`[TextureManager] Failed to load material ${def.src}`);
        };
        img.src = def.src;
        this.textures[key] = {
          img,
          def,
          isLoaded: () => img.complete && img.naturalWidth > 0
        };
      }

      // 2. Load Monster, NPC and Item Billboard Sprites
      for (const [key, src] of Object.entries(SPRITE_DEFS)) {
        const img = new Image();
        img.onload = () => {
          this.loadedCount++;
          if (this.loadedCount >= this.totalCount) {
            this.isReady = true;
          }
        };
        img.onerror = () => {
          console.warn(`[TextureManager] Failed to load sprite ${src}`);
        };
        img.src = src;
        this.sprites[key] = {
          img,
          src,
          isLoaded: () => img.complete && img.naturalWidth > 0
        };
      }
    }

    get(key) {
      const entry = this.textures[key];
      if (entry && entry.isLoaded()) {
        return entry.img;
      }
      return null;
    }

    getSprite(key) {
      const entry = this.sprites[key];
      if (entry && entry.isLoaded()) {
        return entry.img;
      }
      // Try generic fallbacks
      if (key && (key.includes('slime') || key.includes('mutant'))) {
        const def = this.sprites['mutant_default'];
        if (def && def.isLoaded()) return def.img;
      }
      if (key && (key.includes('gun') || key.includes('weapon'))) {
        const def = this.sprites['weapon_default'];
        if (def && def.isLoaded()) return def.img;
      }
      return null;
    }

    getFallback(key) {
      const entry = this.textures[key];
      return (entry && entry.def && entry.def.fallback) ? entry.def.fallback : [40, 50, 45];
    }

    getRoomMaterial(roomType) {
      switch (roomType) {
        case 'living':
          return 'plaster_damaged';
        case 'boiler':
        case 'pump':
          return 'metal_rusty';
        case 'warehouse':
        case 'armory':
          return 'concrete_reinforced';
        case 'archive':
          return 'tile_tech';
        case 'airlock':
        case 'decontam':
          return 'lab_clean';
        case 'sewer':
          return 'brick_broken';
        case 'transformer':
          return 'grate_industrial';
        case 'hydroponics':
          return 'brick_red';
        case 'safe':
          return 'plaster_damaged';
        default:
          return 'concrete_old';
      }
    }

    getFloorMaterial(roomType) {
      switch (roomType) {
        case 'boiler':
        case 'pump':
        case 'transformer':
        case 'airlock':
          return 'floor_grate';
        default:
          return 'floor_concrete';
      }
    }
  }

  const instance = new TextureManagerClass();
  global.TextureManager = instance;

})(typeof window !== 'undefined' ? window : this);

