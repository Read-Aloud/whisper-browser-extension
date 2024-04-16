
const whisperWorkerPromise = new Promise((fulfill, reject) => {
  const transcriptionEventSubject = new rxjs.Subject()

  const dispatcher = makeMessageDispatcher({
    from: "whisper-worker",
    to: "whisper-host",
    requestHandlers: {
      onReady(args, sender) {
        fulfill({
          sendRequest: sender.sendRequest,
          transcriptionEventObservable: transcriptionEventSubject.asObservable()
        })
      },
      onTranscriptionEvent(event) {
        transcriptionEventSubject.next(event)
      }
    }
  })

  window.addEventListener("message", event => {
    dispatcher.dispatch({
      message: event.data,
      sender: {
        sendRequest(method, args) {
          const id = String(Math.random())
          const req = {from: "whisper-host", to: "whisper-worker", type: "request", id, method, args}
          event.source.postMessage(req, {targetOrigin: event.origin})
          return dispatcher.waitForResponse(id)
        }
      },
      sendResponse(res) {
        event.source.postMessage(res, {targetOrigin: event.origin})
      }
    })
  })
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
          return "TRANSCRIBING"
        }
      }
    },
    TRANSCRIBING: {
      next() {
        currentTranscription.finish()
          .then(() => sm.trigger("onFinish"))
        return "FINISHING"
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
  const donePromise = immediate(async () => {
    try {
      const contentScript = await makeContentScript(tabId)
      if (control.getValue() == "finish") return;
      try {
        const whisperWorker = await whisperWorkerPromise
        if (control.getValue() == "finish") return;
        await contentScript.sendRequest("prepareToTranscribe")
        if (control.getValue() == "finish") return;
        const transcriptionEventSubscription = whisperWorker.transcriptionEventObservable
          .subscribe(event => {
            contentScript.notify("onTranscribeEvent", event)
              .catch(console.error)
          })
        try {
          await whisperWorker.sendRequest("startTranscription")
          await rxjs.firstValueFrom(control.pipe(rxjs.filter(x => x == "finish")))
          await whisperWorker.sendRequest("finishTranscription")
        }
        finally {
          transcriptionEventSubscription.unsubscribe()
        }
      }
      catch (err) {
        await contentScript.notify("onTranscribeEvent", {type: "error", error: makeSerializableError(err)})
      }
    }
    catch (err) {
      console.error(err)
    }
  })
  return {
    finish() {
      chrome.tabs.update(tabId, {active: true})
        .catch(console.error)
      control.next("finish")
      return donePromise
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
        promises.get(sender.tab.id)?.fulfill()
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
