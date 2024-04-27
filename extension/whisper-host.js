
//inference service

const inferenceServicePromise = new Promise((fulfill, reject) => {
  const dispatcher = makeMessageDispatcher({
    from: "inference-service",
    to: "inference-host",
    requestHandlers: {
      onReady(args, sender) {
        fulfill(sender)
      }
    }
  })

  window.addEventListener("message", event => {
    dispatcher.dispatch({
      message: event.data,
      sender: {
        sendRequest(method, args, transfer) {
          const id = String(Math.random())
          const req = {
            from: "inference-host",
            to: "inference-service",
            type: "request",
            id, method, args
          }
          event.source.postMessage(req, {targetOrigin: event.origin, transfer})
          return dispatcher.waitForResponse(id)
        }
      },
      sendResponse(res) {
        event.source.postMessage(res, {targetOrigin: event.origin})
      }
    })
  })
})

const inferenceSessionPromise = inferenceServicePromise
  .then(async service => {
    const sessionId = await service.sendRequest("makeInferenceSession", {
      model: chrome.runtime.getURL("model/whisper_cpu_int8_cpu-cpu_model.onnx")
    })
    const semaphore = makeSemaphore(1)
    return {
      infer: ({pcmData}) => semaphore.runTask(async () => {
        const feeds = {
          "audio_pcm": {data: pcmData, dims: [1, pcmData.length]},
          "min_length": {data: new Int32Array([1]), dims: [1]},
          "max_length": {data: new Int32Array([448]), dims: [1]},
          "num_beams": {data: new Int32Array([2]), dims: [1]},
          "num_return_sequences": {data: new Int32Array([1]), dims: [1]},
          "length_penalty": {data: new Float32Array([1]), dims: [1]},
          "repetition_penalty": {data: new Float32Array([1]), dims: [1]},
        }
        const transfer = Object.values(feeds)
          .map(tensor => tensor.data.buffer)
        const [str] = await service.sendRequest("infer", {sessionId, feeds, outputNames: ["str"]}, transfer)
        return str.data[0]
      })
    }
  })



//extension-service-worker

immediate(() => {
  const dispatcher = makeMessageDispatcher({
    from: "extension-service-worker",
    to: "whisper-host",
    requestHandlers: {
      async areYouThere({requestFocus}) {
        if (requestFocus) await switchToCurrentTab({delay: 0})
        return true
      },
      transcribe({tabId}) {
        transcribeStateMachine.trigger("next", tabId)
      }
    }
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return dispatcher.dispatch({
      message,
      sender,
      sendResponse(res) {
        if (res.error) res.error = makeSerializableError(res.error)
        sendResponse(res)
      }
    })
  })

  chrome.runtime.sendMessage({
    from: "whisper-host",
    to: "extension-service-worker",
    type: "notification",
    method: "onReady"
  })
  .catch(console.error)
})



//transcribe state machine

const transcribeStateMachine = immediate(() => {
  let currentTranscription = null

  const sm = makeStateMachine({
    IDLE: {
      next(tabId) {
        if (tabId) {
          const tran = currentTranscription = makeTranscription(tabId)
          tran.finishPromise.finally(() => tran == currentTranscription && sm.trigger("onFinish"))
          return "TRANSCRIBING"
        }
      }
    },
    TRANSCRIBING: {
      next() {
        currentTranscription.finish()
        currentTranscription = null
        return "IDLE"
      },
      onFinish() {
        currentTranscription = null
        return "IDLE"
      }
    },
  })

  return sm
})



//transcription

function makeTranscription(tabId) {
  const control = new rxjs.BehaviorSubject("go")
  const keepAliveSub = keepAlive.subscribe()
  return {
    finishPromise: immediate(async () => {
      try {
        const contentScript = await makeContentScript(tabId)
        if (control.getValue() == "finish") return;
        const sessionId = Math.random()
        const notifyEvent = function(event) {
          contentScript.notify("onTranscribeEvent", {sessionId, ...event})
            .catch(console.error)
        }
        try {
          await contentScript.sendRequest("prepareToTranscribe", {sessionId})
          notifyEvent({type: "loading"})
          const recording = await getRecorder().start()
          notifyEvent({type: "recording"})
          await rxjs.firstValueFrom(control.pipe(rxjs.filter(x => x == "finish")))
          const pcmData = await recording.finish()
          notifyEvent({type: "transcribing"})
          const inferenceSession = await inferenceSessionPromise
          const text = await inferenceSession.infer({pcmData})
          notifyEvent({type: "transcribed", text})
        }
        catch (err) {
          notifyEvent({type: "error", error: makeSerializableError(err)})
        }
      }
      catch (err) {
        console.error(err)
      }
      finally {
        keepAliveSub.unsubscribe()
      }
    }),
    finish() {
      control.next("finish")
      chrome.tabs.update(tabId, {active: true})
        .catch(console.error)
    }
  }
}



//content script

const contentScriptManager = immediate(() => {
  const promises = new Map()

  const dispatcher = makeMessageDispatcher({
    from: "content-script",
    to: "whisper-host",
    requestHandlers: {
      onReady(args, sender) {
        const promise = promises.get(sender.tab.id)
        if (promise) promise.fulfill()
        else console.error("Unexpected")
      }
    }
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return dispatcher.dispatch({
      message,
      sender,
      sendResponse(res) {
        if (res.error) res.error = makeSerializableError(res.error)
        sendResponse(res)
      }
    })
  })

  return {
    async inject(tabId) {
      try {
        await Promise.all([
          new Promise(fulfill => promises.set(tabId, {fulfill})),
          chrome.scripting.executeScript({
            target: {tabId},
            files: [
              "common/rxjs.umd.min.js",
              "common/utils.js",
              "content-script.js"
            ]
          })
        ])
      }
      finally {
        promises.delete(tabId)
      }
    }
  }
})

async function makeContentScript(tabId) {
  if (tabId == (await getCurrentTab()).id) return selfContentScript

  async function sendRequest(method, args) {
    const res = await chrome.tabs.sendMessage(tabId, {
      from: "whisper-host",
      to: "content-script",
      type: "request",
      id: String(Math.random()),
      method, args
    })
    if (res.error) throw res.error
    return res.result
  }
  function notify(method, args) {
    return chrome.tabs.sendMessage(tabId, {
      from: "whisper-host",
      to: "content-script",
      type: "notification",
      method, args
    })
  }
  try {
    if (!await sendRequest("areYouThere")) throw "Absent"
  }
  catch (err) {
    await contentScriptManager.inject(tabId)
  }
  return {
    sendRequest,
    notify
  }
}



//recorder

const microphone = makeSharedResource({
  create() {
    const switcher = switchToCurrentTab({delay: 3000})
    return navigator.mediaDevices.getUserMedia({audio: true})
      .finally(() => switcher.restore())
  },
  destroy(resource) {
    resource
      .then(stream => stream.getTracks().forEach(track => track.stop()))
      .catch(err => "ignore")
  },
  keepAliveDuration: 10000
})

const getAudioContext = lazy(() => new AudioContext({sampleRate: 16000}))

const getRecorder = lazy(() => {
  const context = getAudioContext()
  const capture = makeAudioCapture(context, {chunkSize: 16000})
  return {
    async start() {
      const handle = microphone.acquire()
      try {
        const stream = await handle.resource
        const session = await capture.start(context.createMediaStreamSource(stream))
        return {
          finish() {
            handle.release()
            return session.finish()
          }
        }
      }
      catch (err) {
        handle.release()
        throw err
      }
    }
  }
})



//autoclose

const keepAlive = immediate(() => {
  let count = 0
  const startTimer = () => setTimeout(() => window.close(), 5*60*1000)
  let timer = startTimer()
  return {
    subscribe() {
      count++
      clearTimeout(timer)
      return {
        unsubscribe() {
          count--
          if (count == 0) timer = startTimer()
        }
      }
    }
  }
})



//UI

const selfContentScript = {
  async sendRequest(method, args) {
  },
  async notify(method, event) {
    if (method == "onTranscribeEvent") {
      const txtTranscription = document.querySelector("#test-transcribe textarea")
      const lblStatus = document.querySelector("#test-transcribe .lbl-status")
      switch (event.type) {
        case "loading":
          lblStatus.innerText = "Initializing..."
          break
        case "recording":
          lblStatus.innerText = "Listening..."
          break
        case "transcribing":
          lblStatus.innerText = "Transcribing..."
          break
        case "transcribed":
          lblStatus.innerText = ""
          insertAtCursor(txtTranscription, event.text)
          break
        case "error":
          lblStatus.innerText = event.error.message
          break
        default:
          lblStatus.innerText = JSON.stringify(event, null, 2)
      }
    }
  }
}



document.addEventListener("DOMContentLoaded", function() {
  //test microphone
  const fgLevel = document.querySelector("#test-microphone .fg-level")
  const btnTest = document.querySelector("#test-microphone .btn-test")
  const btnChange = document.querySelector("#test-microphone .btn-change")
  let session
  btnTest.addEventListener("click", async function() {
    if (session) {
      btnTest.innerText = session.originalButtonText
      session.stop()
      session = null
    }
    else {
      const handle = microphone.acquire()
      const stream = await handle.resource
      const analyzer = makeMicrophoneLevelAnalyzer({
        sourceNode: getAudioContext().createMediaStreamSource(stream),
        refreshInterval: 100,
        callback(level) {
          fgLevel.style.width = (level * 100) + '%'
        }
      })
      session = {
        originalButtonText: btnTest.innerText,
        stop() {
          analyzer.stop()
          handle.release()
          fgLevel.style.width = ''
        }
      }
      btnTest.innerText = btnTest.getAttribute("data-finish")
    }
  })
  btnChange.addEventListener("click", function() {
    chrome.tabs.create({url: "chrome://settings/content/microphone"})
      .catch(err => alert(err.message))
  })

  //test transcribe
  const txtTranscription = document.querySelector("#test-transcribe textarea")
  chrome.commands.getAll()
    .then(commands => {
      const {shortcut} = commands.find(x => x.name == "transcribe")
      txtTranscription.placeholder = `Click here and press ${shortcut} to transcribe`
    })
})
