
const audioCaptureWorkletUrl = document.currentScript.src.replace("audio-capture.js", "audio-capture-processor.js")


function makeAudioCapture(audioContext, {chunkSize}) {
  const captureNodePromise = audioContext.audioWorklet.addModule(audioCaptureWorkletUrl)
    .then(() => new AudioWorkletNode(audioContext, "audio-capture-processor"))

  return {
    async start(sourceNode) {
      const sessionId = Math.random()
      const captureNode = await captureNodePromise
      sourceNode.connect(captureNode)
      captureNode.port.postMessage({method: "start", sessionId, chunkSize})

      const finishPromise = new Promise(fulfill => {
        const chunks = []
        captureNode.port.onmessage = function(event) {
          const message = event.data
          if (message.sessionId == sessionId) {
            if (message.method == "onChunk") chunks.push(message.chunk)
            else if (message.method == "onFinish") fulfill(concat(chunks))
          }
        }
      })

      return {
        finish() {
          captureNode.port.postMessage({method: "finish"})
          sourceNode.disconnect(captureNode)
          return finishPromise
        }
      }
    }
  }

  function concat(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Float32Array(totalLength)
    let index = 0
    for (const chunk of chunks) {
      result.set(chunk, index)
      index += chunk.length
    }
    return result
  }
}
