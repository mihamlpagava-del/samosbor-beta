/**
 * ============================================================================
 * MODULE: assetGenerator.js (Procedural Pixel-Art & Vector Canvas Generator)
 * ============================================================================
 * Generates crisp retro Soviet dieselpunk pixel-art assets for Samosbor:
 * - exit_elevator: 64x64 freight extraction elevator with hazard borders & [ H ]
 * - keycards: yellow (engineering), blue (science), red (VOKhR), master (commandant)
 * - loot items: military medkit, shotgun ammo, pistol ammo, GP-5 filter, scrap metal, tape, recorder
 */
(function(global) {
  'use strict';

  class AssetGeneratorClass {
    constructor() {
      this.cache = {};
      this.init();
    }

    init() {
      if (typeof document === 'undefined') return;
      this.generateAll();
    }

    generateAll() {
      this.cache['exit_elevator'] = this.createExitElevator();
      this.cache['elevator_pad'] = this.cache['exit_elevator'];

      this.cache['keycard_yellow'] = this.createKeycard('yellow');
      this.cache['keycard_blue'] = this.createKeycard('blue');
      this.cache['keycard_red'] = this.createKeycard('red');
      this.cache['keycard_master'] = this.createKeycard('master');
      this.cache['keycard_pass'] = this.cache['keycard_red'];
      this.cache['keycard'] = this.cache['keycard_red'];

      this.cache['item_medkit_military'] = this.createItemMedkit();
      this.cache['food_medkit'] = this.cache['item_medkit_military'];

      this.cache['item_ammo_shotgun'] = this.createItemAmmoShotgun();
      this.cache['item_ammo_pistol'] = this.createItemAmmoPistol();
      this.cache['ammo_box'] = this.cache['item_ammo_shotgun'];

      this.cache['item_filter_box'] = this.createItemFilterBox();
      this.cache['item_scrap_metal'] = this.createItemScrapMetal();
      this.cache['item_tape'] = this.createItemTape();
      this.cache['item_recorder'] = this.createItemRecorder();
      this.cache['recorder'] = this.cache['item_recorder'];
      this.cache['wall_note'] = this.createWallNote();
      this.cache['item_wall_note'] = this.cache['wall_note'];
    }

    get(name) {
      if (!this.cache[name]) {
        this.generateAll();
      }
      return this.cache[name] || null;
    }

    _makeCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      return { canvas: c, ctx };
    }

    // 1. Exit Elevator Platform (64x64)
    createExitElevator() {
      const { canvas, ctx } = this._makeCanvas(64, 64);

      // Deep steel base
      ctx.fillStyle = '#141715';
      ctx.fillRect(0, 0, 64, 64);

      // Yellow-Black Hazard Perimeter Border
      const stripeW = 6;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          if (x < stripeW || x >= 64 - stripeW || y < stripeW || y >= 64 - stripeW) {
            ctx.fillStyle = (((x + y) % 8) < 4) ? '#e6aa14' : '#161917';
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // Inner pit & industrial mesh grating
      ctx.fillStyle = '#0c100e';
      ctx.fillRect(6, 6, 52, 52);

      // Steel grating lines
      ctx.strokeStyle = '#222e28';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 8; i <= 56; i += 4) {
        ctx.moveTo(i, 6); ctx.lineTo(i, 58);
        ctx.moveTo(6, i); ctx.lineTo(58, i);
      }
      ctx.stroke();

      // Cross structural steel beams
      ctx.strokeStyle = '#38483f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(6, 6); ctx.lineTo(58, 58);
      ctx.moveTo(6, 58); ctx.lineTo(58, 6);
      ctx.stroke();

      // Center steel plate (24x24)
      ctx.fillStyle = '#19221d';
      ctx.fillRect(20, 20, 24, 24);
      ctx.strokeStyle = '#42584c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(20, 20, 24, 24);

      // Corner rivets
      ctx.fillStyle = '#8fa398';
      const rivets = [[7, 7], [55, 7], [7, 55], [55, 55], [21, 21], [41, 21], [21, 41], [41, 41]];
      for (const [rx, ry] of rivets) {
        ctx.fillRect(rx, ry, 2, 2);
      }

      // Glowing Holographic [ H ] Marker
      // Brackets
      ctx.fillStyle = '#00ff88';
      ctx.fillRect(23, 23, 5, 2); ctx.fillRect(23, 23, 2, 5);
      ctx.fillRect(36, 23, 5, 2); ctx.fillRect(39, 23, 2, 5);
      ctx.fillRect(23, 39, 5, 2); ctx.fillRect(23, 36, 2, 5);
      ctx.fillRect(36, 39, 5, 2); ctx.fillRect(39, 36, 2, 5);

      // Center 'H'
      ctx.fillStyle = '#f0fff4';
      ctx.fillRect(27, 26, 3, 12);
      ctx.fillRect(34, 26, 3, 12);
      ctx.fillRect(27, 31, 10, 3);

      // Emergency console on upper wall edge
      ctx.fillStyle = '#2f3b33';
      ctx.fillRect(25, 0, 14, 6);
      ctx.strokeStyle = '#506657';
      ctx.strokeRect(25, 0, 14, 6);
      ctx.fillStyle = '#ff2a2a'; // Red lever
      ctx.fillRect(27, 2, 3, 3);
      ctx.fillStyle = '#e5dec5'; // Voltmeter dial
      ctx.fillRect(33, 1, 4, 4);
      ctx.fillStyle = '#111';
      ctx.fillRect(35, 2, 1, 2); // needle

      return canvas;
    }

    // 2. Keycards (32x32)
    createKeycard(theme) {
      const { canvas, ctx } = this._makeCanvas(32, 32);
      const cx = 4, cy = 8, cw = 24, ch = 16;

      // Drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(cx + 1, cy + 2, cw, ch);

      // Card frame
      ctx.fillStyle = '#1a1d1b';
      ctx.fillRect(cx, cy, cw, ch);

      let bodyColor, darkColor, trimColor;
      if (theme === 'yellow') {
        bodyColor = '#d99b00'; darkColor = '#8c6400'; trimColor = '#ffea6c';
      } else if (theme === 'blue') {
        bodyColor = '#0f6cb8'; darkColor = '#093f6c'; trimColor = '#00f0ff';
      } else if (theme === 'red') {
        bodyColor = '#af1919'; darkColor = '#660e0e'; trimColor = '#ff4d4d';
      } else {
        bodyColor = '#292c2f'; darkColor = '#151718'; trimColor = '#b84dff';
      }

      ctx.fillStyle = bodyColor;
      ctx.fillRect(cx + 1, cy + 1, cw - 2, ch - 2);

      // Bevel shade
      ctx.fillStyle = darkColor;
      ctx.fillRect(cx + 1, cy + ch - 2, cw - 2, 1);
      ctx.fillRect(cx + cw - 2, cy + 1, 1, ch - 2);

      // Magnetic stripe
      ctx.fillStyle = '#141414';
      ctx.fillRect(cx + 1, cy + 2, cw - 2, 3);

      // Golden smart chip
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(7, 14, 5, 5);
      ctx.fillStyle = '#9e7b00';
      ctx.fillRect(9, 14, 1, 5);
      ctx.fillRect(7, 16, 5, 1);

      // Status LED
      ctx.fillStyle = trimColor;
      ctx.fillRect(23, cy + 2, 2, 2);

      if (theme === 'yellow') {
        // Cogwheel gear emblem
        ctx.fillStyle = darkColor;
        ctx.fillRect(16, 14, 5, 5);
        ctx.fillStyle = bodyColor;
        ctx.fillRect(18, 16, 1, 1);
        ctx.fillStyle = darkColor;
        ctx.fillRect(18, 13, 1, 1); ctx.fillRect(18, 19, 1, 1);
        ctx.fillRect(15, 16, 1, 1); ctx.fillRect(21, 16, 1, 1);
        // Perforations
        ctx.fillStyle = '#141414';
        for (let py = cy + 6; py <= cy + 13; py += 2) {
          ctx.fillRect(cx + cw - 2, py, 1, 1);
        }
      } else if (theme === 'blue') {
        // PCB traces
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(13, 15); ctx.lineTo(17, 15); ctx.lineTo(17, 18); ctx.lineTo(22, 18);
        ctx.stroke();
        ctx.fillStyle = '#d6f4ff';
        ctx.fillRect(19, 13, 3, 3);
        ctx.fillStyle = bodyColor;
        ctx.fillRect(20, 14, 1, 1);
      } else if (theme === 'red') {
        // Soviet Star
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(18, 13, 1, 1);
        ctx.fillRect(17, 14, 3, 1);
        ctx.fillRect(15, 15, 7, 2);
        ctx.fillStyle = '#b38600';
        ctx.fillRect(17, 17, 3, 1);
        ctx.fillRect(16, 18, 1, 1); ctx.fillRect(20, 18, 1, 1);
        ctx.fillStyle = '#aa1111';
        ctx.fillRect(18, 15, 1, 1);
        // Yellow stamp bar
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(cx + 3, cy + ch - 3, 14, 1);
      } else {
        // Master violet thread
        ctx.strokeStyle = '#d666ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(13, 15); ctx.lineTo(17, 18); ctx.lineTo(21, 14); ctx.lineTo(24, 17);
        ctx.stroke();
        ctx.fillStyle = '#a6b0ba';
        ctx.fillRect(cx + 2, cy + ch - 3, 1, 1);
        ctx.fillRect(cx + cw - 3, cy + ch - 3, 1, 1);
      }

      return canvas;
    }

    // 3. Military Medkit (32x32)
    createItemMedkit() {
      const { canvas, ctx } = this._makeCanvas(32, 32);
      const x = 5, y = 7, w = 22, h = 18;

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x + 1, y + 2, w, h);

      // Khaki steel case
      ctx.fillStyle = '#445738';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#273320';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);

      // Handle
      ctx.fillStyle = '#5c6b53';
      ctx.fillRect(x + 6, y - 3, 10, 3);
      ctx.fillStyle = '#141414';
      ctx.fillRect(x + 8, y - 2, 6, 2);

      // Latches & Corners
      ctx.fillStyle = '#9aa894';
      ctx.fillRect(x, y, 3, 3);
      ctx.fillRect(x + w - 3, y, 3, 3);
      ctx.fillRect(x, y + h - 3, 3, 3);
      ctx.fillRect(x + w - 3, y + h - 3, 3, 3);
      ctx.fillRect(x + 4, y + 4, 3, 5);
      ctx.fillRect(x + w - 7, y + 4, 3, 5);

      // Badge & Red Cross
      ctx.fillStyle = '#ece8d9';
      ctx.fillRect(x + 7, y + 4, 8, 8);
      ctx.fillStyle = '#d92626';
      ctx.fillRect(x + 10, y + 5, 2, 6);
      ctx.fillRect(x + 8, y + 7, 6, 2);

      return canvas;
    }

    // 4. Shotgun Ammo Box (32x32)
    createItemAmmoShotgun() {
      const { canvas, ctx } = this._makeCanvas(32, 32);
      const x = 6, y = 10, w = 20, h = 16;

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x + 1, y + 2, w, h);

      // Kraft cardboard
      ctx.fillStyle = '#a6733a';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#69461f';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);

      // Red label
      ctx.fillStyle = '#c7241e';
      ctx.fillRect(x + 2, y + 4, w - 4, 5);
      ctx.fillStyle = '#f0e6d2';
      ctx.fillRect(x + 4, y + 6, w - 8, 1);

      // 3 Protruding Red Shells
      const shells = [x + 3, x + 8, x + 13];
      for (const sx of shells) {
        ctx.fillStyle = '#d4221a';
        ctx.fillRect(sx, y - 6, 4, 7);
        ctx.fillStyle = '#f2be2b'; // Brass base
        ctx.fillRect(sx, y - 2, 4, 3);
      }

      return canvas;
    }

    // 5. Pistol Ammo Can (32x32)
    createItemAmmoPistol() {
      const { canvas, ctx } = this._makeCanvas(32, 32);
      const x = 5, y = 9, w = 22, h = 16;

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x + 1, y + 2, w, h);

      // Military Green Zinc Can
      ctx.fillStyle = '#344f30';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#1d2e1b';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);

      // Solder lid line
      ctx.fillStyle = '#8f9e8d';
      ctx.fillRect(x + 1, y + 4, w - 2, 1);

      // Wire handle
      ctx.fillStyle = '#7a8778';
      ctx.fillRect(x + 6, y - 2, 10, 2);

      // Yellow Stencil "9x18"
      ctx.fillStyle = '#e6b825';
      ctx.fillRect(x + 4, y + 7, 6, 2);
      ctx.fillRect(x + 12, y + 7, 6, 2);
      ctx.fillRect(x + 4, y + 11, 14, 1);

      return canvas;
    }

    // 6. GP-5 Filter Box (32x32)
    createItemFilterBox() {
      const { canvas, ctx } = this._makeCanvas(32, 32);
      const left = 6, top = 11, w = 20, h = 16;

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(left + 1, top + 2, w, h);

      // Olive canister
      ctx.fillStyle = '#374f2f';
      ctx.fillRect(left, top, w, h);
      ctx.strokeStyle = '#20301b';
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, w, h);

      // Vertical corrugated ribs
      for (let rx = left + 3; rx <= left + w - 4; rx += 4) {
        ctx.fillStyle = '#22331d';
        ctx.fillRect(rx, top + 1, 1, h - 2);
        ctx.fillStyle = '#516e45';
        ctx.fillRect(rx + 1, top + 1, 1, h - 2);
      }

      // Metallic screw thread neck
      ctx.fillStyle = '#939e91';
      ctx.fillRect(11, 6, 10, 5);
      ctx.fillStyle = '#cbd4c9';
      ctx.fillRect(11, 7, 10, 1);
      ctx.fillRect(11, 9, 10, 1);

      return canvas;
    }

    // 7. Scrap Metal Bundle (32x32)
    createItemScrapMetal() {
      const { canvas, ctx } = this._makeCanvas(32, 32);

      ctx.strokeStyle = '#753513';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(5, 24); ctx.lineTo(25, 8);
      ctx.stroke();

      // Copper pipe
      ctx.strokeStyle = '#d66822';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(4, 22); ctx.lineTo(24, 6);
      ctx.stroke();

      // Steel rod
      ctx.strokeStyle = '#859094';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(7, 26); ctx.lineTo(27, 10);
      ctx.stroke();

      // Binding wire
      ctx.fillStyle = '#d9e0e3';
      ctx.fillRect(13, 14, 5, 5);
      ctx.fillStyle = '#4f5557';
      ctx.fillRect(14, 15, 3, 3);

      return canvas;
    }

    // 8. Roll of Cloth Electrical Tape (32x32)
    createItemTape() {
      const { canvas, ctx } = this._makeCanvas(32, 32);
      const cx = 15, cy = 16;

      ctx.fillStyle = '#1c1c1c';
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();

      // Cardboard core
      ctx.fillStyle = '#ab854b';
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();

      // Center hole
      ctx.clearRect(cx - 3, cy - 3, 6, 6);

      // Loose tape strip
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 10, cy);
      ctx.lineTo(cx + 15, cy + 4);
      ctx.lineTo(cx + 17, cy + 8);
      ctx.stroke();

      return canvas;
    }

    // 9. Soviet Tape Recorder «Весна-306» (32x32)
    createItemRecorder() {
      const { canvas, ctx } = this._makeCanvas(32, 32);
      const x = 4, y = 7, w = 24, h = 18;

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x + 1, y + 2, w, h);

      // Charcoal plastic casing
      ctx.fillStyle = '#2f3331';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#181a19';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);

      // Aluminum faceplate
      ctx.fillStyle = '#7a827e';
      ctx.fillRect(x + 2, y + 2, w - 4, 8);

      // Cassette window
      ctx.fillStyle = '#111312';
      ctx.fillRect(x + 4, y + 3, 12, 6);

      // Spools
      ctx.fillStyle = '#e8e5d8';
      ctx.fillRect(x + 5, y + 4, 3, 4);
      ctx.fillRect(x + 12, y + 4, 3, 4);
      ctx.fillStyle = '#5c351c'; // tape ribbon
      ctx.fillRect(x + 8, y + 6, 4, 2);

      // Red [REC] LED
      ctx.fillStyle = '#ff2b2b';
      ctx.fillRect(x + 17, y + 3, 2, 2);

      // Buttons
      ctx.fillStyle = '#b3bab5';
      ctx.fillRect(x + 14, y + 12, 2, 4);
      ctx.fillStyle = '#d62424'; // REC button
      ctx.fillRect(x + 17, y + 12, 2, 4);
      ctx.fillStyle = '#b3bab5';
      ctx.fillRect(x + 20, y + 12, 2, 4);

      // Handle
      ctx.fillStyle = '#4c524f';
      ctx.fillRect(x + 4, y - 3, 16, 2);

      return canvas;
    }

    createWallNote() {
      const { canvas, ctx } = this._makeCanvas(48, 64);
      const x = 6, y = 8, w = 36, h = 48;

      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x + 2, y + 3, w, h);

      // Aged Soviet document paper
      ctx.fillStyle = '#eedebc';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#6e5e40';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);

      // Rusty iron pin/nail at top
      ctx.fillStyle = '#3a2b1c';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + 4, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Department header bar
      ctx.fillStyle = '#8a2020';
      ctx.fillRect(x + 4, y + 8, w - 8, 3);

      // Typed text rows
      ctx.fillStyle = '#3a3428';
      for (let ly = y + 15; ly < y + h - 10; ly += 4) {
        ctx.fillRect(x + 4, ly, w - 8, 1.5);
      }

      // Red Soviet round stamp at bottom right
      ctx.strokeStyle = 'rgba(180, 20, 20, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x + w - 10, y + h - 10, 6, 0, Math.PI * 2);
      ctx.stroke();

      return canvas;
    }
  }

  const AssetGenerator = new AssetGeneratorClass();
  global.AssetGenerator = AssetGenerator;

})(typeof window !== 'undefined' ? window : this);

