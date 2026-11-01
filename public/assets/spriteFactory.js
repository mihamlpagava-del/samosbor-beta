/**
 * ============================================================================
 * MODULE: spriteFactory.js (Radar Roguelike Procedural Top-Down Sprite Factory)
 * ============================================================================
 * Procedurally draws 2D top-down retro CRT phosphor entities with:
 * - 2-frame walking cycle & foot offsets (Math.sin(tick * 0.2) * 2px)
 * - Shoulder sway & body bobbing relative to velocity
 * - Overhead floating CRT health bars (24x4px, phosphor colors, damage flash)
 * - Phosphor radar decay visibility trail
 */

(function (global) {
  'use strict';

  const SpriteFactory = {
    /**
     * Render an entity on a 2D canvas context
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} entity
     * @param {number} tick
     * @param {Object} [options]
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

      // Эффект вспышки при получении урона (белый оверлей)
      const isDamageFlash = entity.damageFlashTimer && entity.damageFlashTimer > 0;

      // 1. Отрисовка ног и процедурного шага (для гуманоидов)
      if (entity.type !== 'mutant_slime') {
        this.drawWalkingLegs(ctx, x, y, angle, radius, isMoving, tick, entity.type, isDamageFlash);
      }

      // 2. Отрисовка торса и головы со смещением покачивания
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      // Процедурный наклон и покачивание плеч при ходьбе
      let bodyBob = isMoving ? Math.abs(Math.sin(tick * 0.2)) * 1.5 : Math.sin(tick * 0.05) * 0.5;
      let shoulderSway = isMoving ? Math.cos(tick * 0.2) * 0.08 : 0;
      ctx.rotate(shoulderSway);

      switch (entity.type) {
        case 'player':
          this.drawPlayerBody(ctx, radius, isDamageFlash);
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
        default:
          this.drawGenericBody(ctx, radius, isDamageFlash);
      }

      ctx.restore(); // Сброс трансформации торса

      // 3. Плавающий индикатор здоровья над головой (Overhead Floating Health Bar)
      this.drawOverheadHealthBar(ctx, entity, x, y, radius, isDamageFlash);

      ctx.restore();
    },

    /**
     * Отрисовка ног с процедурным циклом шага
     */
    drawWalkingLegs(ctx, x, y, angle, radius, isMoving, tick, type, isDamageFlash) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      const footOffset = isMoving ? Math.sin(tick * 0.2) * 3 : 0;
      const legColor = isDamageFlash ? '#ffffff' : (type === 'liquidator' ? '#144d24' : (type === 'civilian' ? '#4d3d14' : '#0e3a18'));
      const bootColor = isDamageFlash ? '#ffffff' : (type === 'liquidator' ? '#1fe044' : '#225522');

      ctx.fillStyle = bootColor;
      ctx.strokeStyle = legColor;
      ctx.lineWidth = 1;

      // Левая нога / ботинок
      ctx.beginPath();
      ctx.roundRect(-radius * 0.7, -radius * 0.8 + footOffset, 5, 8, 2);
      ctx.fill();
      ctx.stroke();

      // Правая нога / ботинок (в противофазе)
      ctx.beginPath();
      ctx.roundRect(radius * 0.7 - 5, -radius * 0.8 - footOffset, 5, 8, 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    },

    /**
     * Отрисовка игрока (вид сверху, тактический скафандр)
     */
    drawPlayerBody(ctx, r, isFlash) {
      const mainColor = isFlash ? '#ffffff' : '#1fe044';
      const darkColor = isFlash ? '#dddddd' : '#08260c';
      const visorColor = isFlash ? '#ffffff' : '#00ffff';

      // Рюкзак / кислородные баллоны
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

      // Оружие в руках (направлено вперед)
      ctx.fillStyle = '#1fe044';
      ctx.fillRect(r * 0.45, r * 0.2, 3, r * 0.9);
      ctx.strokeStyle = '#051408';
      ctx.lineWidth = 1;
      ctx.strokeRect(r * 0.45, r * 0.2, 3, r * 0.9);
    },

    /**
     * Отрисовка Патрульного Ликвидатора (Тяжелая броня, огнемет/карабин, зеленый фосфор)
     */
    drawLiquidatorBody(ctx, r, isFlash) {
      const armorColor = isFlash ? '#ffffff' : '#1fe044';
      const plateColor = isFlash ? '#ffffff' : '#0a2a10';
      const glowColor = isFlash ? '#ffffff' : '#00ff66';

      // Силовые кабели и дыхательный ранец
      ctx.fillStyle = plateColor;
      ctx.strokeStyle = armorColor;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(-r * 0.85, -r * 0.95, r * 1.7, r * 0.6, 2);
      ctx.fill();
      ctx.stroke();

      // Бронеплиты плеч
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.15, r * 1.05, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fillStyle = plateColor;
      ctx.fill();
      ctx.stroke();

      // Бронеколпак шлема с решеткой фильтра
      ctx.beginPath();
      ctx.arc(0, r * 0.15, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = isFlash ? '#ffffff' : '#061a0b';
      ctx.fill();
      ctx.stroke();

      // Светящийся узкий визор ликвидатора
      ctx.beginPath();
      ctx.moveTo(-r * 0.32, r * 0.35);
      ctx.lineTo(r * 0.32, r * 0.35);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = glowColor;
      ctx.stroke();

      // Огнемет / тактический дробовик
      ctx.fillStyle = isFlash ? '#fff' : '#00ffaa';
      ctx.fillRect(r * 0.5, r * 0.1, 4, r * 1.15);
      ctx.strokeRect(r * 0.5, r * 0.1, 4, r * 1.15);
    },

    /**
     * Отрисовка Заблудшего жильца / Сталкера (Ватник, самодельный респиратор, янтарный фосфор)
     */
    drawCivilianBody(ctx, r, isFlash) {
      const coatColor = isFlash ? '#ffffff' : '#ffaa00';
      const darkColor = isFlash ? '#ffffff' : '#261b05';

      // Потрепанный вещмешок
      ctx.fillStyle = darkColor;
      ctx.strokeStyle = coatColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -r * 0.65, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Телогрейка
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.1, r * 0.8, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = darkColor;
      ctx.fill();
      ctx.stroke();

      // Шапка / голова
      ctx.beginPath();
      ctx.arc(0, r * 0.18, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = darkColor;
      ctx.fill();
      ctx.stroke();

      // Лепесток / респиратор
      ctx.beginPath();
      ctx.arc(0, r * 0.35, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = coatColor;
      ctx.fill();
      ctx.stroke();
    },

    /**
     * Отрисовка Мутанта / Слизня (Аморфная масса, ядовитые споры, пульсация, красный фосфор)
     */
    drawMutantSlimeBody(ctx, r, tick, isFlash, entity) {
      const redColor = isFlash ? '#ffffff' : '#ff3b30';
      const innerColor = isFlash ? '#ffffff' : '#4a0808';

      ctx.save();
      ctx.beginPath();
      const points = 8;
      for (let i = 0; i <= points; i++) {
        let angle = (i / points) * Math.PI * 2;
        let pulse = Math.sin(tick * 0.15 + i * 1.5) * 2.5;
        let pr = r + pulse;
        let px = Math.cos(angle) * pr;
        let py = Math.sin(angle) * pr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = innerColor;
      ctx.fill();
      ctx.strokeStyle = redColor;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Глазные узлы / наросты
      const eyePositions = [
        { x: -r * 0.35, y: -r * 0.2, sz: 2.5 },
        { x: r * 0.3, y: r * 0.2, sz: 3.5 },
        { x: -r * 0.1, y: r * 0.4, sz: 2.0 },
        { x: r * 0.15, y: -r * 0.4, sz: 2.8 }
      ];
      ctx.fillStyle = isFlash ? '#ffffff' : '#ffaa00';
      eyePositions.forEach(ep => {
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, ep.sz, 0, Math.PI * 2);
        ctx.fill();
      });

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
     * Плавающая ЭЛТ-шкала здоровья (Overhead Floating Health Bar)
     * - Высота: 4px, ширина: 24px, 8px над головой персонажа
     * - Рамка: 1px #041407, фон: #3a0808
     * - Заполнение: #1fe044 (союзники/нейтралы), #ff3b30 (враги)
     * - Вспышка белым при получении урона
     */
    drawOverheadHealthBar(ctx, entity, x, y, radius, isDamageFlash) {
      const maxHp = entity.maxHp || 100;
      const curHp = Math.max(0, Math.min(maxHp, entity.hp !== undefined ? entity.hp : maxHp));
      const hpPct = curHp / maxHp;

      const barW = 24;
      const barH = 4;
      const barX = Math.round(x - barW / 2);
      const barY = Math.round(y - radius - 8 - barH);

      // Рамка и подложка
      ctx.fillStyle = '#041407';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

      // Фон пустой полоски (урон)
      ctx.fillStyle = '#3a0808';
      ctx.fillRect(barX, barY, barW, barH);

      // Заполнение здоровья
      let fillColor = '#1fe044';
      if (entity.type === 'mutant_slime') {
        fillColor = '#ff3b30';
      } else if (entity.type === 'civilian') {
        fillColor = '#ffaa00';
      }

      if (isDamageFlash) {
        fillColor = '#ffffff';
      }

      const fillW = Math.max(0, Math.round(barW * hpPct));
      if (fillW > 0) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(barX, barY, fillW, barH);
      }
    },

    /**
     * Окружение: Стена Гигахруща (32x32 железобетонный блок со светлой окантовкой стыков)
     */
    drawWallTile(ctx, x, y, size = 32, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.1, alpha);
      // Базовый темный железобетон
      ctx.fillStyle = '#061c0b';
      ctx.fillRect(x, y, size, size);

      // Внутренний массив плиты
      ctx.fillStyle = '#0b3814';
      ctx.fillRect(x + 2, y + 2, size - 4, size - 4);

      // Светлая окантовка стыков блоков
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

      // Крепежные заклепки / арматура по углам
      ctx.fillStyle = '#88ff9e';
      ctx.fillRect(x + 3, y + 3, 2, 2);
      ctx.fillRect(x + size - 5, y + 3, 2, 2);
      ctx.fillRect(x + 3, y + size - 5, 2, 2);
      ctx.fillRect(x + size - 5, y + size - 5, 2, 2);

      ctx.restore();
    },

    /**
     * Окружение: Пол коридора (32x32 темная плиточная сетка со слабыми линиями сканирования)
     */
    drawFloorTile(ctx, x, y, size = 32, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.04, alpha * 0.7);

      ctx.fillStyle = '#031006';
      ctx.fillRect(x, y, size, size);

      // Тонкая сетка плитки
      ctx.strokeStyle = '#082a10';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

      // Внутренние слабые линии сканирования
      ctx.strokeStyle = 'rgba(31, 224, 68, 0.08)';
      ctx.beginPath();
      ctx.moveTo(x + 4, y + size / 2);
      ctx.lineTo(x + size - 4, y + size / 2);
      ctx.stroke();

      ctx.restore();
    },

    /**
     * Окружение: Гермодверь (полосатая штриховка безопасности, разделяющая помещения)
     */
    drawDoorTile(ctx, door, size = 32, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.15, alpha);

      const x = door.x - size / 2;
      const y = door.y - size / 2;

      // Рама гермодвери
      ctx.fillStyle = '#041407';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

      // Полосатая штриховка безопасности (желто-черная / фосфорно-темная)
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

      // Индикатор замка
      ctx.fillStyle = door.isOpen ? '#1fe044' : '#ff3b30';
      ctx.beginPath();
      ctx.arc(door.x, door.y, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },

    /**
     * Окружение: Ящик снабжения / Лут (контур контейнера с маркировкой пайка концентрата)
     */
    drawLootCrate(ctx, crate, size = 32, tick = 0, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.12, alpha);

      const cx = crate.x;
      const cy = crate.y;
      const r = crate.radius || 12;

      if (crate.opened) {
        // Открытый пустой ящик
        ctx.strokeStyle = '#445544';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
        ctx.fillStyle = 'rgba(10, 25, 12, 0.4)';
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
        return;
      }

      // Неоткрытый контейнер (#f5a623 контур и свечение)
      const pulse = Math.sin(tick * 0.1) * 2;
      const color = crate.type === 'ammo' ? '#33d4ff' : '#f5a623';

      ctx.shadowColor = color;
      ctx.shadowBlur = 6 + pulse;

      ctx.fillStyle = '#091c0e';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);

      // Крест или маркировка пайка
      ctx.fillStyle = color;
      if (crate.type === 'ammo') {
        // Три патронные риски
        ctx.fillRect(cx - 5, cy - 6, 2, 12);
        ctx.fillRect(cx - 1, cy - 6, 2, 12);
        ctx.fillRect(cx + 3, cy - 6, 2, 12);
      } else {
        // Звезда / концентратный крест
        ctx.fillRect(cx - 6, cy - 2, 12, 4);
        ctx.fillRect(cx - 2, cy - 6, 4, 12);
      }

      ctx.restore();
    },

    /**
     * Окружение: Шахта лифта / Эвакуация (мигающие шевроны выхода)
     */
    drawElevatorShaft(ctx, elevator, size = 32, tick = 0, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.2, alpha);

      const x = elevator.x;
      const y = elevator.y;

      // Площадка шахты
      ctx.fillStyle = '#031407';
      ctx.fillRect(x, y, size, size);

      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

      // Пульсирующие шевроны выхода (вверх / внутрь)
      const blink = Math.sin(tick * 0.15) > 0;
      ctx.strokeStyle = blink ? '#88ff9e' : '#1fe044';
      ctx.lineWidth = 2;

      const midX = x + size / 2;
      const midY = y + size / 2;

      // Шеврон 1
      ctx.beginPath();
      ctx.moveTo(midX - 8, midY + 4);
      ctx.lineTo(midX, midY - 4);
      ctx.lineTo(midX + 8, midY + 4);
      ctx.stroke();

      // Шеврон 2
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

