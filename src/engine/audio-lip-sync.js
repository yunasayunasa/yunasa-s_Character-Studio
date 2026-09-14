export class AudioLipSync {
  constructor(audioElement, onLevel) {
    this.audio = audioElement;
    this.onLevel = onLevel;
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.samples = null;
    this.frame = null;
    this.objectUrl = null;
    this.update = this.update.bind(this);
  }

  load(file) {
    this.stop();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.audio.src = this.objectUrl;
    this.audio.hidden = false;
    this.audio.load();
  }

  async start() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("このブラウザは Web Audio API に対応していません");
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.68;
      this.samples = new Uint8Array(this.analyser.fftSize);
      this.source = this.context.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    if (!this.frame) this.frame = requestAnimationFrame(this.update);
  }

  update() {
    if (!this.analyser || this.audio.paused || this.audio.ended) {
      this.onLevel(0);
      this.frame = null;
      return;
    }
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / this.samples.length);
    this.onLevel(Math.min(1, Math.max(0, (rms - 0.018) * 7.5)));
    this.frame = requestAnimationFrame(this.update);
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.onLevel(0);
  }
}
