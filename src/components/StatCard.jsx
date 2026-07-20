import { motion } from 'framer-motion'

/**
 * Card de estatística com gradiente + ícone grande esmaecido no canto + hover.
 * Usado nos headers de Disparos (WhatsApp, E-mail, SMS).
 * @param {{ label: string, value: any, icon?: any, color?: 'blue'|'green'|'red'|'amber'|'purple' }} props
 */
export default function StatCard({ label, value, icon: Icon, color = 'blue' }) {
  const colors = {
    blue: 'from-sky-50 to-blue-50/80 text-blue-700 border-blue-100/90 shadow-blue-500/5',
    green: 'from-emerald-50 to-green-50/80 text-emerald-700 border-emerald-100/90 shadow-emerald-500/5',
    red: 'from-rose-50 to-red-50/80 text-rose-700 border-rose-100/90 shadow-rose-500/5',
    amber: 'from-amber-50 to-orange-50/70 text-amber-800 border-amber-100/90 shadow-amber-500/5',
    purple: 'from-violet-50 to-purple-50/80 text-violet-700 border-violet-100/90 shadow-violet-500/5',
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, transition: { type: 'spring', stiffness: 400, damping: 22 } }}
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-3 sm:p-3.5 shadow-lg ${colors[color] || colors.blue}`}
    >
      {Icon && <Icon className="pointer-events-none absolute -right-3 -bottom-4 w-[72px] h-[72px] opacity-[0.14]" strokeWidth={1.5} />}
      <div className="relative">
        <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.14em] opacity-55 whitespace-nowrap">{label}</p>
        <p className="text-xl sm:text-2xl font-bold mt-1 tracking-tight tabular-nums">{value}</p>
      </div>
    </motion.div>
  )
}
