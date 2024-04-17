
immediate(() => {
  const dispatcher = makeMessageDispatcher({
    from: "whisper-host",
    to: "content-script",
    requestHandlers: {
      areYouThere() {
        return true
      },
      prepareToTranscribe() {
      },
      onTranscribeEvent(event) {
        getToast().show(JSON.stringify(event, null, 2))
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
    from: "content-script",
    to: "whisper-host",
    type: "notification",
    method: "onReady"
  })
  .catch(console.error)
})



//UI

const getToast = lazy(() => {
  const toast = document.createElement("DIV")
  Object.assign(toast.style, {
    position: "absolute",
    top: "1em",
    left: "50%",
    transform: "translateX(-50%)",
    border: "1px solid #888",
    padding: "1em",
    backgroundColor: "#d9f7f7",
    whiteSpace: "pre-wrap",
    display: "none",
    alignItems: "center",
  })
  document.body.appendChild(toast)

  const control = new rxjs.Subject()
  control
    .pipe(
      rxjs.switchMap(text => {
        return rxjs.timer(7000)
          .pipe(
            rxjs.map(() => null),
            rxjs.startWith(text)
          )
      })
    )
    .subscribe(text => {
      if (text) {
        toast.innerText = text
        toast.style.display = "flex"
      }
      else {
        toast.style.display = "none"
      }
    })

  return {
    show(text) {
      control.next(text)
    }
  }
})
