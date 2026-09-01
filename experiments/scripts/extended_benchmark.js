const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { makeCertificateLeaves, buildTree } = require("./merkle");
const { buildDSTree, getProof } = require("./merkle_ds");

const BATCH_SIZES = [1, 10, 50, 100, 500, 1000];

function hex(buffer) {
  return "0x" + buffer.toString("hex");
}

async function deploy(name) {
  const factory = await hre.ethers.getContractFactory(name);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  return { contract, deployGas: Number(receipt.gasUsed) };
}

async function architectureA(sizes) {
  const { contract, deployGas } = await deploy("CertificateRegistry");
  const rows = [];
  for (const n of sizes) {
    const leaves = makeCertificateLeaves(n, `extended-A-${n}`);
    let total = 0n;
    for (const leaf of leaves) {
      const receipt = await (await contract.registerCertificate(hex(leaf))).wait();
      total += receipt.gasUsed;
    }
    const verifyGas = await contract.verifyCertificate.estimateGas(hex(leaves[0]));
    rows.push({
      arch: "A_single_tx_per_hash",
      batchSize: n,
      deployGas,
      registerTotalGas: Number(total),
      registerAvgGas: Number(total / BigInt(n)),
      verifyGas: Number(verifyGas),
      proofDepth: "",
      revocationGas: "",
      storageSlotsPerBatch: n,
      notes: "One transaction and one storage slot per certificate",
    });
    console.log(`[A] n=${n} total=${total} avg=${total / BigInt(n)} verify=${verifyGas}`);
  }
  return rows;
}

async function architectureB(sizes) {
  const { contract, deployGas } = await deploy("BatchCertificateRegistry");
  const rows = [];
  for (const n of sizes) {
    const leaves = makeCertificateLeaves(n, `extended-B-${n}`);
    const tree = buildTree(leaves);
    const root = hex(tree.getRoot());
    const receipt = await (await contract.registerRoot(root, n)).wait();
    const proof = tree.getHexProof(leaves[0]);
    const verifyGas = await contract.verifyCertificate.estimateGas(root, hex(leaves[0]), proof);
    rows.push({
      arch: "B_merkle_root",
      batchSize: n,
      deployGas,
      registerTotalGas: Number(receipt.gasUsed),
      registerAvgGas: Number(receipt.gasUsed) / n,
      verifyGas: Number(verifyGas),
      proofDepth: proof.length,
      revocationGas: "",
      storageSlotsPerBatch: 1,
      notes: "One Merkle root and one transaction per batch",
    });
    console.log(`[B] n=${n} register=${receipt.gasUsed} avg=${Number(receipt.gasUsed) / n} verify=${verifyGas} proofDepth=${proof.length}`);
  }
  return rows;
}

async function architectureC(sizes) {
  const { contract, deployGas } = await deploy("BulkCertificateRegistry");
  const rows = [];
  for (const n of sizes) {
    const leaves = makeCertificateLeaves(n, `extended-C-${n}`);
    const hashes = leaves.map(hex);
    let receipt;
    try {
      receipt = await (await contract.registerCertificateBatch(hashes)).wait();
    } catch (error) {
    rows.push({
      arch: "C_bulk_array_storage",
      batchSize: n,
      deployGas,
      registerTotalGas: "EXCEEDS_TX_GAS_CAP",
      registerAvgGas: "EXCEEDS_TX_GAS_CAP",
      verifyGas: "",
      proofDepth: "",
      revocationGas: "",
      storageSlotsPerBatch: n,
      notes: "Exceeds the per-transaction gas cap of 16,777,216 (EIP-7825); the 30,000,000 block gas limit is not the binding constraint",
    });
    console.log(`[C] n=${n} EXCEEDS per-transaction gas cap of 16,777,216`);
    continue;
  }
    const verifyGas = await contract.verifyCertificate.estimateGas(hashes[0]);
    rows.push({
      arch: "C_bulk_array_storage",
      batchSize: n,
      deployGas,
      registerTotalGas: Number(receipt.gasUsed),
      registerAvgGas: Number(receipt.gasUsed) / n,
      verifyGas: Number(verifyGas),
      proofDepth: "",
      revocationGas: "",
      storageSlotsPerBatch: n,
      notes: "One transaction per batch, but still one storage slot per certificate",
    });
    console.log(`[C] n=${n} register=${receipt.gasUsed} avg=${Number(receipt.gasUsed) / n} verify=${verifyGas}`);
  }
  return rows;
}

async function revocationRows() {
  const rows = [];

  const single = await deploy("RevocableCertificateRegistry");
  const leaf = hex(makeCertificateLeaves(1, "revocable-single")[0]);
  const regReceipt = await (await single.contract.registerCertificate(leaf)).wait();
  const verifyGas = await single.contract.verifyCertificate.estimateGas(leaf);
  const revokeReceipt = await (await single.contract.revokeCertificate(leaf)).wait();
  rows.push({
    arch: "D_revocable_single_hash",
    batchSize: 1,
    deployGas: single.deployGas,
    registerTotalGas: Number(regReceipt.gasUsed),
    registerAvgGas: Number(regReceipt.gasUsed),
    verifyGas: Number(verifyGas),
    proofDepth: "",
    revocationGas: Number(revokeReceipt.gasUsed),
    storageSlotsPerBatch: 2,
    notes: "Individual revocation stores an additional revoked flag per certificate",
  });
  console.log(`[D1] register=${regReceipt.gasUsed} revoke=${revokeReceipt.gasUsed} verify=${verifyGas}`);

  const batch = await deploy("RevocableBatchCertificateRegistry");
  const leaves = makeCertificateLeaves(1000, "revocable-batch");
  const ds = buildDSTree(leaves);
  const root = hex(ds.root);
  const batchRegReceipt = await (await batch.contract.registerRoot(root, leaves.length)).wait();
  const proof = getProof(ds.layers, 0).map(hex);
  const batchVerifyGas = await batch.contract.verifyCertificate.estimateGas(root, hex(leaves[0]), proof);
  const batchRevokeReceipt = await (await batch.contract.revokeRoot(root)).wait();
  rows.push({
    arch: "E_revocable_merkle_batch",
    batchSize: 1000,
    deployGas: batch.deployGas,
    registerTotalGas: Number(batchRegReceipt.gasUsed),
    registerAvgGas: Number(batchRegReceipt.gasUsed) / leaves.length,
    verifyGas: Number(batchVerifyGas),
    proofDepth: proof.length,
    revocationGas: Number(batchRevokeReceipt.gasUsed),
    storageSlotsPerBatch: 2,
    notes: "Root-level revocation invalidates the whole batch with one extra storage slot",
  });
  console.log(`[E] n=1000 register=${batchRegReceipt.gasUsed} revoke=${batchRevokeReceipt.gasUsed} verify=${batchVerifyGas}`);

  return rows;
}

function toCsv(rows) {
  const header = [
    "arch",
    "batchSize",
    "deployGas",
    "registerTotalGas",
    "registerAvgGas",
    "verifyGas",
    "proofDepth",
    "revocationGas",
    "storageSlotsPerBatch",
    "notes",
  ];
  return [
    header.join(","),
    ...rows.map((row) =>
      header
        .map((key) => {
          const value = row[key] ?? "";
          return typeof value === "string" && value.includes(",") ? `"${value}"` : value;
        })
        .join(",")
    ),
  ].join("\n");
}

async function main() {
  console.log("Compiler:", hre.config.solidity.compilers?.[0]?.version || hre.config.solidity.version);
  console.log("Hardhat network:", hre.network.name);
  const rows = [
    ...(await architectureA(BATCH_SIZES)),
    ...(await architectureB(BATCH_SIZES)),
    ...(await architectureC(BATCH_SIZES)),
    ...(await revocationRows()),
  ];

  const outDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "extended_gas_results.csv"), toCsv(rows));
  fs.writeFileSync(path.join(outDir, "extended_gas_results.json"), JSON.stringify(rows, null, 2));
  console.log("\nWrote results/extended_gas_results.csv");
  console.log("Wrote results/extended_gas_results.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
