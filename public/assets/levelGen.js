/**
 * ============================================================================
 * MODULE: levelGen.js (Procedural Floor Generator for Samosbor Radar Roguelike)
 * ============================================================================
 * Grid-based dungeon generator:
 * - 40x40 grid (tileSize = 32px => 1280x1280 world)
 * - 6-8 interconnected rectangular rooms with 1-2 tile wide corridors
 * - Safe player spawn ("Ячейка 556")
 * - Distant elevator shaft extraction zone ("Шахта Лифта // Эвакуация")
 * - Supply crates / loot packs with concentrate rations & ammo
 * - Airtight blast doors ("Гермодвери")
 * - Roaming mutants and patrol liquidator spawn anchors
 */

(function (global) {
  'use strict';

  const LevelGen = {
    GRID_WIDTH: 40,
    GRID_HEIGHT: 40,
    TILE_SIZE: 32,

    // Tile Types
    TILE_WALL: 1,
    TILE_FLOOR: 0,
    TILE_DOOR: 2,
    TILE_ELEVATOR: 3,

    ROOM_NAMES: [
      'Жилая ячейка №556',
      'Бойлерная узла 4',
      'Склад фильтров В-2',
      'Архив ликвидаторов',
      'Шлюзовая секция №9',
      'Канализационный отстойник',
      'Трансформаторная сектора Г',
      'Блок гидропоники Н-12'
    ],

    /**
     * Generate complete procedural floor
     * @returns {Object} Map data with tiles, rooms, doors, loot, spawns
     */
    generate() {
      const W = this.GRID_WIDTH;
      const H = this.GRID_HEIGHT;
      const TS = this.TILE_SIZE;

      // 1. Initialize full solid wall grid
      const grid = [];
      for (let y = 0; y < H; y++) {
        const row = new Uint8Array(W);
        row.fill(this.TILE_WALL);
        grid.push(row);
      }

      // 2. Generate 6 to 8 rectangular rooms
      const numRooms = 6 + Math.floor(Math.random() * 3); // 6, 7, or 8
      const rooms = [];
      let roomNamesPool = [...this.ROOM_NAMES];

      for (let attempt = 0; attempt < 120 && rooms.length < numRooms; attempt++) {
        const rw = 5 + Math.floor(Math.random() * 4); // 5..8 tiles (160..256px)
        const rh = 4 + Math.floor(Math.random() * 4); // 4..7 tiles (128..224px)
        const rx = 2 + Math.floor(Math.random() * (W - rw - 4));
        const ry = 2 + Math.floor(Math.random() * (H - rh - 4));

        const newRoom = {
          id: rooms.length,
          name: roomNamesPool.length > 0 ? roomNamesPool.shift() : `Сектор ${rooms.length + 1}`,
          x: rx,
          y: ry,
          w: rw,
          h: rh,
          worldX: rx * TS,
          worldY: ry * TS,
          worldW: rw * TS,
          worldH: rh * TS,
          centerX: Math.floor(rx + rw / 2),
          centerY: Math.floor(ry + rh / 2)
        };

        // Check distance/overlap with existing rooms (minimum 2 tiles buffer)
        let overlaps = false;
        for (const existing of rooms) {
          if (
            newRoom.x - 2 < existing.x + existing.w &&
            newRoom.x + newRoom.w + 2 > existing.x &&
            newRoom.y - 2 < existing.y + existing.h &&
            newRoom.y + newRoom.h + 2 > existing.y
          ) {
            overlaps = true;
            break;
          }
        }

        if (!overlaps) {
          rooms.push(newRoom);
          // Carve room floor
          for (let y = newRoom.y; y < newRoom.y + newRoom.h; y++) {
            for (let x = newRoom.x; x < newRoom.x + newRoom.w; x++) {
              grid[y][x] = this.TILE_FLOOR;
            }
          }
        }
      }

      // 3. Connect rooms with corridors (MST / Chain + Random shortcuts)
      const doors = [];
      for (let i = 0; i < rooms.length - 1; i++) {
        this.connectRooms(grid, rooms[i], rooms[i + 1], doors);
      }
      // Add a couple extra loop corridors for non-linear exploration
      if (rooms.length > 3) {
        this.connectRooms(grid, rooms[0], rooms[Math.floor(rooms.length / 2)], doors);
        this.connectRooms(grid, rooms[1], rooms[rooms.length - 1], doors);
      }

      // 4. Designate spawn room and elevator room
      // Spawn is Room 0 ("Жилая ячейка №556")
      rooms[0].name = 'Жилая ячейка №556';
      rooms[0].isSafe = true;

      const playerSpawn = {
        x: rooms[0].centerX * TS + TS / 2,
        y: rooms[0].centerY * TS + TS / 2
      };

      // Find furthest room for Elevator Shaft extraction
      let maxDist = -1;
      let elevatorRoom = rooms[rooms.length - 1];
      for (let i = 1; i < rooms.length; i++) {
        const d = Math.hypot(rooms[i].centerX - rooms[0].centerX, rooms[i].centerY - rooms[0].centerY);
        if (d > maxDist) {
          maxDist = d;
          elevatorRoom = rooms[i];
        }
      }
      elevatorRoom.isElevator = true;
      elevatorRoom.name = 'Шахта Лифта // Эвакуация';

      const elevator = {
        x: elevatorRoom.centerX * TS,
        y: elevatorRoom.centerY * TS,
        tileX: elevatorRoom.centerX,
        tileY: elevatorRoom.centerY,
        w: TS,
        h: TS
      };
      grid[elevatorRoom.centerY][elevatorRoom.centerX] = this.TILE_ELEVATOR;

      // 5. Spawn 8 to 12 Loot / Supply Crates in rooms (avoiding player center)
      const lootCrates = [];
      const numCrates = 8 + Math.floor(Math.random() * 5); // 8..12
      for (let c = 0; c < numCrates; c++) {
        // Pick a room (prefer non-spawn rooms, but spawn room can have 1 starter crate)
        const room = rooms[Math.floor(Math.random() * rooms.length)];
        const cx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const cy = room.y + 1 + Math.floor(Math.random() * (room.h - 2));

        if (grid[cy][cx] === this.TILE_FLOOR && !(cx === rooms[0].centerX && cy === rooms[0].centerY)) {
          const isAmmo = Math.random() < 0.55;
          lootCrates.push({
            id: c,
            x: cx * TS + TS / 2,
            y: cy * TS + TS / 2,
            tileX: cx,
            tileY: cy,
            radius: 12,
            type: isAmmo ? 'ammo' : 'ration',
            amount: isAmmo ? 15 : 25,
            name: isAmmo ? 'Патроны 7.62 мм' : 'Паёк концентрата',
            opened: false,
            phosphorAlpha: 0.15
          });
        }
      }

      // 6. Spawn 6 to 10 Hostile Mutants/Slimes in rooms (strictly away from Room 0)
      const mutantSpawns = [];
      const numMutants = 6 + Math.floor(Math.random() * 5); // 6..10
      for (let m = 0; m < numMutants; m++) {
        const eligibleRooms = rooms.filter(r => !r.isSafe);
        const room = eligibleRooms[Math.floor(Math.random() * eligibleRooms.length)];
        const mx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const my = room.y + 1 + Math.floor(Math.random() * (room.h - 2));

        mutantSpawns.push({
          x: mx * TS + TS / 2,
          y: my * TS + TS / 2,
          homeRoomId: room.id,
          hp: 45 + Math.floor(Math.random() * 30),
          maxHp: 75,
          speed: 1.4 + Math.random() * 0.6
        });
      }

      // 7. Spawn 2 to 3 Patrol Liquidators (Allies)
      const patrolSpawns = [];
      const patrolRooms = rooms.slice(1, 4);
      patrolRooms.forEach((r, idx) => {
        patrolSpawns.push({
          x: r.centerX * TS + TS / 2,
          y: r.centerY * TS + TS / 2,
          homeRoomId: r.id,
          hp: 100,
          maxHp: 100,
          speed: 1.8
        });
      });

      return {
        grid,
        width: W,
        height: H,
        tileSize: TS,
        rooms,
        doors,
        playerSpawn,
        elevator,
        lootCrates,
        mutantSpawns,
        patrolSpawns
      };
    },

    /**
     * Connect two rooms with horizontal and vertical corridors
     */
    connectRooms(grid, roomA, roomB, doors) {
      let x1 = roomA.centerX;
      let y1 = roomA.centerY;
      const x2 = roomB.centerX;
      const y2 = roomB.centerY;

      // 50% chance horizontal first, then vertical
      if (Math.random() < 0.5) {
        this.carveHCorridor(grid, x1, x2, y1);
        this.carveVCorridor(grid, y1, y2, x2);
      } else {
        this.carveVCorridor(grid, y1, y2, x1);
        this.carveHCorridor(grid, x1, x2, y2);
      }

      // Add airtight doors near room boundaries
      this.tryPlaceDoor(grid, roomA, doors);
      this.tryPlaceDoor(grid, roomB, doors);
    },

    carveHCorridor(grid, x1, x2, y) {
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      for (let x = minX; x <= maxX; x++) {
        grid[y][x] = this.TILE_FLOOR;
        // Corridor width: 1-2 cells
        if (y + 1 < this.GRID_HEIGHT - 2 && (x % 3 === 0)) {
          grid[y + 1][x] = this.TILE_FLOOR;
        }
      }
    },

    carveVCorridor(grid, y1, y2, x) {
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      for (let y = minY; y <= maxY; y++) {
        grid[y][x] = this.TILE_FLOOR;
        if (x + 1 < this.GRID_WIDTH - 2 && (y % 3 === 0)) {
          grid[y][x + 1] = this.TILE_FLOOR;
        }
      }
    },

    tryPlaceDoor(grid, room, doors) {
      const TS = this.TILE_SIZE;
      // Scan borders of the room for single opening
      const perimeter = [];
      for (let x = room.x; x < room.x + room.w; x++) {
        perimeter.push({ x, y: room.y - 1, dir: 'up' });
        perimeter.push({ x, y: room.y + room.h, dir: 'down' });
      }
      for (let y = room.y; y < room.y + room.h; y++) {
        perimeter.push({ x: room.x - 1, y, dir: 'left' });
        perimeter.push({ x: room.x + room.w, y, dir: 'right' });
      }

      for (const p of perimeter) {
        if (
          p.x > 1 && p.x < this.GRID_WIDTH - 2 &&
          p.y > 1 && p.y < this.GRID_HEIGHT - 2 &&
          grid[p.y][p.x] === this.TILE_FLOOR
        ) {
          // Check if not already a door
          const exists = doors.some(d => d.tileX === p.x && d.tileY === p.y);
          if (!exists) {
            grid[p.y][p.x] = this.TILE_DOOR;
            doors.push({
              tileX: p.x,
              tileY: p.y,
              x: p.x * TS + TS / 2,
              y: p.y * TS + TS / 2,
              w: TS,
              h: TS,
              isOpen: false,
              openProgress: 0,
              dir: p.dir,
              name: 'Гермодверь ГД-4'
            });
            break;
          }
        }
      }
    }
  };

  global.LevelGen = LevelGen;
})(typeof window !== 'undefined' ? window : this);
