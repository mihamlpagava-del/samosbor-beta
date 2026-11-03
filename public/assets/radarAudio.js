/**
 * ============================================================================
 * MODULE: radarAudio.js (Procedural Web Audio API Synthesizer)
 * ============================================================================
 * Generates all sound effects procedurally via AudioContext:
 * - Melee swing / impact
 * - Gunshots (pistol, shotgun, rifle, pulse)
 * - Looting & supply pickup chimes
 * - Door hydraulics & iron clangs
 * - Monster roars, bites & acid splats
 * - Radar ping & extraction countdown beeps
 * - Samosbor alarm siren
 */

(function (global) {
  'use strict';

  class RadarAudioSynth {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.isMuted = false;
    }

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
          this.masterGain.connect(this.ctx.destination);
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    }

    playMeleeSwing() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      // White noise through falling bandpass filter for whoosh
      const bufferSize = ctx.sampleRate * 0.15;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, t);
      filter.frequency.exponentialRampToValueAtTime(180, t + 0.14);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.14);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      noise.start(t);
    }

    playMeleeHit() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      // Low punch thump + metal impact
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.8, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.13);
    }

    /**
     * Boomer Shooter Hit Confirmation Tick
     */
    playHitmarkerTick() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, t);
      osc.frequency.exponentialRampToValueAtTime(1400, t + 0.04);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2000, t);
      filter.Q.setValueAtTime(4.0, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.65, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.05);
    }

    playGunshot(type = 'pistol') {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const isShotgun = (type === 'shotgun');

      // 1. Noise transient punch
      const duration = isShotgun ? 0.35 : 0.22;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = isShotgun ? 'lowpass' : 'bandpass';
      filter.frequency.setValueAtTime(isShotgun ? 1200 : 2400, t);
      filter.frequency.exponentialRampToValueAtTime(200, t + duration);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(isShotgun ? 1.0 : 0.7, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + duration);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      noise.start(t);

      // 2. Low-end body kick
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isShotgun ? 180 : 280, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + (isShotgun ? 0.2 : 0.12));

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.9, t);
      oscGain.gain.exponentialRampToValueAtTime(0.01, t + (isShotgun ? 0.2 : 0.12));

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + (isShotgun ? 0.21 : 0.13));
    }

    playLootPickup() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      // High chime chord (Arpeggio: 587Hz -> 880Hz -> 1174Hz)
      [587, 880, 1174].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + idx * 0.05);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.3, t + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.05 + 0.18);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(t + idx * 0.05);
        osc.stop(t + idx * 0.05 + 0.2);
      });
    }

    playDoorToggle(isOpen) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      // Pneumatic release hiss
      const bufferSize = Math.floor(ctx.sampleRate * 0.25);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(isOpen ? 600 : 1200, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.24);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.start(t);

      // Heavy clank
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(isOpen ? 110 : 85, t + 0.08);

      const clankGain = ctx.createGain();
      clankGain.gain.setValueAtTime(0.4, t + 0.08);
      clankGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(clankGain);
      clankGain.connect(this.masterGain);
      osc.start(t + 0.08);
      osc.stop(t + 0.23);
    }

    playMonsterHurt() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.linearRampToValueAtTime(80, t + 0.16);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.45, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.16);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.17);
    }

    /**
     * Visceral Player Damage Impact:
     * Heavy blunt-force trauma thud, ceramic armor crunch, muffled gas mask grunt, and tinnitus ring
     */
    playPlayerHurt(heavy = false) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;

      // 1. Heavy Sub-bass Flesh/Armor Thud (160Hz -> 36Hz)
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(160, t);
      subOsc.frequency.exponentialRampToValueAtTime(36, t + 0.22);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.85, t);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      subOsc.connect(subGain);
      subGain.connect(this.masterGain);
      subOsc.start(t);
      subOsc.stop(t + 0.25);

      // 2. Ballistic Armor / Bone Impact Transient (Resonant noise burst)
      const noiseLen = 0.08;
      const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseLen), ctx.sampleRate);
      const nData = noiseBuf.getChannelData(0);
      for (let i = 0; i < nData.length; i++) {
        nData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
      }
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuf;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(1400, t);
      noiseFilter.Q.setValueAtTime(3.5, t);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.7, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + noiseLen);
      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      noiseSource.start(t);

      // 3. Muffled Gas Mask Grunt / Breath Intake (Vocal Formant 360Hz -> 140Hz)
      const gruntOsc = ctx.createOscillator();
      gruntOsc.type = 'triangle';
      gruntOsc.frequency.setValueAtTime(340, t + 0.02);
      gruntOsc.frequency.exponentialRampToValueAtTime(110, t + 0.26);
      const gruntGain = ctx.createGain();
      gruntGain.gain.setValueAtTime(0.45, t + 0.02);
      gruntGain.gain.exponentialRampToValueAtTime(0.001, t + 0.27);
      gruntOsc.connect(gruntGain);
      gruntGain.connect(this.masterGain);
      gruntOsc.start(t + 0.02);
      gruntOsc.stop(t + 0.28);

      // 4. Critical Damage Tinnitus Ring on heavy hits
      if (heavy) {
        const tinOsc = ctx.createOscillator();
        tinOsc.type = 'sine';
        tinOsc.frequency.setValueAtTime(3450, t + 0.05);
        const tinGain = ctx.createGain();
        tinGain.gain.setValueAtTime(0.18, t + 0.05);
        tinGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        tinOsc.connect(tinGain);
        tinGain.connect(this.masterGain);
        tinOsc.start(t + 0.05);
        tinOsc.stop(t + 0.76);
      }
    }

    playAcidSpit() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.18);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.19);
    }

    playCountdownBeep(high = false) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(high ? 1440 : 880, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.09);
    }

    playSamosborAlarm() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, t);
      osc.frequency.linearRampToValueAtTime(440, t + 0.4);
      osc.frequency.linearRampToValueAtTime(280, t + 0.8);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.8);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.82);
    }

    /**
     * Soviet Military AI-2 Medkit / Auto-injector Audio Sequence:
     * 1. Orange plastic case latch click
     * 2. High-pressure pneumatic syringe trigger
     * 3. Pressurized medicinal aerosol gas hiss
     * 4. Resonant biosensor vital-sign chimes
     * 5. Stabilized respirator exhale
     */
    playHeal() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;

      // 1. Mechanical Pouch / Case Latch Snap (t)
      const snapOsc = ctx.createOscillator();
      snapOsc.type = 'triangle';
      snapOsc.frequency.setValueAtTime(2200, t);
      snapOsc.frequency.exponentialRampToValueAtTime(320, t + 0.035);
      const snapGain = ctx.createGain();
      snapGain.gain.setValueAtTime(0.5, t);
      snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      snapOsc.connect(snapGain);
      snapGain.connect(this.masterGain);
      snapOsc.start(t);
      snapOsc.stop(t + 0.045);

      // 2. Pneumatic Auto-injector Spring Click (t + 0.06)
      const clickOsc = ctx.createOscillator();
      clickOsc.type = 'sine';
      clickOsc.frequency.setValueAtTime(3100, t + 0.06);
      clickOsc.frequency.exponentialRampToValueAtTime(450, t + 0.11);
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0.65, t + 0.06);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      clickOsc.connect(clickGain);
      clickGain.connect(this.masterGain);
      clickOsc.start(t + 0.06);
      clickOsc.stop(t + 0.13);

      // 3. Pressurized Medicinal Gas Hiss (t + 0.10)
      const hissLen = 0.42;
      const hissBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * hissLen), ctx.sampleRate);
      const hData = hissBuf.getChannelData(0);
      for (let i = 0; i < hData.length; i++) {
        hData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.18));
      }
      const hissSource = ctx.createBufferSource();
      hissSource.buffer = hissBuf;
      const hissFilter = ctx.createBiquadFilter();
      hissFilter.type = 'bandpass';
      hissFilter.frequency.setValueAtTime(2600, t + 0.1);
      hissFilter.frequency.exponentialRampToValueAtTime(800, t + 0.1 + hissLen);
      hissFilter.Q.setValueAtTime(2.2, t + 0.1);
      const hissGain = ctx.createGain();
      hissGain.gain.setValueAtTime(0.42, t + 0.1);
      hissGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1 + hissLen);
      hissSource.connect(hissFilter);
      hissFilter.connect(hissGain);
      hissGain.connect(this.masterGain);
      hissSource.start(t + 0.1);

      // 4. Biosensor Harmonic Recovery Chimes (C5, E5, G5, C6) (t + 0.22)
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        const chimeStart = t + 0.22 + idx * 0.065;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, chimeStart);
        gain.gain.setValueAtTime(0.25, chimeStart);
        gain.gain.exponentialRampToValueAtTime(0.0005, chimeStart + 0.28);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(chimeStart);
        osc.stop(chimeStart + 0.29);
      });
    }

    playMedkit() {
      this.playHeal();
    }

    /**
     * Supersonic bullet near-miss whiz & crack
     */
    playBulletWhiz(pan = 0) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const dest = this.createSpatialNode(pan, 0.55);
      if (!dest) return;

      // Doppler sweep 2800Hz -> 520Hz
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(2800, t);
      osc.frequency.exponentialRampToValueAtTime(520, t + 0.11);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.55, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + 0.13);
    }

    /**
     * Metallic deflection ping when armor deflects a bullet
     */
    playArmorDeflect(pan = 0) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const dest = this.createSpatialNode(pan, 0.6);
      if (!dest) return;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1750, t);
      osc.frequency.exponentialRampToValueAtTime(980, t + 0.18);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.65, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + 0.21);
    }

    /**
     * Visceral binaural heartbeat when health is critical (HP < 30%)
     */
    playLowHealthHeartbeat() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      // Double thump: lub (t) - DUB (t + 0.11)
      [0, 0.11].forEach((delay, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const startFreq = idx === 0 ? 68 : 82;
        osc.frequency.setValueAtTime(startFreq, t + delay);
        osc.frequency.exponentialRampToValueAtTime(34, t + delay + 0.12);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(idx === 0 ? 0.65 : 0.85, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.14);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t + delay);
        osc.stop(t + delay + 0.15);
      });
    }

    /**
     * Screech of anomalous Flying Skull Boss
     */
    playBossScreech() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';

      osc1.frequency.setValueAtTime(650, t);
      osc1.frequency.linearRampToValueAtTime(1450, t + 0.2);
      osc1.frequency.exponentialRampToValueAtTime(380, t + 0.65);

      osc2.frequency.setValueAtTime(658, t); // Detuned for ghastly chorusing
      osc2.frequency.linearRampToValueAtTime(1468, t + 0.2);
      osc2.frequency.exponentialRampToValueAtTime(372, t + 0.65);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.68);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.masterGain);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.7);
      osc2.stop(t + 0.7);
    }

    /**
     * CRT TV Switch ON / OFF sound (Cathode ray tube magnetic discharge, whine & pop)
     */
    playCrtSwitch(turnOn = false) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      if (turnOn) {
        // High voltage power-on whine: 400Hz -> 15734Hz (NTSC line frequency) + degauss thud
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(7800, t + 0.28);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.33);
      } else {
        // Collapse pop & dying discharge
        const popOsc = ctx.createOscillator();
        popOsc.type = 'triangle';
        popOsc.frequency.setValueAtTime(180, t);
        popOsc.frequency.exponentialRampToValueAtTime(30, t + 0.16);
        const popGain = ctx.createGain();
        popGain.gain.setValueAtTime(0.6, t);
        popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        popOsc.connect(popGain);
        popGain.connect(this.masterGain);
        popOsc.start(t);
        popOsc.stop(t + 0.2);

        // Dying static click
        const clickOsc = ctx.createOscillator();
        clickOsc.type = 'sine';
        clickOsc.frequency.setValueAtTime(2400, t + 0.12);
        clickOsc.frequency.exponentialRampToValueAtTime(120, t + 0.24);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.3, t + 0.12);
        clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        clickOsc.connect(clickGain);
        clickGain.connect(this.masterGain);
        clickOsc.start(t + 0.12);
        clickOsc.stop(t + 0.26);
      }
    }

    playBuzzer() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.linearRampToValueAtTime(95, t + 0.22);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.23);
    }

    /**
     * Create Spatial Audio routing node with Stereo Panning & Distance Attenuation
     */
    createSpatialNode(pan = 0, volume = 1.0) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return null;

      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(Math.max(0.01, Math.min(1.0, volume)), t);

      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        const clampedPan = Math.max(-1.0, Math.min(1.0, pan));
        panner.pan.setValueAtTime(clampedPan, t);
        gain.connect(panner);
        panner.connect(this.masterGain);
      } else {
        gain.connect(this.masterGain);
      }
      return gain;
    }

    /**
     * Metallic brass shell casing bouncing and settling on concrete floor
     */
    playShellCasingDrop(pan = 0.35) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const dest = this.createSpatialNode(pan, 0.45);
      if (!dest) return;

      const t = ctx.currentTime;
      // High pitch metallic clinks (bounce 1 and bounce 2)
      [0, 0.08, 0.15].forEach((delay, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const baseFreq = 2200 + Math.random() * 400 - idx * 250;
        osc.frequency.setValueAtTime(baseFreq, t + delay);
        osc.frequency.exponentialRampToValueAtTime(1400, t + delay + 0.04);

        const gain = ctx.createGain();
        const vol = 0.35 / (idx + 1);
        gain.gain.setValueAtTime(vol, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.045);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(t + delay);
        osc.stop(t + delay + 0.05);
      });
    }

    /**
     * Weapon Reload: magazine release click, insert & slide/bolt rack
     */
    playWeaponReload() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      // 1. Magazine release click (t + 0.1)
      const osc1 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(320, t + 0.1);
      osc1.frequency.exponentialRampToValueAtTime(90, t + 0.18);
      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.4, t + 0.1);
      g1.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
      osc1.connect(g1);
      g1.connect(this.masterGain);
      osc1.start(t + 0.1);
      osc1.stop(t + 0.19);

      // 2. Fresh magazine insertion clack (t + 0.55)
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(240, t + 0.55);
      osc2.frequency.exponentialRampToValueAtTime(60, t + 0.65);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.5, t + 0.55);
      g2.gain.exponentialRampToValueAtTime(0.01, t + 0.65);
      osc2.connect(g2);
      g2.connect(this.masterGain);
      osc2.start(t + 0.55);
      osc2.stop(t + 0.66);

      // 3. Bolt / Slide rack metallic pull & snap (t + 0.9)
      const osc3 = ctx.createOscillator();
      osc3.type = 'sawtooth';
      osc3.frequency.setValueAtTime(580, t + 0.9);
      osc3.frequency.linearRampToValueAtTime(1100, t + 0.98);
      osc3.frequency.exponentialRampToValueAtTime(180, t + 1.08);
      const g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.45, t + 0.9);
      g3.gain.exponentialRampToValueAtTime(0.01, t + 1.08);
      osc3.connect(g3);
      g3.connect(this.masterGain);
      osc3.start(t + 0.9);
      osc3.stop(t + 1.1);
    }

    /**
     * Quick Melee Kick: swift swoosh followed by heavy boot impact
     */
    playKickMelee(hit = false) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      // Air swoosh
      const bufSize = Math.floor(ctx.sampleRate * 0.14);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(650, t);
      filter.frequency.exponentialRampToValueAtTime(140, t + 0.13);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.6, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.13);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.start(t);

      // Impact thud
      if (hit) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(130, t + 0.08);
        osc.frequency.exponentialRampToValueAtTime(32, t + 0.22);
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0.9, t + 0.08);
        hg.gain.exponentialRampToValueAtTime(0.01, t + 0.22);
        osc.connect(hg);
        hg.connect(this.masterGain);
        osc.start(t + 0.08);
        osc.stop(t + 0.23);
      }
    }

    /**
     * Spatial Monster Hurt Groan
     */
    playSpatialMonsterHurt(pan = 0, distFactor = 1.0) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const dest = this.createSpatialNode(pan, distFactor * 0.7);
      if (!dest) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.linearRampToValueAtTime(75, t + 0.18);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + 0.19);
    }

    /**
     * Spatial Acid Spit Splat
     */
    playSpatialAcidSpit(pan = 0, distFactor = 1.0) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const dest = this.createSpatialNode(pan, distFactor * 0.6);
      if (!dest) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.2);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + 0.21);
    }

    /**
     * Spatial Door Pneumatic Clank
     */
    playSpatialDoor(pan = 0, distFactor = 1.0, isOpen = true) {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const dest = this.createSpatialNode(pan, distFactor * 0.75);
      if (!dest) return;

      const t = ctx.currentTime;
      const bufSize = Math.floor(ctx.sampleRate * 0.22);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(isOpen ? 550 : 1100, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      noise.start(t);

      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(isOpen ? 115 : 80, t + 0.06);
      const clankGain = ctx.createGain();
      clankGain.gain.setValueAtTime(0.45, t + 0.06);
      clankGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(clankGain);
      clankGain.connect(dest);
      osc.start(t + 0.06);
      osc.stop(t + 0.23);
    }

    /**
     * Keycard Access Granted / Denied Chimes
     */
    playKeycardUnlock() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;
      const t = ctx.currentTime;
      [880, 1320, 1760].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + idx * 0.06);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3, t + idx * 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.06 + 0.12);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t + idx * 0.06);
        osc.stop(t + idx * 0.06 + 0.13);
      });
    }

    playDoorDenied() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;
      const t = ctx.currentTime;
      [180, 150].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t + idx * 0.1);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35, t + idx * 0.1);
        g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.1 + 0.12);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t + idx * 0.1);
        osc.stop(t + idx * 0.1 + 0.13);
      });
    }

    playWeaponSwitch() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(320, t + 0.07);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.07);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.08);
    }

    playWinchFailure() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(950, t);
      osc1.frequency.exponentialRampToValueAtTime(140, t + 0.65);
      gain1.gain.setValueAtTime(0.45, t);
      gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.7);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(260, t);
      osc2.frequency.exponentialRampToValueAtTime(45, t + 0.9);
      gain2.gain.setValueAtTime(0.55, t);
      gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.95);

      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);

      osc1.start(t);
      osc1.stop(t + 0.7);
      osc2.start(t);
      osc2.stop(t + 0.95);

      setTimeout(() => {
        this.playSamosborAlarm();
      }, 350);
    }

    playPneumaticHorn() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(185, t);
      osc.frequency.setValueAtTime(185, t + 0.8);
      osc.frequency.exponentialRampToValueAtTime(140, t + 1.6);

      osc2.type = 'square';
      osc2.frequency.setValueAtTime(277.5, t);
      osc2.frequency.setValueAtTime(277.5, t + 0.8);
      osc2.frequency.exponentialRampToValueAtTime(210, t + 1.6);

      gain.gain.setValueAtTime(0.4, t);
      gain.gain.setValueAtTime(0.4, t + 1.0);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.7);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 1.7);
      osc2.start(t);
      osc2.stop(t + 1.7);
    }

    playBarricadeConstruct() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.12);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.13);
    }

    playBarricadeHit() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.19);
    }

    playBarrelExplosion() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(25, t + 0.8);
      gain.gain.setValueAtTime(0.65, t);
      gain.gain.exponentialRampToValueAtTime(0.005, t + 0.85);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.85);
    }


    playTapeRecorderAudio() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;

      // Mechanical cassette click
      const clickOsc = ctx.createOscillator();
      const clickGain = ctx.createGain();
      clickOsc.type = 'square';
      clickOsc.frequency.setValueAtTime(1400, t);
      clickOsc.frequency.exponentialRampToValueAtTime(120, t + 0.05);
      clickGain.gain.setValueAtTime(0.35, t);
      clickGain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
      clickOsc.connect(clickGain);
      clickGain.connect(this.masterGain);
      clickOsc.start(t);
      clickOsc.stop(t + 0.06);

      // White noise / Radio static tape hiss burst
      const bufferSize = ctx.sampleRate * 0.8;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.18;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(1800, t);
      noiseFilter.Q.setValueAtTime(3.0, t);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.01, t);
      noiseGain.gain.linearRampToValueAtTime(0.28, t + 0.08);
      noiseGain.gain.setValueAtTime(0.22, t + 0.5);
      noiseGain.gain.exponentialRampToValueAtTime(0.005, t + 0.8);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      noise.start(t + 0.04);
      noise.stop(t + 0.82);

      // Low garbled synthetic transmission voice tone
      const voiceOsc = ctx.createOscillator();
      const voiceGain = ctx.createGain();
      voiceOsc.type = 'sawtooth';
      voiceOsc.frequency.setValueAtTime(220, t + 0.1);
      voiceOsc.frequency.linearRampToValueAtTime(340, t + 0.35);
      voiceOsc.frequency.linearRampToValueAtTime(190, t + 0.7);
      voiceGain.gain.setValueAtTime(0.12, t + 0.1);
      voiceGain.gain.exponentialRampToValueAtTime(0.01, t + 0.75);
      voiceOsc.connect(voiceGain);
      voiceGain.connect(this.masterGain);
      voiceOsc.start(t + 0.1);
      voiceOsc.stop(t + 0.75);
    }

    playElectricArc() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;

      // Harsh electrical zap / spark crackle
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(2400, t);
      osc.frequency.linearRampToValueAtTime(180, t + 0.12);
      gain.gain.setValueAtTime(0.45, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.14);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.14);

      // Secondary low buzz hum
      const hum = ctx.createOscillator();
      const humGain = ctx.createGain();
      hum.type = 'square';
      hum.frequency.setValueAtTime(100, t);
      humGain.gain.setValueAtTime(0.25, t);
      humGain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
      hum.connect(humGain);
      humGain.connect(this.masterGain);
      hum.start(t);
      hum.stop(t + 0.18);
    }

    playBreakerSwitch() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;

      // Heavy industrial toggle clunk
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.1);
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.12);
    }

    playTentacleTrap() {
      if (!this.soundEnabled || !this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;

      // Wet fleshy squelch & slither
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.25);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.28);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.28);
    }

  }



  global.RadarAudio = new RadarAudioSynth();
})(typeof window !== 'undefined' ? window : this);

