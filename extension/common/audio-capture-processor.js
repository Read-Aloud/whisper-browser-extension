
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    this.port.onmessage = function(message) {
      if (message.method == "start") {
        this.session = makeSession(message.sessionId, this.port)
      }
      else if (message.method == "finish") {
        this.session.flush()
        this.session = null
      }
    }
  }
  process(inputs) {
    if (this.session) {
      this.session.append(inputs[0][0])
    }
    return true
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor)



function makeSession(sessionId, port) {
  const chunkSize = 16000
  let chunk = new Float32Array(chunkSize)
  let index = 0
  return {
    append(samples) {
      const available = Math.min(samples.length, chunk.length - index)
      if (available) {
        chunk.set(samples.subarray(0, available), index)
        index += available
      }
      if (index >= chunk.length) {
        this.flush()
      }
      if (available < samples.length) {
        const remainder = samples.subarray(available)
        chunk.set(remainder, index)
        index += remainder.length
      }
    },
    flush() {
      if (index) {
        port.postMessage({sessionId, type: "chunk", chunk}, [chunk.buffer])
        chunk = new Float32Array(chunkSize)
        index = 0
      }
    }
  }
}
