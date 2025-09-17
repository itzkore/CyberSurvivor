// Placeholder worker for SoA updates. Not wired yet.
// eslint-disable-next-line no-restricted-globals
const ctx: any = self as any;

type SoAUpdatePayload = {
  sab?: any; // future SharedArrayBuffer handles
  dt: number;
  range: { start: number; end: number };
};

ctx.onmessage = (ev: MessageEvent<SoAUpdatePayload>) => {
  const { dt, range } = ev.data;
  // No-op for now; return ack structure
  ctx.postMessage({ ok: true, processed: range.end - range.start, dt });
};

export {};
