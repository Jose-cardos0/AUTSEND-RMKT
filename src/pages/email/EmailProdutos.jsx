import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import toast from 'react-hot-toast'
import { auth } from '../../lib/firebase'
import { getProductGroups, saveProductGroup, deleteProductGroup, getProducts, getLeads } from '../../lib/firestore'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Package, Plus, Trash2, Loader2, Check, ChevronDown, Pencil, X } from 'lucide-react'

export default function EmailProdutos() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [grupos, setGrupos] = useState([])
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
    >
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Criar grupo — lateral fixa (sticky), estilo Tracker */}
        <div className="lg:w-72 shrink-0">
          <div className="lg:sticky lg:top-24">
            <div className="rounded-2xl border border-surface-200 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
                <Plus className="w-4 h-4 text-primary-600" /> Criar grupo
              </div>
              <div className="flex flex-col gap-2">
                <input
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') criarGrupo() }}
                  placeholder="Ex.: Gekko Pan"
                  className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm"
                />
                <button onClick={criarGrupo} disabled={criando} className="btn-primary min-h-[44px] w-full justify-center">
                  {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar grupo
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Lista de grupos */}
        <div className="flex-1 min-w-0 space-y-3">
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
              <div key={grupo.id} className="app-panel rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3">
                  <button onClick={() => toggleAberto(grupo.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <Package className="w-4 h-4 text-primary-600 shrink-0" />
                    <span className="font-semibold text-stone-800 truncate">Grupo - {grupo.nome || 'Sem nome'}</span>
                    <span className="text-xs text-stone-400 shrink-0">({(grupo.produtos || []).length})</span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
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
      </div>

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
