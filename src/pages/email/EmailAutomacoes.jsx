import { useState, useEffect, useMemo } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { auth } from '../../lib/firebase'
import { getEmailTemplates, getEmailAutomations, saveEmailAutomation } from '../../lib/firestore'
import { KIWIFY_EVENTS } from '../../lib/constants'
import PageShell, { Panel } from '../../components/PageShell'
import PageLoader from '../../components/PageLoader'
import { Mail, Zap, LayoutTemplate, ArrowRight, AlertCircle } from 'lucide-react'

export default function EmailAutomacoes() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [automations, setAutomations] = useState({})

  useEffect(() => {
    if (!user?.uid) return
    Promise.all([getEmailTemplates(user.uid), getEmailAutomations(user.uid)])
      .then(([tpls, autos]) => {
        setTemplates(tpls)
        const map = {}
        autos.forEach((a) => { map[a.evento] = a })
        setAutomations(map)
      })
      .finally(() => setLoading(false))
  }, [user?.uid])

  const setAuto = async (evento, patch) => {
    const atual = automations[evento] || { evento, ativo: false, templateId: '' }
    const novo = { ...atual, ...patch }
    setAutomations((prev) => ({ ...prev, [evento]: novo }))
    try {
      await saveEmailAutomation(user.uid, evento, { templateId: novo.templateId || '', ativo: !!novo.ativo })
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar automação')
    }
  }

  const templatesById = useMemo(() => Object.fromEntries(templates.map((t) => [t.id, t])), [templates])

  if (loading) return <PageLoader className="flex-1 min-h-0 py-10" />

  return (
    <PageShell
      badge="E-mail · Automações"
      title="Automações de E-mail"
      subtitle="Escolha qual template de e-mail é enviado em cada evento. Vários eventos podem usar o mesmo template."
    >
      {templates.length === 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>
            Você ainda não tem templates. Crie um no{' '}
            <Link to="/email/construtor" className="font-semibold underline">Construtor</Link> para poder escolher aqui.
          </span>
        </div>
      )}

      <Panel title="Eventos" icon={Zap} noPadding>
        <div className="divide-y divide-surface-100">
          {KIWIFY_EVENTS.map((ev) => {
            const auto = automations[ev.id] || { ativo: false, templateId: '' }
            const ativo = !!auto.ativo
            const tpl = templatesById[auto.templateId]
            return (
              <div key={ev.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                <div className="flex items-center gap-2 sm:w-52 shrink-0">
                  <Mail className={`w-4 h-4 ${ativo ? 'text-green-500' : 'text-stone-400'}`} />
                  <span className="font-medium text-stone-800 text-sm">{ev.label}</span>
                </div>

                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <ArrowRight className="w-4 h-4 text-stone-300 shrink-0 hidden sm:block" />
                  <select
                    value={auto.templateId || ''}
                    onChange={(e) => setAuto(ev.id, { templateId: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-200 text-sm bg-white"
                    disabled={templates.length === 0}
                  >
                    <option value="">{templates.length === 0 ? 'SEM TEMPLATE' : '— nenhum template —'}</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>

                  <button
                    type="button"
                    onClick={() => setAuto(ev.id, { ativo: !ativo })}
                    disabled={!auto.templateId}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${ativo ? 'bg-primary-500' : 'bg-stone-300'}`}
                    title={!auto.templateId ? 'Escolha um template primeiro' : ativo ? 'Desativar' : 'Ativar'}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ativo ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="sm:w-40 shrink-0 text-xs">
                  {ativo && tpl ? (
                    <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                      <LayoutTemplate className="w-3.5 h-3.5" /> {tpl.nome}
                    </span>
                  ) : (
                    <span className="text-stone-400">Inativo</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <p className="text-xs text-stone-500 leading-relaxed">
        Quando um evento chega (pela Kiwify ou por um webhook do Tracker) e há uma automação <strong>ativa</strong> com template,
        o e-mail é enviado automaticamente para o lead, com <code className="bg-surface-100 px-1 rounded">{'{nome_cliente}'}</code> e demais variáveis já preenchidas.
      </p>
    </PageShell>
  )
}
