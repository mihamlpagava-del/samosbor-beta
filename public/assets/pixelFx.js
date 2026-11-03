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

  // 7. Nature Quake (pixelfx/fx/nature/quake)
  // Shockwave, ground fissures, dust clouds, and upward concrete/rock debris
  const quakeModule = {
    duration: 0.58,
    init(fx, opts = {}) {
      fx.fissures = [];
      fx.shockwaveR = 4;
      fx.maxShockwaveR = 68;

      // Ground fissures extending from center
      const numFissures = 8;
      for (let i = 0; i < numFissures; i++) {
        const ang = (Math.PI * 0.15) + (i / (numFissures - 1)) * (Math.PI * 0.7);
        const maxLen = 32 + Math.random() * 48;
        fx.fissures.push({
          angle: ang,
          length: 0,
          maxLen: maxLen,
          speed: 180 + Math.random() * 100
        });
      }

      // Debris and concrete dust particles
      const count = opts.count || 52;
      for (let i = 0; i < count; i++) {
        const ang = -Math.PI * 0.95 + Math.random() * Math.PI * 0.9;
        const spd = 1.4 + Math.random() * 4.2;
        const isStone = Math.random() > 0.3;
        fx.particles.push({
          x: (Math.random() - 0.5) * 16,
          y: (Math.random() - 0.5) * 6,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 1.2,
          gravity: 0.16,
          life: 0.25 + Math.random() * 0.33,
          maxLife: 0.58,
          sz: Math.random() > 0.65 ? 2 : 1,
          r: isStone ? (130 + Math.floor(Math.random() * 60)) : 220,
          g: isStone ? (115 + Math.floor(Math.random() * 40)) : 170,
          b: isStone ? (95 + Math.floor(Math.random() * 30)) : 100
        });
      }
    },

    update(fx, dt) {
      for (const f of fx.fissures) {
        if (f.length < f.maxLen) {
          f.length += f.speed * dt;
        }
      }
      fx.shockwaveR += 140 * dt;

      for (let i = fx.particles.length - 1; i >= 0; i--) {
        const p = fx.particles[i];
        p.x += (p.vx || 0) * dt * 60;
        p.y += (p.vy || 0) * dt * 60;
        if (p.gravity) p.vy += p.gravity * dt * 60;
        p.life -= dt;
        if (p.life <= 0) {
          fx.particles.splice(i, 1);
        }
      }
    },

    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);

      // 1. Expanding elliptical shockwave
      if (fx.shockwaveR < fx.maxShockwaveR) {
        const swAlpha = Math.max(0, 1.0 - fx.shockwaveR / fx.maxShockwaveR);
        const rInt = Math.floor(fx.shockwaveR);
        const steps = 40;
        for (let s = 0; s < steps; s++) {
          const a = (s / steps) * Math.PI * 2;
          const sx = Math.floor(ox + Math.cos(a) * rInt);
          const sy = Math.floor(oy + Math.sin(a) * (rInt * 0.48));
          if (sx >= 0 && sx < fw && sy >= 0 && sy < fh) {
            const idx = (sy * fw + sx) * 4;
            data[idx] = Math.max(data[idx], Math.floor(220 * swAlpha));
            data[idx + 1] = Math.max(data[idx + 1], Math.floor(180 * swAlpha));
            data[idx + 2] = Math.max(data[idx + 2], Math.floor(120 * swAlpha));
            data[idx + 3] = Math.max(data[idx + 3], Math.floor(220 * swAlpha));
          }
        }
      }

      // 2. Concrete fissure cracks
      const fissureAlpha = Math.max(0, 1.0 - (fx.time / fx.duration));
      for (const f of fx.fissures) {
        const steps = Math.floor(f.length);
        for (let step = 0; step < steps; step += 2) {
          const jag = (Math.sin(step * 0.8) * 1.5);
          const px = Math.floor(ox + Math.cos(f.angle) * step - Math.sin(f.angle) * jag);
          const py = Math.floor(oy + Math.sin(f.angle) * (step * 0.48) + Math.cos(f.angle) * jag);
          if (px >= 0 && px < fw && py >= 0 && py < fh) {
            const idx = (py * fw + px) * 4;
            data[idx] = Math.max(data[idx], Math.floor(45 * fissureAlpha));
            data[idx + 1] = Math.max(data[idx + 1], Math.floor(35 * fissureAlpha));
            data[idx + 2] = Math.max(data[idx + 2], Math.floor(28 * fissureAlpha));
            data[idx + 3] = Math.max(data[idx + 3], Math.floor(240 * fissureAlpha));
          }
        }
      }

      // 3. Concrete shards and dust
      for (let i = 0; i < fx.particles.length; i++) {
        const p = fx.particles[i];
        const px = Math.floor(ox + p.x * fx.scale);
        const py = Math.floor(oy + p.y * fx.scale);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;

        const a = Math.min(1.0, Math.max(0, p.life / p.maxLife));
        const alphaByte = Math.floor(a * 255);
        const idx = (py * fw + px) * 4;

        if (alphaByte > data[idx + 3]) {
          data[idx] = p.r;
          data[idx + 1] = p.g;
          data[idx + 2] = p.b;
          data[idx + 3] = alphaByte;
        }

        if (p.sz > 1 && px + 1 < fw) {
          const idx2 = (py * fw + px + 1) * 4;
          data[idx2] = p.r;
          data[idx2 + 1] = p.g;
          data[idx2 + 2] = p.b;
          data[idx2 + 3] = alphaByte;
        }
      }
    }
  };

  pixelFx.fx.quake = quakeModule;
  pixelFx.fx['nature/quake'] = quakeModule;
  pixelFx.fx['pixelfx/fx/nature/quake'] = quakeModule;

  // 8. Critters: Flying Skull Boss (pixelfx/fx/critters/flying-skull)
  // Flaming demonic pixel skull with glowing eyes, animated jaw, and ethereal fire trail
  const flyingSkullModule = {
    duration: 9999, // Continuous boss effect until killed
    init(fx, opts = {}) {
      fx.bobPhase = Math.random() * Math.PI * 2;
      fx.jawOpen = 0;
      fx.flames = [];
      fx.scale = opts.scale || 1.4;
      fx.eyeColor = opts.eyeColor || { r: 255, g: 30, b: 60 }; // Cursed crimson
    },

    update(fx, dt) {
      fx.bobPhase += dt * 4.5;
      fx.jawOpen = Math.abs(Math.sin(fx.bobPhase * 0.8)) * 3;

      // Spawn flame trail particles
      if (Math.random() < 0.85) {
        fx.flames.push({
          x: (Math.random() - 0.5) * 12,
          y: (Math.random() - 0.5) * 8 + 4,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -0.8 - Math.random() * 1.4, // upward rising ethereal flame
          life: 0.25 + Math.random() * 0.3,
          maxLife: 0.55,
          sz: Math.random() > 0.5 ? 2 : 1,
          colorType: Math.random() > 0.4 ? 'fire' : 'purple'
        });
      }

      for (let i = fx.flames.length - 1; i >= 0; i--) {
        const fl = fx.flames[i];
        fl.x += fl.vx * dt * 60;
        fl.y += fl.vy * dt * 60;
        fl.life -= dt;
        if (fl.life <= 0) {
          fx.flames.splice(i, 1);
        }
      }
    },

    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y + Math.sin(fx.bobPhase) * 4);
      const s = fx.scale;

      // 1. Draw ghostly flame trail behind skull
      for (let i = 0; i < fx.flames.length; i++) {
        const fl = fx.flames[i];
        const px = Math.floor(ox + fl.x * s);
        const py = Math.floor(oy + fl.y * s);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;

        const a = Math.max(0, fl.life / fl.maxLife);
        const idx = (py * fw + px) * 4;
        const isFire = fl.colorType === 'fire';
        const r = isFire ? 255 : 180;
        const g = isFire ? Math.floor(120 * a) : Math.floor(40 * a);
        const b = isFire ? 20 : 240;

        data[idx] = Math.max(data[idx], r);
        data[idx + 1] = Math.max(data[idx + 1], g);
        data[idx + 2] = Math.max(data[idx + 2], b);
        data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 220));
      }

      // 2. Procedural Pixel Skull Cranium (14x16 pixel matrix)
      // 0: transparent, 1: dark contour, 2: bone white, 3: bone shadow, 4: eye glow, 5: teeth
      const skullGrid = [
        [0,0,0,1,1,1,1,1,1,1,1,0,0,0],
        [0,0,1,2,2,2,2,2,2,2,2,1,0,0],
        [0,1,2,2,3,2,2,2,2,3,2,2,1,0],
        [1,2,2,3,3,2,2,2,2,3,3,2,2,1],
        [1,2,2,4,4,1,2,2,1,4,4,2,2,1],
        [1,2,2,4,4,1,2,2,1,4,4,2,2,1],
        [1,3,2,1,1,1,2,2,1,1,1,2,3,1],
        [1,3,3,2,2,2,1,1,2,2,2,3,3,1],
        [0,1,3,3,2,1,1,1,1,2,3,3,1,0],
        [0,0,1,2,2,2,2,2,2,2,2,1,0,0],
        [0,0,1,5,1,5,1,5,1,5,1,1,0,0]
      ];

      const halfW = (skullGrid[0].length * s) / 2;
      const halfH = (skullGrid.length * s) / 2;

      for (let r = 0; r < skullGrid.length; r++) {
        for (let c = 0; c < skullGrid[r].length; c++) {
          const val = skullGrid[r][c];
          if (val === 0) continue;

          let cr = 230, cg = 225, cb = 210, ca = 255;
          if (val === 1) { // Dark contour
            cr = 25; cg = 15; cb = 20;
          } else if (val === 2) { // Bone light
            cr = 240; cg = 235; cb = 215;
          } else if (val === 3) { // Bone shadow
            cr = 160; cg = 150; cb = 135;
          } else if (val === 4) { // Glowing eyes
            const eyePulse = 0.7 + Math.sin(fx.bobPhase * 3) * 0.3;
            cr = Math.floor(fx.eyeColor.r * eyePulse);
            cg = Math.floor(fx.eyeColor.g * eyePulse);
            cb = Math.floor(fx.eyeColor.b * eyePulse);
          } else if (val === 5) { // Teeth
            cr = 255; cg = 250; cb = 220;
          }

          const startX = Math.floor(ox - halfW + c * s);
          const endX = Math.floor(ox - halfW + (c + 1) * s);
          const startY = Math.floor(oy - halfH + r * s);
          const endY = Math.floor(oy - halfH + (r + 1) * s);

          for (let py = startY; py < endY; py++) {
            if (py < 0 || py >= fh) continue;
            for (let px = startX; px < endX; px++) {
              if (px < 0 || px >= fw) continue;
              const idx = (py * fw + px) * 4;
              data[idx] = cr;
              data[idx + 1] = cg;
              data[idx + 2] = cb;
              data[idx + 3] = ca;
            }
          }
        }
      }

      // 3. Lower Animated Jaw (Drops down with fx.jawOpen)
      const jawY = Math.floor(oy - halfH + (skullGrid.length * s) + fx.jawOpen);
      const jawGrid = [
        [0,0,1,5,1,5,1,5,1,5,1,1,0,0],
        [0,0,1,3,3,3,3,3,3,3,3,1,0,0],
        [0,0,0,1,1,1,1,1,1,1,1,0,0,0]
      ];
      for (let r = 0; r < jawGrid.length; r++) {
        for (let c = 0; c < jawGrid[r].length; c++) {
          const val = jawGrid[r][c];
          if (val === 0) continue;
          let cr = 230, cg = 225, cb = 210;
          if (val === 1) { cr = 25; cg = 15; cb = 20; }
          else if (val === 3) { cr = 150; cg = 140; cb = 125; }
          else if (val === 5) { cr = 255; cg = 250; cb = 220; }

          const startX = Math.floor(ox - halfW + c * s);
          const endX = Math.floor(ox - halfW + (c + 1) * s);
          const startY = Math.floor(jawY + r * s);
          const endY = Math.floor(jawY + (r + 1) * s);

          for (let py = startY; py < endY; py++) {
            if (py < 0 || py >= fh) continue;
            for (let px = startX; px < endX; px++) {
              if (px < 0 || px >= fw) continue;
              const idx = (py * fw + px) * 4;
              data[idx] = cr;
              data[idx + 1] = cg;
              data[idx + 2] = cb;
              data[idx + 3] = 255;
            }
          }
        }
      }
    }
  };

  pixelFx.fx.flyingSkull = flyingSkullModule;
  pixelFx.fx['critters/flying-skull'] = flyingSkullModule;
  pixelFx.fx['pixelfx/fx/critters/flying-skull'] = flyingSkullModule;

  // 9. CRT Transitions (pixelfx/fx/transitions/crt-off & crt-on)
  const crtOffModule = {
    duration: 0.55,
    init(fx, opts = {}) {},
    update(fx, dt) {},
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const prog = Math.min(1.0, fx.time / fx.duration);

      const midY = Math.floor(fh / 2);
      const midX = Math.floor(fw / 2);

      if (prog < 0.6) {
        // Vertical collapse into a thin blinding phosphor line
        const p1 = prog / 0.6;
        const halfH = Math.max(1, Math.floor((fh / 2) * Math.pow(1 - p1, 2.2)));
        const topY = midY - halfH;
        const botY = midY + halfH;

        for (let y = 0; y < fh; y++) {
          const isOutside = (y < topY || y > botY);
          const isEdge = (y === topY || y === botY || (halfH <= 2 && Math.abs(y - midY) <= 1));
          for (let x = 0; x < fw; x++) {
            const idx = (y * fw + x) * 4;
            if (isOutside) {
              data[idx] = 0;
              data[idx + 1] = 0;
              data[idx + 2] = 0;
              data[idx + 3] = 255;
            } else if (isEdge) {
              data[idx] = 255;
              data[idx + 1] = 255;
              data[idx + 2] = 255;
              data[idx + 3] = 255;
            }
          }
        }
      } else {
        // Horizontal collapse into a single center dot + fade
        const p2 = (prog - 0.6) / 0.4;
        const halfW = Math.max(0, Math.floor((fw / 2) * Math.pow(1 - p2, 1.8)));
        const dotAlpha = Math.max(0, 1.0 - p2 * 1.5);
        const leftX = midX - halfW;
        const rightX = midX + halfW;

        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const idx = (y * fw + x) * 4;
            if (Math.abs(y - midY) <= 1 && x >= leftX && x <= rightX && dotAlpha > 0) {
              const b = Math.floor(255 * dotAlpha);
              data[idx] = b;
              data[idx + 1] = b;
              data[idx + 2] = b;
              data[idx + 3] = 255;
            } else {
              data[idx] = 0;
              data[idx + 1] = 0;
              data[idx + 2] = 0;
              data[idx + 3] = 255;
            }
          }
        }
      }
    }
  };

  const crtOnModule = {
    duration: 0.45,
    init(fx, opts = {}) {},
    update(fx, dt) {},
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const prog = Math.min(1.0, fx.time / fx.duration);
      const midY = Math.floor(fh / 2);
      const midX = Math.floor(fw / 2);

      if (prog < 0.35) {
        // Expand horizontal line from center dot
        const p1 = prog / 0.35;
        const halfW = Math.floor((fw / 2) * Math.pow(p1, 0.8));
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const idx = (y * fw + x) * 4;
            if (Math.abs(y - midY) <= 1 && Math.abs(x - midX) <= halfW) {
              data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 255; data[idx + 3] = 255;
            } else {
              data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
            }
          }
        }
      } else {
        // Expand vertical frame from horizontal line
        const p2 = (prog - 0.35) / 0.65;
        const halfH = Math.floor((fh / 2) * Math.pow(p2, 1.2));
        const topY = midY - halfH;
        const botY = midY + halfH;
        const edgeGlow = Math.floor(255 * (1 - p2));

        for (let y = 0; y < fh; y++) {
          const isOutside = (y < topY || y > botY);
          const isEdge = (Math.abs(y - topY) <= 1 || Math.abs(y - botY) <= 1);
          for (let x = 0; x < fw; x++) {
            const idx = (y * fw + x) * 4;
            if (isOutside) {
              data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
            } else if (isEdge && edgeGlow > 0) {
              data[idx] = edgeGlow; data[idx + 1] = edgeGlow; data[idx + 2] = edgeGlow; data[idx + 3] = 255;
            }
          }
        }
      }
    }
  };

  pixelFx.fx.crtOff = crtOffModule;
  pixelFx.fx['transitions/crt-off'] = crtOffModule;
  pixelFx.fx['pixelfx/fx/transitions/crt-off'] = crtOffModule;

  pixelFx.fx.crtOn = crtOnModule;
  pixelFx.fx['transitions/crt-on'] = crtOnModule;
  pixelFx.fx['pixelfx/fx/transitions/crt-on'] = crtOnModule;

  // 10. Pickups: Beating Heart & Keycard (pixelfx/fx/pickups/heart-pickup & keycard)
  const heartPickupModule = {
    duration: 9999,
    init(fx, opts = {}) {
      fx.bobPhase = Math.random() * Math.PI * 2;
      fx.sparkles = [];
      fx.scale = opts.scale || 1.3;
    },
    update(fx, dt) {
      fx.bobPhase += dt * 5.0;
      if (Math.random() < 0.4) {
        fx.sparkles.push({
          x: (Math.random() - 0.5) * 14,
          y: (Math.random() - 0.5) * 10,
          vy: -0.6 - Math.random() * 0.8,
          life: 0.3 + Math.random() * 0.3,
          maxLife: 0.6
        });
      }
      for (let i = fx.sparkles.length - 1; i >= 0; i--) {
        const sp = fx.sparkles[i];
        sp.y += sp.vy * dt * 60;
        sp.life -= dt;
        if (sp.life <= 0) fx.sparkles.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y + Math.sin(fx.bobPhase) * 3);
      const s = fx.scale;

      // Sparkles
      for (let i = 0; i < fx.sparkles.length; i++) {
        const sp = fx.sparkles[i];
        const px = Math.floor(ox + sp.x * s);
        const py = Math.floor(oy + sp.y * s);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;
        const a = Math.max(0, sp.life / sp.maxLife);
        const idx = (py * fw + px) * 4;
        data[idx] = Math.max(data[idx], 80);
        data[idx + 1] = Math.max(data[idx + 1], 255);
        data[idx + 2] = Math.max(data[idx + 2], 120);
        data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 220));
      }

      // 9x9 Beating Heart Matrix
      const heartMatrix = [
        [0,1,1,0,0,0,1,1,0],
        [1,2,2,1,0,1,2,2,1],
        [1,2,3,2,1,2,3,2,1],
        [1,3,3,3,3,3,3,3,1],
        [1,3,3,3,3,3,3,3,1],
        [0,1,3,3,3,3,3,1,0],
        [0,0,1,3,3,3,1,0,0],
        [0,0,0,1,3,1,0,0,0],
        [0,0,0,0,1,0,0,0,0]
      ];

      const pulse = 1.0 + Math.sin(fx.bobPhase * 2) * 0.08;
      const totalS = s * pulse;
      const halfW = (heartMatrix[0].length * totalS) / 2;
      const halfH = (heartMatrix.length * totalS) / 2;

      for (let r = 0; r < heartMatrix.length; r++) {
        for (let c = 0; c < heartMatrix[r].length; c++) {
          const val = heartMatrix[r][c];
          if (val === 0) continue;
          let cr = 255, cg = 40, cb = 60;
          if (val === 1) { cr = 80; cg = 10; cb = 20; }
          else if (val === 2) { cr = 255; cg = 80; cb = 90; }
          else if (val === 3) { cr = 255; cg = 255; cb = 255; }

          const sx = Math.floor(ox - halfW + c * totalS);
          const ex = Math.floor(ox - halfW + (c + 1) * totalS);
          const sy = Math.floor(oy - halfH + r * totalS);
          const ey = Math.floor(oy - halfH + (r + 1) * totalS);

          for (let py = sy; py < ey; py++) {
            if (py < 0 || py >= fh) continue;
            for (let px = sx; px < ex; px++) {
              if (px < 0 || px >= fw) continue;
              const idx = (py * fw + px) * 4;
              data[idx] = cr;
              data[idx + 1] = cg;
              data[idx + 2] = cb;
              data[idx + 3] = 255;
            }
          }
        }
      }
    }
  };

  pixelFx.fx.heartPickup = heartPickupModule;
  pixelFx.fx['pickups/heart-pickup'] = heartPickupModule;
  pixelFx.fx['pixelfx/fx/pickups/heart-pickup'] = heartPickupModule;

  const cardPickupModule = {
    duration: 9999,
    init(fx, opts = {}) {
      fx.bobPhase = Math.random() * Math.PI * 2;
      fx.spinPhase = Math.random() * Math.PI * 2;
      fx.scale = opts.scale || 1.3;
      fx.colorType = opts.colorType || 'red';
    },
    update(fx, dt) {
      fx.bobPhase += dt * 4.0;
      fx.spinPhase += dt * 3.5;
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y + Math.sin(fx.bobPhase) * 3);
      const s = fx.scale;

      const spinScale = Math.cos(fx.spinPhase);
      const widthScale = Math.max(0.18, Math.abs(spinScale)) * s;

      const cardW = 12 * widthScale;
      const cardH = 16 * s;
      const leftX = Math.floor(ox - cardW / 2);
      const rightX = Math.floor(ox + cardW / 2);
      const topY = Math.floor(oy - cardH / 2);
      const botY = Math.floor(oy + cardH / 2);

      let r = 255, g = 50, b = 50;
      if (fx.colorType === 'blue') { r = 40; g = 180; b = 255; }
      else if (fx.colorType === 'yellow') { r = 255; g = 210; b = 30; }
      else if (fx.colorType === 'master') { r = 200; g = 60; b = 255; }

      for (let y = topY; y <= botY; y++) {
        if (y < 0 || y >= fh) continue;
        const isBorderY = (y === topY || y === botY);
        for (let x = leftX; x <= rightX; x++) {
          if (x < 0 || x >= fw) continue;
          const isBorderX = (x === leftX || x === rightX);
          const idx = (y * fw + x) * 4;
          if (isBorderX || isBorderY) {
            data[idx] = Math.min(255, r + 40);
            data[idx + 1] = Math.min(255, g + 40);
            data[idx + 2] = Math.min(255, b + 40);
            data[idx + 3] = 255;
          } else {
            const isChip = Math.abs(y - (topY + Math.floor(cardH * 0.35))) <= 2 && Math.abs(x - ox) <= Math.max(1, Math.floor(cardW * 0.25));
            if (isChip) {
              data[idx] = 255; data[idx + 1] = 240; data[idx + 2] = 160; data[idx + 3] = 255;
            } else {
              data[idx] = Math.floor(r * 0.7);
              data[idx + 1] = Math.floor(g * 0.7);
              data[idx + 2] = Math.floor(b * 0.7);
              data[idx + 3] = 255;
            }
          }
        }
      }
    }
  };

  pixelFx.fx.cardPickup = cardPickupModule;
  pixelFx.fx['pickups/card-pickup'] = cardPickupModule;
  pixelFx.fx['pixelfx/fx/pickups/card-pickup'] = cardPickupModule;

  // 11. Secret Loot Chest Opening (pixelfx/fx/pickups/chest-open)
  // Erupting golden light rays, opening military chest lid, flying golden talons and stars
  const chestOpenModule = {
    duration: 0.75,
    init(fx, opts = {}) {
      fx.lidAngle = 0;
      fx.lightBeamH = 0;
      fx.coins = [];
      fx.scale = opts.scale || 1.3;

      // Golden talons and sparkle stars exploding upwards
      const count = opts.count || 32;
      for (let i = 0; i < count; i++) {
        const ang = -Math.PI * 0.85 + Math.random() * Math.PI * 0.7;
        const spd = 1.6 + Math.random() * 4.2;
        fx.coins.push({
          x: (Math.random() - 0.5) * 8,
          y: -2,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 1.8,
          gravity: 0.18,
          life: 0.35 + Math.random() * 0.38,
          maxLife: 0.75,
          sz: Math.random() > 0.5 ? 2 : 1,
          isStar: Math.random() > 0.4
        });
      }
    },
    update(fx, dt) {
      fx.lidAngle = Math.min(1.0, fx.lidAngle + dt * 4.0);
      fx.lightBeamH = Math.min(54, fx.lightBeamH + dt * 180);

      for (let i = fx.coins.length - 1; i >= 0; i--) {
        const c = fx.coins[i];
        c.x += c.vx * dt * 60;
        c.y += c.vy * dt * 60;
        c.vy += c.gravity * dt * 60;
        c.life -= dt;
        if (c.life <= 0) fx.coins.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);
      const s = fx.scale;

      // 1. Upward Golden Volumetric Light Pillar
      const beamH = Math.floor(fx.lightBeamH * s);
      const beamHalfW = Math.floor(14 * s);
      const beamAlpha = Math.max(0, 1.0 - (fx.time / fx.duration));

      for (let y = oy - beamH; y < oy; y++) {
        if (y < 0 || y >= fh) continue;
        const progressY = (oy - y) / (beamH || 1);
        const wAtY = Math.floor(beamHalfW * (1.0 + progressY * 0.8));
        const alphaY = (1.0 - progressY * 0.7) * beamAlpha;

        for (let x = ox - wAtY; x <= ox + wAtY; x++) {
          if (x < 0 || x >= fw) continue;
          const distNorm = Math.abs(x - ox) / (wAtY || 1);
          const a = Math.max(0, (1.0 - distNorm) * alphaY);
          const idx = (y * fw + x) * 4;

          data[idx] = Math.max(data[idx], Math.floor(255 * a));
          data[idx + 1] = Math.max(data[idx + 1], Math.floor(215 * a));
          data[idx + 2] = Math.max(data[idx + 2], Math.floor(60 * a));
          data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 220));
        }
      }

      // 2. Flying Golden Coins and Stars
      for (let i = 0; i < fx.coins.length; i++) {
        const c = fx.coins[i];
        const px = Math.floor(ox + c.x * s);
        const py = Math.floor(oy + c.y * s);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;

        const a = Math.max(0, c.life / c.maxLife);
        const alphaByte = Math.floor(a * 255);
        const idx = (py * fw + px) * 4;

        data[idx] = 255;
        data[idx + 1] = c.isStar ? 245 : 210;
        data[idx + 2] = c.isStar ? 160 : 30;
        data[idx + 3] = alphaByte;

        if (c.sz > 1 && px + 1 < fw) {
          const idx2 = (py * fw + px + 1) * 4;
          data[idx2] = 255;
          data[idx2 + 1] = 220;
          data[idx2 + 2] = 50;
          data[idx2 + 3] = alphaByte;
        }
      }

      // 3. Pixel Chest Base & Opened Lid
      const chestW = Math.floor(22 * s);
      const chestH = Math.floor(12 * s);
      const startX = Math.floor(ox - chestW / 2);
      const endX = Math.floor(ox + chestW / 2);
      const startY = Math.floor(oy - chestH / 2);
      const endY = Math.floor(oy + chestH / 2);

      for (let py = startY; py <= endY; py++) {
        if (py < 0 || py >= fh) continue;
        const isBorderY = (py === startY || py === endY);
        for (let px = startX; px <= endX; px++) {
          if (px < 0 || px >= fw) continue;
          const isBorderX = (px === startX || px === endX);
          const idx = (py * fw + px) * 4;

          if (isBorderX || isBorderY) {
            data[idx] = 60; data[idx + 1] = 45; data[idx + 2] = 15; data[idx + 3] = 255; // Dark metallic frame
          } else {
            data[idx] = 180; data[idx + 1] = 135; data[idx + 2] = 40; data[idx + 3] = 255; // Gold brass panel
          }
        }
      }
    }
  };

  pixelFx.fx.chestOpen = chestOpenModule;
  pixelFx.fx['pickups/chest-open'] = chestOpenModule;
  pixelFx.fx['pixelfx/fx/pickups/chest-open'] = chestOpenModule;

  // 12. Extraction Loot Beam (pixelfx/fx/pickups/loot-beam)
  // Continuous vertical extraction pillar, spiraling energy rings, hazard platform beacon
  const lootBeamModule = {
    duration: 9999,
    init(fx, opts = {}) {
      fx.phase = Math.random() * Math.PI * 2;
      fx.rings = [];
      fx.particles = [];
      fx.scale = opts.scale || 1.3;
      fx.color = opts.color || { r: 0, g: 255, b: 170 }; // Phosphor green
    },
    update(fx, dt) {
      fx.phase += dt * 3.5;

      // Spawn rising spiraling energy particles
      if (Math.random() < 0.6) {
        fx.particles.push({
          angle: Math.random() * Math.PI * 2,
          radius: 6 + Math.random() * 12,
          y: 0,
          vy: -32 - Math.random() * 24,
          life: 0.8 + Math.random() * 0.6,
          maxLife: 1.4
        });
      }

      for (let i = fx.particles.length - 1; i >= 0; i--) {
        const pt = fx.particles[i];
        pt.angle += dt * 4.0;
        pt.y += pt.vy * dt;
        pt.life -= dt;
        if (pt.life <= 0) fx.particles.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);
      const s = fx.scale;

      const beamHalfW = Math.floor(10 * s);
      const beamTop = Math.max(0, oy - Math.floor(110 * s));
      const pulse = 0.85 + Math.sin(fx.phase * 2) * 0.15;

      const r = fx.color.r;
      const g = fx.color.g;
      const b = fx.color.b;

      // 1. Vertical Light Beam Pillar
      for (let y = beamTop; y <= oy; y++) {
        if (y < 0 || y >= fh) continue;
        const distFromBottom = (oy - y) / (oy - beamTop || 1);
        const aY = (1.0 - distFromBottom * 0.4) * pulse;

        for (let x = ox - beamHalfW; x <= ox + beamHalfW; x++) {
          if (x < 0 || x >= fw) continue;
          const distNorm = Math.abs(x - ox) / (beamHalfW || 1);
          const a = Math.max(0, (1.0 - distNorm) * aY);
          const idx = (y * fw + x) * 4;

          data[idx] = Math.max(data[idx], Math.floor(r * a));
          data[idx + 1] = Math.max(data[idx + 1], Math.floor(g * a));
          data[idx + 2] = Math.max(data[idx + 2], Math.floor(b * a));
          data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 210));
        }
      }

      // 2. Rising Spiraling Energy Orbitals
      for (let i = 0; i < fx.particles.length; i++) {
        const pt = fx.particles[i];
        const px = Math.floor(ox + Math.cos(pt.angle) * pt.radius * s);
        const py = Math.floor(oy + pt.y * s);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;

        const a = Math.max(0, pt.life / pt.maxLife);
        const alphaByte = Math.floor(a * 255);
        const idx = (py * fw + px) * 4;

        data[idx] = 220;
        data[idx + 1] = 255;
        data[idx + 2] = 230;
        data[idx + 3] = Math.max(data[idx + 3], alphaByte);
      }

      // 3. Ground Extraction Pad Marker [ H ]
      const padW = Math.floor(16 * s);
      const padY = oy + 2;
      for (let x = ox - padW; x <= ox + padW; x++) {
        if (x < 0 || x >= fw || padY < 0 || padY >= fh) continue;
        const idx = (padY * fw + x) * 4;
        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
      }
    }
  };

  pixelFx.fx.lootBeam = lootBeamModule;
  pixelFx.fx['pickups/loot-beam'] = lootBeamModule;
  pixelFx.fx['pixelfx/fx/pickups/loot-beam'] = lootBeamModule;

  // 13. Caustic Poison Cloud Trap (pixelfx/fx/nature/poison-cloud)
  // Billowing swirling toxic gas, caustic acid vapor, and choking poison spores
  const poisonCloudModule = {
    duration: 1.8,
    init(fx, opts = {}) {
      fx.puffs = [];
      fx.spores = [];
      fx.scale = opts.scale || 1.3;

      // Gas puffs
      const count = opts.count || 24;
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * 18;
        fx.puffs.push({
          x: Math.cos(ang) * dist,
          y: Math.sin(ang) * (dist * 0.5) - 4,
          radius: 6 + Math.random() * 10,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -0.4 - Math.random() * 0.6,
          life: 0.8 + Math.random() * 1.0,
          maxLife: 1.8,
          phase: Math.random() * Math.PI * 2,
          isPurple: Math.random() > 0.65
        });
      }

      // Micro spores
      for (let i = 0; i < 30; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 0.5 + Math.random() * 1.8;
        fx.spores.push({
          x: (Math.random() - 0.5) * 16,
          y: (Math.random() - 0.5) * 8,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 0.5,
          life: 0.4 + Math.random() * 0.8,
          maxLife: 1.2
        });
      }
    },
    update(fx, dt) {
      for (let i = fx.puffs.length - 1; i >= 0; i--) {
        const pf = fx.puffs[i];
        pf.x += pf.vx * dt * 60;
        pf.y += pf.vy * dt * 60;
        pf.radius += dt * 3.5;
        pf.phase += dt * 3.0;
        pf.life -= dt;
        if (pf.life <= 0) fx.puffs.splice(i, 1);
      }

      for (let i = fx.spores.length - 1; i >= 0; i--) {
        const sp = fx.spores[i];
        sp.x += sp.vx * dt * 60;
        sp.y += sp.vy * dt * 60;
        sp.life -= dt;
        if (sp.life <= 0) fx.spores.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);
      const s = fx.scale;

      // 1. Draw volumetric gas puffs
      for (let i = 0; i < fx.puffs.length; i++) {
        const pf = fx.puffs[i];
        const cx = Math.floor(ox + pf.x * s);
        const cy = Math.floor(oy + pf.y * s);
        const r = Math.floor(pf.radius * s);
        const aNorm = Math.max(0, pf.life / pf.maxLife);
        const puffAlpha = Math.sin(aNorm * Math.PI) * 0.42;

        const pr = pf.isPurple ? 160 : 70;
        const pg = pf.isPurple ? 40 : 235;
        const pb = pf.isPurple ? 210 : 45;

        for (let y = cy - r; y <= cy + r; y++) {
          if (y < 0 || y >= fh) continue;
          for (let x = cx - r; x <= cx + r; x++) {
            if (x < 0 || x >= fw) continue;
            const dist = Math.hypot(x - cx, y - cy);
            if (dist <= r) {
              const a = Math.max(0, (1 - dist / r) * puffAlpha);
              const idx = (y * fw + x) * 4;
              data[idx] = Math.max(data[idx], Math.floor(pr * a));
              data[idx + 1] = Math.max(data[idx + 1], Math.floor(pg * a));
              data[idx + 2] = Math.max(data[idx + 2], Math.floor(pb * a));
              data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 200));
            }
          }
        }
      }

      // 2. Micro spores
      for (let i = 0; i < fx.spores.length; i++) {
        const sp = fx.spores[i];
        const px = Math.floor(ox + sp.x * s);
        const py = Math.floor(oy + sp.y * s);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;

        const a = Math.max(0, sp.life / sp.maxLife);
        const idx = (py * fw + px) * 4;
        data[idx] = 180;
        data[idx + 1] = 255;
        data[idx + 2] = 80;
        data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 240));
      }
    }
  };

  pixelFx.fx.poisonCloud = poisonCloudModule;
  pixelFx.fx['nature/poison-cloud'] = poisonCloudModule;
  pixelFx.fx['pixelfx/fx/nature/poison-cloud'] = poisonCloudModule;

  // 14. Toxic Acid Puddle (pixelfx/fx/nature/toxic-puddle)
  // Sizzling caustic slime puddle left on the ground after killing slime/slug mutants
  const toxicPuddleModule = {
    duration: 14.0, // Long-lasting ground puddle
    init(fx, opts = {}) {
      fx.bubbles = [];
      fx.scale = opts.scale || 1.3;
      fx.baseRadiusX = 16 * fx.scale;
      fx.baseRadiusY = 8 * fx.scale;
    },
    update(fx, dt) {
      if (Math.random() < 0.35) {
        fx.bubbles.push({
          x: (Math.random() - 0.5) * fx.baseRadiusX * 1.4,
          y: (Math.random() - 0.5) * fx.baseRadiusY * 1.4,
          r: 1 + Math.random() * 2,
          life: 0.2 + Math.random() * 0.4,
          maxLife: 0.6
        });
      }

      for (let i = fx.bubbles.length - 1; i >= 0; i--) {
        const b = fx.bubbles[i];
        b.life -= dt;
        if (b.life <= 0) fx.bubbles.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);

      const fade = Math.min(1.0, (fx.duration - fx.time) / 2.0); // Fade out in last 2 seconds
      const rx = Math.floor(fx.baseRadiusX);
      const ry = Math.floor(fx.baseRadiusY);

      // Draw flat elliptical corrosive puddle
      for (let y = oy - ry; y <= oy + ry; y++) {
        if (y < 0 || y >= fh) continue;
        const dy = (y - oy) / (ry || 1);
        for (let x = ox - rx; x <= ox + rx; x++) {
          if (x < 0 || x >= fw) continue;
          const dx = (x - ox) / (rx || 1);
          const distSq = dx * dx + dy * dy;
          if (distSq <= 1.0) {
            const edge = Math.sqrt(distSq);
            const a = Math.max(0, (1.0 - edge * 0.4)) * fade;
            const isBorder = (distSq > 0.72);
            const idx = (y * fw + x) * 4;

            const pr = isBorder ? 20 : 60;
            const pg = isBorder ? 140 : 230;
            const pb = isBorder ? 30 : 50;

            data[idx] = Math.max(data[idx], pr);
            data[idx + 1] = Math.max(data[idx + 1], pg);
            data[idx + 2] = Math.max(data[idx + 2], pb);
            data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 210));
          }
        }
      }

      // Draw bubbling popping acid pockets
      for (let i = 0; i < fx.bubbles.length; i++) {
        const b = fx.bubbles[i];
        const bx = Math.floor(ox + b.x);
        const by = Math.floor(oy + b.y);
        if (bx < 0 || bx >= fw || by < 0 || by >= fh) continue;
        const bProg = 1.0 - (b.life / b.maxLife);
        const idx = (by * fw + bx) * 4;
        data[idx] = 180;
        data[idx + 1] = 255;
        data[idx + 2] = 120;
        data[idx + 3] = Math.floor((1.0 - bProg) * 255 * fade);
      }
    }
  };

  pixelFx.fx.toxicPuddle = toxicPuddleModule;
  pixelFx.fx['nature/toxic-puddle'] = toxicPuddleModule;
  pixelFx.fx['pixelfx/fx/nature/toxic-puddle'] = toxicPuddleModule;

  // 15. Shadow Necro-Skulls Aura (pixelfx/fx/shadow/necro-skulls)
  // Dark swirling shadow tendrils and orbiting miniature cursed screaming skulls
  const necroSkullsModule = {
    duration: 9999, // Continuous aura attached to elite necro mutant/cultist
    init(fx, opts = {}) {
      fx.angle = Math.random() * Math.PI * 2;
      fx.scale = opts.scale || 1.2;
      fx.numSkulls = 3;
      fx.shadowWisps = [];
    },
    update(fx, dt) {
      fx.angle += dt * 3.2; // Orbit rotation

      // Spawn shadow wisps
      if (Math.random() < 0.6) {
        fx.shadowWisps.push({
          x: (Math.random() - 0.5) * 16,
          y: (Math.random() - 0.5) * 16,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -0.6 - Math.random() * 0.5,
          life: 0.3 + Math.random() * 0.4,
          maxLife: 0.7
        });
      }

      for (let i = fx.shadowWisps.length - 1; i >= 0; i--) {
        const w = fx.shadowWisps[i];
        w.x += w.vx * dt * 60;
        w.y += w.vy * dt * 60;
        w.life -= dt;
        if (w.life <= 0) fx.shadowWisps.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);
      const s = fx.scale;

      // 1. Swirling dark shadow tendrils
      for (let i = 0; i < fx.shadowWisps.length; i++) {
        const w = fx.shadowWisps[i];
        const px = Math.floor(ox + w.x * s);
        const py = Math.floor(oy + w.y * s);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;

        const a = Math.max(0, w.life / w.maxLife);
        const idx = (py * fw + px) * 4;
        data[idx] = Math.max(data[idx], 60);
        data[idx + 1] = Math.max(data[idx + 1], 15);
        data[idx + 2] = Math.max(data[idx + 2], 90);
        data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 220));
      }

      // 2. Orbiting Mini Necro Skulls
      const orbitR = 18 * s;
      for (let i = 0; i < fx.numSkulls; i++) {
        const a = fx.angle + (i / fx.numSkulls) * Math.PI * 2;
        const sx = Math.floor(ox + Math.cos(a) * orbitR);
        const sy = Math.floor(oy + Math.sin(a) * (orbitR * 0.42)); // Elliptical perspective
        if (sx < 2 || sx >= fw - 2 || sy < 2 || sy >= fh - 2) continue;

        // Mini 4x4 pixel skull
        // Eye pixels (glowing violet-red)
        const eyeColor = { r: 255, g: 30, b: 180 };
        const boneColor = { r: 210, g: 195, b: 230 };

        const miniSkull = [
          [1, 1, 1],
          [2, 0, 2], // eyes
          [1, 1, 1],
          [0, 1, 0]  // teeth
        ];

        for (let r = 0; r < miniSkull.length; r++) {
          for (let c = 0; c < miniSkull[r].length; c++) {
            const v = miniSkull[r][c];
            if (v === 0) continue;
            const px = sx + c - 1;
            const py = sy + r - 2;
            if (px < 0 || px >= fw || py < 0 || py >= fh) continue;
            const idx = (py * fw + px) * 4;

            if (v === 2) {
              data[idx] = eyeColor.r;
              data[idx + 1] = eyeColor.g;
              data[idx + 2] = eyeColor.b;
              data[idx + 3] = 255;
            } else {
              data[idx] = boneColor.r;
              data[idx + 1] = boneColor.g;
              data[idx + 2] = boneColor.b;
              data[idx + 3] = 240;
            }
          }
        }
      }
    }
  };

  pixelFx.fx.necroSkulls = necroSkullsModule;
  pixelFx.fx['shadow/necro-skulls'] = necroSkullsModule;
  pixelFx.fx['pixelfx/fx/shadow/necro-skulls'] = necroSkullsModule;

  // 16. Holy Heal AOE (pixelfx/fx/holy/heal-aoe)
  // Expanding restorative emerald/gold healing ring, rising health crosses, and revitalizing light
  const healAoeModule = {
    duration: 0.72,
    init(fx, opts = {}) {
      fx.ringR = 6;
      fx.maxRingR = 62;
      fx.crosses = [];
      fx.scale = opts.scale || 1.3;

      // Rising health crosses and sparkles
      for (let i = 0; i < 24; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * 26;
        fx.crosses.push({
          x: Math.cos(ang) * dist,
          y: Math.sin(ang) * (dist * 0.45),
          vy: -0.8 - Math.random() * 1.5,
          life: 0.35 + Math.random() * 0.35,
          maxLife: 0.7,
          isCross: Math.random() > 0.4
        });
      }
    },
    update(fx, dt) {
      fx.ringR += dt * 95;

      for (let i = fx.crosses.length - 1; i >= 0; i--) {
        const c = fx.crosses[i];
        c.y += c.vy * dt * 60;
        c.life -= dt;
        if (c.life <= 0) fx.crosses.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);
      const s = fx.scale;

      // 1. Expanding restorative energy ring
      if (fx.ringR < fx.maxRingR) {
        const rAlpha = Math.max(0, 1.0 - fx.ringR / fx.maxRingR);
        const rInt = Math.floor(fx.ringR * s);
        const steps = 36;
        for (let st = 0; st < steps; st++) {
          const a = (st / steps) * Math.PI * 2;
          const px = Math.floor(ox + Math.cos(a) * rInt);
          const py = Math.floor(oy + Math.sin(a) * (rInt * 0.42));
          if (px >= 0 && px < fw && py >= 0 && py < fh) {
            const idx = (py * fw + px) * 4;
            data[idx] = Math.max(data[idx], Math.floor(80 * rAlpha));
            data[idx + 1] = Math.max(data[idx + 1], Math.floor(255 * rAlpha));
            data[idx + 2] = Math.max(data[idx + 2], Math.floor(160 * rAlpha));
            data[idx + 3] = Math.max(data[idx + 3], Math.floor(230 * rAlpha));
          }
        }
      }

      // 2. Rising glowing green crosses and particles
      for (let i = 0; i < fx.crosses.length; i++) {
        const c = fx.crosses[i];
        const px = Math.floor(ox + c.x * s);
        const py = Math.floor(oy + c.y * s);
        if (px < 2 || px >= fw - 2 || py < 2 || py >= fh - 2) continue;

        const a = Math.max(0, c.life / c.maxLife);
        const alphaByte = Math.floor(a * 255);

        if (c.isCross) {
          // 3x3 pixel plus/cross [+]
          const pts = [
            [0, -1],
            [-1, 0], [0, 0], [1, 0],
            [0, 1]
          ];
          for (const [dx, dy] of pts) {
            const idx = ((py + dy) * fw + (px + dx)) * 4;
            data[idx] = Math.max(data[idx], 120);
            data[idx + 1] = 255;
            data[idx + 2] = Math.max(data[idx + 2], 160);
            data[idx + 3] = Math.max(data[idx + 3], alphaByte);
          }
        } else {
          // Sparkle pixel
          const idx = (py * fw + px) * 4;
          data[idx] = 200;
          data[idx + 1] = 255;
          data[idx + 2] = 220;
          data[idx + 3] = Math.max(data[idx + 3], alphaByte);
        }
      }
    }
  };

  pixelFx.fx.healAoe = healAoeModule;
  pixelFx.fx['holy/heal-aoe'] = healAoeModule;
  pixelFx.fx['pixelfx/fx/holy/heal-aoe'] = healAoeModule;

  // 17. High-Energy Impact / Parry (pixelfx/fx/impacts/parry)
  // Sharp ricochet starburst, metallic sparks, and deflection ring when hitting walls or blast doors
  const parryModule = {
    duration: 0.28,
    init(fx, opts = {}) {
      fx.ringR = 2;
      fx.maxRingR = 22;
      fx.sparks = [];
      fx.scale = opts.scale || 1.2;

      // 16 high-speed ricochet sparks
      for (let i = 0; i < 18; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 2.0 + Math.random() * 4.5;
        fx.sparks.push({
          x: 0,
          y: 0,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 0.12 + Math.random() * 0.15,
          maxLife: 0.28,
          isCyan: Math.random() > 0.5
        });
      }
    },
    update(fx, dt) {
      fx.ringR += dt * 110;

      for (let i = fx.sparks.length - 1; i >= 0; i--) {
        const sp = fx.sparks[i];
        sp.x += sp.vx * dt * 60;
        sp.y += sp.vy * dt * 60;
        sp.life -= dt;
        if (sp.life <= 0) fx.sparks.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);
      const s = fx.scale;

      // 1. Expanding deflection ring
      if (fx.ringR < fx.maxRingR) {
        const aNorm = Math.max(0, 1.0 - fx.ringR / fx.maxRingR);
        const rInt = Math.floor(fx.ringR * s);
        const steps = 24;
        for (let st = 0; st < steps; st++) {
          const a = (st / steps) * Math.PI * 2;
          const px = Math.floor(ox + Math.cos(a) * rInt);
          const py = Math.floor(oy + Math.sin(a) * rInt);
          if (px >= 0 && px < fw && py >= 0 && py < fh) {
            const idx = (py * fw + px) * 4;
            data[idx] = Math.max(data[idx], Math.floor(255 * aNorm));
            data[idx + 1] = Math.max(data[idx + 1], Math.floor(240 * aNorm));
            data[idx + 2] = Math.max(data[idx + 2], Math.floor(180 * aNorm));
            data[idx + 3] = Math.max(data[idx + 3], Math.floor(240 * aNorm));
          }
        }
      }

      // 2. High-speed ricochet sparks
      for (let i = 0; i < fx.sparks.length; i++) {
        const sp = fx.sparks[i];
        const px = Math.floor(ox + sp.x * s);
        const py = Math.floor(oy + sp.y * s);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;

        const a = Math.max(0, sp.life / sp.maxLife);
        const alphaByte = Math.floor(a * 255);
        const idx = (py * fw + px) * 4;

        if (sp.isCyan) {
          data[idx] = 180;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
        } else {
          data[idx] = 255;
          data[idx + 1] = 230;
          data[idx + 2] = 80;
        }
        data[idx + 3] = Math.max(data[idx + 3], alphaByte);
      }
    }
  };

  pixelFx.fx.parry = parryModule;
  pixelFx.fx['impacts/parry'] = parryModule;
  pixelFx.fx['pixelfx/fx/impacts/parry'] = parryModule;

  // 18. Fire Brazier / Industrial Burn-Barrel Lighting (pixelfx/fx/fire/brazier)
  // Warm radial amber/orange flickering light aura, crackling flames, and rising soot embers
  const brazierModule = {
    duration: 9999, // Continuous map light source
    init(fx, opts = {}) {
      fx.phase = Math.random() * Math.PI * 2;
      fx.embers = [];
      fx.scale = opts.scale || 1.3;
      fx.lightRadius = 36 * fx.scale;
    },
    update(fx, dt) {
      fx.phase += dt * 7.5; // Flame flicker speed

      // Spawn rising spark embers
      if (Math.random() < 0.45) {
        fx.embers.push({
          x: (Math.random() - 0.5) * 8 * fx.scale,
          y: -2 * fx.scale,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -1.2 - Math.random() * 1.5,
          life: 0.3 + Math.random() * 0.4,
          maxLife: 0.7
        });
      }

      for (let i = fx.embers.length - 1; i >= 0; i--) {
        const em = fx.embers[i];
        em.x += em.vx * dt * 60;
        em.y += em.vy * dt * 60;
        em.life -= dt;
        if (em.life <= 0) fx.embers.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);
      const s = fx.scale;

      const flicker = 0.82 + Math.sin(fx.phase) * 0.12 + Math.cos(fx.phase * 2.3) * 0.06;
      const rLight = Math.floor(fx.lightRadius * flicker);

      // 1. Warm radial amber light buffer (illuminates surrounding floor and walls)
      for (let y = oy - rLight; y <= oy + rLight; y++) {
        if (y < 0 || y >= fh) continue;
        const dy = (y - oy);
        for (let x = ox - rLight; x <= ox + rLight; x++) {
          if (x < 0 || x >= fw) continue;
          const dx = (x - ox);
          const dist = Math.hypot(dx, dy);
          if (dist <= rLight) {
            const a = Math.max(0, (1.0 - dist / rLight) * 0.38 * flicker);
            const idx = (y * fw + x) * 4;
            data[idx] = Math.max(data[idx], Math.floor(255 * a));
            data[idx + 1] = Math.max(data[idx + 1], Math.floor(145 * a));
            data[idx + 2] = Math.max(data[idx + 2], Math.floor(35 * a));
            data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 200));
          }
        }
      }

      // 2. Iron Brazier Basin & Tripod Stand
      const basinW = Math.floor(10 * s);
      const basinH = Math.floor(6 * s);
      for (let py = oy; py <= oy + basinH; py++) {
        if (py < 0 || py >= fh) continue;
        for (let px = ox - basinW / 2; px <= ox + basinW / 2; px++) {
          if (px < 0 || px >= fw) continue;
          const idx = (py * fw + px) * 4;
          data[idx] = 40; data[idx + 1] = 30; data[idx + 2] = 25; data[idx + 3] = 255;
        }
      }

      // 3. Crackling Core Flame
      const flameH = Math.floor((12 + Math.sin(fx.phase * 1.5) * 4) * s);
      const flameW = Math.floor(6 * s);
      for (let py = oy - flameH; py <= oy; py++) {
        if (py < 0 || py >= fh) continue;
        const fyNorm = (oy - py) / (flameH || 1);
        const wAtY = Math.max(1, Math.floor(flameW * (1.0 - fyNorm)));
        for (let px = ox - wAtY; px <= ox + wAtY; px++) {
          if (px < 0 || px >= fw) continue;
          const idx = (py * fw + px) * 4;
          const isCore = (fyNorm < 0.4 && Math.abs(px - ox) <= 1);
          data[idx] = 255;
          data[idx + 1] = isCore ? 230 : (fyNorm > 0.6 ? 70 : 160);
          data[idx + 2] = isCore ? 140 : 20;
          data[idx + 3] = 255;
        }
      }

      // 4. Rising Ember Sparks
      for (let i = 0; i < fx.embers.length; i++) {
        const em = fx.embers[i];
        const px = Math.floor(ox + em.x);
        const py = Math.floor(oy + em.y);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;
        const a = Math.max(0, em.life / em.maxLife);
        const idx = (py * fw + px) * 4;
        data[idx] = 255;
        data[idx + 1] = 200;
        data[idx + 2] = 50;
        data[idx + 3] = Math.max(data[idx + 3], Math.floor(a * 255));
      }
    }
  };

  pixelFx.fx.brazier = brazierModule;
  pixelFx.fx['fire/brazier'] = brazierModule;
  pixelFx.fx['pixelfx/fx/fire/brazier'] = brazierModule;

  // 19. Security Laser Grid Trap (pixelfx/fx/scifi/laser-grid)
  // High-voltage red security laser beams, emitter nodes, and crackling thermal sparks
  const laserGridModule = {
    duration: 9999, // Persistent interactive corridor trap
    init(fx, opts = {}) {
      fx.phase = Math.random() * Math.PI * 2;
      fx.sparks = [];
      fx.scale = opts.scale || 1.3;
      fx.beamSpan = 32 * fx.scale;
      fx.numBeams = 4;
      fx.active = true;
    },
    update(fx, dt) {
      fx.phase += dt * 6.0;

      if (fx.active && Math.random() < 0.4) {
        fx.sparks.push({
          x: (Math.random() - 0.5) * fx.beamSpan,
          y: (Math.random() - 0.5) * 14 * fx.scale,
          vx: (Math.random() - 0.5) * 1.2,
          vy: (Math.random() - 0.5) * 1.2,
          life: 0.15 + Math.random() * 0.2,
          maxLife: 0.35
        });
      }

      for (let i = fx.sparks.length - 1; i >= 0; i--) {
        const sp = fx.sparks[i];
        sp.x += sp.vx * dt * 60;
        sp.y += sp.vy * dt * 60;
        sp.life -= dt;
        if (sp.life <= 0) fx.sparks.splice(i, 1);
      }
    },
    draw(fx, frame, layer = 'front') {
      if (!fx.active) return;
      const fw = frame.width;
      const fh = frame.height;
      const data = frame.data;
      const ox = Math.floor(fx.x);
      const oy = Math.floor(fx.y);
      const s = fx.scale;

      const halfSpan = Math.floor(fx.beamSpan / 2);
      const leftX = Math.max(0, ox - halfSpan);
      const rightX = Math.min(fw - 1, ox + halfSpan);

      const pulse = 0.85 + Math.sin(fx.phase) * 0.15;

      // 1. Emitter nodes on the sides
      const nodeH = Math.floor(16 * s);
      for (let y = oy - nodeH / 2; y <= oy + nodeH / 2; y++) {
        if (y < 0 || y >= fh) continue;
        for (const nx of [leftX, rightX]) {
          const idx = Math.floor(y * fw + nx) * 4;
          data[idx] = 40; data[idx + 1] = 45; data[idx + 2] = 50; data[idx + 3] = 255;
        }
      }

      // 2. Horizontal and criss-cross laser beams
      const beamYs = [
        oy - Math.floor(6 * s),
        oy - Math.floor(2 * s),
        oy + Math.floor(2 * s),
        oy + Math.floor(6 * s)
      ];

      for (let b = 0; b < beamYs.length; b++) {
        const by = Math.floor(beamYs[b]);
        if (by < 0 || by >= fh) continue;

        for (let x = leftX; x <= rightX; x++) {
          const idx = (by * fw + x) * 4;
          // Core bright laser (red with white core)
          data[idx] = 255;
          data[idx + 1] = Math.floor(40 * pulse);
          data[idx + 2] = Math.floor(60 * pulse);
          data[idx + 3] = 255;

          // Upper and lower aura glow
          if (by - 1 >= 0) {
            const upIdx = ((by - 1) * fw + x) * 4;
            data[upIdx] = Math.max(data[upIdx], Math.floor(220 * pulse));
            data[upIdx + 1] = Math.max(data[upIdx + 1], 10);
            data[upIdx + 2] = Math.max(data[upIdx + 2], 20);
            data[upIdx + 3] = Math.max(data[upIdx + 3], 160);
          }
          if (by + 1 < fh) {
            const dnIdx = ((by + 1) * fw + x) * 4;
            data[dnIdx] = Math.max(data[dnIdx], Math.floor(220 * pulse));
            data[dnIdx + 1] = Math.max(data[dnIdx + 1], 10);
            data[dnIdx + 2] = Math.max(data[dnIdx + 2], 20);
            data[dnIdx + 3] = Math.max(data[dnIdx + 3], 160);
          }
        }
      }

      // 3. Electric laser sparks
      for (let i = 0; i < fx.sparks.length; i++) {
        const sp = fx.sparks[i];
        const px = Math.floor(ox + sp.x);
        const py = Math.floor(oy + sp.y);
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;
        const a = Math.max(0, sp.life / sp.maxLife);
        const idx = (py * fw + px) * 4;
        data[idx] = 255;
        data[idx + 1] = 200;
        data[idx + 2] = 220;
        data[idx + 3] = Math.floor(a * 255);
      }
    }
  };

  pixelFx.fx.laserGrid = laserGridModule;
  pixelFx.fx['scifi/laser-grid'] = laserGridModule;
  pixelFx.fx['pixelfx/fx/scifi/laser-grid'] = laserGridModule;

  global.pixelFx = pixelFx;

})(typeof window !== 'undefined' ? window : global);

