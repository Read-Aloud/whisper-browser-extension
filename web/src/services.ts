import { Message, makeDispatcher } from "@lsdsoftware/message-dispatcher"
import * as rxjs from "rxjs"
import config from "./config"
import { deleteFile, getFile } from "./storage"
import { AdvertisedVoice, ExecutionState, InstallState, LoadState, ModelConfig, MyVoice, PiperVoice, PlaybackCommand } from "./types"
import { fetchWithProgress, immediate } from "./utils"


export async function getVoiceList(): Promise<MyVoice[]> {
  const blob = await getFile("voices.json", () => piperFetch("voices.json"))
  const voicesJson: Record<string, PiperVoice> = await blob.text().then(JSON.parse)
  const voiceList = Object.values(voicesJson)
    .filter(voice => !config.excludeVoices.has(voice.key))
    .map(voice => {
      const modelFile = Object.keys(voice.files).find(x => x.endsWith(".onnx"))
      if (!modelFile) throw new Error("Can't identify model file for " + voice.name)
      return {
        ...voice,
        modelFile,
        modelFileSize: voice.files[modelFile].size_bytes,
        installState: "not-installed" as InstallState,
        loadState: "not-loaded" as LoadState,
        numActiveUsers: 0,
      }
    })
  for (const voice of voiceList) {
    voice.installState = await getFile(voice.key + ".onnx")
      .then(() => "installed" as const)
      .catch(err => "not-installed")
  }
  return voiceList
}


export async function getInstalledVoice(voiceKey: string) {
  const [model, modelConfig] = await Promise.all([
    getFile(voiceKey + ".onnx"),
    getFile(voiceKey + ".json")
  ])
  return {
    model,
    modelConfig: JSON.parse(await modelConfig.text()) as ModelConfig
  }
}


export async function installVoice(voice: MyVoice, onProgress: (percent: number) => void) {
  const [model, modelConfig] = await Promise.all([
    getFile(voice.key + ".onnx", () => piperFetch(voice.modelFile, onProgress)),
    getFile(voice.key + ".json", () => piperFetch(voice.modelFile + ".json"))
  ])
  return {
    model,
    modelConfig: JSON.parse(await modelConfig.text()) as ModelConfig
  }
}


export async function deleteVoice(voiceKey: string) {
  await deleteFile(voiceKey + ".onnx")
  await deleteFile(voiceKey + ".json")
}


export function advertiseVoices(voices: readonly AdvertisedVoice[]) {
  top?.postMessage(<Message>{
    type: "notification",
    to: "piper-host",
    method: "advertiseVoices",
    args: {voices}
  }, "*")
}


export function makeAdvertisedVoiceList(voiceList: readonly MyVoice[]|null): AdvertisedVoice[]|null {
  if (voiceList == null) return null
  return voiceList
    .filter(x => x.installState == "installed")
    .flatMap<AdvertisedVoice>(voice => {
      const modelId = voice.key.split("-").slice(1).join("-")
      const lang = voice.language.code.replace(/_/g, "-")
      const eventTypes = ["start", "end", "error"]
      const speakerNames = voice.speaker_id_map ? Object.keys(voice.speaker_id_map) : []
      if (speakerNames.length) {
        return speakerNames
          .map<AdvertisedVoice>(speakerName => ({
            voiceName: `Piper ${modelId} ${speakerName} (${voice.language.name_native})`,
            lang,
            eventTypes
          }))
      }
      else {
        return {
          voiceName: `Piper ${modelId} (${voice.language.name_native})`,
          lang,
          eventTypes
        }
      }
    })
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.voiceName.localeCompare(b.voiceName))
}


export function parseAdvertisedVoiceName(name: string): {modelId: string, speakerName?: string} {
  const [piper, modelId, speakerName] = name.split(" ")
  return {
    modelId,
    speakerName: speakerName.startsWith("(") ? undefined : speakerName
  }
}


export const sampler = immediate(() => {
  const audio = new Audio()
  audio.crossOrigin = "anonymous"
  audio.autoplay = true
  return {
    play(voice: MyVoice, speakerId?: number) {
      const tokens = voice.modelFile.split("/")
      tokens.pop()
      audio.src = config.repoUrl + tokens.join("/") + "/samples/speaker_" + (speakerId ?? 0) + ".mp3"
    },
    stop() {
      audio.pause()
    }
  }
})


export async function piperFetch(file: string, onProgress?: (percent: number) => void) {
  if (onProgress) {
    return fetchWithProgress(config.repoUrl + file, onProgress)
  }
  else {
    const res = await fetch(config.repoUrl + file)
    if (!res.ok) throw new Error("Server return " + res.status)
    return res.blob()
  }
}


export const messageDispatcher = immediate(() => {
  const dispatcher = makeDispatcher<{send(msg: unknown): void}>("piper-service", {})
  addEventListener("message", event => {
    const send = (msg: unknown) => event.source!.postMessage(msg, {targetOrigin: event.origin})
    dispatcher.dispatch(event.data, {send}, send)
  })
  return dispatcher
})


export function makeExecutionState(control: rxjs.Subject<PlaybackCommand>) {
  return control.pipe(
    rxjs.scan((state: ExecutionState, cmd) => {
      if (cmd == "stop") throw {name: "interrupted", message: "Execution interrupted"}
      if (state == "resumed" && cmd == "pause") return "paused"
      if (state == "paused" && cmd == "resume") return "resumed"
      return state
    }, "resumed"),
    rxjs.startWith("resumed" as const),
    rxjs.shareReplay({bufferSize: 1, refCount: false})
  )
}
