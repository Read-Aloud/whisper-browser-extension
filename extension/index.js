
let whisperService


//handle messages from whisper-service

const domDispatcher = makeDispatcher("whisper-host", {
  onReady(args, sender) {
    whisperService = sender
    chrome.runtime.sendMessage({to: "service-worker", type: "notification", method: "onReady"})
  },
})

addEventListener("message", event => {
  const send = message => event.source.postMessage(message, {targetOrigin: event.origin})
  const sender = {
    sendRequest(method, args) {
      const id = String(Math.random())
      send({to: "whisper-service", type: "request", id, method, args})
      return domDispatcher.waitForResponse(id)
    }
  }
  domDispatcher.dispatch(event.data, sender, send)
})


//handle messages from extension service worker

const extDispatcher = makeDispatcher("whisper-host", {
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
    if (!whisperService) throw new Error("No service")
    control.next(tabId)
  },
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return extDispatcher.dispatch(message, sender, res => {
    if (res.error instanceof Error || res.error instanceof DOMException) {
      res.error = {
        name: res.error.name,
        message: res.error.message,
        stack: res.error.stack
      }
    }
    sendResponse(res)
  })
})


//transcribe state machine

const control = new rxjs.Subject()

control
  .pipe(
    rxjs.scan((currentTranscription, tabId) => {
      if (!currentTranscription) {
        return makeTranscription(tabId)
      }
      else {
        currentTranscription.end()
        return null
      }
    }, null)
  )
  .subscribe()
