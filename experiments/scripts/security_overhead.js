
//
// Measures the gas cost of domain separation in Merkle proof verification.
//
// Compares:
//   BatchCertificateRegistry        computed = leaf, then keccak256(sorted pair)
//   SecureBatchCertificateRegistry  computed = keccak256(0x00 || certHash),
//                                   then keccak256(0x01 || sorted pair)
//
// Both trees are built over the same SHA-256 certificate hashes, so the only
// structural difference is the domain separation scheme itself.
//
// TWO SOURCES OF NOISE ARE CONTROLLED FOR:
//
// 1. Calldata. The two calls carry different hash VALUES. Under EIP-2028 a zero
//    byte costs 4 gas and a non-zero byte 16, so identical structures with
//    different values cost different amounts. The base transaction cost and the
//    calldata cost are therefore subtracted and only execution gas is compared.
//
// 2. Proof path. The verifier branches on whether the running hash is less than
//    its sibling, so per-leaf execution cost varies with hash values. A single
//    leaf gives a measurement whose variation exceeds the ~6 gas per level that
//    domain separation actually adds. This script therefore measures many
//    full-depth leaves per batch size and reports the mean, the range and the
//    standard deviation.
//
// Only leaves whose proof has the full ceil(log2 n) length are used. Odd nodes 
// are promoted rather than duplicated, so some leaves have shorter proofs.
//
// Usage:
//   npx hardhat run scripts/security_overhead.js
 
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
 
const { makeCertificateLeaves, buildTree } = require("./merkle");
const { buildDSTree, getProof } = require("./merkle_ds");
 
const BATCH_SIZES = [1, 10, 100, 500, 1000];
const SAMPLES_PER_N = 25; // full-depth leaves measured per batch size
const BASE_TX_GAS = 21000;
const OUT_DIR = path.join(__dirname, "..", "results");
 
function hex(buf) {
  return "0x" + buf.toString("hex");
}
 
// EIP-2028: 16 gas per non-zero calldata byte, 4 gas per zero byte.
function calldataGas(contract, root, leaf, proof) {
  const data = contract.interface.encodeFunctionData("verifyCertificate", [
    root,
    leaf,
    proof,
  ]);
  let zero = 0;
  let nonzero = 0;
  for (const b of ethers.getBytes(data)) {
    if (b === 0) zero++;
    else nonzero++;
  }
  return zero * 4 + nonzero * 16;
}
 
// KECCAK256 opcode: 30 gas + 6 gas per 32-byte word (Yellow Paper).
//   unsecured internal node: 64 bytes = 2 words -> 42
//   secured   leaf         : 33 bytes = 2 words -> 42
//   secured   internal node: 65 bytes = 3 words -> 48
// Opcode-only prediction; excludes memory expansion and encoding overhead.
function predictedOverhead(depth) {
  return 42 + 6 * depth;
}
 
function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
 
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
 
function fmt(x, w, dp = 1) {
  return (typeof x === "number" ? x.toFixed(dp) : String(x)).padStart(w);
}
 
async function main() {
  console.log("Domain separation gas overhead");
  console.log("==============================\n");
  console.log(`Samples per batch size: up to ${SAMPLES_PER_N} full-depth leaves\n`);
 
  const plain = await ethers.deployContract("BatchCertificateRegistry");
  await plain.waitForDeployment();
  const secure = await ethers.deployContract("SecureBatchCertificateRegistry");
  await secure.waitForDeployment();
 
  console.log(`BatchCertificateRegistry        ${await plain.getAddress()}`);
  console.log(`SecureBatchCertificateRegistry  ${await secure.getAddress()}\n`);
 
  const rows = [];
 
  for (const n of BATCH_SIZES) {
    const certHashes = makeCertificateLeaves(n, `sec-${n}`);
 
    const plainTree = buildTree(certHashes);
    const plainRoot = "0x" + plainTree.getRoot().toString("hex");
 
    const ds = buildDSTree(certHashes);
    const dsRoot = hex(ds.root);
 
    await (await plain.registerRoot(plainRoot, n)).wait();
    await (await secure.registerRoot(dsRoot, n)).wait();
 
    // Full depth for this batch size.
    const fullDepth = Math.max(
      ...Array.from({ length: n }, (_, i) => getProof(ds.layers, i).length)
    );
 
    // Indices whose proof reaches full depth in BOTH trees.
    const candidates = [];
    for (let i = 0; i < n; i++) {
      const dsLen = getProof(ds.layers, i).length;
      const plainLen = plainTree.getProof(certHashes[i], i).length;
      if (dsLen === fullDepth && plainLen === fullDepth) candidates.push(i);
    }
 
    // Spread the samples across the candidate set rather than taking a run.
    const step = Math.max(1, Math.floor(candidates.length / SAMPLES_PER_N));
    const sampled = [];
    for (let k = 0; k < candidates.length && sampled.length < SAMPLES_PER_N; k += step) {
      sampled.push(candidates[k]);
    }
 
    const overheads = [];
    const execPlains = [];
    const execSecures = [];
    const cdDiffs = [];
 
    for (const idx of sampled) {
      const plainProof = plainTree
        .getProof(certHashes[idx], idx)
        .map((p) => "0x" + p.data.toString("hex"));
      const plainLeaf = hex(certHashes[idx]);
 
      const dsProof = getProof(ds.layers, idx).map(hex);
      const dsLeaf = hex(certHashes[idx]); // contract hashes it internally
 
      const okPlain = await plain.verifyCertificate(plainRoot, plainLeaf, plainProof);
      const okSecure = await secure.verifyCertificate(dsRoot, dsLeaf, dsProof);
      if (!okPlain) throw new Error(`unsecured verification failed at n=${n} i=${idx}`);
      if (!okSecure) throw new Error(`secured verification failed at n=${n} i=${idx}`);
 
      const totalPlain = Number(
        await plain.verifyCertificate.estimateGas(plainRoot, plainLeaf, plainProof)
      );
      const totalSecure = Number(
        await secure.verifyCertificate.estimateGas(dsRoot, dsLeaf, dsProof)
      );
 
      const cdPlain = calldataGas(plain, plainRoot, plainLeaf, plainProof);
      const cdSecure = calldataGas(secure, dsRoot, dsLeaf, dsProof);
 
      const execPlain = totalPlain - BASE_TX_GAS - cdPlain;
      const execSecure = totalSecure - BASE_TX_GAS - cdSecure;
 
      execPlains.push(execPlain);
      execSecures.push(execSecure);
      overheads.push(execSecure - execPlain);
      cdDiffs.push(cdSecure - cdPlain);
    }
 
    const row = {
      n,
      depth: fullDepth,
      samples: sampled.length,
      execPlainMean: mean(execPlains),
      execSecureMean: mean(execSecures),
      overheadMean: mean(overheads),
      overheadMin: Math.min(...overheads),
      overheadMax: Math.max(...overheads),
      overheadStdev: stdev(overheads),
      plainStdev: stdev(execPlains),
      cdDiffMean: mean(cdDiffs),
      predicted: predictedOverhead(fullDepth),
    };
    rows.push(row);
 
    console.log(
      `n=${String(n).padStart(4)}  depth=${String(fullDepth).padStart(2)}  ` +
        `samples=${String(sampled.length).padStart(2)}  ` +
        `overhead mean=${row.overheadMean.toFixed(1)}  ` +
        `range=[${row.overheadMin}, ${row.overheadMax}]  ` +
        `sd=${row.overheadStdev.toFixed(1)}`
    );
  }
 
  console.log("\nDOMAIN SEPARATION OVERHEAD, EXECUTION GAS, MEAN OVER SAMPLES");
  console.log("  n   depth   samples    mean     min     max      sd   predicted");
  for (const r of rows) {
    console.log(
      String(r.n).padStart(5) +
        String(r.depth).padStart(8) +
        String(r.samples).padStart(10) +
        fmt(r.overheadMean, 8) +
        String(r.overheadMin).padStart(8) +
        String(r.overheadMax).padStart(8) +
        fmt(r.overheadStdev, 8) +
        String(r.predicted).padStart(12)
    );
  }
 
  console.log("\nSIGNAL AGAINST NOISE");
  console.log("  n    overhead mean   per-leaf sd (unsecured)   overhead % of exec");
  for (const r of rows) {
    const pct = ((r.overheadMean / r.execPlainMean) * 100).toFixed(3);
    console.log(
      String(r.n).padStart(5) +
        fmt(r.overheadMean, 17) +
        fmt(r.plainStdev, 25) +
        pct.padStart(21) +
        " %"
    );
  }
 
  console.log("\nMEAN EXECUTION GAS");
  console.log("  n   depth    unsecured      secured");
  for (const r of rows) {
    console.log(
      String(r.n).padStart(5) +
        String(r.depth).padStart(8) +
        fmt(r.execPlainMean, 13) +
        fmt(r.execSecureMean, 13)
    );
  }
 
  console.log("\nREGISTRATION IS UNAFFECTED");
  const regPlain = await plain.registerRoot.estimateGas(
    ethers.keccak256(ethers.toUtf8Bytes("probe-plain")),
    1
  );
  const regSecure = await secure.registerRoot.estimateGas(
    ethers.keccak256(ethers.toUtf8Bytes("probe-secure")),
    1
  );
  console.log(`  registerRoot unsecured  ${regPlain}`);
  console.log(`  registerRoot secured    ${regSecure}`);
  console.log(`  difference              ${Number(regSecure - regPlain)}`);
  console.log(
    "  (registerRoot is byte-identical in both contracts; the fix costs\n" +
      "   nothing at registration and appears only in on-chain verification)"
  );
 
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const csv =
    "n,depth,samples,exec_unsecured_mean,exec_secured_mean,overhead_mean," +
    "overhead_min,overhead_max,overhead_stdev,unsecured_stdev,calldata_diff_mean," +
    "predicted,overhead_pct\n" +
    rows
      .map((r) =>
        [
          r.n,
          r.depth,
          r.samples,
          r.execPlainMean.toFixed(2),
          r.execSecureMean.toFixed(2),
          r.overheadMean.toFixed(2),
          r.overheadMin,
          r.overheadMax,
          r.overheadStdev.toFixed(2),
          r.plainStdev.toFixed(2),
          r.cdDiffMean.toFixed(2),
          r.predicted,
          ((r.overheadMean / r.execPlainMean) * 100).toFixed(4),
        ].join(",")
      )
      .join("\n") +
    "\n";
  fs.writeFileSync(path.join(OUT_DIR, "security_overhead.csv"), csv);
  fs.writeFileSync(
    path.join(OUT_DIR, "security_overhead.json"),
    JSON.stringify(rows, null, 2)
  );
  console.log("\nWritten to results/security_overhead.csv and .json");
}
 
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
 


























