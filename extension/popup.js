
document.addEventListener("DOMContentLoaded", function() {
  chrome.commands.getAll()
    .then(commands => {
      const {shortcut} = commands.find(x => x.name == "transcribe")
      document.getElementById("current-shortcut-key").innerText = shortcut
    })

  document.getElementById("test-microphone")
    .addEventListener("click", function() {
      chrome.runtime.sendMessage({
        from: "popup",
        to: "extension-service-worker",
        type: "notification",
        method: "testMicrophone"
      })
      .catch(console.error)
    })

  document.getElementById("edit-shortcut-key")
    .addEventListener("click", function() {
      chrome.tabs.create({url: "chrome://extensions/configureCommands"})
    })
})
