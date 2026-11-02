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

  class TextureManagerClass {
    constructor() {
      this.textures = {};
      this.patterns = {};
      this.loadedCount = 0;
      this.totalCount = Object.keys(MATERIAL_DEFS).length;
      this.isReady = false;
      this.init();
    }

    init() {
      if (typeof window === 'undefined') return;

      for (const [key, def] of Object.entries(MATERIAL_DEFS)) {
        const img = new Image();
        img.onload = () => {
          this.loadedCount++;
          if (this.loadedCount >= this.totalCount) {
            this.isReady = true;
          }
        };
        img.onerror = () => {
          console.warn(`[TextureManager] Failed to load ${def.src}, fallback will be used.`);
        };
        img.src = def.src;
        this.textures[key] = {
          img,
          def,
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
