/* Índice da Documentação — junta todos os grupos na ordem do menu do app. */
import { comece } from './comece'
import { geral } from './geral'
import { whatsapp } from './whatsapp'
import { vendedor } from './vendedor'
import { email } from './email'
import { sms, call } from './sms'
import { conta } from './conta'

export const DOCS = [comece, geral, whatsapp, vendedor, email, sms, call, conta]

/** Lista achatada [{grupo, artigo}] na ordem de leitura (pra busca e prev/next). */
export const ARTIGOS_FLAT = DOCS.flatMap((g) => g.artigos.map((a) => ({ grupo: g, artigo: a })))
