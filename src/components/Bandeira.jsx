import * as Flags from 'country-flag-icons/react/3x2'
import { parsePhoneNumberFromString } from 'libphonenumber-js'

/** Código do país (ISO 3166-1 alpha-2) a partir de um número E.164. Ex.: +5511... → 'BR'. */
export function paisDoNumero(numero) {
  try {
    const raw = String(numero || '').trim()
    const e164 = raw.startsWith('+') ? raw : `+${raw.replace(/\D/g, '')}`
    const p = parsePhoneNumberFromString(e164)
    return p?.country || null
  } catch {
    return null
  }
}

/** Nome legível do país a partir do ISO (fallback: o próprio código). */
export function nomePais(iso) {
  try {
    const dn = new Intl.DisplayNames(['pt-BR'], { type: 'region' })
    return dn.of(iso) || iso
  } catch {
    return iso
  }
}

/**
 * Bandeirinha padronizada (SVG offline, country-flag-icons).
 * Passe `code` (ISO alpha-2) OU `numero` (deriva o país pelo DDI).
 */
export default function Bandeira({ code, numero, className = 'w-4 h-auto rounded-sm shrink-0', title }) {
  const iso = (code || paisDoNumero(numero) || '').toUpperCase()
  const Flag = iso && Flags[iso]
  if (!Flag) return null
  return <Flag className={className} title={title || nomePais(iso)} />
}
