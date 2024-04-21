
function makeAudioCapture() {
  const context = new AudioContext({sampleRate: 16000})
  const microphoneProvider = makeMicrophoneProvider(context)
  const captureNodePromise = context.audioWorklet.addModule("audio-capture-processor.js")
    .then(() => new AudioWorkletNode(context, "audio-capture-processor"))

  return {
    async start() {
      const captureNode = await captureNodePromise
      const source = microphoneProvider.acquire()
      const sourceNode = await source.promise
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
        finish() {
          captureNode.port.postMessage({method: "finish"})
          sourceNode.disconnect(captureNode)
          source.release()
          return finishPromise
        }
      }
    }
  }
}



function makeMicrophoneProvider(audioContext) {
  const handle = new rxjs.Subject()

  handle
    .pipe(
      rxjs.switchScan((mic, req) => {
        switch (req.method) {
          case "acquire":
            if (mic) {
              req.resolve(mic.promise)
              return rxjs.EMPTY
            }
            else {
              mic = acquireMicrophone()
              req.resolve(mic.promise)
              return rxjs.of(mic)
            }

          case "release":
            return rxjs.timer(10000)
              .pipe(
                rxjs.tap(() => mic.release()),
                rxjs.map(() => null)
              )
        }
      }, null)
    )
    .subscribe()

  return {
    acquire() {
      return {
        promise: new Promise(resolve => handle.next({method: "acquire", resolve})),
        release() {
          handle.next({method: "release"})
        }
      }
    }
  }

  function acquireMicrophone() {
    const streamPromise = navigator.mediaDevices.getUserMedia({audio: true})
    return {
      promise: streamPromise
        .then(stream => audioContext.createMediaStreamSource(stream)),
      release() {
        streamPromise
          .then(stream => stream.getTracks().forEach(track => track.stop()))
          .catch(err => "OK")
      }
    }
  }
}
