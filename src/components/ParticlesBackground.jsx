import clsx from 'clsx'

const ORBS = [
  { left: '2%', top: '10%', size: 300, gradient: 'radial-gradient(circle, rgba(91,94,235,0.28) 0%, transparent 68%)', anim: 'float-slow', delay: '0s' },
  { left: '70%', top: '5%', size: 350, gradient: 'radial-gradient(circle, rgba(168,85,247,0.24) 0%, transparent 68%)', anim: 'float', delay: '3s' },
  { left: '55%', top: '60%', size: 280, gradient: 'radial-gradient(circle, rgba(91,94,235,0.22) 0%, transparent 68%)', anim: 'float-slow', delay: '1.5s' },
  { left: '5%', top: '65%', size: 320, gradient: 'radial-gradient(circle, rgba(168,85,247,0.2) 0%, transparent 68%)', anim: 'float', delay: '0.8s' },
  { left: '38%', top: '30%', size: 220, gradient: 'radial-gradient(circle, rgba(91,94,235,0.2) 0%, transparent 68%)', anim: 'float-slow', delay: '2s' },
]

/** Grade de “partículas” + orbes em movimento (camadas atrás do conteúdo). */
export default function ParticlesBackground({
  children,
  className = '',
  /** centered: login / telas com conteúdo centralizado. app: layout com header + scroll em main. */
  variant = 'centered',
}) {
  return (
    <div
      className={clsx(
        'min-h-dvh relative overflow-hidden bg-surface-50',
        className
      )}
    >
      {/* Pontos visíveis (não dependem só do blur das orbes) */}
      <div
        className="absolute inset-0 pointer-events-none z-[1] opacity-[0.55] sm:opacity-50"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(74, 70, 222, 0.5) 1.25px, transparent 1.25px)',
          backgroundSize: '36px 36px',
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 pointer-events-none z-[1] opacity-30 mix-blend-multiply"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(139, 92, 246, 0.45) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          backgroundPosition: '18px 24px',
        }}
        aria-hidden
      />

      <div className="absolute inset-0 pointer-events-none z-[2]" aria-hidden>
        {ORBS.map((orb, i) => (
          <div
            key={i}
            className={clsx(
              'absolute rounded-full blur-[72px] sm:blur-[80px]',
              orb.anim === 'float-slow' ? 'animate-float-slow' : 'animate-float'
            )}
            style={{
              left: orb.left,
              top: orb.top,
              width: orb.size,
              height: orb.size,
              background: orb.gradient,
              animationDelay: orb.delay,
            }}
          />
        ))}
      </div>

      <div
        className={clsx(
          'relative z-10 flex w-full flex-col',
          variant === 'centered' && 'min-h-dvh flex-1 items-center justify-center',
          variant === 'app' && 'min-h-dvh'
        )}
      >
        {children}
      </div>
    </div>
  )
}
