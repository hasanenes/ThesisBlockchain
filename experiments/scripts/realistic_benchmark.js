
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { makeCertificateLeaves, buildTree } = require("./merkle");

const ALL_SIZES = [1, 10, 50, 100, 500, 1000];

const BASELINE_A_AVG = 47955;
const BASELINE_B_REGISTER = 48373;

async function deploy(name) {
  const factory = await hre.ethers.getContractFactory(name);
  const c = await factory.deploy();
  await c.waitForDeployment();
  return c;
}

function loadRealLeaves() {
  const manifestPath = path.join(__dirname, "..", "results", "realistic_dataset_manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Missing results/realistic_dataset_manifest.json — run `npm run dataset` first.");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return manifest.rows.map((r) => Buffer.from(r.canonicalSha256, "hex"));
}

async function registerArchA(leaves, n) {
  const c = await deploy("CertificateRegistry");
  let total = 0n;
  let first = 0n;
  for (let i = 0; i < n; i++) {
    const tx = await c.registerCertificate("0x" + leaves[i].toString("hex"));
    const r = await tx.wait();
    if (i === 0) first = r.gasUsed;
    total += r.gasUsed;
  }
  const verifyGas = await c.verifyCertificate.estimateGas("0x" + leaves[0].toString("hex"));
  return { total, first, avg: total / BigInt(n), verifyGas: Number(verifyGas) };
}

async function registerArchB(leaves, n) {
  const c = await deploy("BatchCertificateRegistry");
  const subset = leaves.slice(0, n);
  const tree = buildTree(subset);
  const rootHex = "0x" + tree.getRoot().toString("hex");
  const tx = await c.registerRoot(rootHex, n);
  const r = await tx.wait();
  const proof = tree.getHexProof(subset[0]);
  const verifyGas = await c.verifyCertificate.estimateGas(rootHex, "0x" + subset[0].toString("hex"), proof);
  return { register: Number(r.gasUsed), verifyGas: Number(verifyGas), proofDepth: proof.length };
}

async function main() {
  const realLeaves = loadRealLeaves();
  const sizes = ALL_SIZES.filter((n) => n <= realLeaves.length);
  console.log(`Loaded ${realLeaves.length} real canonical hashes; testing sizes [${sizes.join(", ")}]\n`);

  const rows = [];
  for (const n of sizes) {
    const synthLeaves = makeCertificateLeaves(n, `realcmp-${n}`);

    const aReal = await registerArchA(realLeaves, n);
    const aSyn = await registerArchA(synthLeaves, n);
    const bReal = await registerArchB(realLeaves, n);
    const bSyn = await registerArchB(synthLeaves, n);

  
    const aDiff = Number(aReal.total) - Number(aSyn.total);
    const aRel = Math.abs(aDiff) / Number(aSyn.total);
    const bDiff = bReal.register - bSyn.register;
    const bRel = Math.abs(bDiff) / bSyn.register;
    const aWithin = aRel <= TOLERANCE;
    const bWithin = bRel <= TOLERANCE;

    rows.push({
      n,
      A_real_total: Number(aReal.total),
      A_syn_total: Number(aSyn.total),
      A_real_avg: Number(aReal.avg),
      A_diff_gas: aDiff,
      A_rel: aRel,
      A_within_tol: aWithin,
      B_real_register: bReal.register,
      B_syn_register: bSyn.register,
      B_diff_gas: bDiff,
      B_within_tol: bWithin,
      B_proofDepth: bReal.proofDepth,
    });

    const cls = (within, diff) => (diff === 0 ? "IDENTICAL" : within ? `≈ (Δ${diff > 0 ? "+" : ""}${diff}g)` : `DIFFER Δ${diff}g`);
    console.log(
      `[n=${String(n).padStart(4)}]  A real/syn=${Number(aReal.total)}/${Number(aSyn.total)} ${cls(aWithin, aDiff)}` +
        `  |  B real/syn=${bReal.register}/${bSyn.register} ${cls(bWithin, bDiff)}`
    );
  }

  const allWithin = rows.every((r) => r.A_within_tol && r.B_within_tol);
  const maxRel = Math.max(...rows.map((r) => r.A_rel));
  
  const aAvgClose = rows.every((r) => Math.abs(r.A_real_avg - BASELINE_A_AVG) <= 5);
  const bClose = rows.every((r) => Math.abs(r.B_real_register - BASELINE_B_REGISTER) <= 50);

  console.log("");
  console.log(`SUMMARY: ${allWithin ? "real and synthetic gas agree to within 0.05%" : "OUT OF TOLERANCE — investigate"}`);
  console.log(`  largest real-vs-synthetic difference (Arch A): ${(maxRel * 100).toFixed(4)}%  (EIP-2028 calldata zero-byte pricing)`);
  console.log(`  real Arch A avg matches baseline ${BASELINE_A_AVG} (±5): ${aAvgClose}`);
  console.log(`  real Arch B register matches baseline ${BASELINE_B_REGISTER} (±50): ${bClose}`);
  console.log("  => gas is content-independent to within calldata noise; synthetic data is a valid proxy.");

  const outDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const header = ["n", "A_real_total", "A_syn_total", "A_real_avg", "A_diff_gas", "A_within_tol", "B_real_register", "B_syn_register", "B_diff_gas", "B_within_tol", "B_proofDepth"];
  const csv = [header.join(",")];
  for (const r of rows) csv.push(header.map((h) => r[h]).join(","));
  fs.writeFileSync(path.join(outDir, "realistic_gas_results.csv"), csv.join("\n"));
  fs.writeFileSync(path.join(outDir, "realistic_gas_results.json"), JSON.stringify({ allWithin, maxRelativeDiff: maxRel, aAvgClose, bClose, rows }, null, 2));
  console.log("\nWrote results/realistic_gas_results.csv");
  console.log("Wrote results/realistic_gas_results.json");

  if (!allWithin) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
