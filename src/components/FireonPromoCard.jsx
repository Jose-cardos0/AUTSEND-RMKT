import { useState } from 'react'
import { Check, Play, ArrowRight, Flame } from 'lucide-react'
import chipFire from '../assets/fireon/chipfire.png'
import chipVirgem from '../assets/fireon/chipvirgem.png'
import chipAquecido from '../assets/fireon/chipaquecido.png'

const CHECKOUT = 'https://pay.kiwify.com.br/ph1JNRc'
const SITE = 'https://fireon.com.br'
const YT_ID = 'L0c-ukKzTRo'

const BENEFICIOS = [
  '7 números frios (em aquecimento)',
  '3 números quentes (parceiros)',
  'Aquecimento automático em 5 fases',
  'Conversas naturais (1x1 + grupos)',
  'Painel em tempo real',
  'Acesso por 30 dias',
]

/**
 * Card promocional cruzado do Fireon (aquecedor de chips de WhatsApp) — oferta exclusiva
 * pra clientes Autsend: 50% vitalício no plano Pro. Visual dark/fogo-verde da marca Fireon.
 */
export default function FireonPromoCard() {
  const [tocar, setTocar] = useState(false)

  return (
    <section className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-[#070d0a] shadow-xl shadow-emerald-950/40">
      {/* brilho verde de fundo */}
      <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-emerald-500/20 blur-[90px]" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-lime-500/10 blur-[90px]" />

      <div className="relative p-6 sm:p-8">
        {/* selo */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-300">
          <Flame className="h-3.5 w-3.5" /> Exclusivo cliente Autsend · 50% vitalício
        </span>

        {/* hero */}
        <div className="relative mt-4">
          {/* chip em chamas — grande, atrás dos textos */}
          <div className="pointer-events-none absolute -right-10 -top-16 z-0 hidden select-none sm:block">
            <div className="absolute inset-0 rounded-full bg-emerald-500/25 blur-3xl" />
            <img src={chipFire} alt="" className="relative h-[26rem] w-auto object-contain lg:h-[32rem]" />
          </div>

          <div className="relative z-10 max-w-md">
            <h2 className="text-3xl font-black leading-[1.05] tracking-tight text-white sm:text-4xl">
              Pare de ter número<br /><span className="text-emerald-400">banido.</span> Aqueça no<br />automático.
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-emerald-100/70">
              O <b className="text-emerald-200">Fireon</b> aquece seus chips de WhatsApp imitando um usuário humano, em 5 fases ao longo de ~3 semanas — pra você disparar campanhas sem medo de bloqueio.
            </p>

            {/* preço */}
            <div className="mt-5 flex items-end gap-3">
              <span className="text-lg font-medium text-emerald-100/40 line-through">R$ 197,90</span>
              <span className="text-4xl font-black text-white">R$ 97,90</span>
              <span className="mb-1 rounded-md bg-emerald-400/15 px-2 py-0.5 text-xs font-bold text-emerald-300">-50% vitalício</span>
            </div>

            {/* CTAs */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a
                href={CHECKOUT}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-400 px-6 text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-300"
              >
                Assinar agora <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href={SITE}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[46px] items-center justify-center rounded-xl border border-white/15 bg-white/5 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Conhecer o Fireon
              </a>
            </div>
          </div>
        </div>

        {/* benefícios */}
        <div className="mt-7 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {BENEFICIOS.map((b) => (
            <div key={b} className="flex items-center gap-2.5 text-sm text-emerald-50/85">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <Check className="h-3.5 w-3.5" />
              </span>
              {b}
            </div>
          ))}
        </div>

        {/* vídeo de apresentação (facade → iframe ao clicar) */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/5 bg-black">
          <div className="relative aspect-video w-full">
            {tocar ? (
              <iframe
                className="absolute inset-0 h-full w-full"
                src={`https://www.youtube.com/embed/${YT_ID}?autoplay=1&rel=0`}
                title="Apresentação do Fireon"
                allow="accelerator; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <button
                type="button"
                onClick={() => setTocar(true)}
                className="group absolute inset-0 h-full w-full"
                aria-label="Assistir apresentação do Fireon"
              >
                <img src={`https://img.youtube.com/vi/${YT_ID}/hqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-70 transition group-hover:opacity-90" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400 shadow-lg shadow-emerald-500/40 transition group-hover:scale-110">
                    <Play className="ml-1 h-7 w-7 fill-emerald-950 text-emerald-950" />
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>

        {/* transformação: número novo → aquecido */}
        <div className="mt-6 rounded-2xl border border-white/5 bg-white/[0.03] p-5">
          <p className="text-center text-lg font-bold text-white">
            Do número novo ao <span className="text-emerald-400">aquecido</span>
          </p>
          <div className="mt-4 flex items-center justify-center gap-5 sm:gap-10">
            <div className="text-center">
              <img src={chipVirgem} alt="Número novo" className="mx-auto h-24 w-auto object-contain sm:h-28" />
              <p className="mt-1 text-xs font-semibold text-sky-200/70">Número novo</p>
            </div>
            <ArrowRight className="h-7 w-7 shrink-0 text-emerald-400" />
            <div className="text-center">
              <img src={chipAquecido} alt="Número aquecido" className="mx-auto h-24 w-auto object-contain sm:h-28 drop-shadow-[0_0_20px_rgba(52,211,153,0.35)]" />
              <p className="mt-1 text-xs font-semibold text-emerald-300">Número aquecido</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
