/**
 * ============================================================================
 * MODULE "СССР-1: ХРОНИКИ ГИГАХРУЩА" (INTERACTIVE STORY MODE)
 * ============================================================================
 * Samosbor Reactive Consciousness Simulation System (С.С.Р.С.)
 * Setting and texts: DIVAN
 * Engine: Antigravity Terminal Story Engine
 * 
 * Features:
 * - Branching node-based interactive narrative with terminal states.
 * - State persistence in localStorage (samosbor_story_active_node, samosbor_story_completed).
 * - Real-time CRT & Hologram canvas renderer:
 *     * Scanlines (0.15 intensity)
 *     * Barrel spherical distortion (0.08 curvature)
 *     * Chromatic aberration (RGB split 1.5px)
 *     * 60Hz phosphor flicker & jitter
 *     * Animated vector wireframe holograms (terminal, blast door, helmet, elevator, etc.)
 * - Keyboard hooks: ESC (pause/menu), 1/2/3 (choices), Space (advance/reset).
 * - Web Audio procedural sound synthesis (terminal typing clicks, static burst, ambient hum).
 */

(function(window) {
  'use strict';

  // --- AUDIO SYNTHESIS ENGINE (Procedural Web Audio) ---
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playKeyClick() {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800 + Math.random() * 400, ctx.currentTime);
      gain.gain.setValueAtTime(0.02, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } catch (e) {}
  }

  function playGlitchSfx() {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const bufferSize = ctx.sampleRate * 0.12;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1400;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start();
    } catch (e) {}
  }

  function playConfirmSfx() {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {}
  }

  // --- STORY DATABASE ---
  const STORY_NODES = {
    intro: {
      id: 'intro',
      hologram: 'system',
      title: 'С.С.Р.С. // ИНИЦИАЛИЗАЦИЯ',
      lines: [
        { text: '>>> ПОДКЛЮЧЕНИЕ НЕЙРОРАЗЪЕМА... УСПЕШНО.', color: '#00ffaa' },
        { text: '>>> НАЗВАНИЕ МОДУЛЯ: «СИСТЕМА СИМУЛЯЦИИ РЕАКТИВНОСТИ СОЗНАНИЯ» (С.С.Р.С.)', color: '#33d4ff' },
        { text: '>>> ВНИМАНИЕ: СИМУЛЯЦИЯ ПРЕДНАЗНАЧЕНА ДЛЯ ОДНОКРАТНОГО ТЕСТИРОВАНИЯ.', color: '#ffb000' },
        { text: '>>> СКАНИРОВАНИЕ МОЗГОВОЙ АКТИВНОСТИ...', color: '#00ffaa' },
        { text: '>>> ПРЕДИСЛОВИЕ: ВЫ ПЕРЕСЕКАЕТЕ ГРАНИЦУ ТЕРРИТОРИИ САМОСБОРА.', color: '#ff5555' },
        { text: '>>> ПРАВИЛО 1: КАНОНА НЕ СУЩЕСТВУЕТ.', color: '#ffff55' },
        { text: '>>> ПРАВИЛО 2: НЕ ЖДИТЕ СПАСЕНИЯ.', color: '#ff3333' }
      ],
      choices: [
        {
          label: '[1] НАЧАТЬ ПОГРУЖЕНИЕ // 556-Й ЭТАЖ. БЛОК П-46',
          target: 'stage1'
        }
      ]
    },

    stage1: {
      id: 'stage1',
      hologram: 'terminal',
      title: 'ЭТАП 1: 556-Й ЭТАЖ. БЛОК П-46',
      lines: [
        { text: 'Экран вспыхивает тусклым кинескопным светом. Запах жженой изоляции и дешевого чая. Ты сидишь в своей комнате, уставившись в выключенный монитор «Микроша». На часах — конец смены.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Где-то за перекрытиями раздается первый протяжный гул. Не учебный. Вибрация пола передается через подошвы стоптанных тапочек.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: '[СТАТУС]: СИРЕНА САМОСБОРА НАБИРАЕТ ОБОРОТЫ.', color: '#ff4444' },
        { text: '[ЗАМЕР ВОЗДУХА]: СЛАДКОВАТЫЙ ЗАПАХ СЫРОГО МЯСА. КОНЦЕНТРАЦИЯ: 14%.', color: '#ffaa00' }
      ],
      choices: [
        {
          label: '[1] Задраить гермодверь на все три засова и залить щели асбестовой пастой.',
          target: 'stage2a'
        },
        {
          label: '[2] Схватить монтировку, дедовскую ручку «Сделано в СССР» и бежать к лифтовой шахте, пока коридор не отрезало.',
          target: 'stage2b'
        },
        {
          label: '[3] Надеть облегченный респиратор и выглянуть в глазок: проверить, дошел ли сосед дядя Толя.',
          target: 'stage2c'
        }
      ]
    },

    stage2a: {
      id: 'stage2a',
      hologram: 'door',
      title: 'ЭТАП 2А: КВАРТИРНАЯ ОСАДА',
      lines: [
        { text: 'Засовы со скрежетом встали в пазы. Сирена за стеной оглушает. Ты прижался спиной к холодному металлу. Через десять минут звуки шагов в подъезде стихают. Но внезапно в дверь начинают скрестись.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Голос с той стороны — мягкий, знакомый, чуть с хрипотцой:', color: '#00ffcc' },
        { text: '«Сынок... открывай, я тебе торт купил. Мы на кухне чай пьем, выходи, сычина...»', color: '#ffdd77' },
        { text: '', color: '#c8f0d8' },
        { text: 'Ты прекрасно помнишь: отец погиб в цеху очистки воды два года назад. Голос повторяет слова слишком ровно, проглатывая шипящие звуки. Металл гермодвери в районе нижнего уплотнителя начинает покрываться черной испариной.', color: '#ff7777' }
      ],
      choices: [
        {
          label: '[1] Молчать, зажать уши и отползти в ванную, повторяя дедовский устав.',
          target: 'stage3_burnout'
        },
        {
          label: '[2] Подойти вплотную к двери и крикнуть кодовый пароль блоккома.',
          target: 'ending_meat'
        },
        {
          label: '[3] Начать жарить на плите суповую массу 2Б с концентратом Р666, создавая едкую дымовую завесу.',
          target: 'stage3_defense'
        }
      ]
    },

    ending_meat: {
      id: 'ending_meat',
      hologram: 'anomaly',
      title: 'ИСХОД // ТРАНСФОРМАЦИЯ',
      lines: [
        { text: '[ИСХОД]:', color: '#ff3333' },
        { text: 'Голос за дверью прерывается утробным визгом. Из вентиляционного отверстия вырывается струя фиолетовой ваты.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Мозг фиксирует необратимое искажение пространства. Металл стен течет, как теплое повидло.', color: '#ff77aa' },
        { text: '', color: '#c8f0d8' },
        { text: '>>> [СИМУЛЯЦИЯ ПРЕРВАНА: ТРАНСФОРМАЦИЯ В ПСЕВДОПЛОТЬ] <<<', color: '#ff2222' }
      ],
      choices: [
        {
          label: '[1] ПЕРЕЗАГРУЗИТЬ НЕЙРОСИМУЛЯЦИЮ',
          target: 'intro'
        },
        {
          label: '[2] ЗАФИКСИРОВАТЬ ДАННЫЕ В ПРОТОКОЛЕ (ТИТРЫ)',
          target: 'credits'
        }
      ]
    },

    stage2b: {
      id: 'stage2b',
      hologram: 'elevator',
      title: 'ЭТАП 2Б: ПОБЕГ НА МИНУС-ЭТАЖИ',
      lines: [
        { text: 'Коридор залит тусклым аварийным светом. Лампы дневного света гудят и лопаются одна за другой со стеклянным звоном. Ты успеваешь влететь в кабину грузового лифта перед самым закрытием внешних створок.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Внутри темно. В углу сидит фигура в тяжелом, обшарпанном скафандре ликвидатора с самодельными силовыми кабелями. На броне выцарапана маркировка «ДЕМБЕЛЬ».', color: '#33d4ff' },
        { text: '', color: '#c8f0d8' },
        { text: '— Куда прешь под сирену, гражданский? — хрипит динамик его шлема. Лифт с грохотом срывается вниз, тросы натужно визжат. — На нижних сейчас такое месиво, что даже граблями шкрябать нечего. Будешь самогон из плесени?', color: '#ffd566' }
      ],
      choices: [
        {
          label: '[1] Принять жестяную флягу, выпить мутную жижу и молча смотреть на индикатор этажей.',
          target: 'stage3_subcellar'
        },
        {
          label: '[2] Отказаться, достать аварийный тормозной ключ и потребовать остановки на 42-м этаже.',
          target: 'ending_elevator_death'
        }
      ]
    },

    ending_elevator_death: {
      id: 'ending_elevator_death',
      hologram: 'elevator',
      title: 'ИСХОД // ГИБЕЛЬ В ШАХТЕ',
      lines: [
        { text: '[ИСХОД]:', color: '#ff3333' },
        { text: 'Ликвидатор усмехается под затемненным визором. Ты всаживаешь аварийный тормозной ключ в панель. Скрежет тормозных колодок режет слух, лифт клинит между перекрытиями.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Сверху на крышу падает стотонная биомасса. Трос с визгом лопается. Кабина срывается в бездонную бездну шахты.', color: '#ff5555' },
        { text: '', color: '#c8f0d8' },
        { text: '>>> [СИМУЛЯЦИЯ ЗАВЕРШЕНА: ГИБЕЛЬ В ШАХТЕ] <<<', color: '#ff2222' }
      ],
      choices: [
        {
          label: '[1] ПЕРЕЗАГРУЗИТЬ НЕЙРОСИМУЛЯЦИЮ',
          target: 'intro'
        },
        {
          label: '[2] ЗАФИКСИРОВАТЬ ДАННЫЕ В ПРОТОКОЛЕ (ТИТРЫ)',
          target: 'credits'
        }
      ]
    },

    stage2c: {
      id: 'stage2c',
      hologram: 'eye',
      title: 'ЭТАП 2В: ЗЕРКАЛЬНАЯ ЛОВУШКА',
      lines: [
        { text: 'Ты подходишь к оптическому глазку гермодвери. Прижимаешься взором к стеклу. С той стороны — абсолютная чернота, в которой плавает фиолетовый туман.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Внезапно в центре линзы появляется зрачок. Он расширяется синхронно с твоим. Ты делаешь шаг назад — отражение повторяет движение. Ты моргаешь — оно моргает.', color: '#00e5ff' },
        { text: '', color: '#c8f0d8' },
        { text: 'Ты бросаешь взгляд себе под ноги и холодеешь: бетонный пол коридора, обрывки проводов и капли бурой жижи находятся прямо под твоими ботинками.', color: '#ff7777' },
        { text: 'Ты стоишь снаружи квартиры. А за запертой гермодверью горит теплый свет твоей собственной кухни.', color: '#ffff77' }
      ],
      choices: [
        {
          label: '[1] Со всей силы вонзить стальную дедовскую ручку в стык уплотнителя, ломая запорный механизм.',
          target: 'stage3_slug'
        },
        {
          label: '[2] Упасть на колени и попытаться слиться с кабельным каналом у плинтуса.',
          target: 'stage3_slug'
        }
      ]
    },

    stage3_burnout: {
      id: 'stage3_burnout',
      hologram: 'helmet',
      title: 'ЭТАП 3: ВЫГОРАНИЕ И ЛИКВИДАТОРЫ',
      lines: [
        { text: 'Ты сидишь в ванной, зажав уши. Часы тянутся как резина. За дверью затихает скрежет, но начинается низкий свистящий гул.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Удар гидравлического тарана вышибает замок. В квартиру вваливаются бойцы ликвидационного отряда в черных плащах ОЗК. Факелы огнеметов заливают коридор белым пламенем, сжигая остатки черной испарины.', color: '#ff9900' },
        { text: '', color: '#c8f0d8' },
        { text: 'Векторы сходятся в единую точку развязки. Пространство Хруща сжимается. Сирена затихает, но вместо тишины наступает свистящий ультразвук.', color: '#33d4ff' },
        { text: '[СИСТЕМА]: ПРЕДЕЛ СТАБИЛЬНОСТИ ПСИХИКИ ДОСТИГНУТ.', color: '#ff3333' }
      ],
      choices: [
        {
          label: '[1] ПРИНЯТЬ САМОСБОР (Растворить личность, обрести новую форму в бетоне)',
          target: 'finale_1'
        },
        {
          label: '[2] ВСТАТЬ В СТРОЙ (Взять огнемет павшего ликвидатора и зачищать отсек)',
          target: 'finale_2'
        },
        {
          label: '[3] ВЫЙТИ В ОКНО (Использовать парашют А-03 в поисках мифического "Снаружи")',
          target: 'finale_3'
        }
      ]
    },

    stage3_defense: {
      id: 'stage3_defense',
      hologram: 'helmet',
      title: 'ЭТАП 3: АДОВАЯ ОБОРОНА',
      lines: [
        { text: 'Сковорода шипит. Концентрат Р666 вступает в реакцию с суповой массой 2Б, поднимая плотное желтое облако едкого дыма. Существо за дверью начинает выть, шипящие звуки захлебываются в кашле.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'В коридоре раздается треск высоковольтных разрядников — подоспела зачистка. Огнеметы продувают этаж. Воздух пропитан озоном, паленой резиной и жареным мясом.', color: '#ffaa00' },
        { text: '', color: '#c8f0d8' },
        { text: 'Векторы сходятся в единую точку развязки. Пространство Хруща сжимается.', color: '#33d4ff' },
        { text: '[СИСТЕМА]: ПРЕДЕЛ СТАБИЛЬНОСТИ ПСИХИКИ ДОСТИГНУТ.', color: '#ff3333' }
      ],
      choices: [
        {
          label: '[1] ПРИНЯТЬ САМОСБОР (Растворить личность, обрести новую форму в бетоне)',
          target: 'finale_1'
        },
        {
          label: '[2] ВСТАТЬ В СТРОЙ (Взять огнемет павшего ликвидатора и зачищать отсек)',
          target: 'finale_2'
        },
        {
          label: '[3] ВЫЙТИ В ОКНО (Использовать парашют А-03 в поисках мифического "Снаружи")',
          target: 'finale_3'
        }
      ]
    },

    stage3_subcellar: {
      id: 'stage3_subcellar',
      hologram: 'helmet',
      title: 'ЭТАП 3: СПУСК В ПОДВАЛ',
      lines: [
        { text: 'Самогон из плесени обжигает пищевод жидким натрием. Лифт со стоном тормозит на отметке -120 этажа. Створки раздвигаются ломами.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Вокруг — циклопический зал насосной станции. Ликвидаторы в резиновых плащах ведут огонь по пульсирующим трубам. Воздух дрожит от грохота.', color: '#ff8800' },
        { text: '', color: '#c8f0d8' },
        { text: 'Векторы сходятся в единую точку развязки. Пространство Хруща сжимается. Ликвидатор падает, роняя раскаленный огнемет к твоим ногам.', color: '#33d4ff' },
        { text: '[СИСТЕМА]: ПРЕДЕЛ СТАБИЛЬНОСТИ ПСИХИКИ ДОСТИГНУТ.', color: '#ff3333' }
      ],
      choices: [
        {
          label: '[1] ПРИНЯТЬ САМОСБОР (Растворить личность, обрести новую форму в бетоне)',
          target: 'finale_1'
        },
        {
          label: '[2] ВСТАТЬ В СТРОЙ (Взять огнемет павшего ликвидатора и зачищать отсек)',
          target: 'finale_2'
        },
        {
          label: '[3] ВЫЙТИ В ОКНО (Использовать парашют А-03 в поисках мифического "Снаружи")',
          target: 'finale_3'
        }
      ]
    },

    stage3_slug: {
      id: 'stage3_slug',
      hologram: 'anomaly',
      title: 'ЭТАП 3: РОЖДЕНИЕ СЛИЗНЯ',
      lines: [
        { text: 'Твои пальцы скользят по стыкам плит. Ручка ломается, брызнув чернилами цвета венозной крови. Бетон вокруг становится липким и теплым.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Ты больше не понимаешь, где квартира, а где коридор. Вдали горят факелы ликвидаторов, выжигающих отсек за отсеком. Воздух пропитан озоном, паленой резиной и жареным мясом.', color: '#ff66aa' },
        { text: '', color: '#c8f0d8' },
        { text: 'Векторы сходятся в единую точку развязки. Пространство Хруща сжимается.', color: '#33d4ff' },
        { text: '[СИСТЕМА]: ПРЕДЕЛ СТАБИЛЬНОСТИ ПСИХИКИ ДОСТИГНУТ.', color: '#ff3333' }
      ],
      choices: [
        {
          label: '[1] ПРИНЯТЬ САМОСБОР (Растворить личность, обрести новую форму в бетоне)',
          target: 'finale_1'
        },
        {
          label: '[2] ВСТАТЬ В СТРОЙ (Взять огнемет павшего ликвидатора и зачищать отсек)',
          target: 'finale_2'
        },
        {
          label: '[3] ВЫЙТИ В ОКНО (Использовать парашют А-03 в поисках мифического "Снаружи")',
          target: 'finale_3'
        }
      ]
    },

    finale_1: {
      id: 'finale_1',
      hologram: 'anomaly',
      title: 'ФИНАЛ: ПРИНЯТИЕ САМОСБОРА',
      lines: [
        { text: 'Твое тело вспучивается черным сталагмитом. Боли нет.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Ты утекаешь по кабельным каналам на нижние уровни, навстречу далекому эху дедовского шага.', color: '#00ffaa' },
        { text: '', color: '#c8f0d8' },
        { text: 'Самосбор принял тебя. Бетон стал твоей новой кожей.', color: '#33d4ff' }
      ],
      choices: [
        {
          label: '[1] ПЕРЕЙТИ К ПРОТОКОЛУ ЗАВЕРШЕНИЯ',
          target: 'credits'
        }
      ]
    },

    finale_2: {
      id: 'finale_2',
      hologram: 'helmet',
      title: 'ФИНАЛ: ВСТАТЬ В СТРОЙ',
      lines: [
        { text: 'Ты поднимаешь тяжелый огнемет павшего бойца. Запотевший шлем ликвидатора щелкает на затылке. Паек выдан.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Впереди — бесконечные километры коридоров и заваренные намертво двери. Ты стал частью Системы.', color: '#ffaa00' },
        { text: '', color: '#c8f0d8' },
        { text: 'До следующего Самосбора.', color: '#ff3333' }
      ],
      choices: [
        {
          label: '[1] ПЕРЕЙТИ К ПРОТОКОЛУ ЗАВЕРШЕНИЯ',
          target: 'credits'
        }
      ]
    },

    finale_3: {
      id: 'finale_3',
      hologram: 'system',
      title: 'ФИНАЛ: ВЫЙТИ В ОКНО',
      lines: [
        { text: 'Ты срываешь стопорную раму и шагаешь в густой туман. Парашют А-03 с треском раскрывается.', color: '#c8f0d8' },
        { text: '', color: '#c8f0d8' },
        { text: 'Этажи мелькают: 200... 100... 10... 0... -50...', color: '#33d4ff' },
        { text: '', color: '#c8f0d8' },
        { text: 'Земли нет. Внизу лишь бесконечные трубы, кабели и такие же тусклые окна бескрайней Гигахрущевки.', color: '#00ffcc' }
      ],
      choices: [
        {
          label: '[1] ПЕРЕЙТИ К ПРОТОКОЛУ ЗАВЕРШЕНИЯ',
          target: 'credits'
        }
      ]
    },

    credits: {
      id: 'credits',
      hologram: 'credits',
      title: 'ПРОТОКОЛ С.С.Р.С. // ЗАВЕРШЕНО',
      lines: [
        { text: '=============================================================', color: '#00ffaa' },
        { text: '             СИМУЛЯЦИЯ РЕАКТИВНОСТИ СОЗНАНИЯ ЗАВЕРШЕНА       ', color: '#ffffff' },
        { text: '                     СТАТУС: ДАННЫЕ ЗАПИСАНЫ                 ', color: '#33d4ff' },
        { text: '=============================================================', color: '#00ffaa' },
        { text: '', color: '#fff' },
        { text: '          "И все идет по плану. Белковый набат звучит.       ', color: '#ffdd88' },
        { text: '           Гермодвери закрыты. Самосбор продолжается."       ', color: '#ffdd88' },
        { text: '', color: '#fff' },
        { text: '-------------------------------------------------------------', color: '#00aa77' },
        { text: '              АВТОР ОРИГИНАЛЬНОГО СЕТТИНГА И ТЕКСТОВ:        ', color: '#88eebb' },
        { text: '                              DIVAN                          ', color: '#ffffff' },
        { text: '-------------------------------------------------------------', color: '#00aa77' },
        { text: '[КВЕСТ ПРОЙДЕН. НАЖМИТЕ ПРОБЕЛ ИЛИ КНОПКУ ДЛЯ ВЫХОДА НА БАЗУ]', color: '#00ffaa' }
      ],
      choices: [
        {
          label: '[ПРОБЕЛ] ЗАВЕРШИТЬ СИМУЛЯЦИЮ И ВЕРНУТЬСЯ НА БАЗУ (+150 ТАЛОНОВ)',
          target: 'finish'
        }
      ]
    }
  };

  // --- STATE MACHINE & RUNTIME ---
  let currentNodeId = 'intro';
  let isPaused = false;
  let isGlitching = false;
  let glitchTimer = 0;
  let animFrameId = null;
  let typeCharIndex = 0;
  let typeTimer = null;
  let fullTextRendered = false;

  // Canvas context
  let canvas = null;
  let ctx = null;
  let canvasW = 800;
  let canvasH = 460;

  // Time ticker
  let globalTime = 0;

  // Initialize from storage
  function initStoryEngine() {
    const saved = localStorage.getItem('samosbor_story_active_node');
    if (saved && STORY_NODES[saved]) {
      currentNodeId = saved;
    } else {
      currentNodeId = 'intro';
    }
  }

  // --- VECTOR WIREFRAME HOLOGRAM RENDERERS ---
  function drawHologramObject(hType, cx, cy, size, t) {
    ctx.save();
    ctx.translate(cx, cy);

    // Subtle floating bobbing
    ctx.translate(0, Math.sin(t * 2) * 5);

    // Phosphor glow styling
    ctx.strokeStyle = '#00ffcc';
    ctx.shadowColor = '#00ffaa';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;

    if (hType === 'terminal') {
      // Retro "Микроша" PC
      const s = size * 0.7;
      ctx.strokeRect(-s * 0.8, -s * 0.6, s * 1.6, s * 1.0);
      ctx.strokeRect(-s * 0.7, -s * 0.5, s * 1.4, s * 0.8);
      // Screen scanlines on miniature
      ctx.beginPath();
      for (let y = -s * 0.45; y < s * 0.25; y += 8) {
        ctx.moveTo(-s * 0.65, y);
        ctx.lineTo(s * 0.65, y);
      }
      ctx.strokeStyle = 'rgba(0, 255, 170, 0.4)';
      ctx.stroke();

      // Keyboard
      ctx.strokeStyle = '#00ffcc';
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, s * 0.45);
      ctx.lineTo(s * 0.9, s * 0.45);
      ctx.lineTo(s * 0.75, s * 0.8);
      ctx.lineTo(-s * 0.75, s * 0.8);
      ctx.closePath();
      ctx.stroke();
    } else if (hType === 'door') {
      // Heavy Blast Door with 3 bolts and round viewport
      const s = size * 0.75;
      ctx.strokeRect(-s * 0.6, -s * 0.9, s * 1.2, s * 1.8);
      ctx.strokeRect(-s * 0.5, -s * 0.8, s * 1.0, s * 1.6);
      // Porthole
      ctx.beginPath();
      ctx.arc(0, -s * 0.25, s * 0.22, 0, Math.PI * 2);
      ctx.arc(0, -s * 0.25, s * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      // 3 Bolts
      const boltY = [-s * 0.6, 0, s * 0.5];
      boltY.forEach(by => {
        ctx.strokeRect(-s * 0.75, by - 5, s * 0.3, 10);
        ctx.strokeRect(s * 0.45, by - 5, s * 0.3, 10);
      });
      // Hazard cross
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, s * 0.2);
      ctx.lineTo(s * 0.4, s * 0.6);
      ctx.moveTo(s * 0.4, s * 0.2);
      ctx.lineTo(-s * 0.4, s * 0.6);
      ctx.strokeStyle = 'rgba(255, 170, 0, 0.6)';
      ctx.stroke();
    } else if (hType === 'elevator') {
      // Elevator shaft & cage
      const s = size * 0.75;
      // Cables
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, -s * 1.2);
      ctx.lineTo(-s * 0.2, -s * 0.7);
      ctx.moveTo(s * 0.2, -s * 1.2);
      ctx.lineTo(s * 0.2, -s * 0.7);
      ctx.stroke();
      // Cage
      ctx.strokeRect(-s * 0.6, -s * 0.7, s * 1.2, s * 1.4);
      // Lattice gate
      ctx.beginPath();
      for (let x = -s * 0.5; x <= s * 0.5; x += 15) {
        ctx.moveTo(x, -s * 0.7);
        ctx.lineTo(x + 10, s * 0.7);
        ctx.moveTo(x + 10, -s * 0.7);
        ctx.lineTo(x, s * 0.7);
      }
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
      ctx.stroke();
    } else if (hType === 'helmet') {
      // Liquidator Gas Mask & Helmet
      const s = size * 0.65;
      ctx.beginPath();
      // Dome
      ctx.arc(0, -s * 0.2, s * 0.7, Math.PI * 0.85, Math.PI * 0.15, false);
      ctx.lineTo(s * 0.65, s * 0.3);
      ctx.lineTo(-s * 0.65, s * 0.3);
      ctx.closePath();
      ctx.stroke();
      // Visor goggles
      ctx.strokeRect(-s * 0.5, -s * 0.35, s * 0.4, s * 0.3);
      ctx.strokeRect(s * 0.1, -s * 0.35, s * 0.4, s * 0.3);
      // Filter box at bottom
      ctx.strokeRect(-s * 0.3, s * 0.3, s * 0.6, s * 0.4);
      // Filter grille
      ctx.beginPath();
      for (let gy = s * 0.36; gy < s * 0.65; gy += 6) {
        ctx.moveTo(-s * 0.24, gy);
        ctx.lineTo(s * 0.24, gy);
      }
      ctx.stroke();
    } else if (hType === 'eye') {
      // Biomechanical ocular surveillance
      const s = size * 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      // Reticle rings
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 60, 60, 0.8)';
      ctx.stroke();
      // Iris pulsate
      const p = s * (0.2 + Math.sin(t * 5) * 0.08);
      ctx.beginPath();
      ctx.arc(0, 0, p, 0, Math.PI * 2);
      ctx.fillStyle = '#ff2255';
      ctx.fill();
    } else if (hType === 'anomaly') {
      // Morphing Meat Slime Tendrils
      const s = size * 0.7;
      ctx.beginPath();
      const points = 16;
      for (let i = 0; i < points; i++) {
        const ang = (i / points) * Math.PI * 2;
        const rad = s * (0.6 + Math.sin(ang * 4 + t * 4) * 0.2 + Math.cos(ang * 2 - t * 3) * 0.15);
        const x = Math.cos(ang) * rad;
        const y = Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#ff33aa';
      ctx.shadowColor = '#ff0066';
      ctx.stroke();
    } else {
      // System emblem / Soviet Star Reticle
      const s = size * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const r1 = s * 0.7;
        const r2 = s * 0.3;
        const a1 = (i * 72 - 90) * Math.PI / 180;
        const a2 = (i * 72 - 54) * Math.PI / 180;
        if (i === 0) ctx.moveTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
        else ctx.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
        ctx.lineTo(Math.cos(a2) * r2, Math.sin(a2) * r2);
      }
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
  }

  // --- BACKGROUND PHOSPHOR GRID ---
  function drawPerspectiveGrid(w, h, t) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 120, 60, 0.18)';
    ctx.lineWidth = 1;

    // Perspective horizon
    const horizonY = h * 0.65;
    const vpX = w * 0.75; // vanishing point offset to right
    const vpY = horizonY;

    // Horizon line
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();

    // Radiating floor rays
    for (let x = -w * 0.5; x <= w * 1.5; x += 45) {
      ctx.beginPath();
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Moving horizontal grid lines
    const offset = (t * 25) % 30;
    for (let y = horizonY + 2; y < h; y += Math.max(3, (y - horizonY) * 0.35) + (offset * 0.05)) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // --- TYPEWRITER & TEXT BUFFER RENDERER ---
  function renderTextBuffer(node, w, h) {
    ctx.save();
    ctx.font = '14px "Share Tech Mono", "Consolas", "Courier New", monospace';
    ctx.textBaseline = 'top';

    const leftX = 26;
    let currY = 24;
    const maxTextWidth = w - 240; // reserve right side for vector hologram

    // Draw Node Header Badge
    ctx.fillStyle = '#00ffaa';
    ctx.shadowColor = '#00ffaa';
    ctx.shadowBlur = 4;
    ctx.fillText(`==[ ${node.title} ]==`, leftX, currY);
    currY += 24;

    let charsRemaining = typeCharIndex;

    for (let i = 0; i < node.lines.length; i++) {
      const lineObj = node.lines[i];
      const text = lineObj.text;
      if (text === '') {
        currY += 12;
        continue;
      }

      ctx.fillStyle = lineObj.color || '#c8f0d8';
      ctx.shadowColor = lineObj.color || '#00ffaa';
      ctx.shadowBlur = 3;

      // Word wrapping
      const words = text.split(' ');
      let curLine = '';

      for (let j = 0; j < words.length; j++) {
        const testLine = curLine ? (curLine + ' ' + words[j]) : words[j];
        const testW = ctx.measureText(testLine).width;
        if (testW > maxTextWidth && curLine !== '') {
          // Render current wrapped line up to charsRemaining
          const toDraw = curLine.slice(0, Math.max(0, charsRemaining));
          if (toDraw.length > 0) ctx.fillText(toDraw, leftX, currY);
          charsRemaining -= curLine.length;
          currY += 20;
          curLine = words[j];
        } else {
          curLine = testLine;
        }
      }

      if (curLine.length > 0) {
        const toDraw = curLine.slice(0, Math.max(0, charsRemaining));
        if (toDraw.length > 0) ctx.fillText(toDraw, leftX, currY);
        charsRemaining -= curLine.length;
        currY += 20;
      }

      if (charsRemaining <= 0) break;
    }

    // Blinking cursor at end of text
    if (!fullTextRendered && Math.floor(globalTime * 3) % 2 === 0) {
      ctx.fillStyle = '#00ffaa';
      ctx.fillRect(leftX + 4, currY + 2, 8, 14);
    }

    ctx.restore();
  }

  // --- POST-PROCESSING CRT PASS ---
  function applyCrtPostProcessing(w, h) {
    // 1. Scanlines (intensity 0.15)
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1.2);
    }

    // 2. 60Hz Phosphor flicker & luminance jitter
    const flickerAlpha = 0.025 + (Math.sin(globalTime * 60) * 0.015) + (Math.random() * 0.01);
    ctx.fillStyle = `rgba(0, 255, 170, ${flickerAlpha})`;
    ctx.fillRect(0, 0, w, h);

    // 3. Scanline jitter glitch (when transitioning)
    if (isGlitching) {
      const glitchSlices = 4;
      for (let i = 0; i < glitchSlices; i++) {
        const sliceY = Math.random() * (h - 30);
        const sliceH = 8 + Math.random() * 20;
        const shiftX = (Math.random() - 0.5) * 24;
        ctx.drawImage(canvas, 0, sliceY, w, sliceH, shiftX, sliceY, w, sliceH);
      }
      // Chromatic RGB aberration split
      ctx.fillStyle = 'rgba(255, 0, 80, 0.08)';
      ctx.fillRect(2, 0, w, h);
      ctx.fillStyle = 'rgba(0, 230, 255, 0.08)';
      ctx.fillRect(-2, 0, w, h);
    }

    // 4. Vignette / edge shadows
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.85);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 10, 5, 0.65)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
  }

  // --- MAIN ANIMATION LOOP ---
  function loop(timestamp) {
    if (!canvas || !ctx) return;
    globalTime = timestamp * 0.001;

    // Check glitch countdown
    if (isGlitching) {
      glitchTimer -= 0.016;
      if (glitchTimer <= 0) isGlitching = false;
    }

    // Clear Canvas with Soviet deep dark CRT green
    ctx.fillStyle = '#010e07';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw 3D Perspective Grid
    drawPerspectiveGrid(canvasW, canvasH, globalTime);

    // Current Node data
    const node = STORY_NODES[currentNodeId] || STORY_NODES.intro;

    // Draw Vector Wireframe Hologram on top-right
    const holoX = canvasW - 110;
    const holoY = 130;
    drawHologramObject(node.hologram, holoX, holoY, 90, globalTime);

    // Render Typewriter Text Buffer
    renderTextBuffer(node, canvasW, canvasH);

    // CRT Post-processing Pass
    applyCrtPostProcessing(canvasW, canvasH);

    animFrameId = requestAnimationFrame(loop);
  }

  // --- TYPEWRITER ADVANCER ---
  function startTypewriter(node) {
    typeCharIndex = 0;
    fullTextRendered = false;
    clearInterval(typeTimer);

    // Total characters count
    let totalChars = 0;
    node.lines.forEach(l => { totalChars += l.text.length + 1; });

    typeTimer = setInterval(() => {
      if (isPaused) return;
      typeCharIndex += 3;
      if (typeCharIndex % 12 === 0) playKeyClick();
      if (typeCharIndex >= totalChars) {
        typeCharIndex = totalChars;
        fullTextRendered = true;
        clearInterval(typeTimer);
      }
    }, 20);
  }

  function skipTypewriter() {
    const node = STORY_NODES[currentNodeId] || STORY_NODES.intro;
    let totalChars = 0;
    node.lines.forEach(l => { totalChars += l.text.length + 1; });
    typeCharIndex = totalChars;
    fullTextRendered = true;
    clearInterval(typeTimer);
  }

  // --- NODE TRANSITIONS ---
  function goToNode(nodeId) {
    if (nodeId === 'finish') {
      finishStoryMode();
      return;
    }

    const nextNode = STORY_NODES[nodeId];
    if (!nextNode) return;

    currentNodeId = nodeId;
    localStorage.setItem('samosbor_story_active_node', nodeId);

    // Trigger glitch & SFX
    isGlitching = true;
    glitchTimer = 0.28;
    playGlitchSfx();

    startTypewriter(nextNode);
    renderChoicesUI(nextNode);
  }

  function renderChoicesUI(node) {
    const container = document.getElementById('story-choices-container');
    if (!container) return;
    container.innerHTML = '';

    node.choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.className = 'story-choice-btn';
      btn.innerHTML = `<span class="story-choice-num">[${idx + 1}]</span> ${choice.label.replace(/^\[\d+\]\s*/, '')}`;
      btn.onclick = () => {
        playConfirmSfx();
        goToNode(choice.target);
      };
      container.appendChild(btn);
    });
  }

  // --- FINISH STORY & REWARDS ---
  function finishStoryMode() {
    localStorage.setItem('samosbor_story_completed', 'true');
    localStorage.removeItem('samosbor_story_active_node');
    currentNodeId = 'intro';

    // Award supply talons & log entry if in main game
    if (typeof clientMe !== 'undefined' && clientMe) {
      const rewardTalons = 150;
      clientMe.score = (clientMe.score || 0) + rewardTalons;
      if (typeof addNotebookEntry === 'function') {
        addNotebookEntry(`[С.С.Р.С.] Симуляция «Хроники Гигахруща» успешно пройдена. Получено снабжение: +${rewardTalons} талонов.`);
      }
      if (typeof updateUI === 'function') {
        updateUI(clientMe, window.sectorPlayers || []);
      }
      if (typeof socket !== 'undefined' && socket && socket.connected) {
        socket.emit('claimStoryReward', { reward: rewardTalons });
      }
    }

    closeStorySimulationModal();

    if (typeof showFloatingCombatText === 'function') {
      showFloatingCombatText('+150 ТАЛОНОВ [С.С.Р.С. ПРОЙДЕН]', '#00ffaa');
    }
  }

  // --- PAUSE & MENU HOOKS ---
  function togglePause() {
    isPaused = !isPaused;
    const overlay = document.getElementById('story-pause-overlay');
    if (overlay) {
      overlay.style.display = isPaused ? 'flex' : 'none';
    }
  }

  function resumeSimulation() {
    isPaused = false;
    const overlay = document.getElementById('story-pause-overlay');
    if (overlay) overlay.style.display = 'none';
    playConfirmSfx();
  }

  function restartSimulation() {
    localStorage.removeItem('samosbor_story_active_node');
    isPaused = false;
    const overlay = document.getElementById('story-pause-overlay');
    if (overlay) overlay.style.display = 'none';
    goToNode('intro');
  }

  // --- MODAL CONTROLS ---
  function openStoryModal() {
    const modal = document.getElementById('story-simulation-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    isPaused = false;

    // Setup Canvas
    canvas = document.getElementById('story-canvas');
    if (canvas) {
      ctx = canvas.getContext('2d');
      // Set internal resolution
      canvas.width = canvasW;
      canvas.height = canvasH;
    }

    initStoryEngine();
    const node = STORY_NODES[currentNodeId] || STORY_NODES.intro;
    startTypewriter(node);
    renderChoicesUI(node);

    if (!animFrameId) {
      animFrameId = requestAnimationFrame(loop);
    }
  }

  function closeStoryModal() {
    const modal = document.getElementById('story-simulation-modal');
    if (modal) modal.style.display = 'none';
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    clearInterval(typeTimer);
    isPaused = false;
  }

  // --- KEYBOARD LISTENER HOOK ---
  window.addEventListener('keydown', function(e) {
    const modal = document.getElementById('story-simulation-modal');
    if (!modal || modal.style.display === 'none') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      togglePause();
      return;
    }

    if (isPaused) return;

    // Skip typewriter with Space or Enter
    if (e.key === ' ' || e.key === 'Enter') {
      if (!fullTextRendered) {
        e.preventDefault();
        skipTypewriter();
        return;
      }
      // If credits, space advances to finish
      if (currentNodeId === 'credits') {
        e.preventDefault();
        finishStoryMode();
        return;
      }
    }

    // Number keys for choices
    const node = STORY_NODES[currentNodeId];
    if (node && node.choices) {
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= node.choices.length) {
        e.preventDefault();
        playConfirmSfx();
        goToNode(node.choices[num - 1].target);
      }
    }
  });

  // --- EXPORT TO WINDOW ---
  window.openStorySimulationModal = openStoryModal;
  window.closeStorySimulationModal = closeStoryModal;
  window.storyTogglePause = togglePause;
  window.storyResume = resumeSimulation;
  window.storyRestart = restartSimulation;

})(window);
