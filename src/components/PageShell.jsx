import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'

// Cascata: o cabeçalho entra primeiro, depois o conteúdo desliza suave.
const shellContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.04 } },
}
const shellItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
}

/**
 * Cabeçalho de página + animação.
 * @param {boolean} [fill] — ocupa a área útil do layout (flex-1) sem scroll na página; filhos devem usar min-h-0 + scroll interno.
 */
export default function PageShell({ title, subtitle, badge, right, children, className, fill }) {
  return (
    <motion.div
      variants={shellContainer}
      initial="hidden"
      animate="show"
      className={clsx(
        fill
          ? 'flex flex-col flex-1 min-h-0 overflow-hidden gap-2'
          : 'space-y-6 sm:space-y-8 pb-10',
        className
      )}
    >
      <motion.header
        variants={shellItem}
        className={clsx(
          'shrink-0 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3',
          fill && 'pb-1'
        )}
      >
        <div className="min-w-0 flex-1">
          {badge && (
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary-50 to-violet-50 text-primary-700 font-semibold uppercase tracking-widest border border-primary-200/70',
                fill ? 'text-[10px] px-2 py-0.5 mb-0.5' : 'text-[11px] px-3 py-1.5 mb-3 shadow-sm'
              )}
            >
              {badge}
            </span>
          )}
          <h1
            className={clsx(
              'font-bold tracking-tight page-title-gradient',
              fill ? 'text-lg sm:text-xl' : 'text-2xl sm:text-3xl'
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className={clsx(
                'text-stone-600 leading-snug',
                fill
                  ? 'text-[11px] sm:text-xs mt-0.5 line-clamp-2 max-w-4xl'
                  : 'mt-2 text-sm sm:text-base max-w-2xl leading-relaxed'
              )}
            >
              {subtitle}
            </p>
          )}
        </div>
        {right ? (
          <div className="shrink-0 flex flex-wrap gap-2 items-center justify-start sm:justify-end">{right}</div>
        ) : null}
      </motion.header>
      <motion.div variants={shellItem} className={fill ? 'flex flex-col flex-1 min-h-0 overflow-hidden gap-2' : undefined}>{children}</motion.div>
    </motion.div>
  )
}

/**
 * Painel de seção.
 * @param {boolean} [flexFill] — preenche coluna flex e permite scroll no corpo (use com fill no PageShell).
 * @param {string} [bodyClassName] — classes no wrapper do conteúdo (ex.: overflow, padding).
 */
export function Panel({
  title,
  description,
  icon: Icon,
  children,
  className,
  headerClassName,
  noPadding,
  flexFill,
  bodyClassName,
  /** Torna o cabeçalho clicável (dropdown). Controle externo via open/onToggle. */
  collapsible,
  open = true,
  onToggle,
}) {
  const showBody = !collapsible || open
  return (
    <section
      className={clsx(
        'app-panel rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col',
        flexFill && 'flex-1 min-h-0',
        className
      )}
    >
      {title && (
        collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            className={clsx(
              'shrink-0 w-full text-left px-3 sm:px-5 py-2.5 sm:py-3 app-panel-header flex items-center justify-between gap-2 transition-colors hover:bg-surface-50/60',
              open && 'border-b border-surface-200/80',
              headerClassName
            )}
            aria-expanded={open}
          >
            <span className="flex items-center gap-2 min-w-0">
              {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 shrink-0" />}
              <span className="text-sm sm:text-base font-semibold text-stone-800 min-w-0 truncate">{title}</span>
            </span>
            <ChevronDown className={clsx('w-5 h-5 text-stone-400 shrink-0 transition-transform', open && 'rotate-180')} />
          </button>
        ) : (
          <div
            className={clsx(
              'shrink-0 px-3 sm:px-5 py-2.5 sm:py-3 border-b border-surface-200/80 app-panel-header',
              headerClassName
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 shrink-0" />}
              <div className="text-sm sm:text-base font-semibold text-stone-800 min-w-0">{title}</div>
            </div>
            {description && (
              <p className="mt-1.5 text-[11px] sm:text-xs text-stone-500 leading-relaxed">{description}</p>
            )}
          </div>
        )
      )}
      {showBody && (
        <div
          className={clsx(
            !noPadding && 'p-3 sm:p-5 space-y-4',
            flexFill && 'flex-1 min-h-0 flex flex-col overflow-hidden min-w-0',
            bodyClassName
          )}
        >
          {children}
        </div>
      )}
    </section>
  )
}
