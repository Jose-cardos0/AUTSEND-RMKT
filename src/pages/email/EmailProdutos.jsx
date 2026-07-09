import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../../lib/firebase'
import { getProductGroups, saveProductGroup, deleteProductGroup, getProducts, getLeads } from '../../lib/firestore'
import { LOJAS, lojaByKey } from '../../lib/lojas'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Package, Plus, Trash2, Loader2, Check, ChevronDown, Pencil, X } from 'lucide-react'

export default function EmailProdutos() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [grupos, setGrupos] = useState([])
  const [lojaPopup, setLojaPopup] = useState(null)
  const [lojaSelTemp, setLojaSelTemp] = useState(new Set())
  const [logoAtivo, setLogoAtivo] = useState(null)
  const [showCriar, setShowCriar] = useState(false)
  const [nomesDisponiveis, setNomesDisponiveis] = useState([])
  const [novoNome, setNovoNome] = useState('')
  const [criando, setCriando] = useState(false)
  const [abertos, setAbertos] = useState({})
  const [confirmExcluir, setConfirmExcluir] = useState(null)
  const [addInput, setAddInput] = useState({})
  const [editing, setEditing] = useState(null)
  const [editValor, setEditValor] = useState('')
  const toggleAberto = (id) => setAbertos((a) => ({ ...a, [id]: !a[id] }))
  const startEdit = (grupo, nome) => { setEditing(`${grupo.id}::${nome}`); setEditValor(nome) }
  const salvarEdicao = async (grupo, antigo) => {
    const novo = editValor.trim()
    setEditing(null)
    if (!novo || novo === antigo) return
    const produtos = [...new Set((grupo.produtos || []).map((p) => (p === antigo ? novo : p)))]
    setGrupos((prev) => prev.map((g) => (g.id === grupo.id ? { ...g, produtos } : g)))
    setNomesDisponiveis((prev) => (prev.includes(novo) ? prev : [...prev, novo].sort()))
    try { await saveProductGroup(user.uid, grupo.id, { produtos }) } catch (err) { toast.error(err.message) }
  }

  const carregar = async () => {
    if (!user?.uid) return
    const [gs, prods, leads] = await Promise.all([getProductGroups(user.uid), getProducts(user.uid), getLeads(user.uid)])
    setGrupos(gs)
    const nomes = new Set()
    prods.forEach((p) => p.nome && nomes.add(p.nome))
    leads.forEach((l) => l.produto && nomes.add(l.produto))
    setNomesDisponiveis([...nomes].sort())
    setLoading(false)
  }

  useEffect(() => { carregar() }, [user?.uid])

  const criarGrupo = async () => {
    const nome = novoNome.trim()
    if (!nome) { toast.error('Dê um nome ao grupo.'); return }
    setCriando(true)
    try {
      await saveProductGroup(user.uid, null, { nome, produtos: [] })
      setNovoNome('')
      setShowCriar(false)
      setGrupos(await getProductGroups(user.uid))
      toast.success('Grupo criado.')
    } catch (err) { toast.error(err.message || 'Erro ao criar') } finally { setCriando(false) }
  }

  const toggleProduto = async (grupo, nome) => {
    const jaTem = (grupo.produtos || []).includes(nome)
    const produtos = jaTem ? grupo.produtos.filter((p) => p !== nome) : [...(grupo.produtos || []), nome]
    setGrupos((prev) => prev.map((g) => (g.id === grupo.id ? { ...g, produtos } : g)))
    try {
      await saveProductGroup(user.uid, grupo.id, { produtos })
    } catch (err) { toast.error(err.message || 'Erro ao salvar') }
  }

  const adicionarManual = async (grupo) => {
    const nome = (addInput[grupo.id] || '').trim()
    if (!nome) return
    if ((grupo.produtos || []).includes(nome)) { toast('Esse produto já está no grupo.', { icon: 'ℹ️' }); return }
    const produtos = [...(grupo.produtos || []), nome]
    setGrupos((prev) => prev.map((g) => (g.id === grupo.id ? { ...g, produtos } : g)))
    setNomesDisponiveis((prev) => (prev.includes(nome) ? prev : [...prev, nome].sort()))
    setAddInput((s) => ({ ...s, [grupo.id]: '' }))
    try { await saveProductGroup(user.uid, grupo.id, { produtos }) } catch (err) { toast.error(err.message) }
  }

  const salvarNome = async (grupo, nome) => {
    const valor = (nome || '').trim() || 'Grupo'
    setGrupos((prev) => prev.map((g) => (g.id === grupo.id ? { ...g, nome: valor } : g)))
    try { await saveProductGroup(user.uid, grupo.id, { nome: valor }) } catch (err) { toast.error(err.message) }
  }

  const openLojaPopup = (grupo) => { setLogoAtivo(null); setLojaSelTemp(new Set(grupo.lojas || [])); setLojaPopup(grupo) }
  const toggleLojaTemp = (key) => setLojaSelTemp((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const salvarLojas = async () => {
    if (!lojaPopup) return
    const gid = lojaPopup.id
    const lojas = [...lojaSelTemp]
    setGrupos((prev) => prev.map((g) => (g.id === gid ? { ...g, lojas } : g)))
    setLojaPopup(null)
    try { await saveProductGroup(user.uid, gid, { lojas }) } catch (err) { toast.error(err.message) }
  }
  const removerLoja = async (grupo, key) => {
    const lojas = (grupo.lojas || []).filter((k) => k !== key)
    setGrupos((prev) => prev.map((g) => (g.id === grupo.id ? { ...g, lojas } : g)))
    try { await saveProductGroup(user.uid, grupo.id, { lojas }) } catch (err) { toast.error(err.message) }
  }

  const confirmarExcluir = async () => {
    const grupo = confirmExcluir
    setConfirmExcluir(null)
    if (!grupo) return
    try {
      await deleteProductGroup(user.uid, grupo.id)
      setGrupos((prev) => prev.filter((g) => g.id !== grupo.id))
      toast.success('Grupo excluído.')
    } catch (err) { toast.error(err.message || 'Erro ao excluir') }
  }

  // nomes já usados em algum grupo (pra sinalizar)
  const usados = useMemo(() => {
    const m = {}
    grupos.forEach((g) => (g.produtos || []).forEach((p) => { m[p] = g.nome }))
    return m
  }, [grupos])

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell
      badge="Geral · Produtos"
      title="Grupos de produtos"
      right={
        <button onClick={() => { setNovoNome(''); setShowCriar(true) }} className="btn-primary text-sm min-h-[44px]"><Plus className="w-4 h-4" /> Criar grupo</button>
      }
    >
      <div className="space-y-3">
        {nomesDisponiveis.length === 0 && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            Ainda não recebemos nenhum produto pelos webhooks. Assim que chegar um evento com produto, os nomes aparecem aqui para você marcar nos grupos.
          </div>
        )}

        {grupos.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-6">Nenhum grupo ainda. Crie o primeiro acima.</p>
        ) : (
          grupos.map((grupo) => {
            const aberto = !!abertos[grupo.id]
            return (
              <div key={grupo.id} className={`app-panel rounded-2xl relative ${logoAtivo?.g === grupo.id ? 'z-30' : ''}`}>
                <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3">
                  <button onClick={() => toggleAberto(grupo.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <Package className="w-4 h-4 text-primary-600 shrink-0" />
                    <span className="font-semibold text-stone-800 truncate">Grupo - {grupo.nome || 'Sem nome'}</span>
                    <span className="text-xs text-stone-400 shrink-0">({(grupo.produtos || []).length})</span>
                  </button>
                  {(grupo.lojas || []).length > 0 && (
                    <div className="flex items-center gap-2 shrink-0">
                      {(grupo.lojas || []).map((key) => {
                        const loja = lojaByKey(key)
                        if (!loja) return null
                        const ativo = logoAtivo?.g === grupo.id && logoAtivo?.k === key
                        return (
                          <div key={key} className="relative">
                            <button type="button" onClick={() => setLogoAtivo(ativo ? null : { g: grupo.id, k: key })} className="block" title={loja.nome}>
                              <img src={loja.logo} alt={loja.nome} className="h-6 w-auto max-w-[64px] object-contain" />
                            </button>
                            {ativo && (
                              <div className="absolute top-full right-0 mt-1 z-40 flex items-center gap-1 bg-white rounded-lg shadow-xl border border-surface-200 p-1">
                                <button onClick={() => { removerLoja(grupo, key); setLogoAtivo(null) }} className="p-1.5 rounded-md text-stone-400 hover:bg-red-50 hover:text-red-600" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                                <button onClick={() => openLojaPopup(grupo)} className="p-1.5 rounded-md text-stone-400 hover:bg-primary-50 hover:text-primary-600" title="Editar lojas"><Pencil className="w-3.5 h-3.5" /></button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openLojaPopup(grupo)} className="p-2 rounded-lg text-stone-400 hover:bg-primary-50 hover:text-primary-600" title="Definir lojas"><Plus className="w-4 h-4" /></button>
                    <button onClick={() => setConfirmExcluir(grupo)} className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600" title="Excluir grupo"><Trash2 className="w-4 h-4" /></button>
                    <button onClick={() => toggleAberto(grupo.id)} className="p-1.5 text-stone-400"><ChevronDown className={`w-4 h-4 transition-transform ${aberto ? 'rotate-180' : ''}`} /></button>
                  </div>
                </div>
                {aberto && (
                  <div className="px-4 sm:px-5 pb-4 pt-0 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Nome do grupo</label>
                      <input
                        defaultValue={grupo.nome}
                        onBlur={(e) => salvarNome(grupo, e.target.value)}
                        className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm font-semibold text-stone-800"
                      />
                    </div>
                    <p className="text-xs font-medium text-stone-600">Produtos deste grupo (salva sozinho):</p>
                    {(grupo.produtos || []).length === 0 ? (
                      <p className="text-xs text-stone-400">Nenhum produto ainda. Adicione dos recebidos abaixo ou digite manualmente.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {(grupo.produtos || []).map((nome) => {
                          const editando = editing === `${grupo.id}::${nome}`
                          return (
                            <div key={nome} className="flex items-center gap-2 p-2 rounded-xl border border-primary-200 bg-primary-50/40">
                              {editando ? (
                                <>
                                  <input
                                    value={editValor}
                                    onChange={(e) => setEditValor(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') salvarEdicao(grupo, nome); if (e.key === 'Escape') setEditing(null) }}
                                    autoFocus
                                    className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-primary-300 text-sm font-mono"
                                  />
                                  <button onClick={() => salvarEdicao(grupo, nome)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Salvar"><Check className="w-4 h-4" /></button>
                                  <button onClick={() => setEditing(null)} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-lg" title="Cancelar"><X className="w-4 h-4" /></button>
                                </>
                              ) : (
                                <>
                                  <span className="flex-1 min-w-0 truncate text-sm text-stone-700">{nome}</span>
                                  <button onClick={() => startEdit(grupo, nome)} className="p-1.5 text-stone-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg" title="Editar nome"><Pencil className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => toggleProduto(grupo, nome)} className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Remover do grupo"><X className="w-4 h-4" /></button>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {nomesDisponiveis.filter((n) => !(grupo.produtos || []).includes(n)).length > 0 && (
                      <>
                        <p className="text-xs font-medium text-stone-600">Adicionar dos produtos recebidos:</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {nomesDisponiveis.filter((n) => !(grupo.produtos || []).includes(n)).map((nome) => {
                            const dono = usados[nome]
                            return (
                              <button key={nome} type="button" onClick={() => toggleProduto(grupo, nome)} className="flex items-center gap-2 p-2.5 rounded-xl border border-surface-200 bg-white hover:bg-surface-50 text-sm text-left">
                                <Plus className="w-3.5 h-3.5 text-primary-600 shrink-0" />
                                <span className="flex-1 min-w-0 truncate text-stone-700">{nome}</span>
                                {dono && dono !== grupo.nome && <span className="text-[10px] text-amber-600 shrink-0">em {dono}</span>}
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}

                    <div className="flex gap-2 pt-1">
                      <input
                        value={addInput[grupo.id] || ''}
                        onChange={(e) => setAddInput((s) => ({ ...s, [grupo.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') adicionarManual(grupo) }}
                        placeholder="Digitar nome exato (ex.: MEMO MAX PRO - 50% OFF)"
                        className="flex-1 min-w-0 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 text-sm"
                      />
                      <button onClick={() => adicionarManual(grupo)} className="btn-secondary text-sm min-h-[40px] shrink-0"><Plus className="w-4 h-4" /> Adicionar</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Popup: criar grupo */}
      {showCriar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowCriar(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Plus className="w-5 h-5" /></span>
              <h3 className="text-base font-semibold text-stone-800">Criar grupo</h3>
              <button onClick={() => setShowCriar(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') criarGrupo() }}
              placeholder="Ex.: Gekko Pan"
              autoFocus
              className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCriar(false)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={criarGrupo} disabled={criando} className="btn-primary min-h-[44px]">{criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar</button>
            </div>
          </div>
        </div>
      )}

      {lojaPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setLojaPopup(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0"><Package className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-stone-800 truncate">Lojas do grupo</h3>
                <p className="text-xs text-stone-500 truncate">Grupo - {lojaPopup.nome || 'Sem nome'}</p>
              </div>
              <button onClick={() => setLojaPopup(null)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-stone-500">Selecione uma ou mais lojas onde esse grupo é vendido:</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {LOJAS.map((l) => {
                const sel = lojaSelTemp.has(l.key)
                return (
                  <button key={l.key} type="button" onClick={() => toggleLojaTemp(l.key)} className={`relative flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 transition ${sel ? 'border-primary-500 bg-primary-50' : 'border-surface-200 hover:border-primary-200'}`}>
                    {sel && <Check className="w-4 h-4 text-primary-600 absolute top-1.5 right-1.5" />}
                    <img src={l.logo} alt={l.nome} className="h-9 max-w-[100px] object-contain" />
                    <span className="text-xs font-medium text-stone-700">{l.nome}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setLojaPopup(null)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={salvarLojas} className="btn-primary min-h-[44px]"><Check className="w-4 h-4" /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {confirmExcluir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setConfirmExcluir(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-stone-800 font-medium text-sm">Excluir o grupo <strong>&quot;{confirmExcluir.nome}&quot;</strong>? As automações desse grupo deixam de disparar.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmExcluir(null)} className="btn-secondary min-h-[44px]">Cancelar</button>
              <button onClick={confirmarExcluir} className="min-h-[44px] px-4 rounded-xl bg-red-500 text-white hover:bg-red-600 text-sm font-medium">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
