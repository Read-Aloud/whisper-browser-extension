
const audioCaptureWorkletUrl = document.currentScript.src.replace("audio-capture.js", "audio-capture-processor.js")


function makeAudioCapture(audioContext, {chunkSize}) {
  const readyPromise = audioContext.audioWorklet.addModule(audioCaptureWorkletUrl)

  return {
    async start(sourceNode) {
      await readyPromise
      const captureNode = new AudioWorkletNode(audioContext, "audio-capture-processor", {processorOptions: {chunkSize}})
      sourceNode.connect(captureNode)

      const finishPromise = new Promise(fulfill => {
        const chunks = []
        captureNode.port.onmessage = function(event) {
          const message = event.data
          //console.debug(message)
          if (message.method == "onChunk") chunks.push(message.chunk)
          else if (message.method == "onFinish") fulfill(concat(chunks))
        }
      })

      return {
        finish() {
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
