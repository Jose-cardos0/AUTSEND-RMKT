import { useState, useEffect } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../lib/firebase'
import { getEvolutionConfig } from '../lib/firestore'
import { enviarMensagemWhatsApp } from '../lib/mensagemApi'
import MessageEditor from '../components/MessageEditor'
import { Send, Loader2, AlertCircle, UserPlus } from 'lucide-react'

export default function EnviarMensagem() {
  const [user] = useAuthState(auth)
  const [evolution, setEvolution] = useState(null)
  const [lista, setLista] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  useEffect(() => {
    if (!user?.uid) return
    getEvolutionConfig(user.uid).then(setEvolution)
  }, [user?.uid])

  const parseLista = (text) => {
    const lines = text
      .trim()
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return lines.map((line) => {
      const parts = line.split(/[\t,;]/).map((p) => p.trim())
      const telefone = parts[0]?.replace(/\D/g, '') || parts[0]
      const nome = parts[1] || ''
      return { telefone, nome }
    })
  }

  const handleEnviar = async () => {
    const contatos = parseLista(lista)
    if (contatos.length === 0 || !mensagem.trim()) {
      setMsg({ type: 'error', text: 'Adicione pelo menos um número e escreva a mensagem.' })
      return
    }
    setEnviando(true)
    setMsg({ type: '', text: '' })
    try {
      const evolutionAtual = await getEvolutionConfig(user.uid)
      if (!evolutionAtual?.nomeInstancia) {
        setMsg({ type: 'error', text: 'Nenhuma instância conectada. Conecte sua instância em Integrações.' })
        return
      }
      await enviarMensagemWhatsApp(contatos, mensagem.trim(), evolutionAtual?.instanceId ?? evolutionAtual?.hash)
      setMsg({ type: 'success', text: `Mensagem enviada para ${contatos.length} contato(s).` })
      setMensagem('')
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Erro ao enviar mensagem' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Enviar mensagem</h1>
        <p className="text-gray-500 mt-1">
          Envie mensagens para uma lista de leads (números separados por linha). Conecta ao webhook WhatsApp.
        </p>
      </div>

      {msg.text && (
        <div
          className={`
            flex items-center gap-2 p-4 rounded-xl border
            ${msg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : ''}
            ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : ''}
          `}
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{msg.text}</span>
        </div>
      )}

      {!evolution?.conectado && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Conecte uma instância do WhatsApp em Integrações para enviar mensagens.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
          <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            Lista de contatos
          </h3>
          <p className="text-sm text-gray-500 mb-3">
            Um contato por linha. Formato: número ou número,nome (telefone pode ter vírgula ou ponto).
          </p>
          <textarea
            value={lista}
            onChange={(e) => setLista(e.target.value)}
            placeholder={'5511999999999\n5521988888888,João\n5531977777777;Maria'}
            rows={12}
            className="w-full p-4 rounded-xl border border-surface-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none text-sm font-mono"
          />
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-3">Mensagem</h3>
            <MessageEditor
              value={mensagem}
              onChange={setMensagem}
              placeholder="Digite a mensagem que será enviada para todos os contatos..."
            />
            <button
              onClick={handleEnviar}
              disabled={enviando || !lista.trim() || !mensagem.trim()}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary-500 text-white font-medium hover:bg-primary-600 disabled:opacity-50"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {enviando ? 'Enviando...' : 'Enviar mensagem'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
