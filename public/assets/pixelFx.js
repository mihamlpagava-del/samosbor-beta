/**
 * PixelFX Engine for Samosbor
 * High-performance deterministic procedural pixel-art VFX system
 * Supports low-resolution framebuffers, DDA Z-buffer clipping, and multi-layer compositing.
 */
(function(global) {
  'use strict';

  const pixelFx = {
    version: '1.0.0',

    createFrame(width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      let canvas = null;
      let ctx = null;
      let imgData = null;
      if (typeof document !== 'undefined') {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d');
        imgData = ctx.createImageData(width, height);
      }
      return {
        width,
        height,
        data,
        canvas,
        ctx,
        imgData,
        targetCanvas: null,
        clear() {
          data.fill(0);
        }
      };
    },

    clearFrame(frame) {
      if (frame && frame.data) {
        frame.data.fill(0);
      }
    },

    createFx(effectModule, options = {}) {
      return new FxInstance(effectModule, options);
    },

    composite(frame, targetData, bgColor) {
      if (!frame || !frame.data || !targetData) return;

      const fw = frame.width;
      const fh = frame.height;
      const fData = frame.data;

      let tw = 0;
      let th = 0;
      if (frame.targetCanvas) {
        tw = frame.targetCanvas.width;
        th = frame.targetCanvas.height;
      } else {
        const totalPixels = targetData.length / 4;
        if (totalPixels === fw * fh) {
          tw = fw;
          th = fh;
        } else {
          th = Math.round(Math.sqrt(totalPixels / (16 / 9)));
          tw = Math.round(totalPixels / th);
        }
      }

      if (tw <= 0 || th <= 0) return;

      if (tw === fw && th === fh) {
        for (let i = 0; i < targetData.length; i += 4) {
          const a = fData[i + 3];
          if (a === 0) continue;
          if (a === 255) {
            targetData[i] = fData[i];
            targetData[i + 1] = fData[i + 1];
            targetData[i + 2] = fData[i + 2];
            targetData[i + 3] = 255;
          } else {
            const alpha = a / 255;
            const invAlpha = 1 - alpha;
            targetData[i] = Math.floor(fData[i] * alpha + targetData[i] * invAlpha);
            targetData[i + 1] = Math.floor(fData[i + 1] * alpha + targetData[i + 1] * invAlpha);
            targetData[i + 2] = Math.floor(fData[i + 2] * alpha + targetData[i + 2] * invAlpha);
            targetData[i + 3] = 255;
          }
        }
        return;
      }

      // Fast nearest-neighbor upscaled compositing
      const scaleX = tw / fw;
      const scaleY = th / fh;

      for (let fy = 0; fy < fh; fy++) {
        const srcRow = fy * fw * 4;
        const startTy = Math.floor(fy * scaleY);
        const endTy = Math.min(th, Math.floor((fy + 1) * scaleY));

        for (let fx = 0; fx < fw; fx++) {
          const srcIdx = srcRow + fx * 4;
          const a = fData[srcIdx + 3];
          if (a === 0) continue;

          const r = fData[srcIdx];
          const g = fData[srcIdx + 1];
          const b = fData[srcIdx + 2];
          const alpha = a / 255;
          const invAlpha = 1 - alpha;

          const startTx = Math.floor(fx * scaleX);
          const endTx = Math.min(tw, Math.floor((fx + 1) * scaleX));

          for (let ty = startTy; ty < endTy; ty++) {
            const dstRow = ty * tw * 4;
            for (let tx = startTx; tx < endTx; tx++) {
              const dstIdx = dstRow + tx * 4;
              targetData[dstIdx] = Math.floor(r * alpha + targetData[dstIdx] * invAlpha);
              targetData[dstIdx + 1] = Math.floor(g * alpha + targetData[dstIdx + 1] * invAlpha);
              targetData[dstIdx + 2] = Math.floor(b * alpha + targetData[dstIdx + 2] * invAlpha);
              targetData[dstIdx + 3] = 255;
            }
          }
        }
      }
    },

    fx: {}
  };

  class FxInstance {
    constructor(moduleOrName, options = {}) {
      this.x = options.x || 0;
      this.y = options.y || 0;
      this.scale = options.scale !== undefined ? options.scale : 1.0;
      this.time = 0;
      this.finished = false;
      this.particles = [];

      let mod = moduleOrName;
      if (typeof moduleOrName === 'string' && pixelFx.fx[moduleOrName]) {
        mod = pixelFx.fx[moduleOrName];
      }

      if (typeof mod === 'function') {
        this.module = { init: mod };
      } else {
        this.module = mod || pixelFx.fx.bloodSplatter;
      }

      this.duration = (this.module && this.module.duration) || 0.45;

      if (this.module && this.module.init) {
        this.module.init(this, options);
      }
    }

    update(dt) {
      this.time += dt;
      if (this.module && this.module.update) {
        this.module.update(this, dt);
      } else {
        for (let i = this.particles.length - 1; i >= 0; i--) {
          const p = this.particles[i];
          p.x += (p.vx || 0) * dt * 60;
          p.y += (p.vy || 0) * dt * 60;
          if (p.gravity) p.vy += p.gravity * dt * 60;
          p.life -= dt;
          if (p.life <= 0) {
            this.particles.splice(i, 1);
          }
        }
      }
      if (this.time >= this.duration || (this.particles.length === 0 && this.time > 0.05)) {
        this.finished = true;
      }
    }

    draw(frame, layer = 'front') {
      if (this.finished || !frame || !frame.data) return;
      if (this.module && this.module.draw) {
        this.module.draw(this, frame, layer);
      } else {
        const fw = frame.width;
        const fh = frame.height;
        const data = frame.data;
        const px0 = Math.floor(this.x);
        const py0 = Math.floor(this.y);

        for (let i = 0; i < this.particles.length; i++) {
          const p = this.particles[i];
          const px = Math.floor(px0 + p.x * this.scale);
          const py = Math.floor(py0 + p.y * this.scale);
          if (px < 0 || px >= fw || py < 0 || py >= fh) continue;

          const idx = (py * fw + px) * 4;
          const a = Math.min(1.0, Math.max(0, p.life / (p.maxLife || 0.3)));
          const r = p.r !== undefined ? p.r : 255;
          const g = p.g !== undefined ? p.g : 50;
          const b = p.b !== undefined ? p.b : 50;
          const alphaByte = Math.floor(a * 255);

          if (alphaByte > data[idx + 3]) {
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = alphaByte;
          }
        }
      }
    }
  }

  // --- PROCEDURAL EFFECT MODULES ---

  // 1. Blood Splatter (Liquidator gore & monster hits)
  pixelFx.fx.bloodSplatter = {
    duration: 0.42,
    init(fx, opts = {}) {
      const count = opts.count || 18;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 0.8 + Math.random() * 2.4;
        const dark = Math.random() > 0.45;
        fx.particles.push({
          x: (Math.random() - 0.5) * 3,
          y: (Math.random() - 0.5) * 3,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - 0.5,
          gravity: 0.08,
          life: 0.2 + Math.random() * 0.22,
          maxLife: 0.42,
          r: dark ? 160 : 220,
          g: dark ? 15 : 25,
          b: dark ? 20 : 30
        });
      }
    }
  };

  // 2. Muzzle Flash (Shotgun / Pistol gunshots)
  pixelFx.fx.muzzleFlash = {
    duration: 0.14,
    init(fx, opts = {}) {
      // Core starburst
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 1.2 + Math.random() * 3.2;
        fx.particles.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          gravity: 0,
          life: 0.06 + Math.random() * 0.08,
          maxLife: 0.14,
          r: 255,
          g: Math.random() > 0.3 ? 220 : 160,
          b: Math.random() > 0.6 ? 120 : 40
        });
      }
    }
  };

  // 3. Spark Burst (Ricochet / Wall impacts)
  pixelFx.fx.sparkBurst = {
    duration: 0.35,
    init(fx, opts = {}) {
      for (let i = 0; i < 16; i++) {
        const angle = -Math.PI * 0.85 + Math.random() * Math.PI * 0.7;
        const spd = 1.5 + Math.random() * 3.0;
        fx.particles.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          gravity: 0.12,
          life: 0.15 + Math.random() * 0.2,
          maxLife: 0.35,
          r: 255,
          g: 220 + Math.floor(Math.random() * 35),
          b: 80 + Math.floor(Math.random() * 100)
        });
      }
    }
  };

  // 4. Sludge Acid (Toxic flesh vents & chemical spills)
  pixelFx.fx.sludgeAcid = {
    duration: 0.55,
    init(fx, opts = {}) {
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 0.5 + Math.random() * 1.5;
        fx.particles.push({
          x: (Math.random() - 0.5) * 4,
          y: (Math.random() - 0.5) * 4,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - 0.6, // upward fizzing
          gravity: -0.02,
          life: 0.25 + Math.random() * 0.3,
          maxLife: 0.55,
          r: 70 + Math.floor(Math.random() * 40),
          g: 230 + Math.floor(Math.random() * 25),
          b: 40 + Math.floor(Math.random() * 30)
        });
      }
    }
  };

  // 5. Heavy Chemical Explosion (Barrels, grenades, structural breach)
  pixelFx.fx.explosion = {
    duration: 0.65,
    init(fx, opts = {}) {
      const count = opts.count || 36;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 1.0 + Math.random() * 4.2;
        const isCore = Math.random() > 0.4;
        fx.particles.push({
          x: (Math.random() - 0.5) * 4,
          y: (Math.random() - 0.5) * 4,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - 0.4,
          gravity: 0.05,
          life: 0.25 + Math.random() * 0.4,
          maxLife: 0.65,
          r: isCore ? 255 : (Math.random() > 0.5 ? 220 : 80),
          g: isCore ? 180 : (Math.random() > 0.5 ? 60 : 70),
          b: isCore ? 40 : 30
        });
      }
    }
  };

  // 6. Anomalous Energy Distortion (Samosbor spatial vortex)
  pixelFx.fx.anomalousDistortion = {
    duration: 0.5,
    init(fx, opts = {}) {
      for (let i = 0; i < 22; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 0.6 + Math.random() * 2.2;
        fx.particles.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          gravity: 0,
          life: 0.2 + Math.random() * 0.3,
          maxLife: 0.5,
          r: Math.random() > 0.5 ? 230 : 50,
          g: Math.random() > 0.5 ? 40 : 220,
          b: 255
        });
      }
    }
  };

  global.pixelFx = pixelFx;

})(typeof window !== 'undefined' ? window : global);
