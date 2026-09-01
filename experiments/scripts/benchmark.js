const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { makeCertificateLeaves, buildTree } = require("./merkle");

const BATCH_SIZES = [1, 10, 50, 100, 500, 1000];

async function deploy(name) {
  const factory = await hre.ethers.getContractFactory(name);
  const c = await factory.deploy();
  await c.waitForDeployment();
  const tx = c.deploymentTransaction();
  const receipt = await tx.wait();
  return { contract: c, deployGas: Number(receipt.gasUsed) };
}

async function benchmarkArchitectureA(sizes) {
  const { contract, deployGas } = await deploy("CertificateRegistry");
  const rows = [];
  for (const n of sizes) {
    const leaves = makeCertificateLeaves(n, `A-${n}`);
    let total = 0n;
    let first = 0n;
    for (let i = 0; i < n; i++) {
      const tx = await contract.registerCertificate("0x" + leaves[i].toString("hex"));
      const r = await tx.wait();
      if (i === 0) first = r.gasUsed;
      total += r.gasUsed;
    }

    const verifyTx = await contract.verifyCertificate.staticCall(
      "0x" + leaves[0].toString("hex")
    );
    const verifyEstimate = await contract.verifyCertificate.estimateGas(
      "0x" + leaves[0].toString("hex")
    );

    rows.push({
      arch: "A",
      batchSize: n,
      deployGas,
      registerTotalGas: Number(total),
      registerFirstGas: Number(first),
      registerAvgGas: Number(total / BigInt(n)),
      verifyGas: Number(verifyEstimate),
      verifyResult: verifyTx,
    });
    console.log(
      `[A] n=${n}  total=${total}  avg=${total / BigInt(n)}  verify=${verifyEstimate}`
    );
  }
  return rows;
}

async function benchmarkArchitectureB(sizes) {
  const { contract, deployGas } = await deploy("BatchCertificateRegistry");
  const rows = [];
  for (const n of sizes) {
    const leaves = makeCertificateLeaves(n, `B-${n}`);
    const tree = buildTree(leaves);
    const root = tree.getRoot();
    const rootHex = "0x" + root.toString("hex");

    const tx = await contract.registerRoot(rootHex, n);
    const r = await tx.wait();
    const registerGas = Number(r.gasUsed);

    const leafHex = "0x" + leaves[0].toString("hex");
    const proof = tree.getHexProof(leaves[0]);

    const verifyEstimate = await contract.verifyCertificate.estimateGas(
      rootHex,
      leafHex,
      proof
    );
    const verifyResult = await contract.verifyCertificate.staticCall(
      rootHex,
      leafHex,
      proof
    );

    const proofDepth = proof.length;
    rows.push({
      arch: "B",
      batchSize: n,
      deployGas,
      registerTotalGas: registerGas,
      registerFirstGas: registerGas,
      registerAvgGas: Number(registerGas) / n,
      verifyGas: Number(verifyEstimate),
      proofDepth,
      verifyResult,
    });
    console.log(
      `[B] n=${n}  register=${registerGas}  verify=${verifyEstimate}  proofDepth=${proofDepth}`
    );
  }
  return rows;
}

function toCsv(rows) {
  const header = [
    "arch",
    "batchSize",
    "deployGas",
    "registerTotalGas",
    "registerFirstGas",
    "registerAvgGas",
    "verifyGas",
    "proofDepth",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      header
        .map((h) => (r[h] === undefined ? "" : r[h]))
        .join(",")
    );
  }
  return lines.join("\n");
}

async function main() {
  console.log("Compiler:", hre.config.solidity.compilers?.[0]?.version || hre.config.solidity.version);
  console.log("Hardhat network:", hre.network.name);

  const a = await benchmarkArchitectureA(BATCH_SIZES);
  const b = await benchmarkArchitectureB(BATCH_SIZES);
  const all = [...a, ...b];

  const outDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, "gas_results.csv");
  const jsonPath = path.join(outDir, "gas_results.json");
  fs.writeFileSync(csvPath, toCsv(all));
  fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2));

  console.log("\nWrote", csvPath);
  console.log("Wrote", jsonPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
