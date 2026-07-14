import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../lib/firebase'
import { getEvolutionConfig } from '../lib/firestore'
import { enviarMensagemParaGrupos } from '../lib/mensagemApi'
import MessageEditor from '../components/MessageEditor'
import TemplatePicker from '../components/TemplatePicker'
import toast from 'react-hot-toast'
import {
  Users,
  MessageSquare,
  Search,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import PageShell from '../components/PageShell'
import PageLoader from '../components/PageLoader'

const GRUPOS_POR_PAGINA = 10

export default function RemarketingGrupos() {
  const [user] = useAuthState(auth)
  const [grupos, setGrupos] = useState([])
  const [evolutionConfig, setEvolutionConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedGrupoIds, setSelectedGrupoIds] = useState(new Set())
  const [mensagemGrupos, setMensagemGrupos] = useState('')
  const [enviandoGrupos, setEnviandoGrupos] = useState(false)
  const [filtroGrupos, setFiltroGrupos] = useState('')
  const [paginaGrupos, setPaginaGrupos] = useState(1)

  const gruposFiltrados = useMemo(() => {
    if (!filtroGrupos.trim()) return grupos
    const q = filtroGrupos.toLowerCase().trim()
    return grupos.filter(
      (g) =>
        (g.nome ?? g.name ?? g.subject ?? '').toLowerCase().includes(q) ||
        (g.id ?? '').toLowerCase().includes(q)
    )
  }, [grupos, filtroGrupos])

  useEffect(() => {
    if (!user?.uid) return
    getEvolutionConfig(user.uid).then((evolution) => {
      setEvolutionConfig(evolution || null)
      const g = evolution?.grupos
      const gruposArray = Array.isArray(g)
        ? g
        : g && typeof g === 'object' && Array.isArray(g.grupos)
          ? g.grupos
          : Array.isArray(g?.groups)
            ? g.groups
            : []
      setGrupos(gruposArray)
      setLoading(false)
    })
  }, [user?.uid])

  useEffect(() => {
    setPaginaGrupos(1)
  }, [filtroGrupos])

  const totalPaginasGrupos = Math.max(1, Math.ceil(gruposFiltrados.length / GRUPOS_POR_PAGINA))
  const paginaGruposAtual = Math.min(paginaGrupos, totalPaginasGrupos)
  const gruposPagina = useMemo(
    () => gruposFiltrados.slice((paginaGruposAtual - 1) * GRUPOS_POR_PAGINA, paginaGruposAtual * GRUPOS_POR_PAGINA),
    [gruposFiltrados, paginaGruposAtual]
  )

  const toggleGrupo = (id) => {
    setSelectedGrupoIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllGrupos = () => {
    const list = gruposFiltrados
    const allSelected = list.length > 0 && list.every((g) => selectedGrupoIds.has(g.id))
    if (allSelected) {
      const next = new Set(selectedGrupoIds)
      list.forEach((g) => next.delete(g.id))
      setSelectedGrupoIds(next)
    } else {
      const next = new Set(selectedGrupoIds)
      list.forEach((g) => next.add(g.id))
      setSelectedGrupoIds(next)
    }
  }

  const todosSelecionados = gruposFiltrados.length > 0 && gruposFiltrados.every((g) => selectedGrupoIds.has(g.id))

  const selectedGrupos = useMemo(
    () => grupos.filter((g) => selectedGrupoIds.has(g.id)),
    [grupos, selectedGrupoIds]
  )

  const handleEnviarParaGrupos = async () => {
    if (selectedGrupos.length === 0 || !mensagemGrupos.trim()) {
      toast.error('Selecione pelo menos um grupo e escreva a mensagem.')
      return
    }
    setEnviandoGrupos(true)
    try {
      const evolutionAtual = await getEvolutionConfig(user.uid)
      if (!evolutionAtual?.nomeInstancia) {
        setEnviandoGrupos(false)
        toast.error('Nenhuma instância conectada. Vá em Integrações, crie e conecte sua instância do WhatsApp.')
        return
      }
      await enviarMensagemParaGrupos(selectedGrupos, mensagemGrupos.trim(), evolutionAtual)
      setMensagemGrupos('')
      setSelectedGrupoIds(new Set())
      toast.success('Enviado com sucesso')
    } catch (err) {
      toast.error(err.message || 'Erro ao enviar para grupos')
    } finally {
      setEnviandoGrupos(false)
    }
  }

  if (loading) {
    return <PageLoader className="flex-1 min-h-0 py-10" />
  }

  return (
    <PageShell
      fill
      badge="WhatsApp · Grupos"
      title="Remarketing em grupos"
      right={
        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-[280px] sm:max-w-none">
          <div className="rounded-2xl border border-surface-200/90 bg-white/90 backdrop-blur-sm px-3 py-2.5 text-center shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Total</p>
            <p className="text-lg font-bold text-stone-800 tabular-nums">{grupos.length}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-white px-3 py-2.5 text-center shadow-sm shadow-emerald-500/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Filtrados</p>
            <p className="text-lg font-bold text-emerald-700 tabular-nums">{gruposFiltrados.length}</p>
          </div>
          <div className="rounded-2xl border border-primary-200/90 bg-gradient-to-br from-primary-50 to-white px-3 py-2.5 text-center shadow-sm shadow-primary-500/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">Sel.</p>
            <p className="text-lg font-bold text-primary-700 tabular-nums">{selectedGrupos.length}</p>
          </div>
        </div>
      }
    >
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row gap-2 overflow-hidden min-w-0">
        <aside className="flex flex-col shrink-0 lg:w-[min(480px,42vw)] lg:min-w-[320px] lg:max-w-lg h-[min(42dvh,320px)] lg:h-auto lg:min-h-0 overflow-hidden">
          <div className="app-panel rounded-2xl sm:rounded-3xl p-3 sm:p-4 flex flex-col h-full min-h-0 overflow-hidden">
            <h3 className="text-sm sm:text-base font-semibold text-stone-800 shrink-0 mb-2 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 shrink-0 text-primary-600" />
              Mensagem
              <TemplatePicker onPick={setMensagemGrupos} label="Template" className="ml-auto text-xs min-h-[34px] py-1.5 px-2.5" />
            </h3>
            <MessageEditor
              fillHeight
              className="flex-1 min-h-0"
              value={mensagemGrupos}
              onChange={setMensagemGrupos}
              placeholder="Digite a mensagem para os grupos selecionados..."
              showCheckout
              rows={4}
            />
            <button
              onClick={handleEnviarParaGrupos}
              disabled={enviandoGrupos || selectedGrupos.length === 0 || !mensagemGrupos.trim() || !evolutionConfig?.nomeInstancia}
              className="btn-primary mt-3 w-full py-2.5 min-h-[44px] touch-manipulation shrink-0 text-sm"
            >
              {enviandoGrupos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {enviandoGrupos ? 'Enviando...' : `Enviar (${selectedGrupos.length} grupo(s))`}
            </button>
          </div>
        </aside>

        <div className="app-panel rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col flex-1 min-h-0 min-w-0">
          <div className="p-3 sm:p-4 border-b border-surface-200 space-y-2 shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-stone-700">
                <Users className="w-4 h-4" />
                <p className="text-sm font-semibold">Seus grupos</p>
              </div>
              <button
                type="button"
                onClick={selectAllGrupos}
                className="text-sm font-medium text-primary-600 hover:underline py-0.5 touch-manipulation shrink-0"
              >
                {todosSelecionados ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                value={filtroGrupos}
                onChange={(e) => setFiltroGrupos(e.target.value)}
                placeholder="Filtrar por nome ou ID"
                className="w-full pl-10 pr-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 focus:border-surface-300 focus:ring-0 outline-none text-sm"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-stone-500">
              <Filter className="w-3.5 h-3.5" />
              <span>{gruposFiltrados.length} grupo(s) após filtros</span>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scroll-y-soft">
            {gruposFiltrados.length === 0 ? (
              <div className="p-6 sm:p-8 text-center text-stone-500 text-sm">
                {grupos.length === 0
                  ? 'Nenhum grupo salvo. Em Integrações, conecte o WhatsApp e use Puxar grupos.'
                  : 'Nenhum grupo encontrado com esse filtro.'}
              </div>
            ) : (
              <ul className="divide-y divide-surface-200">
                {gruposPagina.map((g, index) => {
                  const isSelected = selectedGrupoIds.has(g.id)
                  return (
                    <li
                      key={g.id ? `${g.id}-${index}` : `grupo-${index}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleGrupo(g.id)
                        }
                      }}
                      className={`
                        flex px-2 sm:px-4 py-3 sm:py-3.5 min-h-[56px] cursor-pointer touch-manipulation
                        transition-colors duration-150
                        ${isSelected
                          ? 'bg-primary-50/95 ring-1 ring-inset ring-primary-300/70 shadow-sm'
                          : 'hover:bg-surface-50/90 active:bg-surface-100/90'
                        }
                      `}
                      onClick={() => toggleGrupo(g.id)}
                    >
                      <div className="flex items-center gap-3 w-full min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleGrupo(g.id)
                          }}
                          className={`
                            shrink-0 p-1 min-w-[44px] min-h-[44px] flex items-center justify-center -m-1 rounded-lg touch-manipulation
                            ${isSelected ? 'text-primary-600 bg-primary-100/60' : 'text-stone-400 hover:text-primary-500 hover:bg-primary-50/50'}
                          `}
                          aria-pressed={isSelected}
                          aria-label={isSelected ? 'Desmarcar grupo' : 'Selecionar grupo'}
                        >
                          {isSelected ? <CheckCircle2 className="w-5 h-5 text-primary-600" /> : <Circle className="w-5 h-5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-stone-800 truncate">{g.nome ?? g.name ?? g.subject ?? 'Sem nome'}</p>
                          <p className="text-[11px] text-stone-500 truncate mt-0.5">{g.id}</p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {gruposFiltrados.length > GRUPOS_POR_PAGINA && (
            <div className="shrink-0 px-3 py-2.5 border-t border-surface-200 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-2">
              <p className="text-xs sm:text-sm text-stone-600 order-2 sm:order-1 text-center sm:text-left">
                Página {paginaGruposAtual} de {totalPaginasGrupos} · {gruposFiltrados.length} grupo(s)
              </p>
              <div className="flex items-center gap-2 order-1 sm:order-2 justify-center sm:justify-end">
                <button
                  type="button"
                  onClick={() => setPaginaGrupos((p) => Math.max(1, p - 1))}
                  disabled={paginaGruposAtual <= 1}
                  className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPaginaGrupos((p) => Math.min(totalPaginasGrupos, p + 1))}
                  disabled={paginaGruposAtual >= totalPaginasGrupos}
                  className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl border border-surface-200 bg-white text-sm font-medium text-stone-700 hover:bg-surface-50 disabled:opacity-50 disabled:pointer-events-none touch-manipulation flex-1 sm:flex-initial"
                >
                  Próxima
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
