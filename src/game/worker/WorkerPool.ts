export type WorkerMessage = any;

export class WorkerPool<TPayload extends object = any, TResult = any> {
  private workers: Worker[] = [];
  private queue: Array<{ payload: TPayload; resolve: (r: TResult) => void; reject: (e: any) => void } > = [];
  private idle: Worker[] = [];

  constructor(workerUrl: URL, size: number = Math.max(1, navigator.hardwareConcurrency ? Math.floor(navigator.hardwareConcurrency / 2) : 2)) {
    const n = Math.max(1, Math.min(8, size));
    for (let i = 0; i < n; i++) {
      const w = new Worker(workerUrl, { type: 'module' });
      w.onmessage = (ev) => this.onWorkerMessage(w, ev);
      w.onerror = (err) => this.onWorkerError(w, err);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    this.queue.length = 0;
  }

  run(payload: TPayload): Promise<TResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      // Attach a one-off handler via property bag
      (w as any).__currentJob = job;
      w.postMessage(job.payload);
    }
  }

  private onWorkerMessage(w: Worker, ev: MessageEvent) {
    const job = (w as any).__currentJob;
    (w as any).__currentJob = null;
    this.idle.push(w);
    try { job?.resolve(ev.data as TResult); } catch (e) { job?.reject(e); }
    this.pump();
  }

  private onWorkerError(w: Worker, err: ErrorEvent) {
    const job = (w as any).__currentJob;
    (w as any).__currentJob = null;
    this.idle.push(w);
    job?.reject(err);
    this.pump();
  }
}
