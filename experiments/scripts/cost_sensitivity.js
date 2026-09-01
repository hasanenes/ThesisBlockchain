const fs = require("fs");
const path = require("path");

const GAS_PRICES_GWEI = [0.1, 0.5, 5, 50];
const ETH_EUR_PRICES = [1500, 2200, 4000];
const SCENARIOS = [
  { label: "A_1000_single_hash", gas: 47955536, certificates: 1000 },
  { label: "B_1000_merkle_batch", gas: 48385, certificates: 1000 },
  { label: "C_500_bulk_array", gas: 12303268, certificates: 500 },
  { label: "A_500_single_hash", gas: 23977780, certificates: 500 },
  { label: "B_500_merkle_batch", gas: 48385, certificates: 500 },
];
function eur(gas, gasPriceGwei, ethEur) {
  return gas * gasPriceGwei * 1e-9 * ethEur;
}

const rows = [];
for (const scenario of SCENARIOS) {
  for (const gasPriceGwei of GAS_PRICES_GWEI) {
    for (const ethEur of ETH_EUR_PRICES) {
      const totalEur = eur(scenario.gas, gasPriceGwei, ethEur);
      rows.push({
        scenario: scenario.label,
        certificates: scenario.certificates,
        gas: scenario.gas,
        gasPriceGwei,
        ethEur,
        totalEur,
        eurPerCertificate: totalEur / scenario.certificates,
      });
    }
  }
}

const outDir = path.join(__dirname, "..", "results");
fs.mkdirSync(outDir, { recursive: true });
const header = ["scenario", "certificates", "gas", "gasPriceGwei", "ethEur", "totalEur", "eurPerCertificate"];
const csv = [
  header.join(","),
  ...rows.map((row) =>
    header
      .map((key) => (typeof row[key] === "number" ? row[key].toFixed(key.includes("Eur") || key.includes("eur") ? 6 : 0) : row[key]))
      .join(",")
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "cost_sensitivity.csv"), csv);
fs.writeFileSync(path.join(outDir, "cost_sensitivity.json"), JSON.stringify(rows, null, 2));

for (const row of rows) {
  if (row.ethEur === 2200 && row.gasPriceGwei === 0.5) {
    console.log(
      `${row.scenario}: ${row.totalEur.toFixed(2)} EUR total, ${row.eurPerCertificate.toFixed(4)} EUR/certificate`
    );
  }
}
console.log("\nWrote results/cost_sensitivity.csv");
console.log("Wrote results/cost_sensitivity.json");
