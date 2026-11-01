/**
 * ============================================================================
 * MODULE: AsciiRenderer.js (Full-Color Swaggerfall ANSI Text-Mode Shader)
 * ============================================================================
 * Post-process shader converting 2D Canvas rendering into full-color ANSI text mode:
 * - Two-layer cell color (8x8 px blocks):
 *   * Background: darkened average RGB tone (0.28x) for volume and deep shadows
 *   * Foreground: vibrant source RGB at lighting/illumination points
 * - Glyph density: 8-character luminance ramp (' ', '.', ':', '-', '+', '*', '%', '#')
 * - 4x4 Bayer Matrix dithering for silky smooth light transitions on walls & corridors
 * - Full preservation of UI colors (HP bars, ammo, radar, muzzle flashes, loot)
 */

(function (global) {
  'use strict';

  // 4x4 Bayer Matrix for ordered dithering
  const BAYER_4X4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
  ];

  // 8-character ANSI luminance density ramp
  const GLYPH_RAMP = [' ', '.', ':', '-', '+', '*', '%', '#'];

  const AsciiRenderer = {
    CELL_W: 8,
    CELL_H: 8,
    enabled: true,

    // Internal offscreen buffer
    offscreenCanvas: null,
    offscreenCtx: null,

    init(width, height) {
      if (!this.offscreenCanvas) {
        this.offscreenCanvas = document.createElement('canvas');
      }
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    },

    /**
     * Get or resize offscreen canvas matching the main canvas
     */
    getOffscreen(width, height) {
      if (!this.offscreenCanvas || this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
        this.init(width, height);
      }
      return { canvas: this.offscreenCanvas, ctx: this.offscreenCtx };
    },

    /**
     * Post-process source canvas into full-color Swaggerfall ANSI text-mode onto targetCtx
     * @param {HTMLCanvasElement} sourceCanvas Rendered game scene
     * @param {CanvasRenderingContext2D} targetCtx Display context
     * @param {number} width Screen width
     * @param {number} height Screen height
     */
    render(sourceCanvas, targetCtx, width, height) {
      if (!this.enabled) {
        targetCtx.drawImage(sourceCanvas, 0, 0);
        return;
      }

      const sCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sCtx) return;

      const imgData = sCtx.getImageData(0, 0, width, height);
      const data = imgData.data;

      const cw = this.CELL_W;
      const ch = this.CELL_H;
      const cols = Math.floor(width / cw);
      const rows = Math.floor(height / ch);

      // Black out the target
      targetCtx.fillStyle = '#020503';
      targetCtx.fillRect(0, 0, width, height);

      targetCtx.font = 'bold 9px "Share Tech Mono", monospace';
      targetCtx.textAlign = 'center';
      targetCtx.textBaseline = 'middle';

      const rowStride = width * 4;

      for (let cy = 0; cy < rows; cy++) {
        const py = cy * ch;
        const bayerRow = BAYER_4X4[cy & 3];

        for (let cx = 0; cx < cols; cx++) {
          const px = cx * cw;

          // Sample 4 representative points inside the 8x8 block for blazing performance
          // Points at (2,2), (5,2), (2,5), (5,5)
          const p1 = (py + 2) * rowStride + (px + 2) * 4;
          const p2 = (py + 2) * rowStride + (px + 5) * 4;
          const p3 = (py + 5) * rowStride + (px + 2) * 4;
          const p4 = (py + 5) * rowStride + (px + 5) * 4;

          const r1 = data[p1], g1 = data[p1 + 1], b1 = data[p1 + 2];
          const r2 = data[p2], g2 = data[p2 + 1], b2 = data[p2 + 2];
          const r3 = data[p3], g3 = data[p3 + 1], b3 = data[p3 + 2];
          const r4 = data[p4], g4 = data[p4 + 1], b4 = data[p4 + 2];

          // Average RGB
          const rAvg = (r1 + r2 + r3 + r4) >> 2;
          const gAvg = (g1 + g2 + g3 + g4) >> 2;
          const bAvg = (b1 + b2 + b3 + b4) >> 2;

          // Skip completely dark pitch black cells
          if (rAvg < 3 && gAvg < 3 && bAvg < 3) continue;

          // Max / peak RGB for intense lighting spots & UI preservation
          const rMax = Math.max(r1, r2, r3, r4);
          const gMax = Math.max(g1, g2, g3, g4);
          const bMax = Math.max(b1, b2, b3, b4);

          // Standard photometric luminance: 0.299 R + 0.587 G + 0.114 B
          const lum = (rAvg * 77 + gAvg * 150 + bAvg * 29) >> 8;

          // 1. Dithering using Bayer 4x4 matrix
          const bayerVal = bayerRow[cx & 3]; // 0..15
          const dither = (bayerVal - 7.5) * 3.2;
          const ditheredLum = Math.max(0, Math.min(255, lum + dither));

          // 2. Select character from 8-density ramp
          const rampIdx = Math.max(0, Math.min(7, Math.floor((ditheredLum / 256) * 8)));
          const glyph = GLYPH_RAMP[rampIdx];

          // 3. Two-layer color calculation
          // Background: Darkened average RGB (0.28x) for volume, shadows, and walls
          const bgR = Math.floor(rAvg * 0.28);
          const bgG = Math.floor(gAvg * 0.28);
          const bgB = Math.floor(bAvg * 0.28);

          if (bgR > 1 || bgG > 1 || bgB > 1) {
            targetCtx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
            targetCtx.fillRect(px, py, cw, ch);
          }

          // 4. Foreground Glyph Color: preserve vivid UI, lasers, blood, acid, lights
          if (glyph !== ' ') {
            // Check for high saturation or key game hues (green UI, red blood, cyan elevator, amber lamp)
            const maxC = Math.max(rMax, gMax, bMax);
            const minC = Math.min(rMax, gMax, bMax);
            const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

            let fgR = rMax, fgG = gMax, fgB = bMax;

            if (sat > 0.35 || maxC > 180) {
              // High saturation / bright UI element: boost foreground contrast
              const boost = 1.25;
              fgR = Math.min(255, Math.floor(rMax * boost));
              fgG = Math.min(255, Math.floor(gMax * boost));
              fgB = Math.min(255, Math.floor(bMax * boost));
            } else {
              // Standard volumetric lighting
              const boost = 1.15;
              fgR = Math.min(255, Math.floor(rAvg * boost + 30));
              fgG = Math.min(255, Math.floor(gAvg * boost + 30));
              fgB = Math.min(255, Math.floor(bAvg * boost + 30));
            }

            targetCtx.fillStyle = `rgb(${fgR},${fgG},${fgB})`;
            targetCtx.fillText(glyph, px + 4, py + 4);
          }
        }
      }
    }
  };

  global.AsciiRenderer = AsciiRenderer;
})(typeof window !== 'undefined' ? window : this);
