
document.addEventListener("DOMContentLoaded", function() {
  chrome.commands.getAll()
    .then(commands => {
      const {shortcut} = commands.find(x => x.name == "transcribe")
      document.getElementById("current-shortcut-key").innerText = shortcut
    })

  document.getElementById("test-microphone")
    .addEventListener("click", function() {
      location.href = "microphone-test.html"
    })

  document.getElementById("edit-shortcut-key")
    .addEventListener("click", function() {
      chrome.tabs.create({url: "chrome://extensions/configureCommands"})
    })
})
