const ORBS = [
  { left: '2%', top: '10%', size: 300, gradient: 'radial-gradient(circle, rgba(91,94,235,0.12) 0%, transparent 70%)', anim: 'float-slow', delay: '0s' },
  { left: '70%', top: '5%', size: 350, gradient: 'radial-gradient(circle, rgba(168,85,247,0.10) 0%, transparent 70%)', anim: 'float', delay: '3s' },
  { left: '55%', top: '60%', size: 280, gradient: 'radial-gradient(circle, rgba(91,94,235,0.10) 0%, transparent 70%)', anim: 'float-slow', delay: '1.5s' },
  { left: '5%', top: '65%', size: 320, gradient: 'radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)', anim: 'float', delay: '0.8s' },
  { left: '38%', top: '30%', size: 220, gradient: 'radial-gradient(circle, rgba(91,94,235,0.08) 0%, transparent 70%)', anim: 'float-slow', delay: '2s' },
]

export default function ParticlesBackground({ children, className = '' }) {
  return (
    <div className={`min-h-screen bg-surface-50 relative overflow-hidden ${className}`}>
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        {ORBS.map((orb, i) => (
          <div
            key={i}
            className={`absolute rounded-full blur-[80px] ${orb.anim === 'float-slow' ? 'animate-float-slow' : 'animate-float'}`}
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
      <div className="relative z-10 flex-1 flex items-center justify-center">
        {children}
      </div>
    </div>
  )
}
