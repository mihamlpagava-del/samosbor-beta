/**
 * ============================================================================
 * MODULE: spriteFactory.js (Radar Roguelike Procedural Top-Down Sprite Factory)
 * ============================================================================
 * Procedurally draws 2D top-down retro CRT phosphor entities & tiles:
 * - Player with equipped melee / firearms & swing animations
 * - Diverse procedural monsters (Slime, Creeper, Spitter, Brute)
 * - Patrol Liquidators (Allies)
 * - CRT Tactical Crosshair (Reticle)
 * - Melee slash arc VFX
 * - Environment tiles (Wall, Floor, Airtight Door, Loot Crate, Elevator, Dropped Guns)
 * - Overhead floating CRT health bars (24x4px, phosphor colors, damage flash)
 */

(function (global) {
  'use strict';

  const SpriteFactory = {
    /**
     * Render an entity on a 2D canvas context
     */
    drawEntity(ctx, entity, tick, options = {}) {
      if (!ctx || !entity) return;

      const x = entity.x || 0;
      const y = entity.y || 0;
      const radius = entity.radius || 12;
      const angle = entity.angle || 0;
      const vx = entity.vx || 0;
      const vy = entity.vy || 0;
      const speed = Math.hypot(vx, vy);
      const isMoving = speed > 0.1;

      // Радарная видимость и затухание люминофора
      const phosphorAlpha = Math.max(0.08, Math.min(1.0, entity.phosphorAlpha !== undefined ? entity.phosphorAlpha : 1.0));
      if (phosphorAlpha <= 0.05 && !entity.isPlayer && !entity.inLightCone) return;

      ctx.save();
      ctx.globalAlpha = phosphorAlpha;

      const isDamageFlash = entity.damageFlashTimer && entity.damageFlashTimer > 0;

      // 1. Отрисовка ног и процедурного шага (для гуманоидов)
      if (entity.type === 'player' || entity.type === 'liquidator' || entity.type === 'civilian') {
        this.drawWalkingLegs(ctx, x, y, angle, radius, isMoving, tick, entity.type, isDamageFlash);
      }

      // 2. Отрисовка торса и головы со смещением покачивания
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      const bodyBob = isMoving ? Math.abs(Math.sin(tick * 0.25)) * 1.5 : Math.sin(tick * 0.05) * 0.5;
      const shoulderSway = isMoving ? Math.cos(tick * 0.25) * 0.08 : 0;
      ctx.rotate(shoulderSway);

      switch (entity.type) {
        case 'player':
          this.drawPlayerBody(ctx, radius, isDamageFlash, entity);
          break;
        case 'liquidator':
          this.drawLiquidatorBody(ctx, radius, isDamageFlash);
          break;
        case 'civilian':
          this.drawCivilianBody(ctx, radius, isDamageFlash);
          break;
        case 'mutant_slime':
          this.drawMutantSlimeBody(ctx, radius, tick, isDamageFlash, entity);
          break;
        case 'creeper':
          this.drawCreeperBody(ctx, radius, tick, isDamageFlash);
          break;
        case 'spitter':
          this.drawSpitterBody(ctx, radius, tick, isDamageFlash);
          break;
        case 'brute':
          this.drawBruteBody(ctx, radius, tick, isDamageFlash);
          break;
        default:
          this.drawGenericBody(ctx, radius, isDamageFlash);
      }

      ctx.restore();

      // 3. Плавающий индикатор здоровья над головой
      this.drawOverheadHealthBar(ctx, entity, x, y, radius, isDamageFlash);

      ctx.restore();
    },

    drawWalkingLegs(ctx, x, y, angle, radius, isMoving, tick, type, isDamageFlash) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      const footOffset = isMoving ? Math.sin(tick * 0.25) * 3 : 0;
      const legColor = isDamageFlash ? '#ffffff' : (type === 'liquidator' ? '#144d24' : '#0e3a18');
      const bootColor = isDamageFlash ? '#ffffff' : (type === 'liquidator' ? '#1fe044' : '#225522');

      ctx.fillStyle = bootColor;
      ctx.strokeStyle = legColor;
      ctx.lineWidth = 1;

      // Левый ботинок
      ctx.beginPath();
      ctx.roundRect(-radius * 0.7, -radius * 0.8 + footOffset, 5, 8, 2);
      ctx.fill();
      ctx.stroke();

      // Правый ботинок
      ctx.beginPath();
      ctx.roundRect(radius * 0.7 - 5, -radius * 0.8 - footOffset, 5, 8, 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    },

    drawPlayerBody(ctx, r, isFlash, entity) {
      const mainColor = isFlash ? '#ffffff' : '#1fe044';
      const darkColor = isFlash ? '#dddddd' : '#08260c';
      const visorColor = isFlash ? '#ffffff' : '#00ffff';

      // Кислородные баллоны за спиной
      ctx.fillStyle = darkColor;
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(-r * 0.75, -r * 0.85, r * 1.5, r * 0.55, 3);
      ctx.fill();
      ctx.stroke();

      // Плечи / торс
      ctx.fillStyle = darkColor;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.1, r * 0.95, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Шлем
      ctx.beginPath();
      ctx.arc(0, r * 0.15, r * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = isFlash ? '#ffffff' : '#0a3612';
      ctx.fill();
      ctx.stroke();

      // Забрало / визор скафандра
      ctx.beginPath();
      ctx.arc(0, r * 0.28, r * 0.32, 0.15 * Math.PI, 0.85 * Math.PI, false);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = visorColor;
      ctx.stroke();

      // Оружие в руках (Огнестрел или Ближний бой)
      const weapon = entity && entity.weapon ? entity.weapon : null;
      ctx.save();
      if (weapon && weapon.isRanged) {
        // Огнестрел (ствол вперед)
        ctx.fillStyle = isFlash ? '#fff' : '#1fe044';
        ctx.fillRect(r * 0.35, r * 0.2, 4, r * 1.1);
        ctx.strokeStyle = '#051408';
        ctx.lineWidth = 1;
        ctx.strokeRect(r * 0.35, r * 0.2, 4, r * 1.1);
      } else {
        // Оружие ближнего боя (лом/труба/нож под углом в руках)
        ctx.strokeStyle = isFlash ? '#fff' : '#88ffaa';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(r * 0.4, r * 0.1);
        ctx.lineTo(r * 0.7, r * 0.8);
        ctx.stroke();
      }
      ctx.restore();
    },

    drawLiquidatorBody(ctx, r, isFlash) {
      const armorColor = isFlash ? '#ffffff' : '#1fe044';
      const plateColor = isFlash ? '#ffffff' : '#0a2a10';
      const glowColor = isFlash ? '#ffffff' : '#00ff66';

      ctx.fillStyle = plateColor;
      ctx.strokeStyle = armorColor;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(-r * 0.85, -r * 0.95, r * 1.7, r * 0.6, 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(0, -r * 0.1, r * 1.05, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, r * 0.18, r * 0.58, 0, Math.PI * 2);
      ctx.fillStyle = '#061c0b';
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = glowColor;
      ctx.fillRect(-r * 0.3, r * 0.32, r * 0.6, 3);

      ctx.fillStyle = armorColor;
      ctx.fillRect(r * 0.4, r * 0.2, 5, r * 1.2);
    },

    drawCivilianBody(ctx, r, isFlash) {
      const coatColor = isFlash ? '#ffffff' : '#ffaa00';
      const darkColor = isFlash ? '#ffffff' : '#261b05';

      ctx.fillStyle = darkColor;
      ctx.strokeStyle = coatColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -r * 0.65, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(0, -r * 0.1, r * 0.8, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, r * 0.18, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    },

    /**
     * Мутант 1: Слизень (Кислотная аморфная пульсирующая масса)
     */
    drawMutantSlimeBody(ctx, r, tick, isFlash, entity) {
      const redColor = isFlash ? '#ffffff' : '#ff3b30';
      const innerColor = isFlash ? '#ffffff' : '#4a0808';

      ctx.save();
      ctx.beginPath();
      const points = 8;
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const pulse = Math.sin(tick * 0.15 + i * 1.5) * 2.5;
        const pr = r + pulse;
        const px = Math.cos(angle) * pr;
        const py = Math.sin(angle) * pr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = innerColor;
      ctx.fill();
      ctx.strokeStyle = redColor;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Глазные узлы
      ctx.fillStyle = isFlash ? '#ffffff' : '#ffaa00';
      [
        { x: -r * 0.35, y: -r * 0.2, sz: 2.5 },
        { x: r * 0.3, y: r * 0.2, sz: 3.5 },
        { x: -r * 0.1, y: r * 0.4, sz: 2.0 }
      ].forEach(ep => {
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, ep.sz, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    },

    /**
     * Мутант 2: Трупоед-Шмыг (Быстрый членистоногий ползун с жвалами)
     */
    drawCreeperBody(ctx, r, tick, isFlash) {
      const color = isFlash ? '#ffffff' : '#ff5533';
      const dark = isFlash ? '#ffffff' : '#331108';

      ctx.save();
      // Суставчатые лапки по бокам
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) {
        const legWiggle = Math.sin(tick * 0.35 + i) * 3;
        // Левая лапка
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, i * 6);
        ctx.lineTo(-r * 1.2, i * 8 + legWiggle);
        ctx.lineTo(-r * 1.5, i * 10);
        ctx.stroke();
        // Правая лапка
        ctx.beginPath();
        ctx.moveTo(r * 0.5, i * 6);
        ctx.lineTo(r * 1.2, i * 8 - legWiggle);
        ctx.lineTo(r * 1.5, i * 10);
        ctx.stroke();
      }

      // Панцирное сегментированное тело
      ctx.fillStyle = dark;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.7, r * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Жвалы
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.8);
      ctx.lineTo(-r * 0.6, r * 1.3);
      ctx.lineTo(-r * 0.1, r * 1.0);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(r * 0.4, r * 0.8);
      ctx.lineTo(r * 0.6, r * 1.3);
      ctx.lineTo(r * 0.1, r * 1.0);
      ctx.fill();

      // Глазные щели
      ctx.fillStyle = '#ff0033';
      ctx.fillRect(-3, r * 0.5, 2, 2);
      ctx.fillRect(1, r * 0.5, 2, 2);

      ctx.restore();
    },

    /**
     * Мутант 3: Плюющийся Червь (Стреляющий кислотой издалека)
     */
    drawSpitterBody(ctx, r, tick, isFlash) {
      const color = isFlash ? '#ffffff' : '#a0ff33';
      const dark = isFlash ? '#ffffff' : '#143305';

      ctx.save();
      // Ребристое кольцеобразное тело
      ctx.fillStyle = dark;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;

      for (let s = -2; s <= 2; s++) {
        const segR = r * (1 - Math.abs(s) * 0.15);
        ctx.beginPath();
        ctx.arc(0, s * 5, segR * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Разинутая кислотная пасть с зеленым свечением
      const mawOpen = Math.abs(Math.sin(tick * 0.1)) * 3;
      ctx.fillStyle = '#112200';
      ctx.beginPath();
      ctx.arc(0, r * 0.6, r * 0.45 + mawOpen, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();

      ctx.fillStyle = '#88ff00';
      ctx.beginPath();
      ctx.arc(0, r * 0.6, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },

    /**
     * Мутант 4: Бронированный Мусорщик (Тяжелый бронированный голем)
     */
    drawBruteBody(ctx, r, tick, isFlash) {
      const color = isFlash ? '#ffffff' : '#ff9900';
      const dark = isFlash ? '#ffffff' : '#331a00';

      ctx.save();
      // Массивные бронеплиты
      ctx.fillStyle = dark;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;

      ctx.beginPath();
      ctx.roundRect(-r * 1.1, -r * 0.8, r * 2.2, r * 1.6, 4);
      ctx.fill();
      ctx.stroke();

      // Массивные кулаки / когти
      ctx.fillStyle = color;
      ctx.fillRect(-r * 1.25, r * 0.4, r * 0.5, r * 0.7);
      ctx.fillRect(r * 0.75, r * 0.4, r * 0.5, r * 0.7);

      // Ядерное реакторное ядро на спине
      ctx.fillStyle = Math.sin(tick * 0.2) > 0 ? '#ffcc00' : '#ff5500';
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },

    drawGenericBody(ctx, r, isFlash) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = isFlash ? '#fff' : '#08260c';
      ctx.fill();
      ctx.strokeStyle = isFlash ? '#fff' : '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    },

    /**
     * Тактический ЭЛТ Прицел (Crosshair Reticle)
     */
    drawCrosshair(ctx, screenX, screenY, tick, isTargetEnemy) {
      ctx.save();
      const color = isTargetEnemy ? '#ff3b30' : '#1fe044';
      const pulse = Math.sin(tick * 0.1) * 2;
      const radius = 16 + pulse;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;

      // 4 дуги кольца прицела с зазорами
      const gap = 0.35;
      for (let i = 0; i < 4; i++) {
        const startAng = i * (Math.PI / 2) + gap / 2;
        const endAng = (i + 1) * (Math.PI / 2) - gap / 2;
        ctx.beginPath();
        ctx.arc(screenX, screenY, radius, startAng, endAng);
        ctx.stroke();
      }

      // Центровая маркерная точка
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(screenX, screenY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // 4 риски наведения
      const tickLen = 6;
      ctx.beginPath();
      ctx.moveTo(screenX, screenY - radius - tickLen);
      ctx.lineTo(screenX, screenY - radius + 2);
      ctx.moveTo(screenX, screenY + radius - 2);
      ctx.lineTo(screenX, screenY + radius + tickLen);
      ctx.moveTo(screenX - radius - tickLen, screenY);
      ctx.lineTo(screenX - radius + 2, screenY);
      ctx.moveTo(screenX + radius - 2, screenY);
      ctx.lineTo(screenX + radius + tickLen, screenY);
      ctx.stroke();

      ctx.restore();
    },

    /**
     * Анимация дуги удара ближнего боя
     */
    drawMeleeSwingArc(ctx, x, y, angle, progress) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      const radius = 42;
      const arcSpread = Math.PI * 0.8;
      const start = -arcSpread / 2 + progress * (arcSpread * 0.4);
      const end = start + arcSpread * 0.7;

      ctx.strokeStyle = 'rgba(136, 255, 158, 0.85)';
      ctx.lineWidth = 4 * (1 - progress);
      ctx.shadowColor = '#1fe044';
      ctx.shadowBlur = 10;

      ctx.beginPath();
      ctx.arc(0, 0, radius, start, end);
      ctx.stroke();

      ctx.restore();
    },

    /**
     * Оружие на полу (дроп огнестрела)
     */
    drawDroppedWeapon(ctx, drop, size = 32, tick = 0, alpha = 1.0) {
      if (drop.pickedUp) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0.15, alpha);

      const cx = drop.x;
      const cy = drop.y;
      const bounce = Math.sin(tick * 0.12) * 2;

      // Неоновый индикатор оружия
      ctx.strokeStyle = '#33d4ff';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#33d4ff';
      ctx.shadowBlur = 8;

      ctx.strokeRect(cx - 14, cy - 8 + bounce, 28, 16);
      ctx.fillStyle = '#061c24';
      ctx.fillRect(cx - 14, cy - 8 + bounce, 28, 16);

      // Силуэт ствола
      ctx.fillStyle = '#33d4ff';
      ctx.fillRect(cx - 10, cy - 2 + bounce, 20, 4);
      ctx.fillRect(cx - 2, cy + 2 + bounce, 5, 5);

      // Название оружия и патроны
      ctx.fillStyle = '#ffffff';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${drop.name} [${drop.ammo}]`, cx, cy + 18 + bounce);
      ctx.textAlign = 'left';

      ctx.restore();
    },

    /**
     * Плавающая ЭЛТ-шкала здоровья над персонажем
     */
    drawOverheadHealthBar(ctx, entity, x, y, radius, isDamageFlash) {
      const maxHp = entity.maxHp || 100;
      const curHp = Math.max(0, Math.min(maxHp, entity.hp !== undefined ? entity.hp : maxHp));
      const hpPct = curHp / maxHp;

      const barW = 24;
      const barH = 4;
      const barX = Math.round(x - barW / 2);
      const barY = Math.round(y - radius - 8 - barH);

      ctx.fillStyle = '#041407';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

      ctx.fillStyle = '#3a0808';
      ctx.fillRect(barX, barY, barW, barH);

      let fillColor = '#1fe044';
      if (entity.type === 'mutant_slime' || entity.type === 'creeper' || entity.type === 'spitter' || entity.type === 'brute') {
        fillColor = '#ff3b30';
      } else if (entity.type === 'civilian') {
        fillColor = '#ffaa00';
      }

      if (isDamageFlash) fillColor = '#ffffff';

      const fillW = Math.max(0, Math.round(barW * hpPct));
      if (fillW > 0) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(barX, barY, fillW, barH);
      }
    },

    drawWallTile(ctx, x, y, size = 32, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.08, alpha);
      ctx.fillStyle = '#061c0b';
      ctx.fillRect(x, y, size, size);

      ctx.fillStyle = '#0b3814';
      ctx.fillRect(x + 2, y + 2, size - 4, size - 4);

      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

      ctx.fillStyle = '#88ff9e';
      ctx.fillRect(x + 3, y + 3, 2, 2);
      ctx.fillRect(x + size - 5, y + 3, 2, 2);
      ctx.fillRect(x + 3, y + size - 5, 2, 2);
      ctx.fillRect(x + size - 5, y + size - 5, 2, 2);
      ctx.restore();
    },

    drawFloorTile(ctx, x, y, size = 32, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.03, alpha * 0.65);
      ctx.fillStyle = '#031006';
      ctx.fillRect(x, y, size, size);

      ctx.strokeStyle = '#082a10';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      ctx.restore();
    },

    drawDoorTile(ctx, door, size = 32, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.15, alpha);
      const x = door.x - size / 2;
      const y = door.y - size / 2;

      ctx.fillStyle = '#041407';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

      const stripeW = 6;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 3, y + 3, size - 6, size - 6);
      ctx.clip();

      for (let s = -size; s < size * 2; s += stripeW * 2) {
        ctx.fillStyle = door.isOpen ? '#0b3814' : '#ffaa00';
        ctx.beginPath();
        ctx.moveTo(x + s, y);
        ctx.lineTo(x + s + stripeW, y);
        ctx.lineTo(x + s + stripeW - size, y + size);
        ctx.lineTo(x + s - size, y + size);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      ctx.fillStyle = door.isOpen ? '#1fe044' : '#ff3b30';
      ctx.beginPath();
      ctx.arc(door.x, door.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    drawLootCrate(ctx, crate, size = 32, tick = 0, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.12, alpha);
      const cx = crate.x;
      const cy = crate.y;
      const r = crate.radius || 12;

      if (crate.opened) {
        ctx.strokeStyle = '#445544';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
        return;
      }

      const pulse = Math.sin(tick * 0.1) * 2;
      const color = crate.type === 'ammo' ? '#33d4ff' : '#f5a623';

      ctx.shadowColor = color;
      ctx.shadowBlur = 6 + pulse;
      ctx.fillStyle = '#091c0e';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);

      ctx.fillStyle = color;
      if (crate.type === 'ammo') {
        ctx.fillRect(cx - 5, cy - 6, 2, 12);
        ctx.fillRect(cx - 1, cy - 6, 2, 12);
        ctx.fillRect(cx + 3, cy - 6, 2, 12);
      } else {
        ctx.fillRect(cx - 6, cy - 2, 12, 4);
        ctx.fillRect(cx - 2, cy - 6, 4, 12);
      }
      ctx.restore();
    },

    drawElevatorShaft(ctx, elevator, size = 32, tick = 0, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.2, alpha);
      const x = elevator.x;
      const y = elevator.y;

      ctx.fillStyle = '#031407';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

      const blink = Math.sin(tick * 0.15) > 0;
      ctx.strokeStyle = blink ? '#88ff9e' : '#1fe044';
      ctx.lineWidth = 2;

      const midX = x + size / 2;
      const midY = y + size / 2;

      ctx.beginPath();
      ctx.moveTo(midX - 8, midY + 4);
      ctx.lineTo(midX, midY - 4);
      ctx.lineTo(midX + 8, midY + 4);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(midX - 8, midY + 10);
      ctx.lineTo(midX, midY + 2);
      ctx.lineTo(midX + 8, midY + 10);
      ctx.stroke();

      ctx.restore();
    }
  };

  global.SpriteFactory = SpriteFactory;
})(typeof window !== 'undefined' ? window : this);
