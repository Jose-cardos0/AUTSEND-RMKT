import { useState, useEffect } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../lib/firebase'
import { getCheckoutStores, saveCheckoutStore, deleteCheckoutStore } from '../lib/firestore'
import { LOJAS, lojaByKey } from '../lib/lojas'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'
import { Plus, Trash2, ChevronDown, Loader2, X, Link2, ShoppingBag, HelpCircle } from 'lucide-react'

const genId = () => 'p_' + Math.random().toString(36).slice(2, 9)

export default function Checkouts() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState([])
  const [abertos, setAbertos] = useState({})
  const [showAddLoja, setShowAddLoja] = useState(false)
  const [novoProduto, setNovoProduto] = useState({})
  const [delLoja, setDelLoja] = useState(null)

  useEffect(() => {
    if (!user?.uid) return
    getCheckoutStores(user.uid).then(setStores).finally(() => setLoading(false))
  }, [user?.uid])

  const reload = async () => setStores(await getCheckoutStores(user.uid))
  const toggleAberto = (id) => setAbertos((o) => ({ ...o, [id]: !o[id] }))

  const addLoja = async (lojaKey) => {
    try {
      const id = await saveCheckoutStore(user.uid, null, { loja: lojaKey, ativo: true, produtos: [] })
      setShowAddLoja(false)
      await reload()
      setAbertos((o) => ({ ...o, [id]: true }))
      toast.success(`${lojaByKey(lojaKey)?.nome || 'Loja'} adicionada.`)
    } catch (err) {
      toast.error(err.message || 'Erro ao adicionar loja')
    }
  }

  const toggleAtivo = async (store) => {
    const novo = !store.ativo
    setStores((s) => s.map((x) => (x.id === store.id ? { ...x, ativo: novo } : x)))
    try { await saveCheckoutStore(user.uid, store.id, { ativo: novo }) } catch { toast.error('Erro ao salvar'); reload() }
  }

  const addProduto = async (store) => {
    const np = novoProduto[store.id] || {}
    const nome = (np.nome || '').trim()
    const link = (np.link || '').trim()
    if (!nome || !link) { toast.error('Preencha nome e link do checkout.'); return }
    const produtos = [...(store.produtos || []), { id: genId(), nome, link }]
    setStores((s) => s.map((x) => (x.id === store.id ? { ...x, produtos } : x)))
    setNovoProduto((n) => ({ ...n, [store.id]: { nome: '', link: '' } }))
    try { await saveCheckoutStore(user.uid, store.id, { produtos }) } catch { toast.error('Erro ao salvar'); reload() }
  }

  const removeProduto = async (store, prodId) => {
    const produtos = (store.produtos || []).filter((p) => p.id !== prodId)
    setStores((s) => s.map((x) => (x.id === store.id ? { ...x, produtos } : x)))
    try { await saveCheckoutStore(user.uid, store.id, { produtos }) } catch { toast.error('Erro ao salvar'); reload() }
  }

  const excluirLoja = async () => {
    if (!delLoja) return
    try {
      await deleteCheckoutStore(user.uid, delLoja.id)
      setStores((s) => s.filter((x) => x.id !== delLoja.id))
      toast.success('Loja removida.')
    } catch (err) {
      toast.error(err.message || 'Erro ao remover')
    } finally {
      setDelLoja(null)
    }
  }

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell
      badge="Geral · Checkouts"
      title="Checkouts"
      right={
        <button onClick={() => setShowAddLoja(true)} className="btn-primary text-sm min-h-[44px]"><Plus className="w-4 h-4" /> Adicionar loja</button>
      }
    >
      <div className="space-y-3">
        {stores.length === 0 ? (
          <Panel>
            <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-violet-100 text-primary-600"><ShoppingBag className="w-7 h-7" /></span>
              <h2 className="text-lg font-semibold text-stone-800">Nenhuma loja ainda</h2>
              <p className="text-sm text-stone-500 max-w-md leading-relaxed">Catalogue suas lojas e os links de checkout dos produtos. Depois a IA usa esses links pra criar as ofertas.</p>
              <button onClick={() => setShowAddLoja(true)} className="btn-primary min-h-[44px]"><Plus className="w-4 h-4" /> Adicionar loja</button>
            </div>
          </Panel>
        ) : (
          stores.map((store) => {
            const loja = lojaByKey(store.loja)
            const aberto = !!abertos[store.id]
            const np = novoProduto[store.id] || {}
            return (
              <div key={store.id} className="app-panel rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-3 sm:px-4 py-3">
                  <button onClick={() => toggleAberto(store.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                    <span className="flex h-10 w-10 items-center justify-center shrink-0 overflow-hidden">
                      {loja?.logo ? <img src={loja.logo} alt={loja.nome} className="max-h-9 max-w-9 object-contain" /> : <HelpCircle className="w-5 h-5 text-stone-400" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-stone-800 truncate">{loja?.nome || (store.loja === 'custom' ? 'Outra' : store.loja)}</span>
                      <span className="block text-[11px] text-stone-400">{(store.produtos || []).length} produto(s)</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAtivo(store)}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${store.ativo ? 'bg-primary-500' : 'bg-stone-300'}`}
                    title={store.ativo ? 'Ativa' : 'Inativa'}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${store.ativo ? 'translate-x-5' : ''}`} />
                  </button>
                  <button onClick={() => setDelLoja(store)} className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 shrink-0" title="Remover loja"><Trash2 className="w-4 h-4" /></button>
                  <button onClick={() => toggleAberto(store.id)} className="p-1 text-stone-400 shrink-0"><ChevronDown className={`w-4 h-4 transition-transform ${aberto ? 'rotate-180' : ''}`} /></button>
                </div>

                {aberto && (
                  <div className="px-3 sm:px-4 pb-4 pt-1 space-y-3 border-t border-surface-100">
                    {(store.produtos || []).length > 0 && (
                      <div className="space-y-2">
                        {(store.produtos || []).map((p) => (
                          <div key={p.id} className="flex items-center gap-2 rounded-xl border border-surface-200 bg-surface-50/50 px-3 py-2">
                            <Link2 className="w-4 h-4 text-primary-500 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-stone-800 truncate">{p.nome}</span>
                              <span className="block text-[11px] text-stone-400 truncate">{p.link}</span>
                            </span>
                            <button onClick={() => removeProduto(store, p.id)} className="p-1.5 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 shrink-0" title="Remover"><X className="w-4 h-4" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Adicionar produto */}
                    <div className="rounded-xl border border-surface-200 p-3 space-y-2">
                      <p className="text-xs font-medium text-stone-600 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Adicionar produto</p>
                      <input
                        value={np.nome || ''}
                        onChange={(e) => setNovoProduto((n) => ({ ...n, [store.id]: { ...np, nome: e.target.value } }))}
                        placeholder="Nome do produto (ex.: Gekko Pan)"
                        className="w-full px-3 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm"
                      />
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          value={np.link || ''}
                          onChange={(e) => setNovoProduto((n) => ({ ...n, [store.id]: { ...np, link: e.target.value } }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') addProduto(store) }}
                          placeholder="Link do checkout (ex.: https://pay.loja.com/...)"
                          className="flex-1 px-3 py-2 min-h-[40px] rounded-lg border border-surface-200 text-sm"
                        />
                        <button onClick={() => addProduto(store)} className="btn-primary min-h-[40px] text-sm shrink-0"><Plus className="w-4 h-4" /> Adicionar</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Popup: escolher loja */}
      {showAddLoja && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowAddLoja(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><ShoppingBag className="w-5 h-5" /></span>
              <h3 className="text-base font-semibold text-stone-800">Escolher loja</h3>
              <button onClick={() => setShowAddLoja(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {LOJAS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => addLoja(l.key)}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-surface-200 hover:border-primary-300 hover:bg-primary-50 px-3 py-4 transition"
                >
                  <img src={l.logo} alt={l.nome} className="h-10 max-w-[100px] object-contain" />
                  <span className="text-xs font-medium text-stone-700">{l.nome}</span>
                </button>
              ))}
              {/* Loja que não temos nas logos */}
              <button
                type="button"
                onClick={() => addLoja('custom')}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-surface-200 hover:border-primary-300 hover:bg-primary-50 px-3 py-4 transition"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100 text-stone-400"><HelpCircle className="w-6 h-6" /></span>
                <span className="text-xs font-medium text-stone-700">Outra</span>
              </button>
            </div>
            <p className="text-[11px] text-stone-400">Pode adicionar a mesma loja mais de uma vez (ex.: contas diferentes).</p>
          </div>
        </div>
      )}

      {/* Popup: confirmar exclusão */}
      {delLoja && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setDelLoja(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-stone-800 font-medium">Remover <strong>{lojaByKey(delLoja.loja)?.nome || delLoja.loja}</strong> e seus {(delLoja.produtos || []).length} produto(s)?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelLoja(null)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={excluirLoja} className="min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Remover</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
