
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
    return {
      async infer({pcmData}) {
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
      }
    }
  })



//extension-service-worker

immediate(() => {
  const dispatcher = makeMessageDispatcher({
    from: "extension-service-worker",
    to: "whisper-host",
    requestHandlers: {
      async areYouThere({requestFocus}) {
        if (requestFocus) {
          const tab = await chrome.tabs.getCurrent()
          await Promise.all([
            chrome.windows.update(tab.windowId, {focused: true}),
            chrome.tabs.update(tab.id, {active: true})
          ])
        }
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
          currentTranscription = makeTranscription(tabId)
          currentTranscription.finishPromise.finally(() => sm.trigger("onFinish"))
          return "TRANSCRIBING"
        }
      }
    },
    TRANSCRIBING: {
      next() {
        currentTranscription.finish()
        return "FINISHING"
      },
      onFinish() {
        currentTranscription = null
        return "IDLE"
      }
    },
    FINISHING: {
      onFinish() {
        if (this.pending) {
          currentTranscription = makeTranscription(this.pending)
          return "TRANSCRIBING"
        }
        else {
          currentTranscription = null
          return "IDLE"
        }
      },
      next(tabId) {
        this.pending = tabId
      }
    }
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
        const notifyEvent = function(event) {
          contentScript.notify("onTranscribeEvent", event)
            .catch(console.error)
        }
        try {
          notifyEvent({type: "loading"})
          await contentScript.sendRequest("prepareToTranscribe")
          const recording = await startRecording()
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

const getAudioCapture = lazy(makeAudioCapture)

async function startRecording() {
  const switcher = await switchToMyTab(3000)
  const capture = await getAudioCapture().start()
  await switcher.restore()
  return {
    finish() {
      return capture.finish()
    }
  }
}



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
