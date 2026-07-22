/* Documentação · WhatsApp — Integrações, Automações, Remarketing, Disparos, Funil, Métricas. */
import { MessageCircle } from 'lucide-react'
import { P, B, H, Passos, Dica, Atencao, Tabela, Lista, Tag, Caminho, Code } from './kit'

export const whatsapp = {
  key: 'whatsapp',
  label: 'WhatsApp',
  icon: MessageCircle,
  artigos: [
    {
      id: 'wa-conectar',
      titulo: 'Conectar seu número (instâncias)',
      desc: 'Leia o QR code e deixe seu WhatsApp pronto pra enviar.',
      corpo: (
        <>
          <P>
            Uma <B>instância</B> é um número de WhatsApp conectado ao Autsend. É por ela que saem automações,
            disparos, funis e as conversas do Vendedor IA.
          </P>
          <H>Conectando</H>
          <Passos itens={[
            <>Vá em <Caminho itens={['WhatsApp', 'Integrações']} /> e clique em <B>Criar instância</B>.</>,
            <>Dê um nome (ex.: "Suporte Principal") e confirme — o <B>QR code</B> aparece na tela.</>,
            <>No celular, abra o WhatsApp → <B>Configurações</B> → <B>Aparelhos conectados</B> → <B>Conectar aparelho</B> e escaneie o QR.</>,
            <>Aguarde o status ficar <Tag tom="green">Conectado</Tag>. Pronto — o número já pode enviar.</>,
          ]} />
          <H>Status, verificação e reconexão</H>
          <Lista itens={[
            <><B>Verificar conexão</B> — confere na hora se o número segue ativo.</>,
            <><B>Reconectar</B> — se o status cair (ex.: você desconectou pelo celular), clique em reconectar e leia o novo QR.</>,
            <><B>Excluir</B> — remove a instância (as mensagens já enviadas não são afetadas).</>,
          ]} />
          <Dica>Precisa de mais números? Compre <B>instâncias extras</B> por R$ 29,90/mês em <Caminho itens={['Conta', 'Perfil']} /> — e cada instância comprada também libera <B>+1 Vendedor IA</B>.</Dica>
          <Atencao>Use um número aquecido. Números novos disparando em massa tomam ban do WhatsApp. Se precisar aquecer, conheça o <B>Fireon</B> (oferta com 50% off pra clientes Autsend no presente 🎁 do canto da tela).</Atencao>
        </>
      ),
    },
    {
      id: 'wa-automacoes',
      titulo: 'Automações de WhatsApp',
      desc: 'Mensagem automática na hora exata do evento.',
      corpo: (
        <>
          <P>
            Automação = <B>evento + template + instância</B>. Quando o evento chega pelo webhook, a mensagem sai
            sozinha, em segundos.
          </P>
          <Passos itens={[
            <>Vá em <Caminho itens={['WhatsApp', 'Automações']} /> e clique em <B>Nova automação</B>.</>,
            <>Escolha o <B>evento</B> (compra aprovada, carrinho abandonado, PIX gerado…).</>,
            <>Escolha o <B>produto/grupo</B> (ou deixe valer pra todos).</>,
            <>Selecione o <B>template</B> e a <B>instância</B> que vai enviar.</>,
            <>Ative. A partir de agora, todo evento desse tipo dispara a mensagem.</>,
          ]} />
          <H>Exemplos que convertem</H>
          <Lista itens={[
            <><Tag tom="amber">PIX gerado</Tag> → "Seu PIX expira em 30 min! Qualquer dúvida me chama aqui 👇" (recupera na hora).</>,
            <><Tag tom="amber">Carrinho abandonado</Tag> → mensagem com o link do checkout + quebra de objeção.</>,
            <><Tag tom="green">Compra aprovada</Tag> → boas-vindas + acesso + preparação pro upsell.</>,
          ]} />
          <Dica>Se o mesmo evento tiver automação <B>e</B> Vendedor IA ativo, a automação envia primeiro e o vendedor assume quando o lead responder.</Dica>
        </>
      ),
    },
    {
      id: 'wa-remarketing',
      titulo: 'Remarketing (reaquecer leads antigos)',
      desc: 'Envie campanhas pra quem já está no seu Banco de Leads.',
      corpo: (
        <>
          <P>
            O <B>Remarketing</B> pega leads que já estão na sua base (por evento, produto e período) e envia uma
            campanha pra eles — ex.: todo mundo que abandonou carrinho nos últimos 7 dias.
          </P>
          <Passos itens={[
            <>Vá em <Caminho itens={['WhatsApp', 'Remarketing']} /> e monte o filtro: <B>evento</B>, <B>produto</B> e <B>período</B>.</>,
            <>Veja a prévia de quantos leads entram na campanha.</>,
            <>Escolha o <B>template</B> e a <B>instância</B>, dê um nome à campanha e dispare.</>,
          ]} />
          <H>Como o envio acontece</H>
          <Lista itens={[
            <>O envio sai em <B>lotes de 50</B>, com intervalos humanizados — proteção anti-ban.</>,
            <>O <B>histórico</B> da página mostra cada campanha: enviados, erros e status em tempo real.</>,
            <>Erros têm detalhe: clique pra ver quais números falharam e por quê.</>,
          ]} />
          <Atencao>Remarketing é poderoso, mas respeite a frequência — mais de 1 campanha por dia pro mesmo público derruba resposta e aumenta bloqueio.</Atencao>
        </>
      ),
    },
    {
      id: 'wa-disparos',
      titulo: 'Disparos em massa',
      desc: 'Suba uma lista e dispare pra quem você quiser — com proteção anti-ban.',
      corpo: (
        <>
          <P>
            Em <Caminho itens={['WhatsApp', 'Disparos']} /> você envia pra uma <B>lista externa</B> (planilha) —
            útil pra bases que ainda não estão no Autsend.
          </P>
          <Passos itens={[
            <>Baixe o <B>modelo de planilha</B> na página (colunas: nome, telefone…).</>,
            <>Preencha e <B>suba o arquivo</B> — o Autsend valida os números na hora.</>,
            <>Escolha o template, a instância, dê um nome ao disparo e envie.</>,
            <>Acompanhe no <B>histórico</B>: enviados, erros (com motivo) e conclusão.</>,
          ]} />
          <H>Proteção anti-ban</H>
          <Lista itens={[
            <>As mensagens saem em <B>intervalos de 1 a 5 minutos</B>, imitando um humano.</>,
            <>Lotes controlados + digitação simulada antes de cada mensagem.</>,
            <>Variáveis (<Code>{'{{nome}}'}</Code>) deixam cada mensagem única — menos cara de spam.</>,
          ]} />
          <Atencao>Dispare apenas pra quem já teve contato com você. Lista fria = denúncia = ban. Se o número já sofreu, aqueça com o <B>Fireon</B> antes de voltar a disparar.</Atencao>
        </>
      ),
    },
    {
      id: 'wa-funil',
      titulo: 'Funil de WhatsApp',
      desc: 'Sequências visuais: mensagem → espera → comprou? → caminho Sim/Não.',
      corpo: (
        <>
          <P>
            O <B>Funil</B> é um construtor visual (arrasta e solta) de sequências. Ele continua a conversa por dias,
            sozinho, e muda de caminho quando o lead compra.
          </P>
          <H>Os blocos</H>
          <Lista itens={[
            <><B>Gatilho</B> — o evento que coloca o lead no funil (ex.: carrinho abandonado).</>,
            <><B>Mensagem</B> — um template enviado naquele passo.</>,
            <><B>Esperar</B> — pausa de minutos, horas ou dias antes do próximo passo.</>,
            <><B>Condição (comprou?)</B> — divide o fluxo: <Tag tom="green">Sim</Tag> segue um caminho (ex.: parabéns + upsell), <Tag tom="red">Não</Tag> segue outro (ex.: nova oferta).</>,
          ]} />
          <Passos itens={[
            <>Vá em <Caminho itens={['WhatsApp', 'Funil']} /> e crie um novo funil.</>,
            <>Arraste os blocos pro canvas e <B>ligue as bolinhas</B> na ordem da conversa.</>,
            <>Configure cada bloco (template, tempo de espera, condição).</>,
            <>Ative o funil. Cada lead que disparar o gatilho percorre o fluxo no próprio ritmo.</>,
          ]} />
          <Dica>Se o lead <B>compra no meio do funil</B>, a condição "comprou?" resolve na hora pro caminho Sim — ele não recebe cobrança depois de já ter pago.</Dica>
        </>
      ),
    },
    {
      id: 'wa-metricas',
      titulo: 'Métricas de WhatsApp',
      desc: 'Enviados, entregues, erros e desempenho por campanha.',
      corpo: (
        <>
          <P>
            Em <Caminho itens={['WhatsApp', 'Métricas']} /> você acompanha o desempenho do canal: volumes por dia,
            automações × disparos × funis, taxa de erro e os leads impactados.
          </P>
          <Lista itens={[
            <><B>Visão por período</B> — gráficos de envios por dia.</>,
            <><B>Por origem</B> — o que veio de automação, remarketing, disparo ou funil.</>,
            <><B>Erros</B> — números inválidos, instância desconectada etc., com o motivo de cada um.</>,
          ]} />
          <Dica>Taxa de erro subindo geralmente é instância desconectada — confira em Integrações e reconecte o QR.</Dica>
        </>
      ),
    },
  ],
}
