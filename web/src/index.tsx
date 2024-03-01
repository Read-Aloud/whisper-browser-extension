import * as React from "react"
import * as ReactDOM from "react-dom/client"
import { useImmer } from "use-immer"
import { advertiseVoices, deleteVoice, getInstalledVoice, getVoiceList, installVoice, makeAdvertisedVoiceList, messageDispatcher, parseAdvertisedVoiceName, sampler, speechManager } from "./services"
import { createSynthesizer } from "./synthesizer"
import { MyVoice, Synthesizer } from "./types"
import { immediate } from "./utils"

ReactDOM.createRoot(document.getElementById("app")!).render(<App />)


function App() {
  const [state, stateUpdater] = useImmer({
    voiceList: null as MyVoice[]|null,
    activityLog: "Ready",
    synthesizers: {} as Record<string, Synthesizer|undefined>,
    isExpanded: {} as Record<string, boolean>,
  })
  const refs = {
    activityLog: React.useRef<HTMLTextAreaElement>(null!)
  }
  const installed = React.useMemo(() => state.voiceList?.filter(x => x.installState == "installed") ?? [], [state.voiceList])
  const notInstalled = React.useMemo(() => state.voiceList?.filter(x => x.installState != "installed") ?? [], [state.voiceList])
  const advertised = React.useMemo(() => makeAdvertisedVoiceList(state.voiceList), [state.voiceList])


  //startup
  React.useEffect(() => {
    getVoiceList()
      .then(voiceList => stateUpdater(draft => {
        draft.voiceList = voiceList
      }))
      .catch(handleError)
  }, [
  ])

  //advertise voices
  React.useEffect(() => {
    if (advertised) advertiseVoices(advertised)
  }, [
    advertised
  ])

  //handle requests
  React.useEffect(() => {
    messageDispatcher.updateHandlers({
      speak: onSpeak,
      wait: onWait,
      pause: onPause,
      resume: onResume,
      stop: onStop,
    })
  })

  //auto-scroll activity log
  React.useEffect(() => {
    refs.activityLog.current.scrollTop = refs.activityLog.current.scrollHeight
  }, [
    state.activityLog
  ])


  return (
    <div className="container">
      {location.hostname == "localhost" &&
        <React.Fragment>
          <h2 className="text-muted">Test</h2>
          <form onSubmit={onSubmitTest}>
            <textarea className="form-control" rows={3} name="text" defaultValue="It is a period of civil war. Rebel spaceships, striking from a hidden base, have won their first victory against the evil Galactic Empire. During the battle, Rebel spies managed to steal secret plans to the Empire's ultimate weapon, the DEATH STAR, an armored space station with enough power to destroy an entire planet. Pursued by the Empire's sinister agents, Princess Leia races home aboard her starship, custodian of the stolen plans that can save her people and restore freedom to the galaxy..." />
            <select className="form-control mt-3" name="voice">
              <option value=""></option>
              {advertised?.map(voice =>
                <option key={voice.voiceName} value={voice.voiceName}>{voice.voiceName}</option>
              )}
            </select>
            <button type="submit" className="btn btn-primary mt-3">Speak</button>
          </form>
        </React.Fragment>
      }

      <h2 className="text-muted">Activity Log</h2>
      <textarea className="form-control" disabled rows={4} ref={refs.activityLog} value={state.activityLog} />

      <h2 className="text-muted">Installed</h2>
      {installed.length == 0 &&
        <div className="text-muted">Installed voices will appear here</div>
      }
      {installed.length > 0 &&
        <table className="table table-borderless table-hover table-sm">
          <thead>
            <tr>
              <th>Voice Pack</th>
              <th>Language</th>
              <th>Status</th>
              <th></th>
              <th style={{width: "0%"}}></th>
            </tr>
          </thead>
          <tbody>
            {installed.map(voice =>
              <tr key={voice.key}>
                <td>
                  <span className="me-1">{voice.name}</span>
                  <span className="me-1">[{voice.quality}]</span>
                  {voice.num_speakers <= 1 &&
                    <span className="link" onClick={() => sampler.play(voice)}>sample</span>
                  }
                  {voice.num_speakers > 1 &&
                    <span style={{cursor: "pointer"}}
                      onClick={() => toggleExpanded(voice.key)}>({voice.num_speakers} voices) {state.isExpanded[voice.key] ? '▲' : '▼'}</span>
                  }
                  {state.isExpanded[voice.key] &&
                    <ul>
                      {Object.entries(voice.speaker_id_map).map(([speakerName, speakerId]) =>
                        <li key={speakerId}>
                          <span className="me-1">{speakerName}</span>
                          <span className="link" onClick={() => sampler.play(voice, speakerId)}>sample</span>
                        </li>
                      )}
                    </ul>
                  }
                </td>
                <td className="align-top">{voice.language.name_native} ({voice.language.country_english})</td>
                <td className="align-top">({getStatusText(voice)})</td>
                <td className="align-top text-end">{(voice.modelFileSize /1e6).toFixed(1)}MB</td>
                <td className="align-top text-end ps-2">
                  <button type="button" className="btn btn-danger btn-sm"
                    onClick={() => onDelete(voice)}>Delete</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      }

      <h2 className="text-muted">Available to Install</h2>
      {notInstalled.length > 0 &&
        <table className="table table-borderless table-hover table-sm">
          <thead>
            <tr>
              <th>Voice Pack</th>
              <th>Language</th>
              <th></th>
              <th style={{width: "0%"}}></th>
            </tr>
          </thead>
          <tbody>
            {notInstalled.map(voice =>
              <tr key={voice.key}>
                <td>
                  <span className="me-1">{voice.name}</span>
                  <span className="me-1">[{voice.quality}]</span>
                  {voice.num_speakers <= 1 &&
                    <span className="link" onClick={() => sampler.play(voice)}>sample</span>
                  }
                  {voice.num_speakers > 1 &&
                    <span style={{cursor: "pointer"}}
                      onClick={() => toggleExpanded(voice.key)}>({voice.num_speakers} voices) {state.isExpanded[voice.key] ? '▲' : '▼'}</span>
                  }
                  {state.isExpanded[voice.key] &&
                    <ul>
                      {Object.entries(voice.speaker_id_map).map(([speakerName, speakerId]) =>
                        <li key={speakerId}>
                          <span className="me-1">{speakerName}</span>
                          <span className="link" onClick={() => sampler.play(voice, speakerId)}>sample</span>
                        </li>
                      )}
                    </ul>
                  }
                </td>
                <td className="align-top">{voice.language.name_native} ({voice.language.country_english})</td>
                <td className="align-top text-end">{(voice.modelFileSize /1e6).toFixed(1)}MB</td>
                <td className="align-top text-end ps-2">
                  <InstallButton voice={voice} onInstall={onInstall} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      }
    </div>
  )


  //controllers

  function handleError(err: unknown) {
    console.error(err)
    appendActivityLog(String(err))
  }

  function appendActivityLog(text: string) {
    stateUpdater(draft => {
      draft.activityLog += "\n" + text
    })
  }

  function toggleExpanded(voiceKey: string) {
    stateUpdater(draft => {
      draft.isExpanded[voiceKey] = !draft.isExpanded[voiceKey]
    })
  }

  async function onInstall(voice: MyVoice, onProgress: (percent: number) => void) {
    try {
      stateUpdater(draft => {
        draft.voiceList!.find(x => x.key == voice.key)!.installState = "installing"
      })
      const {model, modelConfig} = await installVoice(voice, onProgress)
      const synth = await createSynthesizer(model, modelConfig)
      stateUpdater(draft => {
        draft.voiceList!.find(x => x.key == voice.key)!.installState = "installed"
        draft.synthesizers[voice.key] = synth
      })
    }
    catch (err) {
      handleError(err)
    }
  }

  async function onDelete(voice: MyVoice) {
    try {
      await deleteVoice(voice)
      stateUpdater(draft => {
        draft.voiceList!.find(x => x.key == voice.key)!.installState = "not-installed"
      })
    }
    catch (err) {
      handleError(err)
    }
  }
  
  function getStatusText(voice: MyVoice) {
    const synth = state.synthesizers[voice.key]
    if (synth) {
      if (synth.isBusy) return "in use"
      else return "in memory"
    }
    else {
      return "on disk"
    }
  }

  async function onSpeak({utterance, voiceName, pitch, rate, volume}: Record<string, unknown>) {
    if (!(
      typeof utterance == "string" &&
      typeof voiceName == "string" &&
      (typeof pitch == "number" || typeof pitch == "undefined") &&
      (typeof rate == "number" || typeof rate == "undefined") &&
      (typeof volume == "number" || typeof volume == "undefined")
    )) {
      throw new Error("Bad args")
    }
    const {modelId, speakerName} = parseAdvertisedVoiceName(voiceName)
    const voice = state.voiceList!.find(({key}) => key.endsWith('-' + modelId))
    if (!voice) throw new Error("Voice not found")
    const speakerId = immediate(() => {
      if (speakerName) {
        if (!(speakerName in voice.speaker_id_map)) throw new Error("Speaker name not found")
        return voice.speaker_id_map[speakerName]
      }
    })
    let synth = state.synthesizers[voice.key]
    if (!synth) {
      const {model, modelConfig} = await getInstalledVoice(voice.key)
      synth = await createSynthesizer(model, modelConfig)
      stateUpdater(draft => {
        draft.synthesizers[voice.key] = synth
      })
    }
    stateUpdater(draft => {
      const draftSynth = draft.synthesizers[voice.key]
      if (draftSynth) draftSynth.isBusy = true
    })
    try {
      const speech = await synth.speak({speakerId, utterance, pitch, rate, volume})
      return {
        speechId: speechManager.add(speech)
      }
    }
    finally {
      stateUpdater(draft => {
        const draftSynth = draft.synthesizers[voice.key]
        if (draftSynth) draftSynth.isBusy = false
      })
    }
  }

  async function onWait({speechId}: Record<string, unknown>) {
    if (typeof speechId != "string") throw new Error("Bad args")
    await speechManager.get(speechId)?.wait()
  }

  async function onPause({speechId}: Record<string, unknown>) {
    if (typeof speechId != "string") throw new Error("Bad args")
    await speechManager.get(speechId)?.pause()
  }

  async function onResume({speechId}: Record<string, unknown>) {
    if (typeof speechId != "string") throw new Error("Bad args")
    await speechManager.get(speechId)?.resume()
  }

  async function onStop({speechId}: Record<string, unknown>) {
    if (typeof speechId != "string") throw new Error("Bad args")
    await speechManager.get(speechId)?.stop()
  }

  function onSubmitTest(event: React.FormEvent) {
    event.preventDefault()
    const form = event.target as any
    if (form.text.value && form.voice.value) {
      onSpeak({
        utterance: form.text.value,
        voiceName: form.voice.value
      })
    }
  }
}



function InstallButton({voice, onInstall}: {
  voice: MyVoice
  onInstall(voice: MyVoice, onProgress: (percent: number) => void): void
}) {
  const [percent, setPercent] = React.useState<number>(0)

  React.useEffect(() => {
    if (voice.installState == "not-installed") setPercent(0)
  }, [voice.installState])

  const text = immediate(() => {
    switch (voice.installState) {
      case "not-installed": return "Install"
      case "installing": return Math.round(percent) + "%"
      case "installed": return "100%"
    }
  })

  return (
    <button type="button" className="btn btn-success btn-sm"
      disabled={voice.installState != "not-installed"}
      onClick={() => onInstall(voice, setPercent)}>{text}</button>
  )
}
