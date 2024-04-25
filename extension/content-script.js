
//process messages from whisper-host

immediate(() => {
  const dispatcher = makeMessageDispatcher({
    from: "whisper-host",
    to: "content-script",
    requestHandlers: makeSessionManager()
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
    from: "content-script",
    to: "whisper-host",
    type: "notification",
    method: "onReady"
  })
  .catch(console.error)
})



//transcribe session

function makeSessionManager() {
  const sessions = new Map()
  let currentSessionId

  return {
    areYouThere() {
      return true
    },
    prepareToTranscribe({sessionId}) {
      const session = makeSession()
      sessions.set(sessionId, session)
      session.completePromise.finally(() => sessions.delete(sessionId))
      currentSessionId = sessionId
      session.prepare()
    },
    onTranscribeEvent(event) {
      const session = sessions.get(event.sessionId)
      session.onEvent(event, event.sessionId == currentSessionId ? getToast() : {show() {}})
    }
  }
}



function makeSession() {
  const target = document.activeElement
  const completePromise = makeExposedPromise()

  return {
    completePromise: completePromise.promise,
    prepare() {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement))
        throw {name: "NoTargetException", message: "Please select a textbox to receive transcription"}
    },
    onEvent(event, toast) {
      switch (event.type) {
        case "loading":
          toast.show({type: "success", text: "Whisker initializing, please wait..."})
          break
        case "recording":
          toast.show({type: "danger", text: "Listening..."})
          break
        case "transcribing":
          toast.show({type: "success", text: "Transcribing..."})
          break
        case "transcribed":
          toast.show(null)
          insertAtCursor(target, event.text)
          completePromise.fulfill()
          break
        case "error":
          toast.show({type: "warning", text: event.error.message, hide: 5000})
          completePromise.fulfill()
          break
        default:
          toast.show({type: "info", text: JSON.stringify(event, null, 2), hide: 5000})
      }
    }
  }
}



//UI

const getToast = lazy(() => {
  const toast = document.createElement("DIV")
  Object.assign(toast.style, {
    zIndex: "9000000",
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    border: "6px solid #888",
    borderRadius: "12px",
    padding: "10px 16px",
    backgroundColor: "#d9f7f7",
    color: "black",
    fontSize: "16px",
    whiteSpace: "pre-wrap",
    userSelect: "none",
    display: "none",
    alignItems: "center",
  })
  document.body.appendChild(toast)

  const control = new rxjs.Subject()
  control
    .pipe(
      rxjs.switchMap(opts => {
        if (opts && opts.hide) {
          return rxjs.timer(opts.hide)
            .pipe(
              rxjs.map(() => null),
              rxjs.startWith(opts)
            )
        }
        else {
          return rxjs.of(opts)
        }
      })
    )
    .subscribe(opts => {
      if (opts) {
        toast.innerText = opts.text
        toast.style.backgroundColor = immediate(() => {
          switch (opts.type) {
            case "danger": return "#f2dede"
            case "warning": return "#fcf8e3"
            case "info": return "#d9edf7"
            case "success": return "#dff0d8"
            default: return ""
          }
        })
        toast.style.borderColor = immediate(() => {
          switch (opts.type) {
            case "danger": return "#dca7a7"
            case "warning": return "#f5e79e"
            case "info": return "#9acfea"
            case "success": return "#b2dba1"
            default: return ""
          }
        })
        toast.style.display = "flex"
      }
      else {
        toast.style.display = "none"
      }
    })

  return {
    show(opts) {
      control.next(opts)
    }
  }
})
