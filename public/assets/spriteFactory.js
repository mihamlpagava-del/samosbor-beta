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
    }
  };

  global.SpriteFactory = SpriteFactory;
})(typeof window !== 'undefined' ? window : this);

