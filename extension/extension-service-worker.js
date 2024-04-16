
importScripts(
  "common/rxjs.umd.min.js",
  "common/utils.js"
)

const whisperHost = {
  readySubject: new rxjs.Subject(),
  async ready({requestFocus}) {
    try {
      if (!await this.sendRequest("areYouThere", {requestFocus})) throw "Absent"
    }
    catch (err) {
      await Promise.all([
        chrome.tabs.create({
          url: "whisper-host.html",
          pinned: true,
          active: requestFocus
        }),
        rxjs.firstValueFrom(this.readySubject)
      ])
    }
  },
  async sendRequest(method, args) {
    const {error, result} = await chrome.runtime.sendMessage({
      from: "extension-service-worker",
      to: "whisper-host",
      type: "request",
      id: String(Math.random()),
      method, args
    })
    return error ? Promise.reject(error) : result
  }
}



//process extension messages

immediate(() => {
  const dispatcher = makeMessageDispatcher({
    from: "whisper-host",
    to: "extension-service-worker",
    requestHandlers: {
      onReady() {
        whisperHost.readySubject.next()
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
})



//extension commands

chrome.commands.onCommand.addListener((command, tab) => {
  if (command == "transcribe") {
    whisperHost.ready({requestFocus: false})
      .then(() => whisperHost.sendRequest("transcribe", {tabId: tab ? tab.id : null}))
      .catch(console.error)
  }
})
