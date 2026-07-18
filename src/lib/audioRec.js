// Gravação de áudio do microfone → WAV.
// A Telnyx toca MP3/WAV a partir de uma URL. O MediaRecorder do navegador gera webm/opus,
// então gravamos e convertemos pra WAV (16-bit PCM, mono) antes de subir pro Storage.

/** Converte um AudioBuffer em WAV mono 16-bit PCM (ArrayBuffer). */
function audioBufferToWavMono(buffer) {
  const nChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const len = buffer.length
  // Downmix pra mono (média dos canais).
  const data = new Float32Array(len)
  for (let ch = 0; ch < nChannels; ch++) {
    const chData = buffer.getChannelData(ch)
    for (let i = 0; i < len; i++) data[i] += chData[i] / nChannels
  }

  const bytesPerSample = 2
  const blockAlign = bytesPerSample // mono
  const byteRate = sampleRate * blockAlign
  const dataSize = len * bytesPerSample
  const ab = new ArrayBuffer(44 + dataSize)
  const view = new DataView(ab)
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let off = 44
  for (let i = 0; i < len; i++) {
    let s = Math.max(-1, Math.min(1, data[i]))
    s = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(off, s, true)
    off += 2
  }
  return ab
}

/** Converte um Blob de áudio qualquer (webm/ogg/...) pra WAV mono. */
export async function blobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer()
  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    return new Blob([audioBufferToWavMono(audioBuffer)], { type: 'audio/wav' })
  } finally {
    ctx.close()
  }
}

/**
 * Cria um gravador do microfone. Uso:
 *   const rec = await criarGravador()
 *   rec.start()
 *   ...
 *   const { wavBlob, url, segundos } = await rec.stop()   // já converte pra WAV
 *   rec.dispose()
 */
export async function criarGravador() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
  const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
  const chunks = []
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
  let iniciadoMs = 0

  return {
    start() { chunks.length = 0; iniciadoMs = performance.now(); mr.start() },
    stop() {
      return new Promise((resolve, reject) => {
        mr.onstop = async () => {
          try {
            const raw = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
            const wavBlob = await blobToWav(raw)
            const url = URL.createObjectURL(wavBlob)
            const segundos = Math.round((performance.now() - iniciadoMs) / 1000)
            resolve({ wavBlob, url, segundos })
          } catch (err) { reject(err) }
        }
        mr.stop()
      })
    },
    dispose() { try { stream.getTracks().forEach((t) => t.stop()) } catch (_) {} },
    get state() { return mr.state },
  }
}
