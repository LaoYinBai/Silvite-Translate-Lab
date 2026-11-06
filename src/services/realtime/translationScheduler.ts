import type { RealtimeTranslationHandlers, RealtimeTranslationResult } from '../../api/realtimeClient';

export interface TranslationJob {
  utteranceId: string;
  revision: number;
  stage: 'provisional' | 'confirmed';
  run(signal: AbortSignal, handlers: RealtimeTranslationHandlers): Promise<RealtimeTranslationResult>;
  onStart(): void;
  onReset(reason?: 'generation' | 'invalid'): void;
  onDelta(text: string): void;
  onComplete(result: RealtimeTranslationResult): void;
  onError(error: unknown): void;
}

/** Finals are ordered; provisional jobs are replaceable complete source snapshots. */
export class RealtimeTranslationScheduler {
  private finals: TranslationJob[] = [];
  private drafts = new Map<string, TranslationJob>();
  private active: { job: TranslationJob; controller: AbortController } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastDraftStartedAt = -Infinity;
  private disposed = false;
  private idleWaiters: Array<() => void> = [];
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(intervalMs: number, now = () => performance.now()) { this.intervalMs = intervalMs; this.now = now; }

  get pendingFinals() { return this.finals.length + (this.active?.job.stage === 'confirmed' ? 1 : 0); }

  submit(job: TranslationJob) {
    if (this.disposed) return;
    if (job.stage === 'confirmed') {
      if (this.finals.some((item) => item.utteranceId === job.utteranceId)
        || this.active?.job.stage === 'confirmed' && this.active.job.utteranceId === job.utteranceId) return;
      this.drafts.delete(job.utteranceId);
      this.finals.push(job);
      // A final does not wait for an obsolete draft, even with a provider that ignores abort.
      if (this.active?.job.stage === 'provisional') {
        const interrupted = this.active.job;
        // Retrying an older final may interrupt the current, different sentence.
        // Keep that sentence's latest snapshot so its draft resumes afterward.
        if (interrupted.utteranceId !== job.utteranceId && !this.drafts.has(interrupted.utteranceId)) {
          this.drafts.set(interrupted.utteranceId, interrupted);
        }
        this.cancelActive();
      }
    } else {
      this.drafts.set(job.utteranceId, job);
    }
    this.pump();
  }

  discardDraft(utteranceId: string) {
    this.drafts.delete(utteranceId);
    if (this.active?.job.stage === 'provisional' && this.active.job.utteranceId === utteranceId) this.cancelActive();
    this.pump();
  }

  whenIdle(): Promise<void> {
    if (!this.active && !this.finals.length && !this.drafts.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
    this.finals = [];
    this.drafts.clear();
    this.cancelActive();
    this.notifyIdle();
  }

  private cancelActive() {
    const active = this.active;
    this.active = null;
    active?.controller.abort(new DOMException('Translation superseded', 'AbortError'));
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private pump() {
    this.clearTimer();
    if (this.disposed || this.active) return;
    let job = this.finals.shift();
    if (!job && this.drafts.size) {
      const delay = this.intervalMs - (this.now() - this.lastDraftStartedAt);
      if (delay > 0) {
        this.timer = setTimeout(() => { this.timer = null; this.pump(); }, delay);
        return;
      }
      job = this.drafts.values().next().value;
      if (job) this.drafts.delete(job.utteranceId);
    }
    if (!job) { this.notifyIdle(); return; }
    if (job.stage === 'provisional') this.lastDraftStartedAt = this.now();
    const active = { job, controller: new AbortController() };
    this.active = active;
    const live = () => !this.disposed && this.active === active && !active.controller.signal.aborted;
    job.onStart();
    // The active identity gates callbacks as well as promise completion.
    void Promise.resolve().then(() => live() ? active.job.run(active.controller.signal, {
      onReset: (reason) => { if (live()) active.job.onReset(reason); },
      onDelta: (text) => { if (live()) active.job.onDelta(text); },
    }) : undefined).then((result) => {
      if (live() && result) active.job.onComplete(result);
    }).catch((error: unknown) => {
      if (live()) active.job.onError(error);
    }).finally(() => {
      if (this.active === active) { this.active = null; this.pump(); }
    });
  }

  private notifyIdle() {
    if (this.active || this.finals.length || this.drafts.size) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}
