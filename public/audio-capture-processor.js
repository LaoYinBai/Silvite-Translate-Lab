class SilviteAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.blockSize = Math.max(128, Math.round(sampleRate * 0.04));
    this.startedAt = currentTime;
    this.paused = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flush-complete' });
      } else if (data?.type === 'pause') {
        if (data.paused) this.flush();
        this.paused = !!data.paused;
        this.startedAt = currentTime;
      }
    };
  }

  flush() {
    if (!this.pending.length) return;
    const samples = new Float32Array(this.pending);
    this.port.postMessage({
      type: 'samples', samples, sampleRate,
      startTime: this.startedAt * 1000,
      endTime: currentTime * 1000,
    }, [samples.buffer]);
    this.pending = [];
    this.startedAt = currentTime;
  }

  process(inputs) {
    if (this.paused) return true;
    const channels = inputs[0];
    if (!channels?.length) return true;
    const input = channels[0];
    for (let i = 0; i < input.length; i += 1) {
      let mono = 0;
      for (const channel of channels) mono += channel[i] || 0;
      this.pending.push(mono / channels.length);
      if (this.pending.length >= this.blockSize) this.flush();
    }
    return true;
  }
}

registerProcessor('silvite-audio-capture', SilviteAudioCaptureProcessor);
