

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { makeCertificateLeaves, buildTree } = require("./merkle");

const N = Number(process.argv[2] || 1000);
const GAS_PRICE_GWEI = 20;
const ETH_EUR = 2500;
const A_GAS_PER_CERT = 47955; 
const B_GAS_PER_CERT_AT_N = 48.385; 

const nowNs = () => process.hrtime.bigint();
const ms = (a, b) => Number(b - a) / 1e6;
const gasToEur = (gas) => gas * GAS_PRICE_GWEI * 1e-9 * ETH_EUR;

function main() {
  const leaves = makeCertificateLeaves(N, "baseline"); 


  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  let t0 = nowNs();
  const sigs = leaves.map((l) => crypto.sign(null, l, privateKey));
  let t1 = nowNs();
  const allValid = leaves.every((l, i) => crypto.verify(null, l, publicKey, sigs[i]));
  let t2 = nowNs();
  const signedDb = {
    method: "Centralized signed-hash DB (Ed25519)",
    signMsPerCert: ms(t0, t1) / N,
    verifyMsPerCert: ms(t1, t2) / N,
    perCertStorageBytes: 32 + sigs[0].length, 
    perCertEur: 0, 
    allValid,
  };

  t0 = nowNs();
  const tree = buildTree(leaves);
  t1 = nowNs();
  const proof = tree.getHexProof(leaves[0]);
  const sthSig = crypto.sign(null, tree.getRoot(), privateKey); 
  const ctLog = {
    method: "CT-style Merkle transparency log (RFC 6962)",
    treeBuildMs: ms(t0, t1),
    proofDepth: proof.length,
    inclusionProofBytes: proof.length * 32,
    sthSignatureBytes: sthSig.length,
    perCertEur: 0, 
  };

  
  const archA = {
    method: "Architecture A (blockchain, one hash/cert)",
    gasPerCert: A_GAS_PER_CERT,
    perCertEur: gasToEur(A_GAS_PER_CERT),
  };
  const archB = {
    method: "Architecture B (blockchain, Merkle root/batch)",
    gasPerCertEffective: B_GAS_PER_CERT_AT_N,
    perCertEur: gasToEur(B_GAS_PER_CERT_AT_N),
  };

  
  const matrix = [
    { approach: "Signed-hash DB",       trustedParties: "issuer key + DB operator", publicAudit: "only if DB is published", censorshipResistant: "no", singlePointOfFailure: "yes (operator/DB)", holderKeepsProof: "no" },
    { approach: "CT-style Merkle log",  trustedParties: "log operator (not to equivocate)", publicAudit: "yes (monitors/gossip)", censorshipResistant: "partial (detectable)", singlePointOfFailure: "log operator availability", holderKeepsProof: "yes (inclusion proof)" },
    { approach: "Architecture A (chain)", trustedParties: "issuer key + L1 validators", publicAudit: "yes", censorshipResistant: "yes", singlePointOfFailure: "no (decentralized L1)", holderKeepsProof: "no" },
    { approach: "Architecture B (chain)", trustedParties: "issuer key + L1 validators", publicAudit: "yes", censorshipResistant: "yes", singlePointOfFailure: "no (decentralized L1)", holderKeepsProof: "yes (Merkle proof)" },
  ];

 
  console.log(`Tamper-evidence baselines compared at N=${N} (gas @ ${GAS_PRICE_GWEI} gwei, ETH=${ETH_EUR} EUR)\n`);
  console.log("Per-certificate cost:");
  console.log(`  Signed-hash DB ....... sign ${signedDb.signMsPerCert.toFixed(4)} ms, verify ${signedDb.verifyMsPerCert.toFixed(4)} ms, ${signedDb.perCertStorageBytes} bytes, ~EUR 0`);
  console.log(`  CT-style Merkle log .. proof depth ${ctLog.proofDepth} (${ctLog.inclusionProofBytes} bytes), ~EUR 0`);
  console.log(`  Architecture A ....... ${archA.gasPerCert} gas, EUR ${archA.perCertEur.toFixed(4)}`);
  console.log(`  Architecture B ....... ${archB.gasPerCertEffective} gas, EUR ${archB.perCertEur.toFixed(6)}`);
  console.log("");
  console.log("Trust / property matrix:");
  for (const r of matrix) {
    console.log(`  ${r.approach.padEnd(22)} trust=[${r.trustedParties}]  audit=${r.publicAudit}  censorship-resistant=${r.censorshipResistant}  SPoF=${r.singlePointOfFailure}`);
  }
  console.log("");
  console.log("VERDICT:");
  console.log("  A signed-hash DB and a CT-style log both deliver tamper-evidence and (for the log)");
  console.log("  public auditability at effectively zero per-certificate cost. Their weakness is a");
  console.log("  trusted operator: the DB can be altered or withheld, and the log operator must be");
  console.log("  watched for equivocation. The ONLY property a public blockchain adds is removing that");
  console.log("  trusted operator — censorship-resistant, no single point of failure — and it charges");
  console.log(`  real money for it (EUR ${archA.perCertEur.toFixed(2)}/cert for A, EUR ${archB.perCertEur.toFixed(4)}/cert for B).`);
  console.log("  Architecture B is therefore justified only when independence from any single operator");
  console.log("  is a hard requirement; otherwise a transparency log is the rational choice.");

  const outDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const json = { N, gasPriceGwei: GAS_PRICE_GWEI, ethEur: ETH_EUR, signedDb, ctLog, archA, archB, matrix };
  fs.writeFileSync(path.join(outDir, "baseline_comparison.json"), JSON.stringify(json, null, 2));

  const header = ["approach", "perCertEur", "perCertStorageBytes", "proofBytes", "trustedParties", "censorshipResistant", "singlePointOfFailure"];
  const rows = [
    ["Signed-hash DB", 0, signedDb.perCertStorageBytes, 0, "issuer+DB operator", "no", "yes"],
    ["CT-style Merkle log", 0, 32, ctLog.inclusionProofBytes, "log operator", "partial", "log availability"],
    ["Architecture A", archA.perCertEur.toFixed(4), 32, 0, "issuer+validators", "yes", "no"],
    ["Architecture B", archB.perCertEur.toFixed(6), 32, ctLog.inclusionProofBytes, "issuer+validators", "yes", "no"],
  ];
  const csv = [header.join(",")].concat(rows.map((r) => r.join(","))).join("\n");
  fs.writeFileSync(path.join(outDir, "baseline_comparison.csv"), csv);
  console.log("\nWrote results/baseline_comparison.json");
  console.log("Wrote results/baseline_comparison.csv");
}

main();
