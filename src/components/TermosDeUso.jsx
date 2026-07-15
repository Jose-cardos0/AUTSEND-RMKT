import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import toast from 'react-hot-toast'
import { functions } from '../lib/firebase'
import { usePlano } from '../lib/PlanoContext'
import { ShieldCheck, Loader2, MapPin } from 'lucide-react'
import autsendLogo from '../assets/autsendlogo.png'

export const TERMOS_VERSAO = '2'

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
        <div className="flex-1 min-h-0 overflow-y-auto scroll-y-soft px-6 py-5 space-y-3 text-[10px] text-stone-600 leading-relaxed">
          <div>
            <h2 className="text-sm font-bold text-stone-800">Termo de Uso, Responsabilidade e Tratamento de Dados</h2>
            <p className="text-[9px] text-stone-400 mt-1">Leia com atenção. Ao aceitar, você concorda integralmente com as condições abaixo. Versão {TERMOS_VERSAO}.</p>
          </div>

          <div className="rounded-xl bg-surface-50 border border-surface-200 p-3 space-y-1">
            <p><span className="text-stone-400">Titular da conta:</span> <strong className="text-stone-700">{(nome || '—').toUpperCase()}</strong></p>
            <p><span className="text-stone-400">CPF/CNPJ:</span> <strong className="text-stone-700">{documento || '—'}</strong></p>
            <p><span className="text-stone-400">E-mail:</span> <strong className="text-stone-700">{emailCliente || '—'}</strong></p>
          </div>

          <p>Este instrumento ("Termo") regula o uso da plataforma <strong>Autsend</strong> (autsend.com.br), de titularidade e operação da <strong>CODENXT</strong> — CNPJ <strong>34.346.582/0001-84</strong>, tendo como responsável <strong>JOSÉ CLEVERTON CARDOSO SANTOS</strong> — CPF <strong>038.308.921-28</strong> (em conjunto, a "Plataforma"). O usuário identificado acima ("Usuário") declara aceitar todas as cláusulas a seguir.</p>

          <div className="space-y-2.5">
            <p><strong className="text-stone-800">1. Aceite, capacidade e vínculo eletrônico.</strong> Ao clicar em "Concordo com os Termos de Uso", o Usuário declara ser maior de 18 anos, plenamente capaz, e ter lido, compreendido e aceito integralmente este Termo, de forma livre, expressa e informada. O aceite eletrônico é válido e tem força probante nos termos do art. 10, §2º, da MP nº 2.200-2/2001 e dos arts. 219 e 425 do Código Civil, sendo registrado com identidade, data/hora, endereço IP, geolocalização e dispositivo, o que o Usuário reconhece como prova idônea.</p>

            <p><strong className="text-stone-800">2. Natureza do serviço.</strong> A Plataforma é uma <strong>ferramenta tecnológica de automação</strong> que apenas transmite, agenda e organiza comunicações definidas pelo Usuário. A Plataforma <strong>não cria, não revisa, não endossa e não controla</strong> o conteúdo enviado, atuando como mera intermediária técnica. A licença de uso é pessoal, não exclusiva, intransferível e revogável, e o serviço é fornecido <strong>"no estado em que se encontra" (as is)</strong>, sem garantia de disponibilidade, resultado, lucro ou adequação a finalidade específica.</p>

            <p><strong className="text-stone-800">3. Responsabilidade exclusiva pelo conteúdo e pelo uso.</strong> O Usuário é o <strong>único e exclusivo responsável</strong> por todo conteúdo, texto, mídia, oferta, lista de contatos, número, e-mail e campanha que enviar ou disparar por qualquer canal (WhatsApp, E-mail, SMS, voz ou outros), bem como pela obtenção, origem e legalidade dessas listas. O Usuário declara e garante possuir <strong>base legal e consentimento válido</strong> dos destinatários e cumprir toda a legislação aplicável.</p>

            <p><strong className="text-stone-800">4. Proteção de dados (LGPD).</strong> Para os fins da Lei nº 13.709/2018 (LGPD), o <strong>Usuário é o CONTROLADOR</strong> dos dados pessoais dos seus destinatários e a <strong>Plataforma atua como OPERADORA</strong>, tratando tais dados <strong>exclusivamente conforme as instruções do Usuário</strong>. O Usuário é o único responsável por definir e comprovar a base legal (art. 7º e 11 da LGPD), obter e gerir o consentimento, atender aos direitos dos titulares e responder a requisições da ANPD. O Usuário responde integralmente por qualquer tratamento indevido, incidente ou vazamento decorrente de sua conduta, listas ou conteúdo, isentando a Plataforma.</p>

            <p><strong className="text-stone-800">5. Marco Civil da Internet.</strong> A Plataforma é provedora de aplicação de internet. Nos termos do art. 19 da Lei nº 12.965/2014, <strong>não responde por conteúdo gerado por terceiros (Usuário)</strong>, somente podendo ser obrigada a agir mediante ordem judicial específica. A Plataforma mantém registros de acesso e uso pelo prazo legal mínimo (art. 15) e poderá fornecê-los mediante requisição da autoridade competente.</p>

            <p><strong className="text-stone-800">6. Usos proibidos.</strong> É terminantemente vedado usar a Plataforma para, exemplificativamente: fraude, estelionato (art. 171 do Código Penal), golpe, phishing, "smishing", roubo, captura ou vazamento de dados; spam, mensagens sem consentimento/opt-in, uso de listas compradas, alugadas ou obtidas ilicitamente; correntes, pirâmides, "renda extra", "ganho fácil" ou promessas enganosas; conteúdo ilegal, enganoso ao consumidor (CDC), ofensivo, difamatório, discriminatório, de ódio, sexual/pornográfico, ou de apologia a crime; violação de propriedade intelectual, marcas ou direitos autorais; falsificação de identidade/remetente (spoofing), burla ao descadastro; e qualquer atividade ilícita, criminosa ou contrária à moral e aos bons costumes. A violação acarreta <strong>suspensão/banimento imediato, sem reembolso</strong>, e comunicação às autoridades.</p>

            <p><strong className="text-stone-800">7. Canais e serviços de terceiros.</strong> WhatsApp/Meta, operadoras de telefonia, provedores de SMS (ex.: Telnyx), provedores de e-mail (ex.: Resend), gateways de pagamento e demais terceiros possuem <strong>políticas próprias</strong>, cujo cumprimento é de responsabilidade exclusiva do Usuário. Bloqueios, banimentos de número/domínio, multas, filtragens ou sanções aplicadas por esses terceiros decorrem do uso do Usuário e <strong>não geram qualquer responsabilidade, reembolso ou indenização</strong> por parte da Plataforma.</p>

            <p><strong className="text-stone-800">8. Isenção total de responsabilidade.</strong> Na máxima extensão permitida em lei, o Usuário concorda que a <strong>Plataforma, a CODENXT e JOSÉ CLEVERTON CARDOSO SANTOS NÃO se responsabilizam</strong>, sob nenhuma hipótese, por qualquer dano, prejuízo, perda, sanção, autuação, processo ou reclamação — <strong>de natureza leve, média ou grave, direta, indireta, incidental, emergente ou consequente</strong>, incluindo lucros cessantes, danos morais, materiais, à imagem, e de ordem civil, penal, administrativa, tributária, regulatória, trabalhista ou de qualquer espécie — decorrente do uso da Plataforma, do conteúdo enviado, de listas, de atos de terceiros, de indisponibilidade, falha, atraso, interrupção ou perda de dados. Toda e qualquer responsabilidade é <strong>única e exclusivamente do Usuário</strong>.</p>

            <p><strong className="text-stone-800">9. Limitação de responsabilidade.</strong> Caso, mesmo diante do acima, seja reconhecida alguma responsabilidade da Plataforma, esta ficará limitada, no total e agregado, ao <strong>valor efetivamente pago pelo Usuário nos 3 (três) meses anteriores</strong> ao evento, excluídos expressamente danos indiretos e lucros cessantes.</p>

            <p><strong className="text-stone-800">10. Indenização e assunção de demandas.</strong> O Usuário obriga-se a <strong>defender, indenizar e manter indenes</strong> a Plataforma, a CODENXT e seu responsável de toda e qualquer perda, custo, despesa, honorários advocatícios, multa, sanção, acordo ou condenação decorrentes do seu uso ou de demandas de terceiros, destinatários, órgãos reguladores, operadoras ou autoridades, <strong>assumindo o polo passivo</strong> de eventuais processos e requerendo a exclusão da Plataforma da lide.</p>

            <p><strong className="text-stone-800">11. Coleta de dados e cooperação com autoridades.</strong> Para segurança, prevenção a fraudes e cumprimento de obrigações legais, o Usuário <strong>consente</strong> na coleta e no armazenamento de sua identidade, endereço <strong>IP</strong>, <strong>geolocalização</strong>, dispositivo e registros de uso, que poderão ser <strong>fornecidos às autoridades competentes</strong> mediante requisição legal ou diante de indício de ilícito, cooperando a Plataforma com investigações.</p>

            <p><strong className="text-stone-800">12. Suspensão e encerramento.</strong> A Plataforma pode, a qualquer tempo e a seu exclusivo critério, suspender, limitar ou encerrar a conta, sem aviso prévio e sem reembolso, diante de suspeita ou constatação de violação deste Termo, congelando as funções, sem que isso gere direito a indenização.</p>

            <p><strong className="text-stone-800">13. Ausência de vínculo.</strong> Este Termo não cria sociedade, parceria, mandato, vínculo empregatício ou de representação entre as partes, que são independentes.</p>

            <p><strong className="text-stone-800">14. Alterações e caso fortuito.</strong> A Plataforma pode alterar este Termo a qualquer tempo, valendo o uso continuado como aceite da versão vigente. A Plataforma não responde por eventos de <strong>caso fortuito ou força maior</strong>, nem por fatos fora de seu controle razoável.</p>

            <p><strong className="text-stone-800">15. Foro e legislação.</strong> Este Termo é regido pela lei brasileira. Fica eleito o foro do domicílio da CODENXT para dirimir quaisquer controvérsias, com renúncia a qualquer outro, por mais privilegiado que seja.</p>
          </div>

          <p className="flex items-start gap-2 text-[9px] text-stone-400 pt-1">
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
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
