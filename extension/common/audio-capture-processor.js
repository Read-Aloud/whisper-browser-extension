
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    this.buffer = new Float32Array(16000)
    this.index = 0
  }
  process(inputs, outputs, parameters) {
    inputs[0][0]
    return true
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor)
