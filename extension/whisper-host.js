
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
          const pcmData = await recording.stop()
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
  function sendRequest(method, args) {
    return chrome.tabs.sendMessage(tabId, {
      from: "whisper-host",
      to: "content-script",
      type: "request",
      id: String(Math.random()),
      method, args
    })
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

const getAudioCtx = lazy(() => new AudioContext({sampleRate: 16000}))

async function startRecording() {
  const switcher = await switchToMyTab(3000)
  const stream = await navigator.mediaDevices.getUserMedia({audio: true})
  await switcher.restore()
  return {
    async stop() {
      for (const track of stream.getTracks()) track.stop()
      const buffer = await fetch("model/narration.mp3").then(res => res.arrayBuffer())
      const audioBuffer = await getAudioCtx().decodeAudioData(buffer)
      return audioBuffer.getChannelData(0)
    }
  }
}

async function switchToMyTab(delay) {
  const [[activeTab], myTab] = await Promise.all([
    chrome.tabs.query({active: true, lastFocusedWindow: true}),
    chrome.tabs.getCurrent()
  ])
  const switchTo = tab => Promise.all([
    chrome.tabs.update(tab.id, {active: true}),
    chrome.windows.update(tab.windowId, {focused: true})
  ])
  let switchedPromise
  const timer = setTimeout(() => switchedPromise = switchTo(myTab), delay)
  return {
    async restore() {
      clearTimeout(timer)
      if (switchedPromise && activeTab) {
        await switchedPromise
        await switchTo(activeTab)
      }
    }
  }
}
