import buygoods from '../assets/lojas/buygoods.png'
import cartpanda from '../assets/lojas/cartpanda.png'
import clickbank from '../assets/lojas/clickbank.png'
import digistore24 from '../assets/lojas/digistore24.png'
import hotmart from '../assets/lojas/hotmart.png'
import kiwify from '../assets/lojas/kwiify.webp'
import mundpay from '../assets/lojas/mundpay.png'
import hubla from '../assets/lojas/hubla.png'
import kirvano from '../assets/lojas/kirvano.png'

export const LOJAS = [
  { key: 'mundpay', nome: 'MundPay', logo: mundpay },
  { key: 'kiwify', nome: 'Kiwify', logo: kiwify },
  { key: 'hotmart', nome: 'Hotmart', logo: hotmart },
  { key: 'digistore24', nome: 'Digistore24', logo: digistore24 },
  { key: 'buygoods', nome: 'BuyGoods', logo: buygoods },
  { key: 'cartpanda', nome: 'CartPanda', logo: cartpanda },
  { key: 'clickbank', nome: 'ClickBank', logo: clickbank },
  { key: 'hubla', nome: 'Hubla', logo: hubla },
  { key: 'kirvano', nome: 'Kirvano', logo: kirvano },
]

export const lojaByKey = (k) => LOJAS.find((l) => l.key === k)
