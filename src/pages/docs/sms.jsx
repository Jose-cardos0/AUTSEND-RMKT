/* Documentação · SMS — EUA (número da plataforma), Brasil (SMSDev), API's (Telnyx BYO). */
import { Smartphone } from 'lucide-react'
import { P, B, H, Passos, Dica, Atencao, Tabela, Lista, Tag, Caminho, Code } from './kit'

export const sms = {
  key: 'sms',
  label: 'SMS',
  icon: Smartphone,
  artigos: [
    {
      id: 'sms-como-funciona',
      titulo: 'Como o SMS funciona no Autsend',
      desc: 'Três caminhos: EUA, Brasil (+55) e mundial com sua conta própria.',
      corpo: (
        <>
          <P>O menu SMS tem três sub-canais, e cada um tem suas páginas de Automações, Remarketing, Disparos, Funil e Métricas:</P>
          <Lista itens={[
            <><Tag>EUA</Tag> — você compra um <B>número americano</B> dentro do app e envia para os EUA usando a cota do plano + créditos.</>,
            <><Tag tom="green">BRL</Tag> — envio para o <B>Brasil (+55)</B> via SMSDev, funciona <B>por créditos</B> (a cota do plano não se aplica ao BR).</>,
            <><Tag tom="stone">API's</Tag> — você conecta a <B>sua própria conta Telnyx</B> e envia pro <B>mundo todo</B> pagando direto lá (sem consumir cota do Autsend). Esse menu só aparece depois de conectar uma conta.</>,
          ]} />
          <Dica>Brasileiro usa WhatsApp — o SMS brilha em público internacional (EUA) e como <B>segundo toque</B> de recuperação: PIX gerado → WhatsApp na hora + SMS 30 min depois.</Dica>
        </>
      ),
    },
    {
      id: 'sms-numero-eua',
      titulo: 'Comprar um número (EUA)',
      desc: 'Escolha o número, pague dentro do app e saia enviando.',
      corpo: (
        <>
          <Passos itens={[
            <>Vá em <Caminho itens={['SMS', 'Integração']} /> → aba <B>Números</B> → <B>Comprar Número</B>.</>,
            <>O app lista números americanos disponíveis. Marque 1 ou mais.</>,
            <>Conclua o pagamento <B>dentro do app</B> (assinatura de R$ 29,90/mês por número).</>,
            <>Em instantes o número aparece como <Tag tom="green">Ativo</Tag>. O primeiro vira o <B>principal</B> (o que envia por padrão) — dá pra trocar com um clique na estrela.</>,
          ]} />
          <H>Gerenciando números</H>
          <Lista itens={[
            <><B>Principal</B> — o número usado nos envios; troque quando quiser.</>,
            <><B>Cancelar</B> — encerra a assinatura daquele número (ele é liberado).</>,
          ]} />
          <Atencao>SMS EUA usa a cota <B>SMS/mês</B> do plano (200/500/1.000) + créditos comprados. Créditos são consumidos primeiro e não expiram.</Atencao>
        </>
      ),
    },
    {
      id: 'sms-telnyx-byo',
      titulo: "Conectar sua conta Telnyx (API's)",
      desc: 'Use sua própria conta pra enviar pro mundo todo, sem cota.',
      corpo: (
        <>
          <Passos itens={[
            <>Crie sua conta em <Code>telnyx.com</Code> e configure um número/messaging profile lá.</>,
            <>No Telnyx: <B>API Keys</B> → <B>Create API Key</B> → copie o <B>valor da chave</B> exibido na hora (não confunda com o "API Key ID").</>,
            <>No Autsend: <Caminho itens={['SMS', 'Integração']} /> → aba <B>API's</B> → botão <B>+ Conectar</B> → escolha <B>Telnyx</B>.</>,
            <>Dê um apelido, cole a API Key e conecte. O Autsend <B>puxa seus números automaticamente</B>.</>,
            <>Na conta conectada, abra o dropdown e escolha qual número será o <B>principal</B> de envio.</>,
          ]} />
          <H>O que muda no app</H>
          <Lista itens={[
            <>O submenu <Tag tom="stone">API's</Tag> aparece no SMS com Disparos, Automações, Remarketing, Funil e Métricas próprios.</>,
            <>Envio <B>mundial</B> (qualquer país, incluindo +55) e <B>sem consumir</B> a cota do Autsend — o custo é cobrado na sua conta Telnyx.</>,
          ]} />
        </>
      ),
    },
    {
      id: 'sms-smsdev',
      titulo: 'Conectar o SMSDev (SMS Brasil)',
      desc: 'Envio pra +55 com créditos — passo a passo da Chave Key.',
      corpo: (
        <>
          <Passos itens={[
            <>Crie sua conta em <Code>smsdev.com.br</Code>.</>,
            <>No painel do SMSDev: <B>Minha Conta</B> → <B>Parâmetros Envio/Recebimento</B> → copie a <B>Chave Key</B>.</>,
            <>Importante: no SMSDev, deixe o campo <B>"IP's API" em branco</B> (se preencher, os envios do Autsend são bloqueados).</>,
            <>No Autsend: <Caminho itens={['SMS', 'Integração']} /> → <B>+ Conectar</B> → escolha <B>SMSDev</B> → cole a Chave Key e conecte.</>,
            <>Compre <B>créditos de SMS Brasil</B> em <Caminho itens={['Conta', 'Perfil']} /> e use o submenu <Tag tom="green">BRL</Tag> pra disparar.</>,
          ]} />
          <Tabela
            colunas={['Pacote (BR)', 'Preço']}
            linhas={[['500 SMS', 'R$ 119'], ['1.000 SMS', 'R$ 199'], ['2.500 SMS', 'R$ 449']]}
          />
          <Atencao>O canal BR é <B>crédito-only</B>: a cota "SMS/mês" do plano vale só pros EUA. Créditos BR não expiram.</Atencao>
        </>
      ),
    },
    {
      id: 'sms-envios',
      titulo: 'Automações, Remarketing, Disparos e Funil de SMS',
      desc: 'As mesmas armas do WhatsApp, no canal SMS.',
      corpo: (
        <>
          <P>Cada sub-canal (EUA, BRL, API's) tem o conjunto completo:</P>
          <Lista itens={[
            <><B>Automações</B> — SMS automático no evento (ex.: PIX gerado → SMS com o link em 30 min).</>,
            <><B>Remarketing</B> — campanha pra leads da base, filtrados por evento/produto/período.</>,
            <><B>Disparos</B> — suba uma lista e envie em massa, em lotes com intervalo configurável.</>,
            <><B>Funil</B> — sequência de SMS com espera e condição de compra (Sim/Não).</>,
            <><B>Métricas</B> — enviados, entregues e erros por dia (com o motivo de cada falha).</>,
          ]} />
          <H>Boas práticas de SMS</H>
          <Lista itens={[
            <>Seja curto (até ~160 caracteres) e vá direto ao ponto, com 1 link só.</>,
            <>Identifique-se ("Aqui é a equipe do Curso X") — SMS anônimo não converte.</>,
            <>No canal EUA/API o número do lead precisa estar em formato internacional; o Autsend valida e mostra os inválidos antes de enviar.</>,
          ]} />
        </>
      ),
    },
  ],
}

/* Documentação · Ligação IA — a IA liga pro seu lead. */
import { Phone } from 'lucide-react'

export const call = {
  key: 'call',
  label: 'Ligação IA',
  icon: Phone,
  artigos: [
    {
      id: 'call-o-que-e',
      titulo: 'O que é o Call Marketing IA',
      desc: 'A IA liga pro lead — torpedo de voz ou conversa de verdade.',
      corpo: (
        <>
          <P>
            No <B>Call Marketing IA</B>, o Autsend faz uma <B>ligação telefônica</B> pro seu lead (EUA). Existem dois modos:
          </P>
          <Lista itens={[
            <><B>Torpedo</B> — a ligação toca uma mensagem (voz de IA lendo seu roteiro <B>ou um áudio seu</B>) e encerra. Ótimo pra avisos e urgência ("seu PIX expira em 1h").</>,
            <><B>Conversacional</B> — a IA conversa com o lead de verdade: fala, ouve e responde, seguindo seu roteiro e objetivo.</>,
          ]} />
          <H>Minutos</H>
          <P>
            Cada plano inclui minutos grátis por mês (Inicial 5 · Padrão 10 · Pro 15). Precisa de mais? Pacotes de
            30/60/120 minutos em <Caminho itens={['Conta', 'Perfil']} /> — crédito antes da cota, sem expirar.
          </P>
        </>
      ),
    },
    {
      id: 'call-campanha',
      titulo: 'Campanhas, Automações e Funil de ligação',
      desc: 'Dispare ligações em massa, no evento ou em sequência.',
      corpo: (
        <>
          <H>Campanha</H>
          <Passos itens={[
            <>Vá em <Caminho itens={['Ligação IA', 'EUA', 'Campanha']} /> e crie uma campanha.</>,
            <>Escolha o público (base ou lista), o modo (Torpedo/Conversacional) e o <B>roteiro</B> — o texto que a IA fala ou usa como guia da conversa.</>,
            <>Se preferir sua voz: selecione um <B>áudio</B> gravado na aba Áudio dos Templates.</>,
            <>Dispare e acompanhe: atendidas, não atendidas e erros aparecem com contadores na lista de leads.</>,
          ]} />
          <H>Automações</H>
          <P>Ligação automática no evento — ex.: carrinho abandonado → a IA liga em 15 minutos oferecendo ajuda pra fechar.</P>
          <H>Funil</H>
          <P>Sequências com nós de ligação: liga → espera → comprou? → liga de novo ou encerra. Combine com WhatsApp/e-mail no mesmo período pra um cerco completo.</P>
          <Dica>Torpedo com áudio seu tem cara de recado pessoal — conversão muito acima de voz robótica em texto lido.</Dica>
        </>
      ),
    },
  ],
}
