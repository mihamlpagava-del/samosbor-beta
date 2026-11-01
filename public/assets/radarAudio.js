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

    playPlayerHurt() {
      const ctx = this.ensureContext();
      if (!ctx || this.isMuted) return;

      const t = ctx.currentTime;
      // Low grunt + static burst
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(95, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.2);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.21);
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
  }

  global.RadarAudio = new RadarAudioSynth();
})(typeof window !== 'undefined' ? window : this);
