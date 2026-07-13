// Helpers de Nichos (segmentos de leads para disparo).
// Nicho pode ser SNAPSHOT (lista fixa de contatos) ou DINÂMICO (recalcula por critério).

/** Mapa: produto (nome/id em minúsculo) -> Set(chaves de loja), a partir dos grupos de produtos. */
export function buildProdutoLojas(productGroups) {
  const m = new Map()
  for (const g of productGroups || []) {
    const lojas = g.lojas || []
    if (!lojas.length) continue
    for (const p of g.produtos || []) {
      const k = String(p).toLowerCase().trim()
      if (!k) continue
      if (!m.has(k)) m.set(k, new Set())
      lojas.forEach((l) => m.get(k).add(l))
    }
  }
  return m
}

/** Agregação leve de leads por contato (só o necessário pra critério dinâmico). */
export function agregarContatos(leads, produtoLojas) {
  const map = new Map()
  const email = (e) => (e || '').trim().toLowerCase()
  const tel = (t) => (t || '').replace(/\D/g, '')
  for (const l of leads || []) {
    const key = email(l.email) || tel(l.telefone) || l.id
    if (!key) continue
    let a = map.get(key)
    if (!a) { a = { key, nome: '', email: '', telefone: '', produtos: new Set(), produtoIds: new Set(), comprou: false, estorno: null }; map.set(key, a) }
    if (l.nome && !a.nome) a.nome = l.nome
    if (l.email && !a.email) a.email = l.email
    if (l.telefone && !a.telefone) a.telefone = l.telefone
    if (l.produto) a.produtos.add(l.produto)
    if (l.produtoId) a.produtoIds.add(l.produtoId)
    if (l.evento === 'order_status.purchase_approved') a.comprou = true
    if (l.evento === 'order_status.chargeback') a.estorno = 'chargeback'
    else if (l.evento === 'order_status.refund' && a.estorno !== 'chargeback') a.estorno = 'refund'
  }
  const pl = produtoLojas || new Map()
  return [...map.values()].map((a) => {
    const lojas = new Set()
    for (const p of a.produtos) { const s = pl.get(String(p).toLowerCase().trim()); if (s) s.forEach((k) => lojas.add(k)) }
    for (const id of a.produtoIds) { const s = pl.get(String(id).toLowerCase().trim()); if (s) s.forEach((k) => lojas.add(k)) }
    return { key: a.key, nome: a.nome, email: a.email, telefone: a.telefone, produto: [...a.produtos][0] || '', lojas: [...lojas], comprou: a.comprou, estorno: a.estorno }
  })
}

/** Aplica o critério de um nicho dinâmico. criterio = { base, loja }. */
export function aplicaCriterio(contatos, criterio) {
  const { base = 'todos', loja = '' } = criterio || {}
  let list = contatos || []
  if (base === 'compradores') list = list.filter((c) => c.comprou)
  else if (base === 'nao_compradores') list = list.filter((c) => !c.comprou)
  else if (base === 'estornados') list = list.filter((c) => c.estorno)
  if (loja) list = list.filter((c) => (c.lojas || []).includes(loja))
  return list
}

/** Resolve os contatos de um nicho (snapshot = fixo; dinâmico = recalcula dos leads). */
export function resolverNicho(nicho, leads, produtoLojas) {
  if (nicho?.tipo === 'dinamico') {
    return aplicaCriterio(agregarContatos(leads || [], produtoLojas), nicho.criterio || {})
  }
  return nicho?.contatos || []
}

/** Linhas prontas pro textarea de disparo. tipo: 'whatsapp' (número,nome) | 'email' (email,nome). */
export function contatosParaLinhas(contatos, tipo) {
  const lines = []
  for (const c of contatos || []) {
    const nm = (c.nome || '').trim()
    if (tipo === 'whatsapp') { const t = (c.telefone || '').replace(/\D/g, ''); if (t) lines.push(nm ? `${t},${nm}` : t) }
    else { const e = (c.email || '').trim(); if (e) lines.push(nm ? `${e},${nm}` : e) }
  }
  return [...new Set(lines)]
}

/** Linhas (arrays) pro Excel. */
export function contatosParaExcel(contatos, tipo) {
  const rows = []
  const vistos = new Set()
  for (const c of contatos || []) {
    if (tipo === 'whatsapp') {
      const t = (c.telefone || '').replace(/\D/g, '')
      if (t && !vistos.has(t)) { vistos.add(t); rows.push([t, c.nome || '']) }
    } else {
      const e = (c.email || '').trim()
      if (e && !vistos.has(e.toLowerCase())) { vistos.add(e.toLowerCase()); rows.push([e, c.nome || '']) }
    }
  }
  return rows
}

export const CRITERIO_LABEL = {
  todos: 'Todos os leads',
  compradores: 'Compradores',
  nao_compradores: 'Não compraram',
  estornados: 'Reembolsados / chargeback',
}
