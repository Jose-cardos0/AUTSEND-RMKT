import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../lib/firebase'
import { getEvolutionConfig } from '../lib/firestore'
import { enviarMensagemParaGrupos } from '../lib/mensagemApi'
import MessageEditor from '../components/MessageEditor'
import toast from 'react-hot-toast'
import {
  Users,
  Search,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react'
import PageShell, { Panel } from '../components/PageShell'
import PageLoader from '../components/PageLoader'

export default function RemarketingGrupos() {
  const [user] = useAuthState(auth)
  const [grupos, setGrupos] = useState([])
  const [evolutionConfig, setEvolutionConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedGrupoIds, setSelectedGrupoIds] = useState(new Set())
  const [mensagemGrupos, setMensagemGrupos] = useState('')
  const [enviandoGrupos, setEnviandoGrupos] = useState(false)
  const [filtroGrupos, setFiltroGrupos] = useState('')

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
      badge="WhatsApp"
      title="Remarketing em grupos"
      subtitle="Grupos da Integração — selecione e envie uma mensagem para todos de uma vez."
    >
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row gap-2 overflow-hidden min-w-0">
        <Panel title="Seus grupos" icon={Users} noPadding flexFill className="min-w-0 lg:min-w-[45%]">
          <div className="flex flex-col flex-1 min-h-0 p-3 sm:p-4 gap-3">
            {grupos.length === 0 ? (
              <p className="text-sm text-stone-500">
                Nenhum grupo salvo. Em Integrações, conecte o WhatsApp e use Puxar grupos.
              </p>
            ) : (
              <>
                <div className="shrink-0 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input
                      type="text"
                      value={filtroGrupos}
                      onChange={(e) => setFiltroGrupos(e.target.value)}
                      placeholder="Filtrar por nome ou ID"
                      className="w-full pl-10 pr-3 py-2 min-h-[40px] rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-stone-600">
                    <span>
                      {gruposFiltrados.length}/{grupos.length}
                    </span>
                    <button
                      type="button"
                      onClick={selectAllGrupos}
                      className="font-medium text-primary-600 hover:underline"
                    >
                      {gruposFiltrados.length > 0 && gruposFiltrados.every((g) => selectedGrupoIds.has(g.id))
                        ? 'Desmarcar todos'
                        : 'Selecionar todos'}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto scroll-y-soft grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 content-start pr-0.5">
                  {gruposFiltrados.map((g, index) => (
                    <button
                      key={g.id ? `${g.id}-${index}` : `grupo-${index}`}
                      type="button"
                      onClick={() => toggleGrupo(g.id)}
                      className={`
                        p-2.5 sm:p-3 min-h-[52px] rounded-xl border text-left transition text-sm touch-manipulation active:scale-[0.99]
                        ${selectedGrupoIds.has(g.id)
                          ? 'border-primary-500 bg-gradient-to-br from-primary-50 to-white ring-2 ring-primary-200/80 shadow-sm'
                          : 'border-surface-200/90 bg-white/80 hover:bg-white hover:border-primary-200/50'}
                      `}
                    >
                      <div className="flex items-start gap-2">
                        {selectedGrupoIds.has(g.id) ? (
                          <CheckCircle2 className="w-4 h-4 text-primary-600 shrink-0 mt-0.5" />
                        ) : (
                          <Circle className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-stone-800 truncate">{g.nome ?? g.name ?? g.subject ?? 'Sem nome'}</p>
                          <p className="text-[11px] text-stone-500 truncate mt-0.5">{g.id}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </Panel>

        <div className="flex flex-col flex-1 min-h-0 min-w-0 lg:max-w-md xl:max-w-lg gap-2">
          <div className="app-panel rounded-2xl sm:rounded-3xl p-3 sm:p-4 flex flex-col flex-1 min-h-0 overflow-hidden">
            <label className="block text-sm font-medium text-stone-800 shrink-0 mb-2">Mensagem para os grupos</label>
            <MessageEditor
              fillHeight
              className="flex-1 min-h-0"
              value={mensagemGrupos}
              onChange={setMensagemGrupos}
              placeholder="Digite a mensagem para os grupos selecionados..."
              rows={4}
            />
            <button
              onClick={handleEnviarParaGrupos}
              disabled={enviandoGrupos || selectedGrupos.length === 0 || !mensagemGrupos.trim() || !evolutionConfig?.nomeInstancia}
              className="btn-primary w-full py-2.5 min-h-[44px] touch-manipulation shrink-0 mt-3 text-sm"
            >
              {enviandoGrupos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {enviandoGrupos ? 'Enviando...' : `Enviar (${selectedGrupos.length} grupo(s))`}
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
