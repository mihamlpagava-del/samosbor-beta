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
    
    // Внутренний буфер пикселей PixelFX
    this.frame = (typeof pixelFx !== 'undefined' && pixelFx.createFrame) 
      ? pixelFx.createFrame(FX_WIDTH, FX_HEIGHT)
      : { width: FX_WIDTH, height: FX_HEIGHT, data: new Uint8ClampedArray(FX_WIDTH * FX_HEIGHT * 4) };
    
    if (this.frame) {
      this.frame.targetCanvas = canvas;
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
      scale
    });
  }

  updateAndRender(dt, cameraMode, player, zBuffer, numRays) {
    if (!this.mainCanvas || !this.mainCtx) return;
    if (this.effects.length === 0) return;

    if (typeof pixelFx !== 'undefined' && pixelFx.clearFrame) {
      pixelFx.clearFrame(this.frame);
    }

    // 1. Обновление координат эффектов с проверкой Z-буфера
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const item = this.effects[i];

      if (cameraMode === 'FPS') {
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
        const camX = (player.cameraX !== undefined) ? player.cameraX : (player.x - this.mainCanvas.width / 2) / 32;
        const camY = (player.cameraY !== undefined) ? player.cameraY : (player.y - this.mainCanvas.height / 2) / 32;
        item.fx.x = Math.floor((item.worldX - camX * 32) * (FX_WIDTH / this.mainCanvas.width));
        item.fx.y = Math.floor((item.worldY - camY * 32) * (FX_HEIGHT / this.mainCanvas.height));
      }

      item.fx.update(dt);
      item.fx.draw(this.frame);

      if (item.fx.finished) {
        this.effects.splice(i, 1);
      }
    }

    // 2. Наложение буфера на Canvas игры
    try {
      const imgData = this.mainCtx.getImageData(0, 0, this.mainCanvas.width, this.mainCanvas.height);
      if (typeof pixelFx !== 'undefined' && pixelFx.composite) {
        pixelFx.composite(this.frame, imgData.data, null);
      }
      this.mainCtx.putImageData(imgData, 0, 0);
    } catch (e) {
      // Fallback in case of cross-origin or canvas read restriction
    }
  }
}

if (typeof window !== 'undefined') {
  window.SamosborFXSystem = SamosborFXSystem;
}
