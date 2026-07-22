/* Documentação · Geral — Webhooks, Banco de Leads, Produtos, Checkouts, Templates. */
import { Settings } from 'lucide-react'
import { P, B, H, Passos, Dica, Atencao, Tabela, Lista, Tag, Caminho, Code } from './kit'

export const geral = {
  key: 'geral',
  label: 'Geral',
  icon: Settings,
  artigos: [
    {
      id: 'webhooks',
      titulo: 'Webhooks: conectar sua plataforma de vendas',
      desc: 'O primeiro passo de tudo — receber os eventos de venda no Autsend.',
      corpo: (
        <>
          <P>
            O <B>Webhook</B> é a ponte entre a sua plataforma de vendas (Kiwify, Hotmart, Cakto, Perfect Pay,
            qualquer uma que envie webhooks) e o Autsend. Sem ele, o app não sabe quem comprou nem quem abandonou.
          </P>
          <H>Criando o seu webhook</H>
          <Passos itens={[
            <>Vá em <Caminho itens={['Geral', 'Webhooks']} /> e clique em <B>Criar webhook</B>.</>,
            <>Dê um nome (ex.: "Kiwify — Produto X"). O Autsend gera uma <B>URL exclusiva</B> pra você.</>,
            <>Copie a URL e cole na sua plataforma de vendas, na área de <B>Webhooks / Integrações</B> dela.</>,
            <>Na plataforma, marque os eventos que quer enviar: <Tag tom="green">compra aprovada</Tag>, <Tag tom="amber">carrinho abandonado</Tag>, <Tag tom="amber">PIX gerado</Tag>, <Tag tom="amber">boleto gerado</Tag>, <Tag tom="red">reembolso</Tag> e <Tag tom="red">chargeback</Tag>.</>,
            <>Faça uma venda de teste (ou gere um PIX) e veja o lead aparecer no <B>Banco de Leads</B>.</>,
          ]} />
          <Dica>Você pode ter vários webhooks — um por plataforma ou um por produto. O limite depende do plano (1 no Free, 2 no Inicial, 10 no Padrão, 20 no Pro).</Dica>
          <Atencao>O nome do produto que chega no webhook precisa <B>bater com o produto cadastrado</B> em Geral → Produtos pra que as automações do produto certo disparem. Cadastre o produto com o mesmo nome da plataforma.</Atencao>
        </>
      ),
    },
    {
      id: 'banco-de-leads',
      titulo: 'Banco de Leads',
      desc: 'Onde todos os seus leads e eventos ficam guardados.',
      corpo: (
        <>
          <P>
            Todo evento que chega pelo webhook vira (ou atualiza) um lead em <Caminho itens={['Geral', 'Banco de Leads']} />.
            Cada lead guarda nome, telefone, e-mail, produto, o evento mais recente e o histórico do que o Autsend já fez com ele.
          </P>
          <H>O que você encontra na tabela</H>
          <Lista itens={[
            <><B>Status do evento</B> — ex.: compra aprovada, carrinho abandonado.</>,
            <><B>Contador de ações</B> — badges como <Tag>2x Enviado</Tag> mostram quantas mensagens aquele lead já recebeu; passe o mouse num erro pra ver o motivo exato.</>,
            <><B>Busca e filtros</B> — encontre por nome, telefone, e-mail ou produto.</>,
          ]} />
          <Dica>O Banco de Leads é a fonte do <B>Remarketing</B>: quando você dispara um remarketing, é daqui que os leads saem, filtrados por evento e produto.</Dica>
        </>
      ),
    },
    {
      id: 'produtos',
      titulo: 'Produtos e grupos de produto',
      desc: 'Organize seus produtos — é por eles que as automações e o Vendedor IA se guiam.',
      corpo: (
        <>
          <P>
            Em <Caminho itens={['Geral', 'Produtos']} /> você cria <B>grupos de produto</B>. Um grupo representa uma
            oferta sua (ex.: "Curso de Tráfego") e pode conter várias variações/nomes de produto da plataforma
            (ex.: "Curso de Tráfego — Black", "Curso de Tráfego 2.0").
          </P>
          <H>Criando um grupo</H>
          <Passos itens={[
            <>Clique em <B>Novo grupo</B>, dê um nome e (recomendado) suba a <B>imagem</B> do produto.</>,
            <>Adicione os <B>produtos</B> dentro do grupo com o <B>mesmo nome</B> que a plataforma envia no webhook.</>,
            <>Vincule os <B>checkouts</B> do grupo (links de pagamento) — o Vendedor IA usa exatamente esses links.</>,
          ]} />
          <H>Por que grupos importam</H>
          <Lista itens={[
            <>As <B>automações</B> encontram o grupo pelo nome do produto do evento — e disparam a mensagem certa.</>,
            <>O <B>Vendedor IA</B> é criado por grupo: ele conhece os planos, preços e checkouts daquele grupo (e nada além disso).</>,
            <>O <B>Relatório</B> do Comercial agrega vendas e conversas por grupo.</>,
          ]} />
          <Atencao>Se um evento chegar com um nome de produto que não está em nenhum grupo, as automações daquele produto não disparam. Confira a grafia exata.</Atencao>
        </>
      ),
    },
    {
      id: 'checkouts',
      titulo: 'Checkouts',
      desc: 'Cadastre seus links de pagamento pra usar em mensagens e no Vendedor IA.',
      corpo: (
        <>
          <P>
            Em <Caminho itens={['Geral', 'Checkouts']} /> você cadastra os <B>links de checkout</B> das suas ofertas
            (Kiwify, Hotmart, Stripe… qualquer link). Cada checkout tem um nome e a URL.
          </P>
          <H>Onde eles aparecem</H>
          <Lista itens={[
            <>Nos <B>templates</B> de mensagem — você insere o checkout e o link vai junto na mensagem.</>,
            <>No <B>Vendedor IA</B> — os checkouts vinculados ao grupo aparecem no fluxo do vendedor; ele envia <B>somente</B> esses links (nunca inventa).</>,
            <>Nos <B>funis</B> — mensagens de qualquer etapa podem carregar um checkout.</>,
          ]} />
          <Dica>Dê nomes claros (ex.: "Plano Anual — R$497") — fica fácil escolher o certo na hora de montar mensagens e fluxos.</Dica>
        </>
      ),
    },
    {
      id: 'templates',
      titulo: 'Templates de mensagem',
      desc: 'Crie mensagens reutilizáveis com texto, imagem, áudio e variáveis.',
      corpo: (
        <>
          <P>
            Em <Caminho itens={['Geral', 'Templates']} /> ficam suas mensagens prontas de WhatsApp — usadas em
            automações, disparos, remarketing e funis. Um template pode ter <B>vários blocos</B>: textos, imagens e áudios,
            enviados em sequência como uma conversa de verdade.
          </P>
          <H>Montando um template</H>
          <Passos itens={[
            <>Clique em <B>Novo template</B> e dê um nome interno (o lead não vê).</>,
            <>Escreva os blocos de texto. Use as <B>variáveis</B> pra personalizar: <Code>{'{{nome}}'}</Code>, <Code>{'{{produto}}'}</Code> — elas são trocadas pelos dados do lead na hora do envio.</>,
            <>Adicione <B>imagem</B> ou <B>áudio</B> se quiser (áudio chega como mensagem de voz).</>,
            <>Precisa de inspiração? Use o <B>Gerar com IA</B>: descreva o objetivo e a IA escreve a mensagem no seu tom.</>,
          ]} />
          <H>Aba Áudio (Ligação IA)</H>
          <P>
            Na aba <B>Áudio</B> você grava ou sobe um MP3 pra usar nas <B>Ligações IA</B>: em vez da voz sintética,
            a ligação toca o seu áudio. Ideal pra manter a sua voz e o seu jeito.
          </P>
          <Dica>Mensagens curtas e "humanas" performam melhor no WhatsApp. Quebre textões em 2–3 blocos — o Autsend envia um por vez, com digitação natural.</Dica>
        </>
      ),
    },
  ],
}
