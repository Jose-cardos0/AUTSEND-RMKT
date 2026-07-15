import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { functions } from '../lib/firebase'
import { usePlano } from '../lib/PlanoContext'
import { ShieldCheck, Loader2, MapPin } from 'lucide-react'
import autsendLogo from '../assets/autsendlogo.png'

export const TERMOS_VERSAO = '1'

/** Captura a geolocalização do navegador (best-effort). Nunca rejeita. */
function pegarGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve({ negado: true }); return }
    const timer = setTimeout(() => resolve({ negado: true }), 9000)
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precisao: pos.coords.accuracy }) },
      () => { clearTimeout(timer); resolve({ negado: true }) },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
    )
  })
}

export default function TermosDeUso() {
  const { nome, documento, emailCliente, marcarTermosAceito } = usePlano()
  const [marcado, setMarcado] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const aceitar = async () => {
    if (!marcado) { toast.error('Marque a caixa de aceite para continuar.'); return }
    setEnviando(true)
    try {
      const geo = await pegarGeo()
      await httpsCallable(functions, 'aceitarTermos')({ versao: TERMOS_VERSAO, nome, documento, geo })
      marcarTermosAceito()
      toast.success('Termos aceitos. Bem-vindo(a)!')
    } catch (err) {
      toast.error(err.message || 'Erro ao registrar o aceite.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-surface-100 flex items-center gap-3">
          <img src={autsendLogo} alt="Autsend" className="h-8 w-auto" />
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-primary-700 bg-primary-50 border border-primary-200/70 rounded-full px-3 py-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Termos de Uso
          </span>
        </div>

        {/* Corpo com scroll */}
        <div className="flex-1 min-h-0 overflow-y-auto scroll-y-soft px-6 py-5 space-y-4 text-sm text-stone-600 leading-relaxed">
          <div>
            <h2 className="text-lg font-bold text-stone-800">Termo de Uso e Responsabilidade</h2>
            <p className="text-xs text-stone-400 mt-1">Para usar o Autsend, você precisa ler e aceitar os termos abaixo. Versão {TERMOS_VERSAO}.</p>
          </div>

          <div className="rounded-xl bg-surface-50 border border-surface-200 p-4 text-xs space-y-1">
            <p><span className="text-stone-400">Titular da conta:</span> <strong className="text-stone-700">{nome || '—'}</strong></p>
            <p><span className="text-stone-400">CPF/CNPJ:</span> <strong className="text-stone-700">{documento || '—'}</strong></p>
            <p><span className="text-stone-400">E-mail:</span> <strong className="text-stone-700">{emailCliente || '—'}</strong></p>
          </div>

          <p>Estes termos regem o uso da plataforma <strong>Autsend</strong> (autsend.com.br), operada por <strong>CODENXT</strong> — CNPJ <strong>34.346.582/0001-84</strong>, tendo como responsável <strong>José Cleverton Cardoso Santos</strong> — CPF <strong>038.308.921-28</strong> (em conjunto, a "Plataforma").</p>

          <div className="space-y-3">
            <p><strong className="text-stone-800">1. Aceite.</strong> Ao clicar em "Concordo com os Termos de Uso", você declara ter lido, compreendido e aceito integralmente estas condições, de forma livre e informada. O aceite é registrado com sua identidade, data/hora, endereço IP e localização.</p>

            <p><strong className="text-stone-800">2. Responsabilidade exclusiva pelo uso.</strong> Você é o <strong>único e exclusivo responsável</strong> por todo o conteúdo, mensagens, listas de contatos e campanhas que enviar ou disparar pela Plataforma, em qualquer canal (WhatsApp, E-mail, SMS ou outros). Você declara possuir o <strong>consentimento dos destinatários</strong> e cumprir integralmente a legislação aplicável, incluindo a <strong>LGPD (Lei nº 13.709/2018)</strong>, o Código de Defesa do Consumidor e as normas anti-spam.</p>

            <p><strong className="text-stone-800">3. Usos proibidos.</strong> É terminantemente proibido usar a Plataforma para: fraudes, golpes, estelionato, phishing, roubo/vazamento de dados, spam, correntes, esquemas de "renda extra" enganosos, conteúdo ilegal, ofensivo, discriminatório ou que viole direitos de terceiros, bem como qualquer atividade criminosa ou ilícita. O descumprimento acarreta <strong>suspensão/banimento imediato, sem reembolso</strong>, e comunicação às autoridades.</p>

            <p><strong className="text-stone-800">4. Isenção de responsabilidade.</strong> Você concorda que a <strong>Plataforma, a CODENXT e José Cleverton Cardoso Santos NÃO se responsabilizam</strong>, em nenhuma hipótese, por qualquer dano, prejuízo, perda, sanção, processo, reclamação ou consequência — <strong>leve, média ou grave, de natureza civil, penal, administrativa, tributária ou de qualquer outra ordem</strong> — decorrente do uso que você fizer da Plataforma ou do conteúdo que enviar. Toda e qualquer responsabilidade é <strong>única e exclusivamente sua</strong>.</p>

            <p><strong className="text-stone-800">5. Indenização.</strong> Você se compromete a <strong>indenizar e manter indenes</strong> a Plataforma, a CODENXT e seu responsável por quaisquer perdas, custos, honorários advocatícios, multas ou condenações que venham a sofrer em razão do seu uso, incluindo demandas de terceiros, órgãos reguladores, operadoras ou autoridades.</p>

            <p><strong className="text-stone-800">6. Coleta de dados e segurança.</strong> Para fins de segurança, prevenção a fraudes e cumprimento de obrigações legais, você <strong>consente</strong> que a Plataforma colete e armazene sua identidade, endereço <strong>IP</strong>, <strong>geolocalização</strong>, dispositivo e registros de uso. Esses dados poderão ser <strong>fornecidos às autoridades competentes</strong> mediante requisição legal ou em caso de indício de ilícito.</p>

            <p><strong className="text-stone-800">7. Suspensão.</strong> A Plataforma pode suspender ou encerrar sua conta a qualquer momento, sem aviso prévio, diante de suspeita ou constatação de violação destes termos.</p>

            <p><strong className="text-stone-800">8. Foro.</strong> Aplica-se a lei brasileira. Fica eleito o foro do domicílio da CODENXT para dirimir eventuais controvérsias.</p>
          </div>

          <p className="flex items-start gap-2 text-xs text-stone-400 pt-1">
            <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
            Ao aceitar, seu navegador poderá pedir permissão de localização. Autorizar ajuda a validar seu aceite (o registro é feito mesmo se você negar).
          </p>
        </div>

        {/* Footer / aceite */}
        <div className="shrink-0 px-6 py-4 border-t border-surface-100 bg-surface-50/60 space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} className="mt-0.5 w-4 h-4 accent-primary-600 shrink-0" />
            <span className="text-sm text-stone-700">Li e <strong>concordo</strong> com os Termos de Uso e assumo total responsabilidade pelo uso da minha conta.</span>
          </label>
          <button
            onClick={aceitar}
            disabled={!marcado || enviando}
            className="w-full min-h-[48px] rounded-xl font-semibold text-white bg-gradient-to-br from-primary-500 to-violet-600 shadow-md shadow-primary-600/25 hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {enviando ? 'Registrando...' : 'Concordo com os Termos de Uso'}
          </button>
        </div>
      </div>
    </div>
  )
}
