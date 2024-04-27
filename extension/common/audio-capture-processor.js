
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this.session = makeSession(options.processorOptions.chunkSize || 48000, this.port)
    this.state = "IDLE"
  }
  process(inputs) {
    /**
     * MDN
     * The number of inputs and thus the length of that array is fixed at the construction of the node (see AudioWorkletNode).
     * If there is no active node connected to the n-th input of the node, inputs[n] will be an empty array (zero input channels available).
     */
    const channels = inputs[0]
    if (this.state == "IDLE") {
      if (channels.length) {
        this.session.append(channels[0])
        this.state = "CAPTURING"
      }
    }
    else if (this.state == "CAPTURING") {
      if (channels.length) {
        this.session.append(channels[0])
      }
      else {
        this.session.finish()
        this.state = "FINISHED"
      }
    }
    return this.state != "FINISHED"
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor)



function makeSession(chunkSize, port) {
  let chunk = new Float32Array(chunkSize)
  let index = 0
  return {
    append(samples) {
      const available = Math.min(samples.length, chunk.length - index)
      if (available) {
        chunk.set(samples.subarray(0, available), index)
        index += available
      }
      if (index == chunk.length) {
        port.postMessage({method: "onChunk", chunk}, [chunk.buffer])
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
        port.postMessage({method: "onChunk", chunk: chunk.subarray(0, index)}, [chunk.buffer])
      }
      port.postMessage({method: "onFinish"})
    }
  }
}
