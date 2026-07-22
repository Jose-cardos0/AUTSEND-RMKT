/* Documentação · Conta & cobrança — Perfil, planos, recargas, suporte. */
import { User } from 'lucide-react'
import { P, B, H, Passos, Dica, Atencao, Tabela, Lista, Tag, Caminho, Code } from './kit'

export const conta = {
  key: 'conta',
  label: 'Conta & cobrança',
  icon: User,
  artigos: [
    {
      id: 'perfil-uso',
      titulo: 'Perfil e uso do mês',
      desc: 'Acompanhe suas cotas, créditos e dados da conta.',
      corpo: (
        <>
          <P>
            Clique no seu avatar (ou vá em <Caminho itens={['Conta', 'Perfil']} />) pra ver tudo num lugar só:
          </P>
          <Lista itens={[
            <><B>Uso deste mês</B> — barras de progresso de e-mails, SMS (EUA e Brasil), Ligação IA, IA do construtor e <B>Conversas do Vendedor</B>. O total já soma cota do plano + créditos.</>,
            <><B>Seu plano</B> — badge com o plano atual; upgrade a qualquer momento.</>,
            <><B>Foto de perfil</B> — clique no avatar pra trocar.</>,
          ]} />
          <Dica>As cotas do plano renovam no dia 1º de cada mês. Créditos comprados nunca expiram.</Dica>
        </>
      ),
    },
    {
      id: 'recargas',
      titulo: 'Recargas e compras dentro do app',
      desc: 'Créditos, instâncias e vendedores — pagamento sem sair da página.',
      corpo: (
        <>
          <P>
            Todas as compras acontecem <B>dentro do app</B> (checkout embutido, cartão internacionalmente seguro via Stripe).
            Depois de pagar, o saldo cai na conta em instantes.
          </P>
          <H>O que dá pra comprar no Perfil</H>
          <Tabela
            colunas={['Item', 'Formato', 'Valores']}
            linhas={[
              ['Instância de WhatsApp', 'Assinatura mensal', 'R$ 29,90/mês (cada; libera +1 vendedor)'],
              ['Vendedor IA', 'Assinatura mensal', 'R$ 45,00/mês (cada; +1 slot)'],
              ['Conversas do Vendedor', 'Crédito (não expira)', '100 · R$ 79 | 300 · R$ 199 | 1.000 · R$ 590'],
              ['Créditos de e-mail', 'Crédito (não expira)', '5.000 · R$ 49,90 | 10.000 · R$ 89,90 | 25.000 · R$ 199'],
              ['Créditos SMS (EUA)', 'Crédito (não expira)', '500 · R$ 49 | 1.000 · R$ 89 | 2.500 · R$ 199'],
              ['Créditos SMS (Brasil)', 'Crédito (não expira)', '500 · R$ 119 | 1.000 · R$ 199 | 2.500 · R$ 449'],
              ['Minutos de Ligação IA', 'Crédito (não expira)', '30 · R$ 44,90 | 60 · R$ 84,90 | 120 · R$ 159,90'],
              ['Número de SMS (EUA)', 'Assinatura mensal', 'R$ 29,90/mês por número'],
            ]}
          />
          <H>A regra de ouro do crédito</H>
          <Lista itens={[
            <><B>Crédito é consumido antes da cota do plano.</B></>,
            <><B>Crédito não expira</B>; a cota do plano zera e renova todo mês.</>,
            <>Cancelou uma assinatura avulsa (instância/vendedor/número)? O recurso é removido no fim do ciclo pago.</>,
          ]} />
        </>
      ),
    },
    {
      id: 'upgrade-suporte',
      titulo: 'Upgrade de plano e suporte',
      desc: 'Como subir de plano e onde pedir ajuda.',
      corpo: (
        <>
          <H>Upgrade</H>
          <Passos itens={[
            <>Clique em <B>Melhorar plano</B> (no menu ou nos avisos de limite).</>,
            <>Compare os planos e clique em <B>Assinar</B> — o pagamento abre dentro do app.</>,
            <>O plano ativa na hora; suas cotas novas valem imediatamente.</>,
          ]} />
          <H>Suporte</H>
          <Lista itens={[
            <>Clique no <B>botão de WhatsApp</B> flutuante (canto inferior direito) em qualquer tela — fala direto com a nossa equipe.</>,
            <>Envios de e-mail <Tag tom="amber">Em Análise</Tag>, dúvidas de DNS, integração com sua plataforma: manda pra gente que resolvemos junto.</>,
          ]} />
          <Dica>Viu o 🎁 flutuando acima do botão de suporte? É uma oferta exclusiva pra clientes Autsend — clique e aproveita.</Dica>
        </>
      ),
    },
  ],
}
