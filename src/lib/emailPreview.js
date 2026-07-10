// Monta o documento HTML de prévia de um template de e-mail (junta CSS + HTML e esconde a scrollbar).
// Usado nos <Select preview> de template (Disparos, Construtor, Automações, Funil).
export function emailPreviewDoc(t) {
  if (!t || (!t.html && !t.css)) return ''
  const hideScroll = 'html,body{margin:0;background:#fff;scrollbar-width:none;-ms-overflow-style:none}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;width:0;height:0}'
  return `<style>${hideScroll}${t.css || ''}</style>${t.html || ''}`
}
