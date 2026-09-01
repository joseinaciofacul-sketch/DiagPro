// Security Risk Score v1.0
//
// Fórmula documentada:
// 1. Cada finding deduplicado recebe peso fixo por severidade.
// 2. O peso é multiplicado somente pela confiança NA EVIDÊNCIA técnica.
// 3. Findings da mesma categoria recebem retornos decrescentes por ordem de força.
// 4. A soma de cada categoria é limitada por seu category cap.
// 5. Categorias adicionais também recebem retornos decrescentes globais.
// 6. O total é arredondado e limitado a 0–100.
//
// Observations não entram diretamente na fórmula. Coverage nunca reduz o valor
// observado: ela controla se o resultado é calculado, parcial ou insuficiente.

const SECURITY_RISK_SCORE_VERSION = '1.0'

const SEVERITY_WEIGHTS = Object.freeze({
  info: 2,
  low: 8,
  medium: 40,
  high: 55,
  critical: 70,
})

const EVIDENCE_CONFIDENCE_MULTIPLIERS = Object.freeze({
  low: 0.5,
  medium: 0.75,
  high: 1,
})

const CATEGORY_DIMINISHING_RETURNS = Object.freeze([1, 0.6, 0.35, 0.2])
const CATEGORY_REMAINDER_MULTIPLIER = 0.1

const GLOBAL_CATEGORY_DIMINISHING_RETURNS = Object.freeze([1, 0.75, 0.5, 0.35])
const GLOBAL_CATEGORY_REMAINDER_MULTIPLIER = 0.25

const CATEGORY_CAPS = Object.freeze({
  outdated_security_patch: 12,
  modified_environment: 35,
  security_configuration: 18,
  sensitive_capability_combination: 70,
  device_administrator_context: 55,
  confirmed_threat: 90,
  // Compatibilidade com categorias persistidas antes da ETAPA 3.
  device_security: 35,
  permissions: 70,
  default: 50,
})

const SECURITY_RISK_THRESHOLDS = Object.freeze([
  { min: 80, level: 'very_high', label: 'Risco muito elevado' },
  { min: 60, level: 'elevated', label: 'Risco elevado' },
  { min: 40, level: 'moderate', label: 'Risco moderado' },
  { min: 20, level: 'attention', label: 'Atenção' },
  { min: 0, level: 'low', label: 'Baixo risco observado' },
])

const COVERAGE_WEIGHTS = Object.freeze({
  packages: 25,
  packageDetails: 20,
  appOps: 20,
  devicePolicy: 10,
  securitySettings: 15,
  deviceProperties: 10,
})

const COVERAGE_STATUS_CREDITS = Object.freeze({
  available: 1,
  not_applicable: 1,
  partial: 0.5,
  not_supported: 0.5,
  not_available: 0,
  error: 0,
  not_executed: 0,
})

const MINIMUM_NUMERIC_COVERAGE_PERCENT = 50
const FULL_CALCULATION_COVERAGE_PERCENT = 80

const CONFIRMED_THREAT_WEIGHT = 70
const CONFIRMED_THREAT_DIMINISHING_RETURNS = Object.freeze([1, 0.5, 0.25])
const CONFIRMED_THREAT_REMAINDER_MULTIPLIER = 0.15

module.exports = {
  CATEGORY_CAPS,
  CATEGORY_DIMINISHING_RETURNS,
  CATEGORY_REMAINDER_MULTIPLIER,
  CONFIRMED_THREAT_DIMINISHING_RETURNS,
  CONFIRMED_THREAT_REMAINDER_MULTIPLIER,
  CONFIRMED_THREAT_WEIGHT,
  COVERAGE_STATUS_CREDITS,
  COVERAGE_WEIGHTS,
  EVIDENCE_CONFIDENCE_MULTIPLIERS,
  FULL_CALCULATION_COVERAGE_PERCENT,
  GLOBAL_CATEGORY_DIMINISHING_RETURNS,
  GLOBAL_CATEGORY_REMAINDER_MULTIPLIER,
  MINIMUM_NUMERIC_COVERAGE_PERCENT,
  SECURITY_RISK_SCORE_VERSION,
  SECURITY_RISK_THRESHOLDS,
  SEVERITY_WEIGHTS,
}
