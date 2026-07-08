import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { auth, functions } from '../lib/firebase'
import { getCheckoutStores } from '../lib/firestore'
import { lojaByKey } from '../lib/lojas'
import { Sparkles, Loader2, X, ChevronLeft, Check, ShoppingBag } from 'lucide-react'

const IDIOMAS = [
  { code: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷', nome: 'Português do Brasil' },
  { code: 'en', label: 'English', flag: '🇺🇸', nome: 'Inglês (English)' },
  { code: 'es', label: 'Español', flag: '🇪🇸', nome: 'Espanhol (Español)' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪', nome: 'Alemão (Deutsch)' },
  { code: 'zh', label: '中文', flag: '🇨🇳', nome: 'Chinês simplificado (中文)' },
  { code: 'ja', label: '日本語', flag: '🇯🇵', nome: 'Japonês (日本語)' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺', nome: 'Russo (Русский)' },
]

/**
 * Botão "Criar com IA" → popup em etapas: idioma → loja → produtos/checkouts.
 * A IA escreve como vendedora e inclui os links de checkout escolhidos.
 */
export default function GerarMensagemIA({ evento, produto, onResult, className }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState('idioma')
  const [idioma, setIdioma] = useState('')
  const [stores, setStores] = useState([])
  const [lojaSel, setLojaSel] = useState(null)
  const [selProd, setSelProd] = useState({})
  const [loading, setLoading] = useState(false)

  const abrir = async () => {
    setStep('idioma'); setIdioma(''); setLojaSel(null); setSelProd({}); setOpen(true)
    try {
      const uid = auth.currentUser?.uid
      if (uid) {
        const list = await getCheckoutStores(uid)
        setStores(list.filter((s) => s.ativo && (s.produtos || []).length > 0))
      }
    } catch (_) {}
  }

  const gerar = async (lang, checkouts) => {
    setOpen(false)
    setLoading(true)
    try {
      const fn = httpsCallable(functions, 'aiGenerateMessage')
      const res = await fn({ evento: evento || 'remarketing', produto: produto || '', idioma: lang, checkouts: checkouts || [] })
      if (res.data?.mensagem) { onResult(res.data.mensagem); toast.success('Mensagem criada com IA ✨') }
      else toast.error('A IA não retornou mensagem.')
    } catch (err) {
      toast.error(err.message || 'Falha ao gerar com IA.')
    } finally {
      setLoading(false)
    }
  }

  const escolherIdioma = (lang) => {
    setIdioma(lang)
    if (stores.length > 0) setStep('loja')
    else gerar(lang, [])
  }

  const escolherLoja = (store) => { setLojaSel(store); setSelProd({}); setStep('produtos') }

  const confirmarProdutos = () => {
    const checkouts = (lojaSel?.produtos || []).filter((p) => selProd[p.id]).map((p) => ({ nome: p.nome, link: p.link }))
    gerar(idioma, checkouts)
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={loading}
        className={className || 'text-sm min-h-[44px] px-4 rounded-xl border-2 border-violet-200 text-violet-700 font-medium hover:bg-violet-50 disabled:opacity-50 flex items-center justify-center gap-2 touch-manipulation'}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {loading ? 'Criando...' : 'Criar com IA'}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              {step !== 'idioma' && (
                <button onClick={() => setStep(step === 'produtos' ? 'loja' : 'idioma')} className="p-1 text-stone-400 hover:text-stone-600"><ChevronLeft className="w-5 h-5" /></button>
              )}
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600 shrink-0"><Sparkles className="w-5 h-5" /></span>
              <h3 className="text-base font-semibold text-stone-800">
                {step === 'idioma' ? 'Idioma da mensagem' : step === 'loja' ? 'Loja da oferta' : 'Produtos / checkouts'}
              </h3>
              <button onClick={() => setOpen(false)} className="ml-auto p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
            </div>

            {/* Etapa 1 — idioma */}
            {step === 'idioma' && (
              <>
                <p className="text-xs text-stone-500">Em qual idioma a IA deve escrever?</p>
                <div className="grid grid-cols-2 gap-2">
                  {IDIOMAS.map((idi) => (
                    <button key={idi.code} type="button" onClick={() => escolherIdioma(idi.nome)} className="flex items-center gap-2 rounded-xl border-2 border-surface-200 hover:border-violet-300 hover:bg-violet-50 px-3 py-2.5 text-left transition">
                      <span className="text-xl leading-none shrink-0">{idi.flag}</span>
                      <span className="text-sm font-medium text-stone-800 truncate">{idi.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Etapa 2 — loja */}
            {step === 'loja' && (
              <>
                <p className="text-xs text-stone-500">Quer incluir um link de checkout? Escolha a loja (ou pule).</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {stores.map((s) => {
                    const loja = lojaByKey(s.loja)
                    return (
                      <button key={s.id} type="button" onClick={() => escolherLoja(s)} className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-surface-200 hover:border-violet-300 hover:bg-violet-50 px-2 py-3 transition">
                        {loja?.logo ? <img src={loja.logo} alt={loja.nome} className="h-8 max-w-[80px] object-contain" /> : <ShoppingBag className="w-6 h-6 text-stone-400" />}
                        <span className="text-[11px] font-medium text-stone-700 truncate max-w-full">{loja?.nome || s.loja}</span>
                      </button>
                    )
                  })}
                </div>
                <button onClick={() => gerar(idioma, [])} className="w-full text-sm text-stone-500 hover:text-stone-700 py-2">Pular — gerar sem checkout</button>
              </>
            )}

            {/* Etapa 3 — produtos */}
            {step === 'produtos' && (
              <>
                <p className="text-xs text-stone-500">Selecione o(s) checkout(s) que vão na mensagem:</p>
                <div className="space-y-2">
                  {(lojaSel?.produtos || []).map((p) => {
                    const sel = !!selProd[p.id]
                    return (
                      <button key={p.id} type="button" onClick={() => setSelProd((s) => ({ ...s, [p.id]: !s[p.id] }))} className={`w-full flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition ${sel ? 'border-violet-500 bg-violet-50' : 'border-surface-200 hover:border-violet-200'}`}>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-md border-2 shrink-0 ${sel ? 'bg-violet-500 border-violet-500 text-white' : 'border-surface-300'}`}>{sel && <Check className="w-3.5 h-3.5" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-stone-800 truncate">{p.nome}</span>
                          <span className="block text-[11px] text-stone-400 truncate">{p.link}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button onClick={confirmarProdutos} className="btn-primary w-full min-h-[44px]"><Sparkles className="w-4 h-4" /> Gerar mensagem</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
