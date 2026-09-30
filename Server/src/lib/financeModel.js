

const TAX_PCT = 14;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}


function agentCommissionFromCompany(companyCommission, agentPct) {
  const base = Math.max(0, Number(companyCommission) || 0);
  const pct = Math.max(0, Number(agentPct) || 0);
  return {
    agentPct: pct,
    agentAmount: round2((base * pct) / 100),
  };
}


function autoCommissionsFromCompany(companyCommission, _isWebsite, agentPct = 0) {
  const result = agentCommissionFromCompany(companyCommission, agentPct);
  return {
    ...result,
    makerPct: 0,
    makerAmount: 0,
  };
}

module.exports = {
  TAX_PCT,
  round2,
  agentCommissionFromCompany,
  autoCommissionsFromCompany,
};
