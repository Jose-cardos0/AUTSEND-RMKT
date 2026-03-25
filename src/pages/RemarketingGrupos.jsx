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
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Enviar para grupos</h1>
        <p className="text-stone-500 mt-1 text-sm">Selecione os grupos e envie a mensagem.</p>
      </div>

      <div className="bg-white rounded-2xl border border-surface-200 shadow-card overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-surface-200 bg-surface-50/80 flex items-center gap-2">
          <Users className="w-5 h-5 text-primary-500 shrink-0" />
          <h2 className="text-base sm:text-lg font-semibold text-stone-800">Grupos</h2>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          {grupos.length === 0 ? (
            <p className="text-sm text-stone-500">Nenhum grupo salvo. Vá em Integrações, conecte o WhatsApp e clique em Puxar grupos.</p>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    value={filtroGrupos}
                    onChange={(e) => setFiltroGrupos(e.target.value)}
                    placeholder="Filtrar por nome ou ID do grupo"
                    className="w-full pl-10 pr-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <p className="text-sm text-stone-600">
                    {gruposFiltrados.length} de {grupos.length} grupo(s)
                  </p>
                  <button
                    type="button"
                    onClick={selectAllGrupos}
                    className="text-sm font-medium text-primary-600 hover:underline"
                  >
                    {gruposFiltrados.length > 0 && gruposFiltrados.every((g) => selectedGrupoIds.has(g.id))
                      ? 'Desmarcar todos'
                      : 'Selecionar todos'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 max-h-52 sm:max-h-64 overflow-auto overscroll-contain">
                {gruposFiltrados.map((g, index) => (
                  <button
                    key={g.id ? `${g.id}-${index}` : `grupo-${index}`}
                    type="button"
                    onClick={() => toggleGrupo(g.id)}
                    className={`
                      p-3 sm:p-4 min-h-[56px] rounded-xl border text-left transition text-sm touch-manipulation active:scale-[0.98]
                      ${selectedGrupoIds.has(g.id)
                        ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                        : 'border-surface-200 bg-white hover:bg-surface-50'}
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
                        <p className="text-xs text-stone-500 truncate mt-0.5">{g.id}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Mensagem para os grupos</label>
                <MessageEditor
                  value={mensagemGrupos}
                  onChange={setMensagemGrupos}
                  placeholder="Digite a mensagem que será enviada para os grupos selecionados..."
                />
              </div>
              <button
                onClick={handleEnviarParaGrupos}
                disabled={enviandoGrupos || selectedGrupos.length === 0 || !mensagemGrupos.trim() || !evolutionConfig?.nomeInstancia}
                className="btn-primary w-full py-3 min-h-[48px] touch-manipulation"
              >
                {enviandoGrupos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {enviandoGrupos ? 'Enviando...' : `Enviar para ${selectedGrupos.length} grupo(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
