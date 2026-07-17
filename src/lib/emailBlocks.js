/* Blocos customizados do construtor de e-mail (ícones bonitos + HTML email-safe).
   Substitui os blocos "crus" do preset-newsletter. */

// Ícones no padrão lucide (traço 2, cantos arredondados).
const ic = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

const CAT_BASICO = 'Básico'
const CAT_LAYOUT = 'Estrutura'
const CAT_AVANCADO = 'Avançado'
const CAT_PRONTO = 'Pré-pronto'

// Sem largura inline (senão ela ganha da regra e o usuário não consegue mudar).
// Tabelas já são 100% pelo atributo width="100%"; divs/sections são block-level (100% natural).
// A CSS de Largura (Dimensão) sobrescreve isso normalmente.
const CENTRAVEL = 'box-sizing:border-box;'

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
    media: ic('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    content: { type: 'image', style: { display: 'block', 'max-width': '100%', height: 'auto', margin: '0 auto' }, attributes: { alt: '' } },
    activate: true,
  },
  {
    id: 'e-botao', label: 'Botão', category: CAT_BASICO,
    media: ic('<rect width="18" height="9" x="3" y="7.5" rx="4.5"/><path d="M9 12h6"/>'),
    content: `<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:14px auto;"><tr><td align="center" style="border-radius:10px;background-color:#7c3aed;">
      <a href="#" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Clique aqui →</a>
    </td></tr></table>`,
  },
  {
    id: 'e-divisor', label: 'Divisor', category: CAT_BASICO,
    media: ic('<path d="M4 12h16"/>'),
    content: '<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td style="padding:14px 0;"><div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>',
  },
  {
    id: 'e-espaco', label: 'Espaço', category: CAT_BASICO,
    media: ic('<path d="M12 2v20"/><path d="m8 8 4-4 4 4"/><path d="m8 16 4 4 4-4"/>'),
    content: '<div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>',
  },

  // ── Estrutura ── (blocos EMPILHADOS, um embaixo do outro)
  {
    id: 'e-secao', label: '1 Bloco', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="${CENTRAVEL}"><tr><td class="am-drop" valign="top" style="padding:16px;"></td></tr></table>`,
  },
  {
    id: 'e-2colunas', label: '2 Colunas', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="${CENTRAVEL}"><tr>
      <td class="am-drop" width="50%" valign="top" style="padding:12px;"></td>
      <td class="am-drop" width="50%" valign="top" style="padding:12px;"></td>
    </tr></table>`,
  },
  {
    id: 'e-3colunas', label: '3 Colunas', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="${CENTRAVEL}"><tr>
      <td class="am-drop" width="33.33%" valign="top" style="padding:10px;"></td>
      <td class="am-drop" width="33.33%" valign="top" style="padding:10px;"></td>
      <td class="am-drop" width="33.33%" valign="top" style="padding:10px;"></td>
    </tr></table>`,
  },
  {
    id: 'e-2blocos', label: '2 Blocos', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="${CENTRAVEL}">
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
    </table>`,
  },
  {
    id: 'e-3blocos', label: '3 Blocos', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.3h18M3 14.6h18"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="${CENTRAVEL}">
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
    </table>`,
  },
  {
    id: 'e-4blocos', label: '4 Blocos', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M3 12h18M3 16h18"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="${CENTRAVEL}">
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
      <tr><td class="am-drop" valign="top" style="padding:14px;"></td></tr>
    </table>`,
  },
  {
    id: 'e-grade22', label: 'Grade 2×2', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 12h18"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="${CENTRAVEL}">
      <tr><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td></tr>
      <tr><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td></tr>
    </table>`,
  },
  {
    id: 'e-grade23', label: 'Grade 2×3', category: CAT_LAYOUT,
    media: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 9.3h18M3 14.6h18"/>'),
    content: `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="${CENTRAVEL}">
      <tr><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td></tr>
      <tr><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td></tr>
      <tr><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td><td class="am-drop" width="50%" valign="top" style="padding:10px;"></td></tr>
    </table>`,
  },

  // ── Avançado ──
  {
    id: 'e-div', label: 'Div', category: CAT_AVANCADO,
    media: ic('<rect width="18" height="16" x="3" y="4" rx="2" stroke-dasharray="4 3"/>'),
    content: `<div class="am-drop" style="padding:16px;${CENTRAVEL}"></div>`,
  },
  {
    id: 'e-section', label: 'Section', category: CAT_AVANCADO,
    media: ic('<rect width="18" height="16" x="3" y="4" rx="2"/><path d="M3 9h18"/>'),
    content: `<section class="am-drop" style="padding:16px;${CENTRAVEL}"></section>`,
  },
  {
    id: 'e-html', label: 'HTML', category: CAT_AVANCADO,
    media: ic('<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>'),
    content: { type: 'text', content: '<div style="font-family:Arial,Helvetica,sans-serif;color:#4b5563;padding:8px 0;">Bloco de HTML livre — edite pelo botão de código.</div>' },
  },

  // ── Pré-pronto ── (ao soltar, abre um popup pra escolher um bloco DTC pronto)
  {
    id: 'e-dtc', label: 'DTC', category: CAT_PRONTO,
    media: ic('<path d="M7 8h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z"/><path d="M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M10 13h4"/>'),
    content: '<div class="am-drop" style="padding:20px;text-align:center;font-family:Arial,sans-serif;color:#7c3aed;">Escolha um bloco DTC…</div>',
  },
  {
    id: 'e-ia', label: 'IA', category: CAT_PRONTO,
    media: ic('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>'),
    content: '<div class="am-drop" style="padding:20px;text-align:center;font-family:Arial,sans-serif;color:#7c3aed;">Escolha um bloco IA…</div>',
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
