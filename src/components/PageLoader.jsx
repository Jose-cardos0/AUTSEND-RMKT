import { motion } from 'framer-motion'
import clsx from 'clsx'
import foguete from '../assets/foguetes/foguete1.png'

export default function PageLoader({ label = 'Carregando…', className }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className={clsx('flex flex-col items-center justify-center py-20 gap-4', className)}
    >
      <div className="relative flex items-center justify-center">
        <motion.div
          className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary-400/35 to-violet-400/30 blur-xl scale-150"
          animate={{ opacity: [0.55, 1, 0.55], scale: [1.4, 1.6, 1.4] }}
          transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity }}
        />
        <motion.img
          src={foguete}
          alt=""
          className="w-12 h-12 object-contain relative drop-shadow-lg"
          animate={{ y: [0, -10, 0], rotate: [-5, 5, -5] }}
          transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity }}
        />
      </div>
      <p className="text-sm font-medium text-stone-500">{label}</p>
    </motion.div>
  )
}
