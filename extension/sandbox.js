
const domDispatcher = makeDispatcher("whisper-service", {
  transcribe({pcmData}) {
    return "This is some dummy transcribed text"
  },
})

addEventListener("message", event => {
  domDispatcher.dispatch(event.data, null, res => event.source.postMessage(res, {targetOrigin: event.origin}))
})

top.postMessage({to: "whisper-host", type: "notification", method: "onReady"}, "*")
