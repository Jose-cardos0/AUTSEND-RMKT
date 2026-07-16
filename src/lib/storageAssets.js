import { ref, uploadBytes, getDownloadURL, listAll, getMetadata, deleteObject } from 'firebase/storage'
import { storage } from './firebase'

// Imagens do construtor de e-mail do usuário: users/{uid}/emailAssets/*
const pastaDoUsuario = (uid) => `users/${uid}/emailAssets`

/** Sobe uma imagem pro Storage do usuário e devolve { src, name }. */
export async function uploadEmailAsset(uid, file) {
  if (!uid) throw new Error('Faça login para enviar imagens.')
  if (!file.type?.startsWith('image/')) throw new Error('Envie um arquivo de imagem.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 10 MB).')
  const limpo = (file.name || 'imagem').replace(/[^\w.\-]+/g, '_')
  const caminho = `${pastaDoUsuario(uid)}/${Date.now()}_${limpo}`
  const r = ref(storage, caminho)
  await uploadBytes(r, file, { contentType: file.type })
  const src = await getDownloadURL(r)
  return { src, name: file.name || limpo }
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
