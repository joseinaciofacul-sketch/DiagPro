function createReputationProvider() {
  return {
    name: 'not_configured',
    async lookupHash() {
      return {
        status: 'not_configured',
        verdict: 'unknown',
        evidence: [],
      }
    },
  }
}

module.exports = { createReputationProvider }
