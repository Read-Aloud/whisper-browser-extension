
function makeAudioCapture() {
  const getContext = lazy(() => new AudioContext({sampleRate: 16000}))

  const getCaptureNode = lazy(async () => {
    const context = getContext()
    await context.audioWorklet.addModule("audio-capture-processor.js")
    return new AudioWorkletNode(context, "audio-capture-processor")
  })

  const sourceNodeObservable = null

  return {
    async start() {
      const sourceNode = await rxjs.firstValueFrom(sourceNodeObservable)
      const captureNode = await getCaptureNode()
      const sessionId = Math.random()

      sourceNode.connect(captureNode)
      captureNode.port.postMessage({method: "start", sessionId})

      const finishPromise = new Promise(fulfill => {
        const chunks = []
        new rxjs.Observable(observer => captureNode.port.onmessage = observer.next)
          .pipe(
            rxjs.filter(event => event.sessionId == sessionId),
            rxjs.takeWhile(event => event.type != "finish"),
          )
          .subscribe({
            next(event) {
              if (event.type == "chunk") chunks.push(event.chunk)
            },
            complete() {
              const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
              const result = new Float32Array(totalLength)
              let index = 0
              for (const chunk of chunks) {
                result.set(chunk, index)
                index += chunk.length
              }
              fulfill(result)
            }
          })
      })

      return {
        async finish() {
          sourceNode.disconnect(captureNode)
          captureNode.port.postMessage({method: "finish"})
          return finishPromise
        }
      }
    }
  }
}
