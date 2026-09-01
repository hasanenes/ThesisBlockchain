const fs = require("fs");
const path = require("path");
const { makeCertificateLeaves, buildTree } = require("./merkle");

const SIZES = [1, 10, 50, 100, 500, 1000, 5000, 10000];
const ROUNDS = 5;

function nowNs() {
  return process.hrtime.bigint();
}

function ms(start, end) {
  return Number(end - start) / 1_000_000;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function runOne(size, round) {
  const t0 = nowNs();
  const leaves = makeCertificateLeaves(size, `offchain-${size}-${round}`);
  const t1 = nowNs();
  const tree = buildTree(leaves);
  const t2 = nowNs();
  const proof = tree.getHexProof(leaves[0]);
  const t3 = nowNs();
  return {
    hashMs: ms(t0, t1),
    treeMs: ms(t1, t2),
    proofMs: ms(t2, t3),
    proofDepth: proof.length,
    proofBytes: proof.length * 32,
  };
}

const rows = [];
for (const size of SIZES) {
  const rounds = [];
  for (let i = 0; i < ROUNDS; i++) {
    rounds.push(runOne(size, i));
  }
  const row = {
    batchSize: size,
    rounds: ROUNDS,
    avgHashMs: average(rounds.map((r) => r.hashMs)),
    avgTreeMs: average(rounds.map((r) => r.treeMs)),
    avgProofMs: average(rounds.map((r) => r.proofMs)),
    proofDepth: rounds[0].proofDepth,
    proofBytes: rounds[0].proofBytes,
  };
  rows.push(row);
  console.log(
    `[offchain] n=${size} hashMs=${row.avgHashMs.toFixed(3)} treeMs=${row.avgTreeMs.toFixed(3)} proofMs=${row.avgProofMs.toFixed(3)} proofDepth=${row.proofDepth} proofBytes=${row.proofBytes}`
  );
}

const outDir = path.join(__dirname, "..", "results");
fs.mkdirSync(outDir, { recursive: true });
const header = ["batchSize", "rounds", "avgHashMs", "avgTreeMs", "avgProofMs", "proofDepth", "proofBytes"];
const csv = [
  header.join(","),
  ...rows.map((row) =>
    header
      .map((key) => (typeof row[key] === "number" ? row[key].toFixed(key.endsWith("Ms") ? 3 : 0) : row[key]))
      .join(",")
  ),
].join("\n");
fs.writeFileSync(path.join(outDir, "offchain_results.csv"), csv);
fs.writeFileSync(path.join(outDir, "offchain_results.json"), JSON.stringify(rows, null, 2));
console.log("\nWrote results/offchain_results.csv");
console.log("Wrote results/offchain_results.json");
