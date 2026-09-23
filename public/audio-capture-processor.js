class SilviteAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.blockSize = 2048;
    this.startedAt = currentTime;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flush-complete' });
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
