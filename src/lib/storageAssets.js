import { ref, uploadBytes, getDownloadURL, listAll, getMetadata, deleteObject } from 'firebase/storage'
import { storage } from './firebase'

// Imagens do construtor de e-mail do usuário: users/{uid}/emailAssets/*
const pastaDoUsuario = (uid) => `users/${uid}/emailAssets`

const UM_MB = 1024 * 1024
const ALVO = Math.floor(UM_MB * 0.95) // comprime pra ~0,95 MB (margem de segurança abaixo de 1 MB)
const DIM_MAX = 1600 // e-mail não precisa de mais que ~1600px de largura/altura

/** Carrega um File de imagem num elemento Image. */
function carregarImagem(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui ler a imagem.')) }
    img.src = url
  })
}

/** Desenha a imagem num canvas no tamanho dado e devolve um Blob no formato/qualidade pedidos. */
function paraBlob(img, w, h, mime, quality) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality))
}

/**
 * Comprime a imagem no navegador pra ficar abaixo de ~1 MB (só se precisar).
 * JPEG/outros → reduz qualidade e, se preciso, dimensão. PNG (transparência) → só reduz dimensão.
 */
async function comprimirSePreciso(file) {
  if (file.size <= UM_MB) return file // já está ok
  const isPng = /png/i.test(file.type)
  const mime = isPng ? 'image/png' : 'image/jpeg'
  const img = await carregarImagem(file)
  let w = img.naturalWidth || img.width
  let h = img.naturalHeight || img.height
  // 1ª redução: limita a dimensão máxima
  if (Math.max(w, h) > DIM_MAX) {
    const r = DIM_MAX / Math.max(w, h)
    w *= r; h *= r
  }
  let quality = isPng ? undefined : 0.85
  let blob = await paraBlob(img, w, h, mime, quality)
  // vai reduzindo até caber: JPEG baixa qualidade; PNG (ou JPEG no talo) baixa dimensão
  let tentativas = 0
  while (blob && blob.size > ALVO && tentativas < 15) {
    tentativas++
    if (!isPng && quality > 0.4) {
      quality = Math.max(0.4, quality - 0.1)
    } else {
      w *= 0.85; h *= 0.85
    }
    blob = await paraBlob(img, w, h, mime, quality)
  }
  if (!blob) return file // fallback: se algo falhar, mantém o original (a regra do Storage barra se passar)
  const baseNome = (file.name || 'imagem').replace(/\.[^.]+$/, '')
  return new File([blob], `${baseNome}.${isPng ? 'png' : 'jpg'}`, { type: mime })
}

/** Sobe uma imagem pro Storage do usuário (comprimindo pra <1 MB antes) e devolve { src, name }. */
export async function uploadEmailAsset(uid, file) {
  if (!uid) throw new Error('Faça login para enviar imagens.')
  if (!file.type?.startsWith('image/')) throw new Error('Envie um arquivo de imagem.')

  // Comprime no navegador pra ficar abaixo de 1 MB (mais leve = e-mail mais rápido e melhor entrega).
  let paraEnviar = file
  try { paraEnviar = await comprimirSePreciso(file) } catch (_) { paraEnviar = file }
  if (paraEnviar.size > UM_MB) throw new Error('Não consegui deixar a imagem abaixo de 1 MB. Tente uma imagem menor.')

  const limpo = (paraEnviar.name || 'imagem').replace(/[^\w.\-]+/g, '_')
  const caminho = `${pastaDoUsuario(uid)}/${Date.now()}_${limpo}`
  const r = ref(storage, caminho)
  await uploadBytes(r, paraEnviar, { contentType: paraEnviar.type })
  const src = await getDownloadURL(r)
  return { src, name: paraEnviar.name || limpo }
}

/** Lista as imagens que o usuário já subiu (pra popular a galeria do editor). */
export async function listEmailAssets(uid) {
  if (!uid) return []
  try {
    const res = await listAll(ref(storage, pastaDoUsuario(uid)))
    const itens = await Promise.all(res.items.map(async (item) => {
      const [src, meta] = await Promise.all([getDownloadURL(item), getMetadata(item).catch(() => null)])
      return { src, name: item.name, at: meta?.timeCreated ? new Date(meta.timeCreated).getTime() : 0 }
    }))
    return itens.sort((a, b) => b.at - a.at)
  } catch (_) { return [] }
}

/** Remove uma imagem do Storage do usuário (pela URL de download). */
export async function deleteEmailAsset(src) {
  try { await deleteObject(ref(storage, src)) } catch (_) { /* ignora se já não existe */ }
}
