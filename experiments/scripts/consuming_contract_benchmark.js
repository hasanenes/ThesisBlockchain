// Measures on-chain verification cost when the verifier is a smart contract
// rather than a human. Supports the break-even analysis in Chapter 4.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const N = 1000;

function hashPair(a, b) {
  // Sorted-pair convention, matching the registry contracts.
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
      if (i + 1 === prev.length) {
        next.push(prev[i]); // odd node promoted unchanged
      } else {
        next.push(hashPair(prev[i], prev[i + 1]));
      }
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

async function main() {
  console.log("Consuming-contract verification benchmark");
  console.log("=========================================\n");

  // --- deploy the two registries -----------------------------------------
  const RegA = await ethers.getContractFactory("CertificateRegistry");
  const regA = await RegA.deploy();
  await regA.waitForDeployment();

  const RegB = await ethers.getContractFactory("BatchCertificateRegistry");
  const regB = await RegB.deploy();
  await regB.waitForDeployment();

  // --- build the batch and register ---------------------------------------
  const leaves = [];
  for (let i = 0; i < N; i++) {
    leaves.push(ethers.keccak256(ethers.toUtf8Bytes(`certificate-${i}`)));
  }
  const layers = buildTree(leaves);
  const root = layers[layers.length - 1][0];

  const leaf0 = leaves[0];
  const proof0 = getProof(layers, 0);
  const leaf1 = leaves[1];
  const proof1 = getProof(layers, 1);

  console.log(`batch size            ${N}`);
  console.log(`proof depth           ${proof0.length}\n`);

  const regGasA = await gasOf(regA.registerCertificate(leaf0));
  const regGasB = await gasOf(regB.registerRoot(root, N));

  // Architecture A also needs the second hash registered so that the
  // no-verification claim is compared against a like-for-like state.
  await gasOf(regA.registerCertificate(leaf1));

  console.log(`A registration        ${regGasA}`);
  console.log(`B registration        ${regGasB}  (${(regGasB / N).toFixed(2)} per certificate)\n`);

  // --- deploy the consuming contracts -------------------------------------
  const GateA = await ethers.getContractFactory("ScholarshipGateA");
  const gateA = await GateA.deploy(await regA.getAddress());
  await gateA.waitForDeployment();

  const GateB = await ethers.getContractFactory("ScholarshipGateB");
  const gateB = await GateB.deploy(await regB.getAddress());
  await gateB.waitForDeployment();

  // --- measure --------------------------------------------------------------
  const claimA = await gasOf(gateA.claim(leaf0));
  const claimAplain = await gasOf(gateA.claimWithoutVerification(leaf1));

  const claimB = await gasOf(gateB.claim(root, leaf0, proof0));
  const claimBplain = await gasOf(
    gateB.claimWithoutVerification(root, leaf1, proof1)
  );

  console.log("Consuming contract, claim with on-chain verification");
  console.log(`  Architecture A      ${claimA}`);
  console.log(`  Architecture B      ${claimB}\n`);

  console.log("Consuming contract, identical claim without verification");
  console.log(`  Architecture A      ${claimAplain}`);
  console.log(`  Architecture B      ${claimBplain}\n`);

  const internalA = claimA - claimAplain;
  const internalB = claimB - claimBplain;
  const deltaInternal = internalB - internalA;
  const deltaTotal = claimB - claimA;

  console.log("Isolated internal verification cost (claim minus plain claim)");
  console.log(`  Architecture A      ${internalA}`);
  console.log(`  Architecture B      ${internalB}`);
  console.log(`  difference          ${deltaInternal}\n`);

  console.log("Total differential paid by a consuming contract (B minus A)");
  console.log(`  difference          ${deltaTotal}\n`);

  const headStart = regGasA - regGasB / N;
  const kInternal = headStart / deltaTotal;

  console.log("Break-even, computed from this run");
  console.log(`  registration head start   ${headStart.toFixed(1)}`);
  console.log(`  loss per verification     ${deltaTotal}`);
  console.log(`  k*                        ${kInternal.toFixed(2)}\n`);

  // --- standalone verification, for comparison with Chapter 4 --------------
  let standaloneA = null;
  let standaloneB = null;
  try {
    standaloneA = await gasOf(regA.verifyCertificate.send(leaf0));
    standaloneB = await gasOf(regB.verifyCertificate.send(root, leaf0, proof0));
    console.log("Standalone verification transactions");
    console.log(`  Architecture A      ${standaloneA}`);
    console.log(`  Architecture B      ${standaloneB}`);
    console.log(`  difference          ${standaloneB - standaloneA}\n`);
  } catch (e) {
    console.log("Standalone verification not measured in this run.\n");
  }

  const results = {
    batchSize: N,
    proofDepth: proof0.length,
    registration: { A: regGasA, B: regGasB, BPerCertificate: regGasB / N },
    consumingContract: {
      claimA,
      claimB,
      claimAWithoutVerification: claimAplain,
      claimBWithoutVerification: claimBplain,
      internalVerificationA: internalA,
      internalVerificationB: internalB,
      differenceInternal: deltaInternal,
      differenceTotal: deltaTotal,
    },
    standalone: { A: standaloneA, B: standaloneB },
    breakEven: { headStart, lossPerVerification: deltaTotal, k: kInternal },
  };

  const outDir = path.join(__dirname, "..", "results");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(
    path.join(outDir, "consuming_contract_benchmark.json"),
    JSON.stringify(results, null, 2)
  );
  console.log("Written to results/consuming_contract_benchmark.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});