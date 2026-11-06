/**
 * ============================================================================
 * MODULE: levelGen.js (Procedural BSP Floor Generator for Samosbor Roguelike)
 * ============================================================================
 * Generates unique 48x48 Gigahrush floors using Binary Space Partitioning (BSP):
 * - 48x48 grid (tileSize = 32px => 1536x1536 world)
 * - 7 to 12 diverse rooms (4x4 to 10x10): living cells, boilers, archives, warehouses, airlocks
 * - Connecting corridors 1-2 cells wide without isolated dead-ends
 * - Automatic airtight blast doors in narrow bottlenecks
 * - Safe player spawn ("Жилая ячейка №556")
 * - Cargo elevator extraction shaft in the furthest room of the topological graph
 * - 4-6 random loot caches (ammo, medkits, concentrates, firearms)
 * - Scaled dynamic bestiary via Progression module
 */

(function (global) {
  'use strict';

  const LevelGen = {
    _rng: Math.random,
    setSeed(seedStr) {
      if (!seedStr) {
        this._rng = Math.random;
        return;
      }
      let h = 2166136261 >>> 0;
      const str = String(seedStr);
      for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
      }
      this._rng = function() {
        h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
        return ((h ^= h >>> 16) >>> 0) / 4294967296;
      };
    },
    random() {
      return this._rng ? this._rng() : this.random();
    },
    GRID_WIDTH: 72,
    GRID_HEIGHT: 72,
    TILE_SIZE: 32,

    TILE_FLOOR: 0,
    TILE_WALL: 1,
    TILE_DOOR_CLOSED: 2,
    TILE_DOOR_OPEN: 3,
    TILE_ELEVATOR: 4,

    ROOM_THEMES: [
      { id: 'living', name: 'Жилые боксы 4-го яруса', type: 'living', color: '#1a2920' },
      { id: 'boiler', name: 'Бойлерная узла 4', type: 'boiler', color: '#2a1a14' },
      { id: 'warehouse', name: 'Склад фильтров В-2', type: 'warehouse', color: '#16242c' },
      { id: 'archive', name: 'Архив ликвидаторов', type: 'archive', color: '#221a28' },
      { id: 'airlock', name: 'Шлюзовая секция №9', type: 'airlock', color: '#122624' },
      { id: 'sewer', name: 'Канализационный отстойник', type: 'sewer', color: '#1c2616' },
      { id: 'transformer', name: 'Трансформаторная сектора Г', type: 'transformer', color: '#262214' },
      { id: 'hydroponics', name: 'Блок гидропоники Н-12', type: 'hydroponics', color: '#162a1c' },
      { id: 'pump', name: 'Насосная станция В-8', type: 'boiler', color: '#241a18' },
      { id: 'armory', name: 'Оружейный бокс спецроты', type: 'warehouse', color: '#1e2428' },
      { id: 'decontam', name: 'Деконтаминационный блок', type: 'airlock', color: '#142828' }
    ],

    /**
     * Generate complete procedural floor
     * @param {number} playerLevel Current hero level for bestiary scaling
     * @returns {Object} Map data
     */
    generate(playerLevel = 1, currentRaidFloor = 1, seed = null) {
      if (seed !== null && seed !== undefined) {
        this.setSeed(seed);
      }
      this.currentRaidFloor = Math.max(1, currentRaidFloor || 1);
      const W = this.GRID_WIDTH;
      const H = this.GRID_HEIGHT;
      const TS = this.TILE_SIZE;

      // 1. Initialize full solid wall grid and material maps
      const grid = [];
      const wallMaterials = [];
      const floorMaterials = [];
      for (let y = 0; y < H; y++) {
        const row = new Uint8Array(W);
        row.fill(this.TILE_WALL);
        grid.push(row);
        wallMaterials.push(new Array(W).fill('concrete_old'));
        floorMaterials.push(new Array(W).fill('floor_concrete'));
      }

      // 2. Binary Space Partitioning (BSP)
      const rootNode = { x: 2, y: 2, w: W - 4, h: H - 4 };
      const leaves = [];
      this.splitBsp(rootNode, leaves, 0, 5);

      // 3. Carve rooms inside BSP leaf partitions (7 to 12 rooms, 4x4 to 10x10)
      const rooms = [];
      let themePool = [...this.ROOM_THEMES];

      for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i];
        // Room dimensions: 4x4 to 10x10, fitting within leaf bounds with at least 1-cell padding
        const maxRw = Math.min(10, leaf.w - 2);
        const maxRh = Math.min(10, leaf.h - 2);
        const minRw = Math.min(4, maxRw);
        const minRh = Math.min(4, maxRh);

        if (maxRw < 4 || maxRh < 4) continue;

        const rw = minRw + Math.floor(this.random() * (maxRw - minRw + 1));
        const rh = minRh + Math.floor(this.random() * (maxRh - minRh + 1));
        const rx = leaf.x + 1 + Math.floor(this.random() * (leaf.w - rw - 1));
        const ry = leaf.y + 1 + Math.floor(this.random() * (leaf.h - rh - 1));

        if (themePool.length === 0) themePool = [...this.ROOM_THEMES];
        const themeIdx = Math.floor(this.random() * themePool.length);
        const theme = themePool.splice(themeIdx, 1)[0];

        const roomName = (i === 0) ? 'Жилая ячейка №556' : theme.name;

        const room = {
          id: i,
          name: roomName,
          type: (i === 0) ? 'safe' : theme.type,
          x: rx,
          y: ry,
          w: rw,
          h: rh,
          worldX: rx * TS,
          worldY: ry * TS,
          worldW: rw * TS,
          worldH: rh * TS,
          centerX: Math.floor(rx + rw / 2),
          centerY: Math.floor(ry + rh / 2),
          leaf: leaf
        };

        leaf.room = room;
        if (i > 1 && i % 4 === 0) {
          room.isSecret = true;
          room.name = '🔒 Секретный схрон ликвидаторов';
          room.type = 'armory';
        }
        rooms.push(room);

        const wallMat = (typeof TextureManager !== 'undefined') ? TextureManager.getRoomMaterial(room.type) : 'concrete_old';
        const floorMat = (typeof TextureManager !== 'undefined') ? TextureManager.getFloorMaterial(room.type) : 'floor_concrete';

        // Carve room floor and assign materials
        for (let y = ry; y < ry + rh; y++) {
          for (let x = rx; x < rx + rw; x++) {
            grid[y][x] = this.TILE_FLOOR;
            floorMaterials[y][x] = floorMat;
          }
        }

        // Tag perimeter walls with the room's architectural material
        for (let y = Math.max(0, ry - 1); y <= Math.min(H - 1, ry + rh); y++) {
          for (let x = Math.max(0, rx - 1); x <= Math.min(W - 1, rx + rw); x++) {
            if (grid[y][x] === this.TILE_WALL) {
              let assigned = wallMat;
              const rRoll = this.random();
              if (rRoll < 0.08) assigned = 'concrete_ussr';
              else if (rRoll < 0.15) assigned = 'concrete_warning';
              else if (rRoll < 0.22) assigned = 'concrete_vent';
              wallMaterials[y][x] = assigned;
            }
          }
        }
      }

      // Ensure minimum 7 rooms, fallback if needed
      if (rooms.length < 14) {
        return this.generate(playerLevel); // Retry BSP with alternate split rolls
      }

      // 4. Carve connecting corridors along BSP tree / sibling graph (1-2 cells wide)
      const doors = [];
      this.connectBspTree(rootNode, grid, doors);

      // Verify full connectivity with BFS; if any room isolated, connect to nearest
      this.ensureFullConnectivity(grid, rooms);

      // 5. Automatic Airtight Blast Doors in narrow bottlenecks entering rooms
      this.placeBlastDoors(grid, rooms, doors);

      // 6. Starting Safe Room (Room 0)
      const startRoom = rooms[0];
      const playerSpawn = {
        x: startRoom.centerX * TS,
        y: startRoom.centerY * TS,
        tileX: startRoom.centerX,
        tileY: startRoom.centerY
      };

      // 7. Evacuation Cargo Elevator in furthest room (Topological BFS distance)
      const furthestRoom = this.findFurthestRoom(rooms, startRoom);
      const elevator = {
        x: (furthestRoom.centerX - 1) * TS,
        y: (furthestRoom.centerY - 1) * TS,
        tileX: furthestRoom.centerX,
        tileY: furthestRoom.centerY,
        w: TS * 2,
        h: TS * 2,
        name: 'Шахта грузового лифта // Эвакуация'
      };

      // Carve 2x2 floor space for the elevator pad
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ey = furthestRoom.centerY + dy;
          const ex = furthestRoom.centerX + dx;
          if (ey >= 1 && ey < H - 1 && ex >= 1 && ex < W - 1) {
            grid[ey][ex] = this.TILE_FLOOR;
          }
        }
      }

      // 8. Dynamic Bestiary Scaling via Progression (Distant Room Spawning)
      let mutants = [];
      if (typeof Progression !== 'undefined' && Progression.generateEnemiesForLevel) {
        mutants = Progression.generateEnemiesForLevel(playerLevel, rooms, TS, startRoom);
      }

      // 9. Loot Caches (4 to 6 random caches in non-safe rooms)
      const lootCrates = [];
      const explosiveBarrels = [];
      const weaponDrops = [];
      this.populateLoot(rooms, startRoom, furthestRoom, lootCrates, weaponDrops, TS);
      this.populateExplosiveBarrels(rooms, startRoom, furthestRoom, explosiveBarrels, TS);

      // 10. Wall Lanterns ("Фонари") for warm volumetric illumination
      const lamps = this.placeLanterns(grid, rooms, TS);

      // 11. Friendly Patrol Liquidators in safe start room & adjacent corridor
      const allies = [
        {
          id: 'liquidator_ally_1',
          name: 'Ликвидатор Семеныч',
          x: (startRoom.x + 1) * TS,
          y: (startRoom.y + 1) * TS,
          radius: 13,
          type: 'liquidator',
          state: 'PATROL',
          angle: 0,
          hp: 150,
          maxHp: 150,
          weapon: { id: 'pipe', name: 'Тяжелая труба', dmg: 25, isRanged: false }
        }
      ];

            // 9b. Supply Chests (openable with [E]) & Keycard Spawn
      const chests = [];
      this.populateChests(rooms, startRoom, chests, weaponDrops, TS);

      // 11b. Friendly NPCs with Dialogues & Quests
      const npcs = [];
      this.populateNPCs(rooms, startRoom, npcs, TS);

      // 12. Authentic Living Cell & Bunker Props (Bunks, Desks, Chairs)
      const props = [];
      this.populateProps(rooms, grid, props, TS);

      // 13. Security Keycards, Notes & In-Run Puzzles Spawn
      const keycards = [];
      const notes = [];
      const puzzles = [];

      // Spawn Blue Keycard in workshop/archive room
      const blueRoom = rooms[Math.min(rooms.length - 1, 2)];
      keycards.push({
        id: 'keycard_blue',
        color: 'BLUE',
        name: 'Синяя ключ-карта Инженера',
        x: (blueRoom.centerX + 1) * TS + TS / 2,
        y: (blueRoom.centerY) * TS + TS / 2,
        tileX: blueRoom.centerX + 1,
        tileY: blueRoom.centerY
      });

      // Spawn Yellow Keycard in medbay/living room
      const yellowRoom = rooms[Math.min(rooms.length - 1, 3)];
      keycards.push({
        id: 'keycard_yellow',
        color: 'YELLOW',
        name: 'Желтая ключ-карта Снабжения',
        x: (yellowRoom.centerX - 1) * TS + TS / 2,
        y: (yellowRoom.centerY + 1) * TS + TS / 2,
        tileX: yellowRoom.centerX - 1,
        tileY: yellowRoom.centerY + 1
      });

      // Spawn Commandant's Note with Code 1984
      const noteRoom = rooms[Math.min(rooms.length - 1, 1)];
      notes.push({
        id: 'note_commandant_1984',
        name: 'Записка коменданта',
        text: 'Код от секретного бункера — год закладки блока (1984)',
        code: '1984',
        x: noteRoom.centerX * TS + TS / 2,
        y: (noteRoom.centerY - 1) * TS + TS / 2,
        tileX: noteRoom.centerX,
        tileY: noteRoom.centerY - 1
      });

      // Spawn Archivist's Punched Card in corridor/room
      const punchRoom = rooms[Math.min(rooms.length - 1, 4)];
      notes.push({
        id: 'item_punched_card',
        name: 'Перфокарта Директивы 74-Б',
        isPunchedCard: true,
        x: (punchRoom.centerX + 1) * TS + TS / 2,
        y: (punchRoom.centerY - 1) * TS + TS / 2,
        tileX: punchRoom.centerX + 1,
        tileY: punchRoom.centerY - 1
      });

      // Spawn Voltage Calibration Substation Terminal
      const subRoom = rooms[Math.min(rooms.length - 1, 2)];
      puzzles.push({
        id: 'puzzle_voltage',
        type: 'VOLTAGE',
        targetVoltage: 80,
        currentVoltage: 0,
        solved: false,
        name: 'Щит подстанции // Калибровка 80W',
        x: (subRoom.centerX - 1) * TS + TS / 2,
        y: (subRoom.centerY - 1) * TS + TS / 2,
        tileX: subRoom.centerX - 1,
        tileY: subRoom.centerY - 1
      });


      // 14. Environmental Lore: Tape Recorders & Wall Decal Notes
      const recorders = [];
      const wallNotes = [];

      // A. Tape Recorders (PROP_RECORDER) - 1 to 2 per floor
      const tapePool = [
        { tapeId: '42', text: '[Кассета №42]: Отряд 3 погиб в шлюзе B... Оно мимикрирует под шум воды... Не включайте свет...' },
        { tapeId: '17', text: '[Кассета №17]: Самосбор пошёл раньше расписания. Комендант запер гермозатворы снаружи. Мы замурованы...' },
        { tapeId: '08', text: '[Кассета №08]: Бетон на 4-м ярусе дышит. Стены пульсируют. Если слышите шёпот — стреляйте без предупреждения...' },
        { tapeId: '29', text: '[Кассета №29]: Фильтры забились чёрной слизью. Дежурный по вентиляции сошёл с ума и открыл люк...' },
        { tapeId: '55', text: '[Кассета №55]: Мы нашли склад ВОХР в секторе 7. Там ящики с патронами и бочки, но двери заклинило намертво...' }
      ];

      const numRecorders = Math.min(2, Math.max(1, rooms.length - 2));
      for (let i = 0; i < numRecorders; i++) {
        const rRoom = rooms[Math.min(rooms.length - 1, i + 2)];
        const tape = tapePool[(i + (this.currentRaidFloor || 1)) % tapePool.length];
        recorders.push({
          id: 'recorder_' + i,
          name: 'Магнитофон «Весна-306»',
          tapeId: tape.tapeId,
          text: tape.text,
          x: (rRoom.centerX - 1) * TS + TS / 2,
          y: (rRoom.centerY) * TS + TS / 2,
          tileX: rRoom.centerX - 1,
          tileY: rRoom.centerY,
          listened: false,
          isPlaying: false
        });
      }

      // B. Wall Decal Notes (WALL_DECAL_NOTE) - 2 to 3 per floor
      const noteDefs = [
        {
          id: 'note_armory_code',
          title: 'СЛУЖЕБНАЯ ЗАПИСКА №1984-С',
          header: 'ДЕЖУРНОМУ ПО СЕКТОРУ',
          text: 'Внимание дежурному! Код от оружейной изменён на 1984. Ключ-карта спрятана за щитком подстанции в секторе C2.',
          stamp: 'СЕКРЕТНО // ОХРАНА БЛОКА',
          roomIdx: 1
        },
        {
          id: 'note_power_hazard',
          title: 'ПРЕДПИСАНИЕ СЛУЖБЫ ТБ',
          header: 'ВНИМАНИЮ ЛИКВИДАТОРОВ',
          text: 'Осторожно! В бойлерной пробило проводку, пол под напряжением. Перед проходом обесточьте распределительный щиток на стене!',
          stamp: 'АВАРИЙНЫЙ НАДЗОР',
          roomIdx: 2
        },
        {
          id: 'note_samosbor_alert',
          title: 'ДИРЕКТИВА №77-Б',
          header: 'ПРИКАЗ КОМЕНДАНТА',
          text: 'При звуках ревуна не приближаться к лифтовой шахте. Возможен обрыв грузовых тросов. В вентиляционных решётках замечена биомасса.',
          stamp: 'УПРАВЛЕНИЕ ГИГАХРУЩА',
          roomIdx: 3
        }
      ];

      noteDefs.forEach((nd, idx) => {
        const targetRoom = rooms[Math.min(rooms.length - 1, nd.roomIdx)];
        wallNotes.push({
          id: nd.id,
          title: nd.title,
          header: nd.header,
          text: nd.text,
          stamp: nd.stamp,
          x: targetRoom.x * TS + TS / 2 + 16,
          y: (targetRoom.y + 1) * TS + TS / 2,
          tileX: targetRoom.x,
          tileY: targetRoom.y + 1
        });
      });

      // 15. Interactive Dungeon Traps: Electric Wires & Flesh Vents
      const electricTraps = [];
      const fleshVents = [];

      // Find suitable corridor floor tiles for traps
      const corridorTiles = [];
      for (let ty = 3; ty < H - 3; ty++) {
        for (let tx = 3; tx < W - 3; tx++) {
          if (grid[ty][tx] === 0) {
            // Check if in corridor (at least 2 opposing wall neighbors)
            const horizWalls = (grid[ty][tx - 1] === 1 && grid[ty][tx + 1] === 1);
            const vertWalls = (grid[ty - 1][tx] === 1 && grid[ty + 1][tx] === 1);
            if (horizWalls || vertWalls) {
              const dSpawn = Math.hypot(tx * TS - playerSpawn.x, ty * TS - playerSpawn.y);
              if (dSpawn > 160) {
                corridorTiles.push({ tx, ty, horizWalls, vertWalls });
              }
            }
          }
        }
      }

      // Spawn 1-2 Electric Wire Traps with Breaker Boxes
      const numWires = Math.min(2, Math.max(1, Math.floor(corridorTiles.length / 12)));
      for (let i = 0; i < numWires; i++) {
        const cTile = corridorTiles[i * 5 + 2] || corridorTiles[i];
        if (cTile) {
          // Breaker box placed 2 tiles away along wall
          const boxTx = cTile.horizWalls ? (cTile.tx - 1) : cTile.tx;
          const boxTy = cTile.horizWalls ? (cTile.ty - 2) : (cTile.ty - 1);

          electricTraps.push({
            id: 'wire_trap_' + i,
            x: cTile.tx * TS + TS / 2,
            y: cTile.ty * TS + TS / 2,
            tileX: cTile.tx,
            tileY: cTile.ty,
            disabled: false,
            isArcing: false,
            arcTimer: 0,
            breakerBox: {
              id: 'breaker_' + i,
              x: boxTx * TS + TS / 2,
              y: boxTy * TS + TS / 2,
              tileX: boxTx,
              tileY: boxTy,
              disabled: false,
              hp: 1
            }
          });
        }
      }

      // Spawn 2-3 Biomechanical Flesh Vent Grates
      const numVents = Math.min(3, Math.max(2, Math.floor(corridorTiles.length / 8)));
      for (let i = 0; i < numVents; i++) {
        const cTile = corridorTiles[corridorTiles.length - 1 - (i * 4)];
        if (cTile) {
          fleshVents.push({
            id: 'flesh_vent_' + i,
            x: cTile.tx * TS + TS / 2,
            y: cTile.ty * TS + TS / 2,
            tileX: cTile.tx,
            tileY: cTile.ty,
            entangled: false,
            dormantTimer: 0,
            entangleTimer: 0
          });
        }
      }

      // Scale Mutant HP & Damage by current floor depth
      const hpScale = 1 + (this.currentRaidFloor - 1) * 0.25;
      const dmgScale = 1 + (this.currentRaidFloor - 1) * 0.15;
      for (const m of mutants) {
        m.maxHp = Math.round(m.maxHp * hpScale);
        m.hp = m.maxHp;
        m.dmg = Math.round((m.dmg || 16) * dmgScale);
      }

      return {
        grid,
        wallMaterials,
        floorMaterials,
        width: W,
        height: H,
        tileSize: TS,
        rooms,
        doors,
        playerSpawn,
        elevator,
        mutants,
        allies,
        lootCrates,
        weaponDrops,
        chests,
        npcs,
        keycards,
        notes,
        puzzles,
        recorders,
        wallNotes,
        electricTraps,
        fleshVents,
        currentRaidFloor: this.currentRaidFloor,
        lamps
      };
    },

    /**
     * Recursive Binary Space Partitioning
     */
    splitBsp(node, leaves, depth, maxDepth) {
      const minSize = 10;
      if (depth >= maxDepth || (node.w < minSize * 2 && node.h < minSize * 2)) {
        leaves.push(node);
        return;
      }

      // Choose split axis (prefer splitting the longer axis)
      let splitHoriz = this.random() < 0.5;
      if (node.w > node.h && node.w / node.h >= 1.25) splitHoriz = false;
      else if (node.h > node.w && node.h / node.w >= 1.25) splitHoriz = true;

      const max = (splitHoriz ? node.h : node.w) - minSize;
      if (max <= minSize) {
        leaves.push(node);
        return;
      }

      const split = minSize + Math.floor(this.random() * (max - minSize + 1));

      if (splitHoriz) {
        node.left = { x: node.x, y: node.y, w: node.w, h: split };
        node.right = { x: node.x, y: node.y + split, w: node.w, h: node.h - split };
      } else {
        node.left = { x: node.x, y: node.y, w: split, h: node.h };
        node.right = { x: node.x + split, y: node.y, w: node.w - split, h: node.h };
      }

      this.splitBsp(node.left, leaves, depth + 1, maxDepth);
      this.splitBsp(node.right, leaves, depth + 1, maxDepth);
    },

    /**
     * Connect sibling nodes in BSP tree
     */
    connectBspTree(node, grid, doors) {
      if (!node.left || !node.right) return;

      this.connectBspTree(node.left, grid, doors);
      this.connectBspTree(node.right, grid, doors);

      const roomA = this.getLeafRoom(node.left);
      const roomB = this.getLeafRoom(node.right);

      if (roomA && roomB) {
        this.carveCorridor(grid, roomA.centerX, roomA.centerY, roomB.centerX, roomB.centerY);
      }
    },

    getLeafRoom(node) {
      if (!node) return null;
      if (node.room) return node.room;
      return this.getLeafRoom(node.left) || this.getLeafRoom(node.right);
    },

    /**
     * Carve L-shaped corridor between points (1-2 tiles wide)
     */
    carveCorridor(grid, x1, y1, x2, y2) {
      const W = this.GRID_WIDTH;
      const H = this.GRID_HEIGHT;

      let cx = x1, cy = y1;
      const horizontalFirst = this.random() < 0.5;

      const stepX = () => {
        while (cx !== x2) {
          cx += (x2 > cx) ? 1 : -1;
          if (cy >= 1 && cy < H - 1 && cx >= 1 && cx < W - 1) {
            grid[cy][cx] = this.TILE_FLOOR;
            // 2-tile wide occasionally for natural bunker feel
            if (cy + 1 < H - 1 && (cx % 3 === 0)) grid[cy + 1][cx] = this.TILE_FLOOR;
          }
        }
      };

      const stepY = () => {
        while (cy !== y2) {
          cy += (y2 > cy) ? 1 : -1;
          if (cy >= 1 && cy < H - 1 && cx >= 1 && cx < W - 1) {
            grid[cy][cx] = this.TILE_FLOOR;
            if (cx + 1 < W - 1 && (cy % 3 === 0)) grid[cy][cx + 1] = this.TILE_FLOOR;
          }
        }
      };

      if (horizontalFirst) {
        stepX();
        stepY();
      } else {
        stepY();
        stepX();
      }
    },

    /**
     * Ensure full connectivity: if any room is isolated, carve corridor to nearest connected room
     */
    ensureFullConnectivity(grid, rooms) {
      if (rooms.length <= 1) return;
      const visited = new Set([rooms[0].id]);
      const unvisited = new Set(rooms.slice(1).map(r => r.id));

      while (unvisited.size > 0) {
        let bestDist = Infinity;
        let bestPair = null;

        for (const vId of visited) {
          const roomA = rooms.find(r => r.id === vId);
          for (const uId of unvisited) {
            const roomB = rooms.find(r => r.id === uId);
            const dist = Math.hypot(roomA.centerX - roomB.centerX, roomA.centerY - roomB.centerY);
            if (dist < bestDist) {
              bestDist = dist;
              bestPair = { a: roomA, b: roomB };
            }
          }
        }

        if (bestPair) {
          this.carveCorridor(grid, bestPair.a.centerX, bestPair.a.centerY, bestPair.b.centerX, bestPair.b.centerY);
          visited.add(bestPair.b.id);
          unvisited.delete(bestPair.b.id);
        } else {
          break;
        }
      }
    },

    /**
     * Place airtight blast doors at narrow openings (1 tile wide) entering rooms
     */
    placeBlastDoors(grid, rooms, doors) {
      const TS = this.TILE_SIZE;
      const W = this.GRID_WIDTH;
      const H = this.GRID_HEIGHT;
      const doorSet = new Set();

      for (const room of rooms) {
        // Check perimeters of room
        const checks = [];
        // Top and bottom walls
        for (let x = room.x; x < room.x + room.w; x++) {
          checks.push({ x, y: room.y - 1, isH: true });
          checks.push({ x, y: room.y + room.h, isH: true });
        }
        // Left and right walls
        for (let y = room.y; y < room.y + room.h; y++) {
          checks.push({ x: room.x - 1, y, isH: false });
          checks.push({ x: room.x + room.w, y, isH: false });
        }

        for (const pt of checks) {
          if (pt.x < 1 || pt.x >= W - 1 || pt.y < 1 || pt.y >= H - 1) continue;
          if (grid[pt.y][pt.x] !== this.TILE_FLOOR) continue;

          // Check if flanked by walls (narrow 1-tile doorway)
          const leftIsWall = grid[pt.y][pt.x - 1] === this.TILE_WALL;
          const rightIsWall = grid[pt.y][pt.x + 1] === this.TILE_WALL;
          const topIsWall = grid[pt.y - 1][pt.x] === this.TILE_WALL;
          const bottomIsWall = grid[pt.y + 1][pt.x] === this.TILE_WALL;

          const isNarrowDoorway = (leftIsWall && rightIsWall) || (topIsWall && bottomIsWall);

          const key = `${pt.x},${pt.y}`;
          if (isNarrowDoorway && !doorSet.has(key)) {
            doorSet.add(key);
            grid[pt.y][pt.x] = this.TILE_DOOR_CLOSED;
            
            // Assign security door types: RED (Armory), BLUE (Workshop), YELLOW (Medbay), CODE (Command bunker)
            let secType = 'NORMAL';
            let isLocked = false;
            let reqKey = null;
            let reqCode = null;
            let secColor = '#00ffaa';

            if (doors.length === 1) {
              secType = 'RED';
              isLocked = true;
              reqKey = 'RED';
              secColor = '#ff3b30';
              room.specialType = 'ARMORY';
              room.name = 'Оружейный арсенал ВОХР';
            } else if (doors.length === 2) {
              secType = 'BLUE';
              isLocked = true;
              reqKey = 'BLUE';
              secColor = '#00e5ff';
              room.specialType = 'WORKSHOP';
              room.name = 'Инженерный отсек / Мастерская';
            } else if (doors.length === 4) {
              secType = 'YELLOW';
              isLocked = true;
              reqKey = 'YELLOW';
              secColor = '#ffd700';
              room.specialType = 'MEDBAY';
              room.name = 'Склад продовольствия и медикаментов';
            } else if (doors.length === 5) {
              secType = 'CODE';
              isLocked = true;
              reqCode = '1984';
              secColor = '#ffaa00';
              room.specialType = 'COMMAND';
              room.name = 'Секретный командный пункт';
            }

            doors.push({
              x: pt.x * TS,
              y: pt.y * TS,
              tileX: pt.x,
              tileY: pt.y,
              w: TS,
              h: TS,
              isOpen: false,
              isLocked: isLocked,
              securityType: secType,
              requiresKeycard: reqKey,
              requiresCode: reqCode,
              color: secColor,
              openProgress: 0.0
            });
            break; // Max 1-2 doors per room perimeter
          }
        }
      }
    },

    /**
     * Find furthest room via topological distance
     */
    findFurthestRoom(rooms, startRoom) {
      let maxDist = -1;
      let furthest = rooms[rooms.length - 1];

      for (let i = 1; i < rooms.length; i++) {
        const r = rooms[i];
        const dist = Math.hypot(r.centerX - startRoom.centerX, r.centerY - startRoom.centerY);
        if (dist > maxDist) {
          maxDist = dist;
          furthest = r;
        }
      }
      return furthest;
    },

    /**
     * Populate rooms with hazardous explosive chemical barrels
     */
    populateExplosiveBarrels(rooms, startRoom, furthestRoom, explosiveBarrels, TS) {
      const eligibleRooms = rooms.filter(r => r.id !== startRoom.id);
      for (const room of eligibleRooms) {
        if (this.random() < 0.65) {
          const numBarrels = 1 + Math.floor(this.random() * 2);
          for (let b = 0; b < numBarrels; b++) {
            const bx = room.x + 1 + Math.floor(this.random() * Math.max(1, room.w - 2));
            const by = room.y + 1 + Math.floor(this.random() * Math.max(1, room.h - 2));
            explosiveBarrels.push({
              id: 'barrel_' + this.random().toString(36).substr(2, 7),
              x: bx * TS + TS / 2,
              y: by * TS + TS / 2,
              tileX: bx,
              tileY: by,
              radius: 13,
              hp: 20,
              maxHp: 20,
              exploded: false,
              type: 'barrel_explosive'
            });
          }
        }
      }
    },

    /**
     * Populate 4 to 6 random caches with loot crates & firearms
     */
    populateLoot(rooms, startRoom, furthestRoom, lootCrates, weaponDrops, TS) {
      const eligibleRooms = rooms.filter(r => r.id !== startRoom.id && r.id !== furthestRoom.id);
      const numCaches = Math.min(eligibleRooms.length, 4 + Math.floor(this.random() * 3));

      // Shuffle rooms
      const shuffled = [...eligibleRooms].sort(() => this.random() - 0.5);

      const crateTypes = ['crate_ammo', 'crate_med', 'crate_supply', 'crate_tech', 'crate_wood'];
      const guns = [
        { id: 'gun_pm', name: 'Пистолет Макарова (ПМ)', dmg: 28, isRanged: true, ammo: 16, gunType: 'pistol' },
        { id: 'gun_shotgun', name: 'Двуствольный обрез', dmg: 48, isRanged: true, ammo: 8, gunType: 'shotgun' },
        { id: 'gun_ak74', name: 'Автомат АК-74', dmg: 34, isRanged: true, ammo: 30, gunType: 'rifle' }
      ];

      for (let i = 0; i < numCaches; i++) {
        const room = shuffled[i];
        const cx = room.centerX;
        const cy = room.centerY;

        // Spawn 1-2 Crates in the cache room
        const numCrates = 1 + Math.floor(this.random() * 2);
        for (let c = 0; c < numCrates; c++) {
          const offsetX = (c === 0 ? -1 : 1);
          const ctype = crateTypes[Math.floor(this.random() * crateTypes.length)];
          lootCrates.push({
            id: 'crate_' + this.random().toString(36).substr(2, 7),
            x: (cx + offsetX) * TS + TS / 2,
            y: cy * TS + TS / 2,
            tileX: cx + offsetX,
            tileY: cy,
            type: ctype,
            opened: false
          });
        }

        // Spawn a firearm in some caches
        if (i < 2 && guns.length > 0) {
          const gun = guns[i % guns.length];
          weaponDrops.push({
            id: 'drop_' + gun.id,
            gunId: gun.id,
            name: gun.name || 'Огнестрельное оружие',
            dmg: gun.dmg || 34,
            ammo: gun.ammo || 20,
            maxAmmo: gun.maxAmmo || 20,
            gunType: gun.gunType || 'rifle',
            x: cx * TS + TS / 2,
            y: (cy + 1) * TS + TS / 2,
            tileX: cx,
            tileY: cy + 1,
            pickedUp: false,
            weapon: Object.assign({}, gun)
          });
        }
      }
    },

    /**
     * Place atmospheric amber lanterns along walls
     */

    /**
     * Populate interactive supply chests & keycard drop
     */

    /**
     * Populate friendly NPCs with dialogues and procedural quests
     */
    populateNPCs(rooms, startRoom, npcs, TS) {
      // 1. Раненый ликвидатор (Просит аптечку -> встает союзником + дает Красную Карту ВОХР)
      if (rooms.length > 1) {
        const rRoom = rooms[1];
        npcs.push({
          id: 'npc_wounded_liquidator',
          name: 'Рядовой Грачев',
          role: 'Раненый ликвидатор ВОХР',
          x: rRoom.centerX * TS - TS,
          y: rRoom.centerY * TS,
          radius: 14,
          type: 'npc_wounded',
          isWounded: true,
          hasAided: false,
          portrait: 'assets/monsters/m_liquidator.png',
          dialogue: 'Брат... Задело кислотой при прорыве слизи. Поделись военной аптечкой [Q]... У меня осталась красная ключ-карта от арсенала ВОХР — отдам её тебе, и пойду с тобой зачищать этот этаж!',
          quest: {
            id: 'quest_heal_liquidator',
            type: 'HEAL_MEDKIT',
            title: 'Полевая перевязка ликвидатора',
            desc: 'Дать армейскую аптечку [Q / 1]',
            rewardKeycard: 'RED',
            rewardFollower: true,
            completed: false,
            turnedIn: false
          }
        });
      }

      // 2. Безумный архивариус НИИ (Ищет потерянную перфокарту с Директивой)
      if (rooms.length > 2) {
        const archRoom = rooms[2];
        npcs.push({
          id: 'npc_mad_archivist',
          name: 'Доцент Лисовский',
          role: 'Безумный архивариус НИИ',
          x: archRoom.centerX * TS + TS / 2,
          y: archRoom.centerY * TS + TS / 2,
          radius: 14,
          type: 'npc_archivist',
          portrait: 'assets/monsters/m_madman.png',
          dialogue: 'Стой! Не подходи к шкафам! Я обронил перфокарту с Директивой 74-Б... Без неё комендант скормит меня туману! Отыщи её в соседних комнатах — я отдам тебе чертеж модификации оружия и связку талонов (+150 талонов)!',
          quest: {
            id: 'quest_find_punched_card',
            type: 'FIND_ITEM',
            itemKey: 'punched_card',
            title: 'Утраченная директива Главснаба',
            desc: 'Найти перфокарту в соседних комнатах',
            rewardTalons: 150,
            rewardXp: 25,
            completed: false,
            turnedIn: false
          }
        });
      }

      // 3. Бродячий барыга из тумана (Обмен слизи на патроны и фильтры)
      if (rooms.length > 3) {
        const traderRoom = rooms[3];
        npcs.push({
          id: 'npc_fog_trader',
          name: 'Хромой Сёма',
          role: 'Бродячий барыга из тумана',
          x: traderRoom.centerX * TS,
          y: traderRoom.centerY * TS - TS / 2,
          radius: 14,
          type: 'npc_trader',
          portrait: 'assets/monsters/m_cultist.png',
          dialogue: 'Пс-с, ликвидатор... Живой еще? Слизь с тварей собираешь? Могу обменять свежие брикеты слизи на патроны для дробовика или новый фильтр противогаза.',
          quest: {
            id: 'quest_barter_trade',
            type: 'BARTER',
            title: 'Нелегальный бартер в тумане',
            desc: 'Обменять собранную слизь на припасы'
          }
        });
      }
    },

    /**
     * Populate authentic retro office furniture, Soviet props & environmental clutter
     */
    populateProps(rooms, grid, props, TS) {
      const clutterDefs = [
        { type: 'office_desk', name: 'Обшарпанный стол с бумагами', radius: 14, isPassable: false },
        { type: 'chair', name: 'Советский стул', radius: 8, isPassable: false },
        { type: 'fridge', name: 'Ржавый холодильник "ЗИЛ"', radius: 14, isPassable: false },
        { type: 'crate', name: 'Деревянный ящик снабжения', radius: 12, isPassable: false },
        { type: 'vent_fan', name: 'Напольный вентилятор', radius: 10, isPassable: false },
        { type: 'bunk', name: 'Двухъярусная койка ликвидаторов', radius: 15, isPassable: false }
      ];

      for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
        const room = rooms[rIdx];

        // Safe Start Room: Bunk bed, terminal desk and chair
        if (rIdx === 0) {
          props.push({
            id: 'prop_bunk_start',
            type: 'bunk',
            x: (room.x + 1) * TS + TS / 2,
            y: (room.y + 1) * TS + TS / 2,
            tileX: room.x + 1,
            tileY: room.y + 1,
            radius: 15,
            name: 'Двухъярусная койка ликвидаторов'
          });
          props.push({
            id: 'prop_desk_start',
            type: 'office_desk',
            x: (room.x + room.w - 2) * TS + TS / 2,
            y: (room.y + 1) * TS + TS / 2,
            tileX: room.x + room.w - 2,
            tileY: room.y + 1,
            radius: 14,
            name: 'Стол с радиотерминалом'
          });
          props.push({
            id: 'prop_chair_start',
            type: 'chair',
            x: (room.x + room.w - 2) * TS + TS / 2,
            y: (room.y + 2) * TS + TS / 2,
            tileX: room.x + room.w - 2,
            tileY: room.y + 2,
            radius: 8,
            name: 'Стул'
          });
          continue;
        }

        // Room Clutter: 2 to 4 obstacles along room perimeters (not blocking doorways)
        const numClutter = 2 + Math.floor(this.random() * 3);
        const perimCells = [];

        for (let ry = room.y + 1; ry < room.y + room.h - 1; ry++) {
          for (let rx = room.x + 1; rx < room.x + room.w - 1; rx++) {
            const isPerim = (rx === room.x + 1 || rx === room.x + room.w - 2 || ry === room.y + 1 || ry === room.y + room.h - 2);
            if (isPerim && grid[ry] && grid[ry][rx] === this.TILE_FLOOR) {
              // Avoid directly in front of doors
              let nearDoor = false;
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  if (grid[ry + dy] && (grid[ry + dy][rx + dx] === this.TILE_DOOR_CLOSED || grid[ry + dy][rx + dx] === this.TILE_DOOR_OPEN)) {
                    nearDoor = true;
                  }
                }
              }
              if (!nearDoor) {
                perimCells.push({ x: rx, y: ry });
              }
            }
          }
        }

        const shuffled = perimCells.sort(() => this.random() - 0.5);
        const toSpawn = Math.min(numClutter, shuffled.length);

        for (let c = 0; c < toSpawn; c++) {
          const cell = shuffled[c];
          let cDef = clutterDefs[Math.floor(this.random() * clutterDefs.length)];
          if (room.type === 'archive') {
            cDef = this.random() < 0.6 ? clutterDefs[0] : clutterDefs[1]; // desks & chairs
          } else if (room.type === 'warehouse' || room.type === 'armory') {
            cDef = this.random() < 0.7 ? clutterDefs[3] : clutterDefs[4]; // crates & fans
          } else if (room.type === 'boiler' || room.type === 'pump') {
            cDef = this.random() < 0.5 ? clutterDefs[2] : clutterDefs[4]; // fridges & fans
          }

          props.push({
            id: 'prop_' + room.id + '_' + c,
            type: cDef.type,
            name: cDef.name,
            x: cell.x * TS + TS / 2,
            y: cell.y * TS + TS / 2,
            tileX: cell.x,
            tileY: cell.y,
            radius: cDef.radius,
            isPassable: cDef.isPassable
          });
        }
      }
    },
    populateChests(rooms, startRoom, chests, weaponDrops, TS) {
      const eligibleRooms = rooms.filter(r => r.id !== startRoom.id);
      const shuffled = [...eligibleRooms].sort(() => this.random() - 0.5);

      // Keycard item drop in one of the mid-distance rooms
      if (shuffled.length > 2) {
        const keycardRoom = shuffled[1];
        weaponDrops.push({
          id: 'drop_keycard_' + this.random().toString(36).substr(2, 6),
          isKeycard: true,
          name: '🔑 Электронная ключ-карта допуска',
          x: (keycardRoom.centerX) * TS + TS / 2,
          y: (keycardRoom.centerY) * TS + TS / 2,
          tileX: keycardRoom.centerX,
          tileY: keycardRoom.centerY,
          pickedUp: false,
          color: '#33d4ff'
        });
      }

      // Spawn 3-5 openable supply chests
      const chestCount = Math.min(shuffled.length, 3 + Math.floor(this.random() * 3));
      for (let i = 0; i < chestCount; i++) {
        const room = shuffled[i];
        const isSecretChest = !!room.isSecret;
        const isLockedKeycard = (i === 1 || isSecretChest);
        chests.push({
          id: 'chest_' + i,
          x: (room.centerX + (i % 2 === 0 ? 1 : -1)) * TS + TS / 2,
          y: (room.centerY + (i % 2 === 0 ? -1 : 1)) * TS + TS / 2,
          tileX: room.centerX + (i % 2 === 0 ? 1 : -1),
          tileY: room.centerY + (i % 2 === 0 ? -1 : 1),
          opened: false,
          isSecret: isSecretChest,
          isLocked: isLockedKeycard,
          requiresKeycard: isLockedKeycard,
          loot: {
            talons: Math.round((isLockedKeycard ? 350 : 95 + Math.floor(this.random() * 70)) * (1 + (this.currentRaidFloor - 1) * 0.40)),
            ammo: Math.round((isLockedKeycard ? 40 : 16 + Math.floor(this.random() * 14)) * (1 + (this.currentRaidFloor - 1) * 0.20)),
            medkits: isLockedKeycard ? 2 : 1,
            hasKeycard: (!isLockedKeycard && i === 0),
            weapon: isLockedKeycard ? { id: 'gun_ks23', name: 'Карабин КС-23', dmg: Math.round(55 * (1 + (this.currentRaidFloor - 1) * 0.15)), isRanged: true, ammo: 24, gunType: 'shotgun' } : null
          }
        });
      }
    },
    placeLanterns(grid, rooms, TS) {
      const lamps = [];
      const W = this.GRID_WIDTH;
      const H = this.GRID_HEIGHT;

      // 1. Place lanterns in each room
      for (const room of rooms) {
        const lx = room.centerX;
        const ly = room.y;
        if (ly > 0 && grid[ly - 1][lx] === this.TILE_WALL) {
          lamps.push({
            x: lx * TS + TS / 2,
            y: ly * TS + 6,
            tileX: lx,
            tileY: ly,
            flicker: (this.random() < 0.4),
            radius: 190 + this.random() * 60
          });
        }
      }

      // 2. Place flickering corridor lamps every 8-10 tiles along corridors
      for (let y = 3; y < H - 3; y += 8) {
        for (let x = 3; x < W - 3; x += 8) {
          if (grid[y][x] === this.TILE_FLOOR) {
            if (grid[y - 1][x] === this.TILE_WALL) {
              lamps.push({
                x: x * TS + TS / 2,
                y: y * TS + 6,
                tileX: x,
                tileY: y,
                flicker: true,
                radius: 175
              });
            } else if (grid[y + 1][x] === this.TILE_WALL) {
              lamps.push({
                x: x * TS + TS / 2,
                y: (y + 1) * TS - 6,
                tileX: x,
                tileY: y,
                flicker: true,
                radius: 175
              });
            }
          }
        }
      }

      return lamps;
    }
  };

  global.LevelGen = LevelGen;
})(typeof window !== 'undefined' ? window : this);
