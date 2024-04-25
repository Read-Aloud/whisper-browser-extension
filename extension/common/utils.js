
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

function makeStateMachine(states) {
  let currentStateName = "IDLE"
  if (states[currentStateName].onTransitionIn) states[currentStateName].onTransitionIn()
  let lock = 0
  return {
    trigger(eventName, ...args) {
      if (lock) throw new Error("Cannot trigger an event synchronously while inside an event handler")
      lock++;
      try {
        const currentState = states[currentStateName]
        if (!(eventName in currentState)) throw new Error("Missing handler " + currentStateName + "." + eventName)
        const nextStateName = currentState[eventName](...args)
        if (nextStateName) {
          if (!(nextStateName in states)) throw new Error("Missing state " + nextStateName)
          currentStateName = nextStateName
          if (states[currentStateName].onTransitionIn) states[currentStateName].onTransitionIn()
        }
      }
      finally {
        lock--;
      }
    },
    getState() {
      return currentStateName;
    }
  }
}

function makeSharedResource({create, destroy, keepAliveDuration}) {
  let resource
  let refCount = 0
  const sm = makeStateMachine({
    IDLE: {
      acquire() {
        resource = create()
        refCount++
        return "ACQUIRED"
      }
    },
    ACQUIRED: {
      acquire() {
        refCount++
      },
      release() {
        refCount--
        if (refCount == 0) return "KEEPALIVE"
      }
    },
    KEEPALIVE: {
      onTransitionIn() {
        this.timer = setTimeout(() => sm.trigger("onTimeout"), keepAliveDuration)
      },
      onTimeout() {
        destroy(resource)
        return "IDLE"
      },
      acquire() {
        clearTimeout(this.timer)
        refCount++
        return "ACQUIRED"
      }
    }
  })
  return {
    acquire() {
      sm.trigger("acquire")
      return {
        resource,
        release() {
          sm.trigger("release")
        }
      }
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

function switchToCurrentTab({delay}) {
  const prevTabPromise = chrome.tabs.query({active: true, lastFocusedWindow: true}).then(tabs => tabs[0])
  let switchedPromise
  const timer = setTimeout(() => switchedPromise = getCurrentTab().then(switchToTab), delay)
  return {
    restore() {
      clearTimeout(timer)
      if (switchedPromise) {
        switchedPromise
          .then(() => prevTabPromise.then(prevTab => prevTab && switchToTab(prevTab)))
          .catch(console.error)
      }
    }
  }
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
  if (myField.selectionStart || myField.selectionStart == '0') {
    var startPos = myField.selectionStart;
    var endPos = myField.selectionEnd;
    myField.value = myField.value.substring(0, startPos) + myValue + myField.value.substring(endPos, myField.value.length);
    myField.selectionStart = myField.selectionEnd = startPos + myValue.length;
  }
  else {
    myField.value += myValue;
  }
}
