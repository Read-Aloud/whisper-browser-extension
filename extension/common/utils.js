
function immediate(func) {
  return func()
}

function lazy(func) {
  let value
  return () => value || (value = func())
}

function makeSerializableError(err) {
  if (err instanceof Error || err instanceof DOMException) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack
    }
  }
  else {
    return err
  }
}

function makeMessageDispatcher({ from, to, requestHandlers }) {
  const pendingRequests = new Map();
  return {
    waitForResponse(requestId) {
      let pending = pendingRequests.get(requestId);
      if (!pending)
        pendingRequests.set(requestId, pending = makePending());
      return pending.promise;
    },
    dispatch({ message, sender, sendResponse }) {
      if (message.from == from && message.to == to) {
        switch (message.type) {
          case "request": return handleRequest(message, sender, sendResponse);
          case "notification": return handleNotification(message, sender);
          case "response": return handleResponse(message);
        }
      }
    },
    updateHandlers(newHandlers) {
      requestHandlers = newHandlers;
    }
  };
  function makePending() {
    const pending = {};
    pending.promise = new Promise((fulfill, reject) => {
      pending.fulfill = fulfill;
      pending.reject = reject;
    });
    return pending;
  }
  function handleRequest(req, sender, sendResponse) {
    if (requestHandlers[req.method]) {
      console.debug("RECV", req)
      Promise.resolve()
        .then(() => requestHandlers[req.method](req.args || {}, sender))
        .then(
          result => ({ from: req.to, to: req.from, type: "response", id: req.id, result, error: undefined }),
          error => ({ from: req.to, to: req.from, type: "response", id: req.id, result: undefined, error })
        )
        .then(res => {
          console.debug("SEND", res)
          sendResponse(res)
        });
      //let caller know that sendResponse will be called asynchronously
      return true;
    }
    else {
      console.error("No handler for method", req);
    }
  }
  function handleNotification(ntf, sender) {
    if (requestHandlers[ntf.method]) {
      console.debug("RECV", ntf)
      Promise.resolve()
        .then(() => requestHandlers[ntf.method](ntf.args || {}, sender))
        .catch(error => console.error("Failed to handle notification", ntf, error));
    }
    else {
      console.error("No handler for method", ntf);
    }
  }
  function handleResponse(res) {
    console.debug("RECV", res)
    const pending = pendingRequests.get(res.id);
    if (pending) {
      pendingRequests.delete(res.id);
      if (res.error)
        pending.reject(res.error);
      else
        pending.fulfill(res.result);
    }
    else {
      console.error("Stray response", res);
    }
  }
}

const getCurrentTab = lazy(() => chrome.tabs.getCurrent())

function switchToTab(tab) {
  return Promise.all([
    chrome.tabs.update(tab.id, {active: true}),
    chrome.windows.update(tab.windowId, {focused: true})
  ])
}

function makeSemaphore(count) {
  const waiters = []
  return {
    async runTask(task) {
      if (count > 0) count--
      else await new Promise(f => waiters.push(f))
      try {
        return await task()
      }
      finally {
        count++
        while (count > 0 && waiters.length > 0) {
          count--
          waiters.shift()()
        }
      }
    }
  }
}

function makeExposedPromise() {
  const exposed = {}
  exposed.promise = new Promise((fulfill, reject) => {
    exposed.fulfill = fulfill
    exposed.reject = reject
  })
  return exposed
}

function insertAtCursor(myField, myValue) {
  if (typeof myField.selectionStart == "number") {
    var startPos = myField.selectionStart;
    var endPos = myField.selectionEnd;
    myField.value = myField.value.slice(0, startPos) + myValue + myField.value.slice(endPos)
    myField.selectionStart = myField.selectionEnd = startPos + myValue.length;
  }
  else if (myField.hasAttribute("contenteditable")) {
    const selection = document.getSelection()
    const {focusNode, focusOffset} = selection
    if (focusNode && focusNode.nodeType == 3 && isDescendant(focusNode, myField)) {
      focusNode.nodeValue = focusNode.nodeValue.slice(0, focusOffset) + myValue + focusNode.nodeValue.slice(focusOffset)
      selection.setPosition(focusNode, focusOffset + myValue.length)
    }
    else {
      myField.appendChild(document.createTextNode(myValue))
    }
  }
  else {
    console.error("Could not insert text into", myField)
  }
}

function isDescendant(child, parent) {
  let node = child.parentNode
  while (node) {
    if (node == parent) return true
    node = node.parentNode
  }
  return false
}

/**
 * sampleRate=16000, fftSize=32 -> frequencyResolution=500Hz per bin
 * We take the first 6 bins 0-3kHz which covers the essential components of speech
 */
function makeMicrophoneLevelAnalyzer({sourceNode, refreshInterval, callback}) {
  const analyser = sourceNode.context.createAnalyser()
  analyser.fftSize = 32
  analyser.smoothingTimeConstant = 0

  const data = new Uint8Array(analyser.frequencyBinCount)
  const refresh = function() {
    analyser.getByteFrequencyData(data)
    callback((data[0] + data[1] + data[2] + data[3] + data[4] + data[5]) /6 /255)
  }

  sourceNode.connect(analyser)
  const timer = setInterval(refresh, refreshInterval)
  return {
    stop() {
      clearInterval(timer)
      sourceNode.disconnect(analyser)
    }
  }
}
