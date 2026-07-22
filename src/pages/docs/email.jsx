/* Documentação · E-mail — Integrações (domínio/Resend), Construtor, Automações, Disparos, Funil, Métricas. */
import { Mail } from 'lucide-react'
import { P, B, H, Passos, Dica, Atencao, Tabela, Lista, Tag, Caminho, Code } from './kit'

export const email = {
  key: 'email',
  label: 'E-mail',
  icon: Mail,
  artigos: [
    {
      id: 'email-como-funciona',
      titulo: 'Como o e-mail funciona no Autsend',
      desc: 'Dois caminhos: domínio próprio na nossa infraestrutura, ou sua conta Resend.',
      corpo: (
        <>
          <P>Você tem <B>duas formas</B> de enviar e-mail pelo Autsend:</P>
          <Lista itens={[
            <><B>1. Domínio próprio (recomendado)</B> — você conecta o SEU domínio (ex.: <Code>seusite.com.br</Code>) na infraestrutura do Autsend e envia com a cota do plano. Melhor entrega, sua marca no remetente.</>,
            <><B>2. Sua conta Resend (API própria)</B> — você conecta a API da sua conta no Resend e envia por ela. Ideal se você já tem tudo montado lá (é o caminho do plano Free).</>,
          ]} />
          <P>Nos dois casos, tudo acontece em <Caminho itens={['E-mail', 'Integrações']} />. A seção <B>Provedores de envio</B> lista suas conexões; a de <B>Domínios</B> gerencia os domínios verificados e os remetentes.</P>
          <Dica>Use variáveis nos e-mails (<Code>{'{{nome}}'}</Code>, <Code>{'{{produto}}'}</Code>) — personalização aumenta abertura e evita a caixa de spam.</Dica>
        </>
      ),
    },
    {
      id: 'email-dominio',
      titulo: 'Conectar seu domínio (passo a passo com DNS)',
      desc: 'Adicione o domínio, configure os registros DNS e verifique — em ~10 minutos.',
      corpo: (
        <>
          <Passos itens={[
            <>Vá em <Caminho itens={['E-mail', 'Integrações']} /> → seção <B>Domínios</B> → <B>Adicionar domínio</B>.</>,
            <>Digite seu domínio (ex.: <Code>seusite.com.br</Code>) e confirme. O Autsend gera os <B>registros DNS</B> que você precisa criar.</>,
            <>Abra o painel do seu provedor de domínio (<B>Registro.br</B>, <B>Cloudflare</B>, <B>GoDaddy</B>, Hostinger…) na área de <B>DNS / Zona DNS</B>.</>,
            <>Crie cada registro exatamente como o Autsend mostra: em geral um <Tag>TXT (DKIM)</Tag>, um <Tag>TXT (SPF)</Tag> e um <Tag>MX</Tag>. Copie e cole <B>nome (host)</B> e <B>valor</B> sem espaços extras.</>,
            <>Volte no Autsend e clique em <B>Verificar</B>. A propagação leva de minutos a algumas horas (na Cloudflare costuma ser rápido).</>,
            <>Status <Tag tom="green">Verificado</Tag>? Crie seus <B>remetentes</B> (ex.: <Code>contato@seusite.com.br</Code>) e pronto — já pode disparar.</>,
          ]} />
          <H>Problemas comuns</H>
          <Lista itens={[
            <><B>"Não verifica"</B> — 90% das vezes é registro colado com host errado. Na Cloudflare, o host às vezes deve ser só o prefixo (ex.: <Code>resend._domainkey</Code>) sem o domínio no final — o painel completa sozinho.</>,
            <><B>Proxy da Cloudflare</B> — registros de e-mail devem ficar <B>DNS only</B> (nuvem cinza), nunca proxied (nuvem laranja).</>,
            <><B>SPF duplicado</B> — só pode existir <B>um</B> registro SPF por domínio. Se já houver um, mescle os valores no mesmo registro.</>,
          ]} />
          <Dica>Quantos domínios posso ter? Inicial e Padrão: 1. Pro: 2. Dá pra criar vários remetentes por domínio.</Dica>
        </>
      ),
    },
    {
      id: 'email-resend',
      titulo: 'Conectar sua conta Resend (API própria)',
      desc: 'Envie pela sua própria conta do Resend em 5 passos.',
      corpo: (
        <>
          <Passos itens={[
            <>Crie sua conta grátis em <Code>resend.com</Code> e verifique seu domínio lá (menu Domains do Resend).</>,
            <>No Resend, vá em <B>API Keys</B> → <B>Create API Key</B> e copie a chave (começa com <Code>re_</Code>). Ela só aparece uma vez — guarde bem.</>,
            <>No Autsend, vá em <Caminho itens={['E-mail', 'Integrações']} /> → <B>Provedores de envio</B> → adicionar provedor.</>,
            <>Cole a <B>API Key</B>, defina o <B>remetente padrão</B> (ex.: <Code>contato@seusite.com.br</Code>) e salve.</>,
            <>Faça um <B>envio de teste</B> pra sua própria caixa e confirme a entrega.</>,
          ]} />
          <Atencao>O remetente precisa ser de um domínio <B>verificado dentro da sua conta Resend</B> — senão o Resend recusa o envio.</Atencao>
          <Dica>No plano Free do Autsend, esse é o caminho de envio (50 e-mails/mês). Nos planos pagos, você pode usar a cota da plataforma com seu domínio e deixar sua API como alternativa.</Dica>
        </>
      ),
    },
    {
      id: 'email-construtor',
      titulo: 'Construtor de e-mail (com IA)',
      desc: 'Monte e-mails bonitos arrastando blocos — ou peça pra IA criar.',
      corpo: (
        <>
          <P>
            Em <Caminho itens={['E-mail', 'Construtor']} /> você monta templates visuais: arraste blocos de texto,
            imagem, botão e divisor, ajuste cores e fontes, e salve pra usar em automações e disparos.
          </P>
          <H>Criando com IA</H>
          <Passos itens={[
            <>Clique em <B>Gerar com IA</B> e descreva o e-mail: objetivo, produto, tom ("e-mail de carrinho abandonado do Curso X, urgência suave").</>,
            <>A IA monta o e-mail completo (estrutura + texto). Edite o que quiser por cima.</>,
            <>Cada geração/edição por IA consome 1 da cota <B>"E-mails com IA"</B> do plano (30/100/200 por mês).</>,
          ]} />
          <Dica>Assunto curto + primeira linha forte = abertura. O conteúdo do e-mail decide o clique; o checkout decide a venda.</Dica>
        </>
      ),
    },
    {
      id: 'email-automacoes-disparos',
      titulo: 'Automações, Disparos e Funil de e-mail',
      desc: 'O evento dispara o e-mail; campanhas em massa; sequências com espera.',
      corpo: (
        <>
          <H>Automações</H>
          <Passos itens={[
            <>Vá em <Caminho itens={['E-mail', 'Automações']} /> → <B>Nova automação</B>.</>,
            <>Escolha o <B>evento</B>, o <B>produto</B>, o <B>template</B> e o <B>remetente</B>.</>,
            <>Defina o <B>assunto</B> (pode usar variáveis) e ative.</>,
          ]} />
          <H>Disparos (campanhas)</H>
          <Passos itens={[
            <>Vá em <Caminho itens={['E-mail', 'Disparos']} />, escolha o público (filtros do Banco de Leads) e o template.</>,
            <>Defina assunto e remetente, revise a prévia e dispare.</>,
            <>Acompanhe no histórico: enviados, aberturas, cliques e erros.</>,
          ]} />
          <H>Funil</H>
          <P>
            Igual ao funil de WhatsApp, mas por e-mail: gatilho → e-mail → esperar → condição (comprou?) → caminhos
            Sim/Não. Perfeito pra sequências de 3–7 e-mails que rodam sozinhas.
          </P>
          <H>Métricas</H>
          <P>Em <Caminho itens={['E-mail', 'Métricas']} />: entregas, aberturas, cliques e bounces por período e por campanha.</P>
        </>
      ),
    },
    {
      id: 'email-risco',
      titulo: 'Setor de Risco (por que meu envio pausou?)',
      desc: 'Proteção automática de reputação — e como resolver.',
      corpo: (
        <>
          <P>
            Pra proteger a entrega de todos os clientes, o Autsend monitora <B>bounces</B> (e-mails inexistentes) e
            <B> reclamações de spam</B>. Se a sua taxa passar do limite seguro, seus envios entram em
            <Tag tom="amber">Em Análise</Tag> automaticamente.
          </P>
          <H>O que fazer</H>
          <Passos itens={[
            <>Limpe sua lista: remova e-mails inválidos e leads que nunca abrem.</>,
            <>Revise o conteúdo (excesso de links/imagens e palavras de spam derrubam reputação).</>,
            <>Chame o <B>suporte</B> (botão de WhatsApp no canto da tela) — nossa equipe revisa e libera o envio.</>,
          ]} />
          <Dica>Enviar menos, pra quem engaja, entrega mais. Uma lista limpa de 1.000 leads vale mais que 10.000 e-mails frios.</Dica>
        </>
      ),
    },
  ],
}
