// Foguetinhos cruzando a tela UMA POR VEZ, em loop, cada um numa trajetória curva.
// Cauda em muitas camadas finas translúcidas → afina suave (sem degraus). Cabeça = foguete randomizado.
// Desktop: trajetórias no rodapé. Mobile: trajetórias no topo (pra não ficar atrás do card).

import foguete1 from '../assets/foguetes/foguete1.png'
import foguete2 from '../assets/foguetes/foguete2.png'
import foguete3 from '../assets/foguetes/foguete3.png'

const ROCKETS = [foguete1, foguete2, foguete3]

// Trajetórias desktop (espalhadas pela tela)
const DESKTOP_PATHS = [
  { d: 'M -120 470 C 320 150 760 130 1560 470', s: [-120, 470], e: [1560, 470] },
  { d: 'M -120 560 C 360 250 830 180 1560 300', s: [-120, 560], e: [1560, 300] },
  { d: 'M 120 380 C 520 110 990 150 1480 660', s: [120, 380], e: [1480, 660] },
  { d: 'M -100 650 C 420 400 930 380 1560 560', s: [-100, 650], e: [1560, 560] },
  { d: 'M 220 320 C 670 95 1070 130 1600 430', s: [220, 320], e: [1600, 430] },
  { d: 'M -100 700 C 470 500 1010 520 1560 700', s: [-100, 700], e: [1560, 700] },
]

// Trajetórias mobile (no topo da tela, acima do card)
const MOBILE_PATHS = [
  { d: 'M -120 120 C 420 40 960 40 1560 120', s: [-120, 120], e: [1560, 120] },
  { d: 'M -120 70 C 500 140 940 140 1560 60', s: [-120, 70], e: [1560, 60] },
  { d: 'M 100 150 C 600 55 1000 55 1480 155', s: [100, 150], e: [1480, 155] },
  { d: 'M -100 95 C 440 30 980 35 1560 105', s: [-100, 95], e: [1560, 105] },
]

// Foguete escolhido por trajetória (randomizado no carregamento — estável entre re-renders)
const DCHOICES = DESKTOP_PATHS.map(() => ROCKETS[Math.floor(Math.random() * ROCKETS.length)])
const MCHOICES = MOBILE_PATHS.map(() => ROCKETS[Math.floor(Math.random() * ROCKETS.length)])

const SLOT = 2.4 // segundos que cada foguete leva pra cruzar (maior = mais devagar)
const SIZE = 46 // tamanho do foguete (px no viewBox)
const ROT = 38 // pré-rotação p/ alinhar o nariz da imagem (~38°) ao +x

// Cauda: muitas camadas finas e translúcidas se sobrepondo → afina SUAVE (sem degraus).
const N_LAYERS = 9
const TAIL_LAYERS = Array.from({ length: N_LAYERS }, (_, k) => {
  const f2 = k / (N_LAYERS - 1)
  return {
    w: +(0.8 + f2 * (5.2 - 0.8)).toFixed(2), // 0.8 → 5.2
    t: +(0.17 - f2 * (0.17 - 0.03)).toFixed(3), // 0.17 → 0.03
    o: 0.12,
  }
})

function StarField({ paths, choices, prefix, className }) {
  const n = paths.length
  const cycle = n * SLOT
  const f = 1 / n
  const dur = `${cycle}s`
  const kt = `0;${f.toFixed(4)};1`
  const oKeyTimes = `0;${(f * 0.06).toFixed(4)};${(f * 0.86).toFixed(4)};${f.toFixed(4)};1`

  return (
    <svg
      aria-hidden
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      className={`absolute inset-0 w-full h-full z-[2] pointer-events-none ${className}`}
    >
      <defs>
        {paths.map((p, i) => (
          <linearGradient key={i} id={`${prefix}g${i}`} gradientUnits="userSpaceOnUse" x1={p.s[0]} y1={p.s[1]} x2={p.e[0]} y2={p.e[1]}>
            <stop offset="0" stopColor="#ff3d9a" />
            <stop offset="0.5" stopColor="#a12bff" />
            <stop offset="1" stopColor="#2f6bff" />
          </linearGradient>
        ))}
        {paths.map((p, i) => (
          <path key={i} id={`${prefix}p${i}`} d={p.d} />
        ))}
      </defs>

      {paths.map((p, i) => {
        const begin = `${(i * SLOT).toFixed(2)}s`
        return (
          <g key={i} opacity="0">
            {/* cauda em camadas: afina da cabeça (foguete) até a ponta */}
            {TAIL_LAYERS.map((L, k) => (
              <path
                key={k}
                d={p.d}
                stroke={`url(#${prefix}g${i})`}
                strokeWidth={L.w}
                strokeLinecap="round"
                opacity={L.o}
                pathLength="1"
                strokeDasharray={`${L.t} 5`}
                strokeDashoffset={L.t}
              >
                <animate
                  attributeName="stroke-dashoffset"
                  dur={dur}
                  begin={begin}
                  repeatCount="indefinite"
                  values={`${L.t};${(L.t - 1).toFixed(3)};${(L.t - 1).toFixed(3)}`}
                  keyTimes={kt}
                />
              </path>
            ))}

            {/* foguete (nariz ~38° na img → rotate(ROT) alinha ao +x; rotate="auto" segue a curva) */}
            <g>
              <image
                href={choices[i]}
                x={-SIZE / 2}
                y={-SIZE / 2}
                width={SIZE}
                height={SIZE}
                transform={`rotate(${ROT})`}
              />
              <animateMotion dur={dur} begin={begin} repeatCount="indefinite" rotate="auto" calcMode="linear" keyPoints="0;1;1" keyTimes={kt}>
                <mpath href={`#${prefix}p${i}`} />
              </animateMotion>
            </g>

            <animate
              attributeName="opacity"
              dur={dur}
              begin={begin}
              repeatCount="indefinite"
              values="0;1;1;0;0"
              keyTimes={oKeyTimes}
            />
          </g>
        )
      })}
    </svg>
  )
}

export default function ShootingStars() {
  return (
    <>
      <StarField paths={DESKTOP_PATHS} choices={DCHOICES} prefix="d" className="hidden lg:block" />
      <StarField paths={MOBILE_PATHS} choices={MCHOICES} prefix="m" className="lg:hidden" />
    </>
  )
}
