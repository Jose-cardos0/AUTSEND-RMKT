import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

/** Wrapper leve do Apache ECharts (canvas + animações). Passe `option` e a altura. */
export default function EChart({ option, height = 300, className = '' }) {
  const elRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!elRef.current) return
    chartRef.current = echarts.init(elRef.current, null, { renderer: 'canvas' })
    const onResize = () => chartRef.current?.resize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chartRef.current?.dispose(); chartRef.current = null }
  }, [])

  useEffect(() => {
    if (chartRef.current && option) chartRef.current.setOption(option, true)
  }, [option])

  return <div ref={elRef} className={className} style={{ height, width: '100%' }} />
}
