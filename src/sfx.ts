// Tiny procedural Game Boy / Pokémon-style sound effects.
// Web Audio API only: square/triangle oscillators with short gain envelopes.
// Every method is a safe no-op if AudioContext is unavailable or not yet unlocked.

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

const MASTER_GAIN = 0.15;

function getCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return (w.AudioContext || w.webkitAudioContext) ?? null;
}

/** Returns the context only if it exists and is running; otherwise null. */
function live(): AudioContext | null {
  if (!ctx || !master) return null;
  if (ctx.state !== 'running') {
    // Try a resume opportunistically (async), but treat as unavailable for this call.
    try { void ctx.resume().catch(() => { /* ignore */ }); } catch { /* ignore */ }
    return null;
  }
  return ctx;
}

/**
 * Play a single tone.
 * @param freq   Hz
 * @param dur    seconds
 * @param wave   oscillator type
 * @param vol    0..1 (relative to master)
 * @param at     absolute start time (ctx.currentTime based)
 * @param slideTo optional end frequency for a pitch ramp
 */
function tone(
  ac: AudioContext,
  freq: number,
  dur: number,
  wave: Wave,
  vol: number,
  at: number,
  slideTo?: number,
): void {
  try {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), at + dur);
    }
    // Snappy envelope: quick attack, hold, fast release.
    const attack = Math.min(0.005, dur * 0.2);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + attack);
    g.gain.setValueAtTime(vol, at + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    osc.onended = () => {
      try { osc.disconnect(); g.disconnect(); } catch { /* ignore */ }
    };
  } catch {
    /* never throw from sfx */
  }
}

// Note frequencies (equal temperament, A4 = 440).
const N = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, E6: 1318.51, G6: 1567.98,
  C3: 130.81, E3: 164.81, G3: 196.0, A3: 220.0,
};

export const sfx = {
  muted: false,

  /** Lazily create/resume the AudioContext. Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!ctx) {
        const Ctor = getCtor();
        if (!Ctor) return;
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = MASTER_GAIN;
        master.connect(ctx.destination);
      }
      if (ctx.state !== 'running') {
        void ctx.resume().catch(() => { /* ignore */ });
      }
    } catch {
      ctx = null;
      master = null;
    }
  },

  toggleMute(): boolean {
    sfx.muted = !sfx.muted;
    return sfx.muted;
  },

  /** Short soft blip for a footstep / successful move. */
  step(): void {
    if (sfx.muted) return;
    const ac = live();
    if (!ac) return;
    const t = ac.currentTime;
    tone(ac, N.G4, 0.06, 'square', 0.35, t, N.A4);
  },

  /** Dull thud when walking into a wall: low triangle with a pitch drop. */
  bump(): void {
    if (sfx.muted) return;
    const ac = live();
    if (!ac) return;
    const t = ac.currentTime;
    tone(ac, 180, 0.09, 'triangle', 0.9, t, 60);
    // A touch of grit on top to make it read as a knock.
    tone(ac, 120, 0.05, 'square', 0.25, t, 40);
  },

  /** Very quick high tick acknowledging a detected hand swipe. */
  swipe(): void {
    if (sfx.muted) return;
    const ac = live();
    if (!ac) return;
    const t = ac.currentTime;
    tone(ac, N.C6, 0.04, 'square', 0.3, t, N.E6);
  },

  /** Pokémon-ish ascending victory jingle, two voices (~1s). */
  win(): void {
    if (sfx.muted) return;
    const ac = live();
    if (!ac) return;
    const t = ac.currentTime;
    // Lead: square wave melody.
    const lead: Array<[number, number, number]> = [
      // [freq, startOffset, duration]
      [N.C5, 0.00, 0.11],
      [N.E5, 0.12, 0.11],
      [N.G5, 0.24, 0.11],
      [N.C6, 0.36, 0.16],
      [N.G5, 0.54, 0.10],
      [N.C6, 0.66, 0.34],
    ];
    for (const [f, off, d] of lead) tone(ac, f, d, 'square', 0.5, t + off);
    // Harmony: triangle wave a third/fifth below, slightly quieter.
    const harm: Array<[number, number, number]> = [
      [N.E4, 0.00, 0.11],
      [N.G4, 0.12, 0.11],
      [N.C5, 0.24, 0.11],
      [N.E5, 0.36, 0.16],
      [N.E5, 0.54, 0.10],
      [N.G5, 0.66, 0.34],
    ];
    for (const [f, off, d] of harm) tone(ac, f, d, 'triangle', 0.45, t + off);
    // Bass root under the final chord.
    tone(ac, N.C3, 0.34, 'triangle', 0.5, t + 0.66);
  },

  /** Short "game start" chime (3 notes). */
  start(): void {
    if (sfx.muted) return;
    const ac = live();
    if (!ac) return;
    const t = ac.currentTime;
    tone(ac, N.E5, 0.08, 'square', 0.45, t);
    tone(ac, N.G5, 0.08, 'square', 0.45, t + 0.09);
    tone(ac, N.C6, 0.18, 'square', 0.5, t + 0.18);
    tone(ac, N.C4, 0.18, 'triangle', 0.4, t + 0.18);
  },
};
