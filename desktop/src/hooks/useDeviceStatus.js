import { useState, useEffect } from 'react'

function useDeviceStatus() {
  const [dispositivo, setDispositivo] = useState({ status: 'waiting' })

  useEffect(() => {
    if (!window.diagpro) return
    let ativo = true

    window.diagpro.getDeviceStatus()
      .then((estado) => { if (ativo) setDispositivo(estado) })
      .catch(() => {})

    const unsubscribe = window.diagpro.onDeviceStatus((estado) => {
      if (ativo) setDispositivo(estado)
    })

    return () => {
      ativo = false
      unsubscribe()
    }
  }, [])

  return dispositivo
}

export default useDeviceStatus