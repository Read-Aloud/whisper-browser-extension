
const whisperHost = {
  readyTopic: {
    callbacks: [],
    publish() {
      for (const callback of this.callbacks) callback()
      this.callbacks = []
    },
    subscribeOnce(callback) {
      this.callbacks.push(callback)
    }
  },
  async ready({requestFocus}) {
    try {
      if (!await this.sendRequest("areYouThere", {requestFocus})) throw "Absent"
    }
    catch (err) {
      await chrome.tabs.create({url: "index.html", pinned: true, active: requestFocus})
      await new Promise(f => this.readyTopic.subscribeOnce(f))
    }
  },
  async sendRequest(method, args) {
    const {error, result} = await chrome.runtime.sendMessage({
      to: "whisper-host",
      type: "request",
      id: String(Math.random()),
      method,
      args
    })
    return error ? Promise.reject(error) : result
  }
}



//process messages from whisper-host

importScripts("message-dispatcher.js")

const extDispatcher = makeDispatcher("service-worker", {
  onReady() {
    whisperHost.readyTopic.publish()
  }
})

chrome.runtime.onMessage.addListener(extDispatcher.dispatch)



//shortcut commands

chrome.commands.onCommand.addListener((command, tab) => {
  if (command == "transcribe" && tab) {
    whisperHost.ready({requestFocus: false})
      .then(() => whisperHost.sendRequest("transcribe", {tabId: tab.id}))
      .catch(console.error)
  }
})
