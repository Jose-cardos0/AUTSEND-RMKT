/* Blocos customizados do construtor de e-mail (ícones bonitos + HTML email-safe).
   Substitui os blocos "crus" do preset-newsletter. */

const ic = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

const CAT_BASICO = 'Básico'
const CAT_LAYOUT = 'Estrutura'
const CAT_AVANCADO = 'Avançado'

const BLOCOS = [
  // ── Básico ──
  {
    id: 'e-titulo', label: 'Título', category: CAT_BASICO,
    media: ic('<path d="M6 4v16M18 4v16M6 12h12"/>'),
    content: '<h1 style="margin:0;padding:12px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.25;font-weight:700;color:#111827;text-align:center;">Escreva seu título aqui</h1>',
  },
  {
    id: 'e-texto', label: 'Texto', category: CAT_BASICO,
    media: ic('<path d="M4 6h16M4 12h11M4 18h14"/>'),
    content: '<p style="margin:0;padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#4b5563;text-align:left;">Clique para editar este texto. Escreva a mensagem do seu e-mail aqui.</p>',
  },
  {
    id: 'e-imagem', label: 'Imagem', category: CAT_BASICO,
    media: ic('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/>'),
    content: { type: 'image', style: { display: 'block', 'max-width': '100%', height: 'auto', margin: '0 auto' }, attributes: { alt: '' } },
    activate: true,
  },
  {
    id: 'e-botao', label: 'Botão', category: CAT_BASICO,
    media: ic('<rect x="2.5" y="8" width="19" height="8" rx="4"/><path d="M8 12h8"/>'),
    content: `<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:14px auto;"><tr><td align="center" style="border-radius:10px;background-color:#7c3aed;">
      <a href="#" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Clique aqui →</a>
    </td></tr></table>`,
  },
  {
    id: 'e-video', label: 'Vídeo', category: CAT_BASICO,
    media: ic('<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="m10 9 5 3-5 3V9z" fill="currentColor" stroke="none"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:10px 0;">
      <a href="https://" target="_blank" style="text-decoration:none;display:inline-block;position:relative;">
        <img src="https://placehold.co/560x315/1f2937/ffffff?text=%E2%96%B6+Assista+ao+v%C3%ADdeo" alt="Assista ao vídeo" style="display:block;max-width:100%;height:auto;border-radius:12px;" />
      </a>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9ca3af;padding-top:6px;">Troque a imagem pela capa e o link pelo seu vídeo</div>
    </td></tr></table>`,
  },
  {
    id: 'e-divisor', label: 'Divisor', category: CAT_BASICO,
    media: ic('<path d="M4 12h16"/>'),
    content: '<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td style="padding:14px 0;"><div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>',
  },
  {
    id: 'e-espaco', label: 'Espaço', category: CAT_BASICO,
    media: ic('<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'),
    content: '<div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>',
  },

  // ── Estrutura ──
  {
    id: 'e-secao', label: '1 Coluna', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/>'),
    content: '<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td class="am-drop" valign="top" style="padding:16px;"></td></tr></table>',
  },
  {
    id: 'e-2col', label: '2 Colunas', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td class="am-drop" width="50%" valign="top" style="padding:12px;"></td>
      <td class="am-drop" width="50%" valign="top" style="padding:12px;"></td>
    </tr></table>`,
  },

  // ── Avançado ──
  {
    id: 'e-html', label: 'HTML', category: CAT_AVANCADO,
    media: ic('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
    content: { type: 'text', content: '<div style="font-family:Arial,Helvetica,sans-serif;color:#4b5563;padding:8px 0;">Bloco de HTML livre — edite pelo botão de código.</div>' },
  },
]

/** Limpa os blocos padrão (feios) e registra os nossos com ícone. */
export function registrarBlocosEmail(editor) {
  const bm = editor.BlockManager
  try { bm.getAll().reset() } catch (_) {}
  BLOCOS.forEach((b) => {
    bm.add(b.id, {
      label: b.label,
      category: b.category,
      media: b.media,
      content: b.content,
      activate: b.activate,
      select: true,
    })
  })
}
