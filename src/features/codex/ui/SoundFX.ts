let canPlay = true;
try { canPlay = !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}

function play(freq = 880, dur = 0.06, type: OscillatorType = 'sine', vol = 0.02){
  if (!canPlay) return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, Math.round(dur*1000));
  } catch {}
}

export const SoundFX = {
  hover(){ play(1200, 0.04, 'triangle', 0.015); },
  click(){ play(600, 0.06, 'square', 0.03); },
  confirm(){ play(960, 0.08, 'sawtooth', 0.03); }
};

export default SoundFX;
