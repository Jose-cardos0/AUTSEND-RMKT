import { motion } from 'framer-motion'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'

export default function PageLoader({ label = 'Carregando…', className }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className={clsx('flex flex-col items-center justify-center py-20 gap-4', className)}
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary-400/35 to-violet-400/30 blur-xl scale-150" />
        <Loader2 className="w-10 h-10 text-primary-600 relative animate-spin" />
      </div>
      <p className="text-sm font-medium text-stone-500">{label}</p>
    </motion.div>
  )
}
