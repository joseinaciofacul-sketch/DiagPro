import { useState, useEffect } from 'react'

function normalizarDispositivo(estado) {
  if (!estado) {
    return { status: 'waiting' }
  }

  return {
    ...estado,

    bateria:
      estado.battery?.level ??
      estado.bateria ??
      null,

    versaoAndroid:
      estado.androidVersion ??
      estado.versaoAndroid ??
      null,
  }
}

function useDeviceStatus() {
  const [dispositivo, setDispositivo] = useState({
    status: 'waiting',
  })

  useEffect(() => {
    if (!window.diagpro) return

    let ativo = true

    window.diagpro
      .getDeviceStatus()
      .then((estado) => {
        if (ativo) {
          setDispositivo(normalizarDispositivo(estado))
        }
      })
      .catch(() => {})

    const unsubscribe = window.diagpro.onDeviceStatus(
      (estado) => {
        if (ativo) {
          setDispositivo(
            normalizarDispositivo(estado)
          )
        }
      }
    )

    return () => {
      ativo = false
      unsubscribe()
    }
  }, [])

  return dispositivo
}

export default useDeviceStatus