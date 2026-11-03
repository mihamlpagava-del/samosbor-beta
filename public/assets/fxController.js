/**
 * PixelFX Engine Hookup for Samosbor Raycaster
 * Low-resolution (320x180) retro pixel effects buffer with Z-buffer depth clipping
 */
const FX_WIDTH = 320;
const FX_HEIGHT = 180;

class SamosborFXSystem {
  constructor(canvas) {
    this.mainCanvas = canvas;
    this.mainCtx = canvas ? canvas.getContext('2d') : null;
    
    // Dedicated 320x180 Offscreen buffer - NO full-screen readbacks!
    this.fxCanvas = document.createElement('canvas');
    this.fxCanvas.width = FX_WIDTH;
    this.fxCanvas.height = FX_HEIGHT;
    this.fxCtx = this.fxCanvas.getContext('2d', { willReadFrequently: true });
    this.fxCtx.imageSmoothingEnabled = false;
    this.fxImageData = this.fxCtx.createImageData(FX_WIDTH, FX_HEIGHT);

    // Внутренний буфер пикселей PixelFX
    this.frame = (typeof pixelFx !== 'undefined' && pixelFx.createFrame) 
      ? pixelFx.createFrame(FX_WIDTH, FX_HEIGHT)
      : { width: FX_WIDTH, height: FX_HEIGHT, data: new Uint8ClampedArray(FX_WIDTH * FX_HEIGHT * 4) };
    
    if (this.frame) {
      this.frame.targetCanvas = this.fxCanvas;
    }
    this.effects = [];
  }

  // Спавн эффекта в мировых 2D-координатах сектора
  trigger(effectModule, worldX, worldY, scale = 1.0) {
    if (typeof pixelFx === 'undefined' || !pixelFx.createFx) return;
    const fx = pixelFx.createFx(effectModule, { x: 0, y: 0, scale });
    this.effects.push({
      fx,
      worldX,
      worldY,
      scale,
      isScreenSpace: false
    });
  }

  // Спавн экранного эффекта (например, quake при выстреле врага или летающий череп {x: 160, y: 120})
  triggerScreen(effectModule, screenX = 160, screenY = 120, scale = 1.0) {
    if (typeof pixelFx === 'undefined' || !pixelFx.createFx) return null;
    const fx = pixelFx.createFx(effectModule, { x: screenX, y: screenY, scale });
    const item = {
      fx,
      screenX,
      screenY,
      scale,
      isScreenSpace: true
    };
    this.effects.push(item);
    return item;
  }

  updateAndRender(dt, cameraMode, player, zBuffer, numRays, targetCtx = null) {
    const destCtx = targetCtx || this.mainCtx;
    if (!destCtx) return;
    if (this.effects.length === 0) return;

    if (typeof pixelFx !== 'undefined' && pixelFx.clearFrame) {
      pixelFx.clearFrame(this.frame);
    }

    // 1. Обновление координат эффектов с проверкой Z-буфера
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const item = this.effects[i];

      if (item.isScreenSpace) {
        // Прямое позиционирование в буфере кадра (320x180)
        item.fx.x = Math.floor(item.screenX !== undefined ? item.screenX : (FX_WIDTH / 2));
        item.fx.y = Math.floor(item.screenY !== undefined ? item.screenY : (FX_HEIGHT / 2));
      } else if (cameraMode === 'FPS') {
        // Проекция в пространство камеры от первого лица
        const dx = item.worldX - player.x;
        const dy = item.worldY - player.y;

        const pCos = Math.cos(-player.angle);
        const pSin = Math.sin(-player.angle);
        const rotX = dx * pCos - dy * pSin;
        const rotY = dx * pSin + dy * pCos; // Дистанция до эффекта

        // Отсечение, если эффект сзади или перекрыт стеной
        if (rotY <= 0.2) continue;

        const screenX = (FX_WIDTH / 2) + (rotX / rotY) * (FX_WIDTH / 2);
        const stripe = Math.floor((screenX / FX_WIDTH) * numRays);

        if (stripe >= 0 && zBuffer && stripe < numRays && rotY > zBuffer[stripe]) {
          continue; // Скрыт за стеной коридора
        }

        item.fx.x = Math.floor(screenX);
        item.fx.y = Math.floor(FX_HEIGHT / 2);
      } else {
        // Вид сверху (TDS)
        const camX = (player.cameraX !== undefined) ? player.cameraX : (player.x - (this.mainCanvas ? this.mainCanvas.width : 640) / 2) / 32;
        const camY = (player.cameraY !== undefined) ? player.cameraY : (player.y - (this.mainCanvas ? this.mainCanvas.height : 360) / 2) / 32;
        const cW = (this.mainCanvas && this.mainCanvas.width) ? this.mainCanvas.width : 640;
        const cH = (this.mainCanvas && this.mainCanvas.height) ? this.mainCanvas.height : 360;
        item.fx.x = Math.floor((item.worldX - camX * 32) * (FX_WIDTH / cW));
        item.fx.y = Math.floor((item.worldY - camY * 32) * (FX_HEIGHT / cH));
      }

      item.fx.update(dt);
      item.fx.draw(this.frame);

      if (item.fx.finished) {
        this.effects.splice(i, 1);
      }
    }

    // 2. Наложение буфера 320x180: чистое копирование пикселей без полноэкранных readback вызовов!
    try {
      this.fxImageData.data.fill(0);
      if (typeof pixelFx !== 'undefined' && pixelFx.composite) {
        pixelFx.composite(this.frame, this.fxImageData.data, null);
      }
      this.fxCtx.putImageData(this.fxImageData, 0, 0);

      // Быстрый аппаратный blit на целевой контекст
      const destW = destCtx.canvas ? destCtx.canvas.width : (this.mainCanvas ? this.mainCanvas.width : FX_WIDTH);
      const destH = destCtx.canvas ? destCtx.canvas.height : (this.mainCanvas ? this.mainCanvas.height : FX_HEIGHT);
      destCtx.imageSmoothingEnabled = false;
      destCtx.drawImage(this.fxCanvas, 0, 0, destW, destH);
    } catch (e) {
      // Fallback in case of canvas restriction
    }
  }
}

if (typeof window !== 'undefined') {
  window.SamosborFXSystem = SamosborFXSystem;
}

