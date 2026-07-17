import { useState } from 'react'
import { X, Lock, ShoppingCart, Loader2, Minus, Plus } from 'lucide-react'
import brlFlag from '../assets/flags/brl-flag.png'
import instanciaWhats from '../assets/whtatsicons/instancia-whats.png'

const PRECO_UNIT = 29.9
const fmtBRL = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Modal (janela estilo Safari) pra comprar instâncias avulsas de WhatsApp — R$29,90/mês cada.
 * @param {(quantidade:number)=>void} onConfirm  chamado ao clicar Comprar
 * @param {boolean} comprando  estado de loading (controlado pelo pai)
 * @param {()=>void} onClose
 */
export default function ComprarInstanciaModal({ onConfirm, comprando, onClose }) {
  const [qtd, setQtd] = useState(1)
  const dec = () => setQtd((q) => Math.max(1, q - 1))
  const inc = () => setQtd((q) => Math.min(20, q + 1))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      {/* Janela estilo Safari — 80% da tela */}
      <div
        className="relative w-[80vw] h-[80vh] max-w-[1000px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Bandeira decorativa — colada no fundo, atrás do conteúdo */}
          <img
            src={brlFlag}
            alt=""
            aria-hidden="true"
            className="pointer-events-none select-none absolute left-0 bottom-0 w-72 sm:w-[26rem] opacity-50"
            style={{ zIndex: 0 }}
          />
          {/* Barra do navegador */}
          <div className="relative z-10 flex items-center gap-2 px-4 py-2.5 border-b border-surface-200 bg-surface-50 shrink-0">
            <span className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <span className="w-3 h-3 rounded-full bg-[#28c840]" />
            </span>
            <div className="flex-1 flex justify-center">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-surface-200 text-xs text-stone-500 max-w-[70%] truncate">
                <Lock className="w-3 h-3" /> autsend.com.br · comprar instância
              </span>
            </div>
            <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600" aria-label="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Conteúdo */}
          <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-5 sm:px-10 py-8">
            <div className="max-w-lg mx-auto">
              <div className="flex items-center gap-3 mb-8">
                <img src={instanciaWhats} alt="" className="w-16 h-16 object-contain shrink-0 drop-shadow-sm" />
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-stone-800">Comprar instância de WhatsApp</h2>
                  <p className="text-sm text-stone-500 flex items-center gap-1.5">
                    <img src={brlFlag} alt="Brasil" className="w-4 h-4 rounded-sm object-cover" />
                    Brasil · <strong className="text-primary-600">{PRECO_UNIT.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês</strong>
                  </p>
                </div>
              </div>

              <p className="text-sm text-stone-600 mb-4">
                Cada instância é um número de WhatsApp a mais pra conectar e usar nas automações e disparos.
                A cobrança é mensal e você pode cancelar quando quiser.
              </p>

              {/* Seletor de quantidade */}
              <div className="rounded-2xl border border-surface-200 bg-white/70 backdrop-blur-md shadow-sm p-5">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Quantas instâncias?</p>
                <div className="flex items-center justify-between gap-4">
                  <div className="inline-flex items-center gap-1 rounded-xl border border-surface-200 bg-white p-1">
                    <button
                      onClick={dec}
                      disabled={qtd <= 1}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-600 hover:bg-surface-100 disabled:opacity-40"
                      aria-label="Diminuir"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-12 text-center text-2xl font-extrabold text-stone-800 tabular-nums">{qtd}</span>
                    <button
                      onClick={inc}
                      disabled={qtd >= 20}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-600 hover:bg-surface-100 disabled:opacity-40"
                      aria-label="Aumentar"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-stone-400">Total mensal</p>
                    <p className="text-2xl font-extrabold text-primary-600 tabular-nums">{fmtBRL(PRECO_UNIT * qtd)}</p>
                    <p className="text-xs text-stone-400">/mês</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="relative z-10 shrink-0 border-t border-surface-200 bg-white px-5 sm:px-10 py-4 flex items-center justify-between gap-3">
          <p className="text-xs text-stone-400 hidden sm:block">
            {qtd} instância(s) · {fmtBRL(PRECO_UNIT)} cada. Ativação automática após o pagamento.
          </p>
          <button
            onClick={() => onConfirm(qtd)}
            disabled={comprando}
            className="btn-primary min-h-[44px] px-6 shrink-0 disabled:opacity-50"
          >
            {comprando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
            {comprando ? 'Abrindo checkout…' : `Comprar (${qtd})`}
          </button>
        </div>
      </div>
    </div>
  )
}
