/* Kit visual da Documentação — peças reutilizáveis no padrão do app (violeta/stone). */
import { Lightbulb, AlertTriangle, ChevronRight } from 'lucide-react'

/** Parágrafo padrão. */
export function P({ children }) {
  return <p className="text-[15px] leading-relaxed text-stone-600 mt-3">{children}</p>
}

/** Destaque em negrito. */
export function B({ children }) {
  return <b className="font-semibold text-stone-800">{children}</b>
}

/** Subtítulo dentro do artigo. */
export function H({ children }) {
  return <h3 className="text-lg font-bold text-stone-800 mt-8 mb-1 flex items-center gap-2">{children}</h3>
}

/** Caminho no app: <Caminho itens={['WhatsApp', 'Integrações']} /> */
export function Caminho({ itens = [] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-primary-50 border border-primary-100 px-2 py-1 text-[12.5px] font-semibold text-primary-700 align-middle">
      {itens.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="w-3 h-3 text-primary-300" />}
          {it}
        </span>
      ))}
    </span>
  )
}

/** Passo a passo numerado. itens = [ReactNode, ...] */
export function Passos({ itens = [] }) {
  return (
    <ol className="mt-4 space-y-3">
      {itens.map((p, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white text-[12px] font-bold shadow-sm mt-0.5">
            {i + 1}
          </span>
          <span className="text-[15px] leading-relaxed text-stone-600 min-w-0">{p}</span>
        </li>
      ))}
    </ol>
  )
}

/** Dica (callout violeta). */
export function Dica({ children }) {
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary-100 bg-primary-50/60 p-3.5">
      <Lightbulb className="w-4 h-4 text-primary-600 shrink-0 mt-0.5" />
      <div className="text-[13.5px] leading-relaxed text-stone-600"><b className="text-primary-700">Dica:</b> {children}</div>
    </div>
  )
}

/** Atenção (callout âmbar). */
export function Atencao({ children }) {
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="text-[13.5px] leading-relaxed text-stone-600"><b className="text-amber-700">Atenção:</b> {children}</div>
    </div>
  )
}

/** Tabela responsiva. colunas = ['A', 'B'], linhas = [[..],[..]] */
export function Tabela({ colunas = [], linhas = [] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-surface-200">
      <table className="w-full text-sm min-w-[480px]">
        <thead>
          <tr className="bg-surface-50">
            {colunas.map((c, i) => (
              <th key={i} className="px-3.5 py-2.5 text-left text-[12px] font-bold uppercase tracking-wide text-stone-500 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-t border-surface-100">
              {l.map((cel, j) => (
                <td key={j} className={`px-3.5 py-2.5 text-stone-600 ${j === 0 ? 'font-semibold text-stone-800 whitespace-nowrap' : ''}`}>{cel}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Lista com marcadores (check violeta). */
export function Lista({ itens = [] }) {
  return (
    <ul className="mt-3 space-y-2">
      {itens.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[15px] leading-relaxed text-stone-600">
          <span className="mt-[9px] h-1.5 w-1.5 rounded-full bg-primary-400 shrink-0" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  )
}

/** Etiqueta pequena (ex.: nome de evento, valor). */
export function Tag({ children, tom = 'violet' }) {
  const cores = {
    violet: 'bg-primary-50 text-primary-700 border-primary-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    stone: 'bg-surface-100 text-stone-600 border-surface-200',
  }
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap ${cores[tom] || cores.violet}`}>{children}</span>
}

/** Trecho de código / valor pra copiar (inline). */
export function Code({ children }) {
  return <code className="rounded-md bg-surface-100 border border-surface-200 px-1.5 py-0.5 text-[13px] font-mono text-stone-700 break-all">{children}</code>
}
