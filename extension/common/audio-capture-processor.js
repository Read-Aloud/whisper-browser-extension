
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this.port.onmessage = event => this.onMessage(event.data)
  }
  onMessage(message) {
    if (message.method == "start") {
      if (this.session) this.session.finish()
      this.session = makeSession(message.sessionId, message.chunkSize, this.port)
    }
    else if (message.method == "finish" && message.sessionId == this.session.sessionId) {
      this.session.finish()
      this.session = null
    }
  }
  process(inputs) {
    if (this.session) this.session.append(inputs[0][0])
    return true
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor)



function makeSession(sessionId, chunkSize, port) {
  let chunk = new Float32Array(chunkSize)
  let index = 0
  return {
    sessionId,
    append(samples) {
      const available = Math.min(samples.length, chunk.length - index)
      if (available) {
        chunk.set(samples.subarray(0, available), index)
        index += available
      }
      if (index == chunk.length) {
        port.postMessage({sessionId, method: "onChunk", chunk}, [chunk.buffer])
        chunk = new Float32Array(chunkSize)
        index = 0
      }
      if (available < samples.length) {
        const remainder = samples.subarray(available)
        chunk.set(remainder, index)
        index += remainder.length
      }
    },
    finish() {
      if (index) {
        port.postMessage({sessionId, method: "onChunk", chunk: chunk.subarray(0, index)}, [chunk.buffer])
      }
      port.postMessage({sessionId, method: "onFinish"})
    }
  }
}
