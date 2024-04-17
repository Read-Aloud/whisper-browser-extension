
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
