// Measures the composability differential and break-even across batch sizes.
// Extends the single-point measurement at n = 1,000 to a curve, and reports
// the calldata floor that bounds the break-even for any implementation.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const SIZES = [10, 100, 500, 1000];

// ---------- Merkle helpers (sorted-pair, matching the contracts) ----------
function hashPair(a, b) {
  return a < b
    ? ethers.keccak256(ethers.concat([a, b]))
    : ethers.keccak256(ethers.concat([b, a]));
}

function buildTree(leaves) {
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      if (i + 1 === prev.length) next.push(prev[i]);
      else next.push(hashPair(prev[i], prev[i + 1]));
    }
    layers.push(next);
  }
  return layers;
}

function getProof(layers, index) {
  const proof = [];
  let idx = index;
  for (let i = 0; i < layers.length - 1; i++) {
    const sibling = idx ^ 1;
    if (sibling < layers[i].length) proof.push(layers[i][sibling]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

async function gasOf(txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  return Number(receipt.gasUsed);
}

// Count zero bytes in a 0x-prefixed hex string, for calldata accounting.
function zeroBytes(hex) {
  const body = hex.slice(2);
  let z = 0;
  for (let i = 0; i < body.length; i += 2) {
    if (body.slice(i, i + 2) === "00") z++;
  }
  return z;
}

async function measureAt(n, tag) {
  // Fresh contracts per batch size, so no state carries over.
  const RegA = await ethers.getContractFactory("CertificateRegistry");
  const regA = await RegA.deploy();
  await regA.waitForDeployment();

  const RegB = await ethers.getContractFactory("BatchCertificateRegistry");
  const regB = await RegB.deploy();
  await regB.waitForDeployment();

  // Build the batch.
  const leaves = [];
  for (let i = 0; i < n; i++) {
    leaves.push(ethers.keccak256(ethers.toUtf8Bytes(`${tag}-cert-${i}`)));
  }
  const layers = buildTree(leaves);
  const root = layers[layers.length - 1][0];

  const leaf0 = leaves[0];
  const proof0 = getProof(layers, 0);
  const leaf1 = leaves[Math.min(1, n - 1)];
  const proof1 = getProof(layers, Math.min(1, n - 1));

  // Registration.
  const regGasA = await gasOf(regA.registerCertificate(leaf0));
  const regGasB = await gasOf(regB.registerRoot(root, n));

  // Architecture A needs the control leaf registered too, so that the
  // no-verification claim is compared against a like-for-like state.
  if (n > 1) await gasOf(regA.registerCertificate(leaf1));

  // Consuming contracts.
  const GateA = await ethers.getContractFactory("ScholarshipGateA");
  const gateA = await GateA.deploy(await regA.getAddress());
  await gateA.waitForDeployment();

  const GateB = await ethers.getContractFactory("ScholarshipGateB");
  const gateB = await GateB.deploy(await regB.getAddress());
  await gateB.waitForDeployment();

  // Four measurements.
  const claimA = await gasOf(gateA.claim(leaf0));
  const claimAplain = await gasOf(gateA.claimWithoutVerification(leaf1));
  const claimB = await gasOf(gateB.claim(root, leaf0, proof0));
  const claimBplain = await gasOf(
    gateB.claimWithoutVerification(root, leaf1, proof1)
  );

  const internalA = claimA - claimAplain;
  const internalB = claimB - claimBplain;
  const differential = claimB - claimA;
  const controlDiff = claimBplain - claimAplain;

  const regBperCert = regGasB / n;
  const headStart = regGasA - regBperCert;
  const kStar = headStart / differential;

  // ---- calldata floor, computed from EIP-2028 pricing ----
  // Architecture B transmits: selector(4) + root(32) + leaf(32)
  //                           + array offset(32) + array length(32)
  //                           + depth * 32 proof elements
  // Architecture A transmits: selector(4) + hash(32)
  const depth = proof0.length;
  const proofZeros = proof0.reduce((s, h) => s + zeroBytes(h), 0);
  const proofBytes = depth * 32;
  const proofCalldata = (proofBytes - proofZeros) * 16 + proofZeros * 4;

  return {
    n,
    depth,
    regGasA,
    regGasB,
    regBperCert,
    claimA,
    claimB,
    claimAplain,
    claimBplain,
    internalA,
    internalB,
    internalDiff: internalB - internalA,
    controlDiff,
    differential,
    headStart,
    kStar,
    proofCalldata,
    proofZeroBytes: proofZeros,
    kStarUpperBound: headStart / proofCalldata,
  };
}

async function main() {
  console.log("Break-even sweep across batch sizes");
  console.log("===================================\n");

  const rows = [];
  for (const n of SIZES) {
    process.stdout.write(`measuring n = ${n} ... `);
    const r = await measureAt(n, "sweep");
    rows.push(r);
    console.log("done");
  }

  console.log("\nREGISTRATION");
  console.log("  n      A reg     B reg     B per cert");
  for (const r of rows) {
    console.log(
      `  ${String(r.n).padStart(5)}  ${String(r.regGasA).padStart(8)}  ` +
        `${String(r.regGasB).padStart(8)}  ${r.regBperCert.toFixed(2).padStart(10)}`
    );
  }

  console.log("\nCONSUMING CONTRACT");
  console.log("  n     depth   claim A   claim B   plain A   plain B");
  for (const r of rows) {
    console.log(
      `  ${String(r.n).padStart(5)}  ${String(r.depth).padStart(5)}  ` +
        `${String(r.claimA).padStart(8)}  ${String(r.claimB).padStart(8)}  ` +
        `${String(r.claimAplain).padStart(8)}  ${String(r.claimBplain).padStart(8)}`
    );
  }

  console.log("\nDECOMPOSITION OF THE DIFFERENTIAL");
  console.log("  n     total    calldata  computation  calldata %");
  for (const r of rows) {
    const pct = (r.controlDiff / r.differential) * 100;
    console.log(
      `  ${String(r.n).padStart(5)}  ${String(r.differential).padStart(7)}  ` +
        `${String(r.controlDiff).padStart(8)}  ${String(r.internalDiff).padStart(11)}  ` +
        `${pct.toFixed(1).padStart(9)}`
    );
  }

  console.log("\nBREAK-EVEN");
  console.log("  n     head start   differential   k* measured");
  for (const r of rows) {
    console.log(
      `  ${String(r.n).padStart(5)}  ${r.headStart.toFixed(1).padStart(10)}  ` +
        `${String(r.differential).padStart(13)}  ${r.kStar.toFixed(2).padStart(11)}`
    );
  }

  console.log("\nIMPLEMENTATION-INDEPENDENT UPPER BOUND");
  console.log("  The proof must reach the chain regardless of contract design.");
  console.log("  Dividing the head start by the proof calldata cost alone gives");
  console.log("  the largest break-even any implementation could achieve.\n");
  console.log("  n     proof bytes   proof calldata   k* upper bound   k* measured");
  for (const r of rows) {
    console.log(
      `  ${String(r.n).padStart(5)}  ${String(r.depth * 32).padStart(11)}  ` +
        `${String(r.proofCalldata).padStart(14)}  ` +
        `${r.kStarUpperBound.toFixed(2).padStart(14)}  ${r.kStar.toFixed(2).padStart(11)}`
    );
  }

  const outDir = path.join(__dirname, "..", "results");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(
    path.join(outDir, "breakeven_sweep.json"),
    JSON.stringify({ sizes: SIZES, rows }, null, 2)
  );

  const header =
    "n,depth,reg_a,reg_b,reg_b_per_cert,claim_a,claim_b,plain_a,plain_b," +
    "internal_a,internal_b,internal_diff,control_diff,differential," +
    "head_start,k_star,proof_calldata,proof_zero_bytes,k_star_upper_bound\n";
  const csv = rows
    .map(
      (r) =>
        `${r.n},${r.depth},${r.regGasA},${r.regGasB},${r.regBperCert},` +
        `${r.claimA},${r.claimB},${r.claimAplain},${r.claimBplain},` +
        `${r.internalA},${r.internalB},${r.internalDiff},${r.controlDiff},` +
        `${r.differential},${r.headStart},${r.kStar},${r.proofCalldata},` +
        `${r.proofZeroBytes},${r.kStarUpperBound}`
    )
    .join("\n");
  fs.writeFileSync(path.join(outDir, "breakeven_sweep.csv"), header + csv + "\n");

  console.log("\nWritten to results/breakeven_sweep.json and .csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
