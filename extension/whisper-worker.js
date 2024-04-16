
immediate(() => {
  const dispatcher = makeMessageDispatcher({
    from: "whisper-host",
    to: "whisper-worker",
    requestHandlers: {
      startTranscription(args, sender) {
        sender.notify("onTranscriptionEvent", {type: "start"})
      },
      finishTranscription() {
        sender.notify("onTranscriptionEvent", {type: "text", text: "This is some dummy transcribed text"})
      }
    }
  })

  window.addEventListener("message", event => {
    dispatcher.dispatch({
      message: event.data,
      sender: {
        notify(method, args) {
          event.source.postMessage({
            from: "whisper-worker",
            to: "whisper-host",
            type: "notification",
            method, args
          }, {
            targetOrigin: event.origin
          })
        }
      },
      sendResponse(res) {
        event.source.postMessage(res, {targetOrigin: event.origin})
      }
    })
  })

  parent?.postMessage({
    from: "whisper-worker",
    to: "whisper-host",
    type: "notification",
    method: "onReady"
  }, "*")
})
