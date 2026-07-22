/* Documentação · Comece aqui — visão geral, primeiro acesso, fluxo mestre, planos. */
import { Sparkles } from 'lucide-react'
import { P, B, H, Passos, Dica, Atencao, Tabela, Lista, Tag, Caminho, Code } from './kit'

export const comece = {
  key: 'comece',
  label: 'Comece aqui',
  icon: Sparkles,
  artigos: [
    {
      id: 'o-que-e-autsend',
      titulo: 'O que é o Autsend',
      desc: 'Visão geral da plataforma e dos canais que você pode usar.',
      corpo: (
        <>
          <P>
            O <B>Autsend</B> é uma central de remarketing e vendas no automático. Ele recebe os eventos da sua
            plataforma de vendas (compra aprovada, carrinho abandonado, PIX gerado…) e reage na hora, pelo canal
            que você escolher — sem você operar nada na mão.
          </P>
          <H>Os canais</H>
          <Lista itens={[
            <><B>WhatsApp</B> — automações, disparos em massa, remarketing e funis de mensagens no seu número.</>,
            <><B>Vendedor IA</B> — um vendedor de inteligência artificial que atende seus leads no WhatsApp, contorna objeções e envia o link de checkout sozinho.</>,
            <><B>E-mail</B> — campanhas, automações e funis com construtor visual e métricas de verdade.</>,
            <><B>SMS</B> — mensagens diretas nos EUA, no Brasil (+55) e no mundo todo (com sua conta própria).</>,
            <><B>Ligação IA</B> — a IA liga pro seu lead e fala com ele (torpedo de voz ou conversa).</>,
          ]} />
          <H>Como tudo se conecta</H>
          <P>
            Tudo começa no <B>Webhook</B>: você cola uma URL do Autsend na sua plataforma de vendas e, a partir daí,
            cada evento de venda vira um lead no seu <B>Banco de Leads</B> e pode disparar ações em qualquer canal.
          </P>
          <Dica>Você pode combinar canais: um carrinho abandonado pode receber WhatsApp na hora, e-mail depois de 1h e uma ligação da IA no dia seguinte.</Dica>
        </>
      ),
    },
    {
      id: 'primeiro-acesso',
      titulo: 'Criando sua conta e primeiro acesso',
      desc: 'Cadastro, login com Google e o que fazer primeiro.',
      corpo: (
        <>
          <Passos itens={[
            <>Acesse <Code>autsend.com.br</Code> e clique em <B>Entrar</B> (ou "Criar conta grátis").</>,
            <>Entre com <B>Google</B> (1 clique) ou crie com e-mail e senha. A conta começa no plano <Tag>Free</Tag> — sem cartão.</>,
            <>Aceite os <B>Termos de Uso</B> quando o app pedir (obrigatório antes de qualquer envio).</>,
            <>Pronto! Você cai no painel. O menu lateral esquerdo organiza tudo por canal.</>,
          ]} />
          <H>Ordem sugerida de configuração</H>
          <Passos itens={[
            <>Crie seu <B>Webhook</B> e cole na sua plataforma de vendas (<Caminho itens={['Geral', 'Webhooks']} />).</>,
            <>Cadastre seus <B>Produtos</B> e <B>Checkouts</B> (<Caminho itens={['Geral', 'Produtos']} />).</>,
            <>Conecte um canal: WhatsApp (QR code), E-mail (domínio ou Resend) ou SMS.</>,
            <>Crie <B>Templates</B> de mensagem e ative suas <B>Automações</B>.</>,
          ]} />
          <Dica>Se você assinou um plano pela página de vendas, sua conta é criada automaticamente com o plano ativo — é só fazer login com o mesmo e-mail da compra.</Dica>
        </>
      ),
    },
    {
      id: 'fluxo-mestre',
      titulo: 'O fluxo mestre: Webhook → Evento → Ação',
      desc: 'Entenda a espinha dorsal do Autsend em 2 minutos.',
      corpo: (
        <>
          <P>Todo o Autsend funciona em cima de um ciclo simples:</P>
          <Passos itens={[
            <><B>Webhook recebe o evento.</B> Sua plataforma de vendas avisa o Autsend: "fulano gerou PIX", "ciclano comprou".</>,
            <><B>O lead entra no Banco de Leads.</B> Nome, telefone, e-mail, produto e o evento ficam salvos.</>,
            <><B>As ações disparam.</B> Cada canal olha suas automações: se houver uma pro evento daquele produto, ela roda — WhatsApp, e-mail, SMS, ligação e/ou o Vendedor IA.</>,
            <><B>Funis continuam a conversa.</B> Sequências com espera e condição ("comprou?") seguem sozinhas nos dias seguintes.</>,
            <><B>Métricas fecham o ciclo.</B> Cada canal mostra envios, erros, conversões — e o Relatório do Vendedor mostra vendas e conversas.</>,
          ]} />
          <H>Eventos que o Autsend entende</H>
          <Lista itens={[
            <><Tag tom="green">Compra aprovada</Tag> — venda paga (dispara agradecimento, entrega, upsell…).</>,
            <><Tag tom="amber">Carrinho abandonado</Tag> — o lead chegou no checkout e não pagou.</>,
            <><Tag tom="amber">PIX gerado</Tag> / <Tag tom="amber">Boleto gerado</Tag> — pagamento pendente (o ouro do remarketing).</>,
            <><Tag tom="red">Reembolso</Tag> e <Tag tom="red">Chargeback</Tag> — pra fluxos de retenção/recuperação.</>,
          ]} />
        </>
      ),
    },
    {
      id: 'planos-limites',
      titulo: 'Planos, limites e créditos',
      desc: 'O que cada plano inclui e como funcionam as recargas.',
      corpo: (
        <>
          <P>Cada plano renova seus limites <B>todo mês</B>. Quando um limite acaba, você pode fazer upgrade ou comprar <B>créditos avulsos</B> — que têm uma regra de ouro:</P>
          <Dica><B>Crédito comprado é consumido antes da cota do plano e nunca expira.</B> A cota do plano zera e renova todo mês; o crédito fica na conta até você usar.</Dica>
          <Tabela
            colunas={['Recurso', 'Free', 'Inicial', 'Padrão', 'Pro']}
            linhas={[
              ['Webhooks', '1', '2', '10', '20'],
              ['Instâncias WhatsApp', '0', '1', '2', '4'],
              ['Vendedores IA', '0', '1', '2', '3'],
              ['Conversas do Vendedor/mês', '0', '100', '200', '300'],
              ['E-mails/mês', '50 (sua API)', '500', '2.500', '5.000'],
              ['Domínios de e-mail', '0', '1', '1', '2'],
              ['SMS/mês (EUA)', '0', '200', '500', '1.000'],
              ['E-mails com IA/mês', '0', '30', '100', '200'],
              ['Ligação IA (min grátis/mês)', '0', '5', '10', '15'],
            ]}
          />
          <H>Compras avulsas</H>
          <Lista itens={[
            <><B>Instância de WhatsApp</B> — R$ 29,90/mês cada (e cada instância comprada libera +1 vendedor).</>,
            <><B>Vendedor IA</B> — R$ 45,00/mês cada (+1 slot de vendedor).</>,
            <><B>Conversas do Vendedor</B> — pacotes de 100 (R$ 79), 300 (R$ 199) e 1.000 (R$ 590).</>,
            <><B>E-mail</B> — 5.000 (R$ 49,90), 10.000 (R$ 89,90) e 25.000 (R$ 199).</>,
            <><B>SMS EUA</B> — 500 (R$ 49), 1.000 (R$ 89) e 2.500 (R$ 199).</>,
            <><B>SMS Brasil</B> — 500 (R$ 119), 1.000 (R$ 199) e 2.500 (R$ 449).</>,
            <><B>Minutos de Ligação IA</B> — 30 (R$ 44,90), 60 (R$ 84,90) e 120 (R$ 159,90).</>,
          ]} />
          <P>Tudo isso fica em <Caminho itens={['Conta', 'Perfil']} /> — com pagamento <B>dentro do app</B>, sem sair da página.</P>
        </>
      ),
    },
  ],
}
