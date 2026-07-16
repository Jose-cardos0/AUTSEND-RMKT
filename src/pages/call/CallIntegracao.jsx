import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthState } from 'react-firebase-hooks/auth'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../../lib/firebase'
import PageShell, { Panel } from '../../components/PageShell'
import { usePlano } from '../../lib/PlanoContext'
import { Phone, Check, Loader2, Sparkles, ShieldCheck, CreditCard } from 'lucide-react'

export default function CallIntegracao() {
  const [user] = useAuthState(auth)
  const { canal: canalParam } = useParams()
  const canal = canalParam === 'api' ? 'api' : 'eua'
  const plano = usePlano()
  const [ativando, setAtivando] = useState(false)
  const [vozAtiva, setVozAtiva] = useState(false)

  useEffect(() => { setVozAtiva(!!plano?.temCallVoz) }, [plano?.temCallVoz])

  const ativarVoz = async () => {
    setAtivando(true)
    try {
      const fn = httpsCallable(functions, 'callAtivarVozNoChip')
      const r = await fn({})
      setVozAtiva(true)
      toast.success(`Voz ativada em ${r.data?.ativados || 1} número(s)! Já pode ligar com IA.`)
    } catch (err) {
      toast.error(err.message || 'Não consegui ativar a voz.')
    } finally {
      setAtivando(false)
    }
  }

  return (
    <PageShell
      badge={`Call · Integração · ${canal === 'api' ? "API's" : 'EUA'}`}
      subtitle="Ative a Ligação IA no seu número e comece a recuperar vendas por voz."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Ativar voz no chip */}
        <Panel title="Ativar voz no meu chip (EUA)" icon={Phone}>
          <p className="text-sm text-stone-600 leading-relaxed">
            O mesmo número que você já usa no SMS também faz ligações. Ativar é grátis — habilita a voz
            do seu chip pra IA ligar pros seus contatos.
          </p>
          {vozAtiva ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-emerald-700 text-sm font-medium">
              <Check className="w-5 h-5 shrink-0" /> Voz ativada no seu chip. Tudo pronto pra ligar.
            </div>
          ) : (
            <button
              onClick={ativarVoz}
              disabled={ativando}
              className="btn-primary w-full sm:w-auto min-h-[44px]"
            >
              {ativando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
              Ativar voz no meu chip
            </button>
          )}
          <p className="text-xs text-stone-400">
            Ainda não tem um número? <Link to="/sms/integracao" className="text-primary-600 hover:underline">Compre um chip EUA em SMS → Integração</Link>.
          </p>
        </Panel>

        {/* Como funciona / créditos */}
        <Panel title="Como funciona a Ligação IA" icon={Sparkles}>
          <ul className="text-sm text-stone-600 space-y-2.5">
            <li className="flex gap-2"><Sparkles className="w-4 h-4 text-primary-600 shrink-0 mt-0.5" /> A IA (Grok) escreve o roteiro e liga pro seu contato falando com voz natural em português.</li>
            <li className="flex gap-2"><CreditCard className="w-4 h-4 text-primary-600 shrink-0 mt-0.5" /> Você paga por <b>minuto de ligação</b> (R$ 1,50/min), debitado por segundo. Só cobra ligação atendida.</li>
            <li className="flex gap-2"><ShieldCheck className="w-4 h-4 text-primary-600 shrink-0 mt-0.5" /> Seu plano já inclui <b>{plano?.callMin === -1 ? '∞' : (plano?.callMin ?? 0)} min/mês</b> grátis. Precisou de mais? Compre minutos no Perfil.</li>
          </ul>
          <Link to="/perfil" className="btn-secondary w-full sm:w-auto min-h-[44px] mt-1">
            <CreditCard className="w-4 h-4" /> Comprar minutos de ligação
          </Link>
        </Panel>
      </div>
    </PageShell>
  )
}
