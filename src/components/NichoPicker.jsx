import { useState } from 'react'
import { useAuthState } from 'react-firebase-hooks/auth'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { auth } from '../lib/firebase'
import { getNichos, getLeads, getProductGroups } from '../lib/firestore'
import { buildProdutoLojas, resolverNicho, contatosParaLinhas } from '../lib/nichos'
import { Layers, X, Loader2, Users } from 'lucide-react'

/**
 * Botão + popup pra escolher um nicho salvo e preencher a lista de disparo.
 * @param {'whatsapp'|'email'} tipo formato dos contatos
 * @param {(linhas:string[])=>void} onPick recebe as linhas prontas (número,nome / email,nome)
 */
export default function NichoPicker({ tipo, onPick, label = 'Nicho', className = '', iconOnly = false }) {
  const [user] = useAuthState(auth)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [nichos, setNichos] = useState([])
  const [leads, setLeads] = useState([])
  const [produtoLojas, setProdutoLojas] = useState(new Map())

  const abrir = async () => {
    setOpen(true)
    if (!user?.uid) return
    setLoading(true)
    try {
      const [ns, lds, pgs] = await Promise.all([getNichos(user.uid), getLeads(user.uid), getProductGroups(user.uid)])
      setNichos(ns); setLeads(lds); setProdutoLojas(buildProdutoLojas(pgs))
    } catch (e) {
      toast.error('Erro ao carregar nichos.')
    } finally { setLoading(false) }
  }

  const linhasDo = (n) => contatosParaLinhas(resolverNicho(n, leads, produtoLojas), tipo)

  const escolher = (n) => {
    const linhas = linhasDo(n)
    if (linhas.length === 0) { toast.error(tipo === 'whatsapp' ? 'Esse nicho não tem contatos com telefone.' : 'Esse nicho não tem contatos com e-mail.'); return }
    onPick(linhas)
    setOpen(false)
    toast.success(`${linhas.length} contato(s) do nicho "${n.nome}" adicionados.`)
  }

  return (
    <>
      {iconOnly ? (
        <button type="button" onClick={abrir} title={label} className={clsx('p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-700 hover:bg-surface-200 transition-colors touch-manipulation', className)}>
          <Layers className="w-4 h-4" />
        </button>
      ) : (
        <button type="button" onClick={abrir} className={clsx('inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-surface-200 bg-white text-stone-600 hover:text-primary-700 hover:border-primary-200 hover:bg-primary-50/50 text-sm font-medium transition-colors', className)}>
          <Layers className="w-4 h-4" /> {label}
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-3 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-1 shrink-0">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0"><Layers className="w-4 h-4" /></span>
                <h3 className="text-sm font-semibold text-stone-800 flex-1">Escolher nicho</h3>
                <button onClick={() => setOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
              </div>
              {loading ? (
                <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
              ) : nichos.length === 0 ? (
                <p className="px-2 py-8 text-sm text-stone-500 text-center leading-relaxed">Nenhum nicho criado ainda.<br />Crie em <strong>Banco de Leads → Nichos</strong>.</p>
              ) : (
                <ul className="space-y-1.5 overflow-y-auto scroll-y-soft">
                  {nichos.map((n) => {
                    const qtd = linhasDo(n).length
                    return (
                      <li key={n.id}>
                        <button type="button" onClick={() => escolher(n)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-primary-50/40 text-left transition-colors">
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden bg-primary-50 shrink-0">
                            {n.imagem ? <img src={n.imagem} alt="" className="h-full w-full object-contain" /> : <Users className="w-5 h-5 text-primary-400" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-stone-800 truncate">{n.nome || 'Sem nome'}</span>
                            <span className="block text-[11px] text-stone-400">{qtd} contato(s) {tipo === 'whatsapp' ? 'com telefone' : 'com e-mail'}{n.tipo === 'dinamico' ? ' · dinâmico' : ''}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
