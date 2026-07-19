// Perfis comerciais (tom que a IA usa no atendimento do WhatsApp).
export const PERSONAS = [
  { key: 'amigavel', label: 'Amigável', desc: 'Simpática e acolhedora' },
  { key: 'direta', label: 'Direta', desc: 'Objetiva, sem enrolação' },
  { key: 'ousada', label: 'Ousada', desc: 'Persuasiva e vendedora' },
  { key: 'consultiva', label: 'Consultiva', desc: 'Tira dúvidas com calma' },
]

export const personaLabel = (k) => PERSONAS.find((p) => p.key === k)?.label || 'Amigável'
