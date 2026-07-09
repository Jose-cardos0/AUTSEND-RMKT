import clsx from 'clsx'

/** Fundo limpo: só um gradiente suave (sem pontinhos nem orbes). */
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
