import PageShell, { Panel } from '../../components/PageShell'
import { Sparkles } from 'lucide-react'

export default function EmailEmBreve({ title = 'Em breve', subtitle, descricao }) {
  return (
    <PageShell badge="E-mail" title={title} subtitle={subtitle || 'Esta etapa faz parte do módulo de e-mail e está sendo construída.'}>
      <Panel>
        <div className="flex flex-col items-center justify-center text-center gap-3 py-10 sm:py-16">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-violet-100 text-primary-600">
            <Sparkles className="w-7 h-7" />
          </span>
          <h2 className="text-lg font-semibold text-stone-800">{title}</h2>
          <p className="text-sm text-stone-500 max-w-md leading-relaxed">
            {descricao || 'Estamos montando esta tela. Ela será liberada em uma das próximas fases do módulo de e-mail.'}
          </p>
        </div>
      </Panel>
    </PageShell>
  )
}
