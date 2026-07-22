/* Documentação · Comercial — Vendedor IA (criação, fluxo, follow-up, relatório, cotas). */
import { Rocket } from 'lucide-react'
import { P, B, H, Passos, Dica, Atencao, Tabela, Lista, Tag, Caminho, Code } from './kit'

export const vendedor = {
  key: 'vendedor',
  label: 'Comercial · Vendedor IA',
  icon: Rocket,
  artigos: [
    {
      id: 'vendedor-o-que-e',
      titulo: 'O que é o Vendedor IA',
      desc: 'Um vendedor de verdade, com inteligência artificial, dentro do seu WhatsApp.',
      corpo: (
        <>
          <P>
            O <B>Vendedor IA</B> é um agente de inteligência artificial que conversa com seus leads no WhatsApp como
            um vendedor humano: responde dúvidas, contorna objeções, recomenda o plano certo e envia o link de
            checkout — 24 horas por dia.
          </P>
          <H>O que ele faz (e o que nunca faz)</H>
          <Lista itens={[
            <>✅ Atende o lead <B>na hora</B>, com linguagem natural e humanizada (técnicas reais de venda consultiva).</>,
            <>✅ Conhece <B>apenas o seu produto</B>: planos, preços e checkouts que você cadastrou no fluxo.</>,
            <>✅ Envia <B>imagens e áudios</B> nos momentos que você definir.</>,
            <>✅ Faz <B>follow-up sozinho</B> quando o lead some (você define os tempos).</>,
            <>🚫 <B>Nunca inventa</B> preço, desconto, link ou promessa — se não está no seu fluxo, ele não fala.</>,
            <>🚫 Não briga com você: se <B>você responder manualmente</B> a conversa, ele pausa por 6 horas e te deixa assumir.</>,
          ]} />
          <Dica>Pense nele como um closer que nunca dorme: você desenha o "mapa da venda" uma vez, e ele executa em todas as conversas.</Dica>
        </>
      ),
    },
    {
      id: 'vendedor-criar',
      titulo: 'Criando seu vendedor (passo a passo)',
      desc: 'Do zero ao vendedor ativo em poucos minutos.',
      corpo: (
        <>
          <Passos itens={[
            <>Antes de tudo: tenha o <B>grupo de produto</B> criado (com checkouts vinculados) e uma <B>instância</B> de WhatsApp conectada.</>,
            <>Vá em <Caminho itens={['Comercial', 'Vendedores']} /> e clique em <B>Novo vendedor</B>.</>,
            <>Escolha o <B>produto</B> (grupo) que ele vai vender e a <B>instância</B> pela qual ele vai conversar.</>,
            <>Defina a <B>personalidade</B>: nome do vendedor, tom de voz e instruções extras (ex.: "seja direto, use emojis com moderação").</>,
            <>Marque os <B>eventos</B> em que ele deve agir (ex.: carrinho abandonado, PIX gerado) — nesses eventos ele <B>puxa papo primeiro</B>.</>,
            <>Monte o <B>fluxo de vendas</B> (próximo artigo) e clique em <B>Ativar</B>.</>,
          ]} />
          <H>Quantos vendedores posso ter?</H>
          <Tabela
            colunas={['Plano', 'Vendedores inclusos', 'Conversas/mês']}
            linhas={[
              ['Free', '0', '0'],
              ['Inicial', '1', '100'],
              ['Padrão', '2', '200'],
              ['Pro', '3', '300'],
            ]}
          />
          <P>Precisa de mais? <B>Vendedor avulso</B> por R$ 45/mês (+1 slot) e <B>instância extra</B> (R$ 29,90/mês) também libera +1 — tudo em <Caminho itens={['Conta', 'Perfil']} />.</P>
        </>
      ),
    },
    {
      id: 'vendedor-fluxo',
      titulo: 'O fluxo de vendas (o cérebro do vendedor)',
      desc: 'Desenhe o mapa da venda: planos, ofertas, checkouts, mídias.',
      corpo: (
        <>
          <P>
            O fluxo é um canvas visual onde você desenha <B>o que o vendedor sabe e pode oferecer</B>. Ele respeita
            esse mapa à risca — é a sua garantia de que a IA vende do seu jeito.
          </P>
          <H>Os nós do fluxo</H>
          <Lista itens={[
            <><B>Plano / Oferta</B> — cada plano ou oferta com nome, preço e argumento. O vendedor recomenda o mais adequado ao lead (escada de valor).</>,
            <><B>Checkout</B> — o link exato de pagamento de cada plano. O vendedor envia <B>somente</B> esses links.</>,
            <><B>Upsell</B> — oferta complementar que ele puxa após interesse/compra.</>,
            <><B>Agradecimento</B> — mensagem de fechamento após a venda.</>,
            <><B>Mídia (imagem/áudio)</B> — pendure uma imagem ou áudio <B>embaixo de um nó</B>: ela é enviada automaticamente logo depois daquele passo (ex.: áudio seu após o agradecimento, print de resultados junto da oferta).</>,
          ]} />
          <H>Como montar</H>
          <Passos itens={[
            <>Abra o vendedor e clique em <B>Editar fluxo</B>.</>,
            <>Use a barra lateral pra adicionar nós; <B>ligue as bolinhas</B> pra criar a sequência lógica.</>,
            <>Escreva os textos-base de cada nó (a IA adapta o tom, mas mantém o conteúdo e os valores).</>,
            <>Pendure as mídias nos nós certos.</>,
            <>Salve — o vendedor passa a usar o novo fluxo imediatamente.</>,
          ]} />
          <Dica>Monte uma <B>escada</B>: plano de entrada → principal → premium. O vendedor entende a escada e sobe o lead degrau por degrau, sem empurrar o mais caro de cara.</Dica>
        </>
      ),
    },
    {
      id: 'vendedor-followup',
      titulo: 'Follow-up automático (lead sumiu? Ele volta)',
      desc: 'Nós Esperar, Condição e Mensagem — o vendedor persegue a venda sozinho.',
      corpo: (
        <>
          <P>
            Lead que some não é lead perdido. Ligue nós de <B>follow-up</B> na bolinha do vendedor e ele
            reengaja automaticamente quem parou de responder.
          </P>
          <H>Como funciona</H>
          <Lista itens={[
            <><B>Esperar</B> — quanto tempo de silêncio do lead até agir (minutos, horas ou dias).</>,
            <><B>Condição (comprou?)</B> — antes de cobrar, ele confere: se o lead <Tag tom="green">comprou</Tag> nesse meio tempo, sai pelo caminho Sim (ex.: agradece); se <Tag tom="red">não</Tag>, segue o caminho da reativação.</>,
            <><B>Mensagem</B> — o toque de reativação. Pode ser um texto seu ou <B>gerado pela IA</B> na hora, com o contexto da conversa (fica natural, não robótico).</>,
          ]} />
          <Passos itens={[
            <>No fluxo, ligue um nó <B>Esperar</B> direto na bolinha do <B>Vendedor IA</B>.</>,
            <>Depois do Esperar, adicione a <B>Condição</B> e os dois caminhos (Sim/Não).</>,
            <>No caminho Não, coloque a <B>Mensagem</B> de reativação — e, se quiser, outro Esperar + Mensagem (2º toque).</>,
            <>Salve. O relógio arma sozinho a cada mensagem do bot e desarma quando o lead responde.</>,
          ]} />
          <Dica>Sequência que funciona: 1º toque após <B>30 min</B> (dúvida rápida), 2º após <B>24 h</B> (prova social), 3º após <B>3 dias</B> (última chamada). Se o lead comprar em qualquer ponto, o funil sai no Sim na hora.</Dica>
        </>
      ),
    },
    {
      id: 'vendedor-proativo-reativo',
      titulo: 'Proativo × Reativo (e o handover pra você)',
      desc: 'Quando o vendedor puxa papo, quando ele responde, e como você assume.',
      corpo: (
        <>
          <H>Modo proativo</H>
          <P>
            Nos <B>eventos marcados</B> (ex.: carrinho abandonado), o vendedor <B>abre a conversa</B>: manda a primeira
            mensagem citando o contexto do lead ("vi que você ficou no checkout do Curso X…"). Se houver uma automação
            pro mesmo evento, a automação envia primeiro e o vendedor só assume quando o lead responder.
          </P>
          <H>Modo reativo</H>
          <P>
            Qualquer pessoa que <B>mandar mensagem</B> pro número da instância cai com o vendedor do produto — ele
            responde na hora, com o histórico da conversa na memória.
          </P>
          <H>Handover (você no comando)</H>
          <Lista itens={[
            <>Se <B>você responder manualmente</B> uma conversa pelo celular/web, o vendedor detecta e <B>pausa por 6 horas</B> naquele lead — sem atropelar você.</>,
            <>Depois da pausa, ele volta a atender normalmente (ou continue você mesmo).</>,
          ]} />
          <H>Simulador (teste sem gastar)</H>
          <P>
            Dentro do vendedor há um <B>simulador de conversa</B>: converse com ele como se fosse o lead e valide o
            fluxo, os preços e o tom — sem enviar nada no WhatsApp real.
          </P>
          <Atencao>O vendedor responde <B>uma conversa por lead por mês</B> dentro da sua cota (veja o artigo de cotas). Leads em conversa ativa não consomem de novo no mesmo mês.</Atencao>
        </>
      ),
    },
    {
      id: 'vendedor-relatorio',
      titulo: 'Relatório do Comercial',
      desc: 'Pessoas atendidas, checkouts, vendas, conversão, tokens — tudo animado.',
      corpo: (
        <>
          <P>
            Em <Caminho itens={['Comercial', 'Relatório']} /> você vê o desempenho de cada vendedor com gráficos
            animados e filtro por período (calendário com presets: hoje, 7 dias, 30 dias, este mês).
          </P>
          <H>Métricas por vendedor</H>
          <Lista itens={[
            <><B>Pessoas atendidas</B> — quantos leads conversaram com ele.</>,
            <><B>IC (Iniciou Checkout)</B> — quantos receberam um link de checkout na conversa.</>,
            <><B>Vendas</B> — compras confirmadas pelo webhook do produto do vendedor.</>,
            <><B>Conversão</B> — vendas ÷ pessoas atendidas.</>,
            <><B>Tokens</B> — consumo de IA no mês (transparência do uso).</>,
          ]} />
          <H>Gráficos</H>
          <Lista itens={[
            <><B>Conversas por dia</B> — evolução do movimento no período.</>,
            <><B>Funil</B> — atendidos → chegaram ao checkout → compraram (onde o fluxo perde gente).</>,
            <><B>Distribuição</B> — participação de cada vendedor no total.</>,
          ]} />
          <Dica>IC alto e venda baixa? O problema está <B>depois do link</B> (preço/checkout). IC baixo? O problema está <B>na conversa</B> — ajuste o fluxo e os argumentos.</Dica>
        </>
      ),
    },
    {
      id: 'vendedor-cotas',
      titulo: 'Cotas de conversa e créditos',
      desc: 'Como as conversas são contadas e como comprar mais.',
      corpo: (
        <>
          <H>Como conta uma conversa</H>
          <Lista itens={[
            <><B>1 conversa = 1 lead atendido no mês.</B> A primeira mensagem do lead no mês consome 1 da sua cota; o resto da conversa é grátis.</>,
            <>Cada conversa tem um teto de <B>40 respostas do vendedor no mês</B> — proteção contra conversas infinitas.</>,
            <>Sem cota e sem crédito? O vendedor <B>para de responder</B> (não gasta nada por baixo dos panos) até você recarregar ou o mês virar.</>,
          ]} />
          <H>Cotas por plano e recarga</H>
          <Tabela
            colunas={['Plano', 'Conversas/mês']}
            linhas={[['Inicial', '100'], ['Padrão', '200'], ['Pro', '300']]}
          />
          <Lista itens={[
            <>Pacotes de crédito em <Caminho itens={['Conta', 'Perfil']} />: <Tag>100 — R$ 79</Tag> <Tag>300 — R$ 199</Tag> <Tag>1.000 — R$ 590</Tag>.</>,
            <><B>Crédito é consumido antes da cota</B> do plano e <B>não expira</B> — a cota renova todo mês.</>,
            <>Acompanhe o uso na barra <B>"Conversas do Vendedor"</B> no Perfil.</>,
          ]} />
        </>
      ),
    },
  ],
}
