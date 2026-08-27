export function calcularHealthScore(diagnostico, dispositivo) {
  if (
    !diagnostico ||
    dispositivo.status !== 'connected' ||
    dispositivo.bateria == null
  ) {
    return null
  }

  const scoreBateria = dispositivo.bateria

  const scoreArmazenamento = Math.round(
    (diagnostico.armazenamento.freeGb /
      diagnostico.armazenamento.totalGb) *
      100
  )

  const scoreMemoria = Math.round(
    (diagnostico.memoria.availableGb /
      diagnostico.memoria.totalGb) *
      100
  )

  const pesos = {
    bateria: 0.30,
    armazenamento: 0.35,
    memoria: 0.35,
  }

  return Math.round(
    scoreBateria * pesos.bateria +
    scoreArmazenamento * pesos.armazenamento +
    scoreMemoria * pesos.memoria
  )
}

export function classificarScore(score) {
  if (score == null) {
    return {
      label: '--',
      tone: 'muted',
    }
  }

  if (score >= 85) {
    return {
      label: 'Excelente',
      tone: 'green',
    }
  }

  if (score >= 70) {
    return {
      label: 'Bom',
      tone: 'blue',
    }
  }

  if (score >= 50) {
    return {
      label: 'Regular',
      tone: 'yellow',
    }
  }

  return {
    label: 'Atenção necessária',
    tone: 'red',
  }
}