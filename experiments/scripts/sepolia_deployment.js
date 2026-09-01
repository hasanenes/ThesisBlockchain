// Deploys the three architectures to Ethereum Sepolia and records real
// network conditions: gas used, effective gas price, cost in ETH, and
// confirmation latency. Validates the local benchmark measurements against
// a live Ethereum network.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BULK_N = 10; // keep Architecture C small; it is linear in batch size

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

const records = [];

async function track(label, txPromise) {
  const t0 = Date.now();
  const tx = await txPromise;
  const receipt = await tx.wait();
  const latency = (Date.now() - t0) / 1000;

  const gasUsed = Number(receipt.gasUsed);
  const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice;
  const costWei = receipt.gasUsed * gasPrice;

  const rec = {
    label,
    gasUsed,
    gasPriceGwei: Number(ethers.formatUnits(gasPrice, "gwei")),
    costEth: Number(ethers.formatEther(costWei)),
    block: receipt.blockNumber,
    latencySeconds: latency,
    txHash: receipt.hash,
  };
  records.push(rec);

  console.log(
    `  ${label.padEnd(34)} ${String(gasUsed).padStart(9)} gas  ` +
      `${rec.gasPriceGwei.toFixed(4).padStart(9)} gwei  ` +
      `${rec.costEth.toFixed(8)} ETH  ${latency.toFixed(1)}s`
  );
  return receipt;
}

async function trackDeploy(label, factory, args = []) {
  const t0 = Date.now();
  const contract = await factory.deploy(...args);
  const receipt = await contract.deploymentTransaction().wait();
  const latency = (Date.now() - t0) / 1000;

  const gasUsed = Number(receipt.gasUsed);
  const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice;
  const costWei = receipt.gasUsed * gasPrice;

  const rec = {
    label,
    gasUsed,
    gasPriceGwei: Number(ethers.formatUnits(gasPrice, "gwei")),
    costEth: Number(ethers.formatEther(costWei)),
    block: receipt.blockNumber,
    latencySeconds: latency,
    txHash: receipt.hash,
    address: await contract.getAddress(),
  };
  records.push(rec);

  console.log(
    `  ${label.padEnd(34)} ${String(gasUsed).padStart(9)} gas  ` +
      `${rec.gasPriceGwei.toFixed(4).padStart(9)} gwei  ` +
      `${rec.costEth.toFixed(8)} ETH  ${latency.toFixed(1)}s`
  );
  return contract;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const feeData = await ethers.provider.getFeeData();
  const startBalance = await ethers.provider.getBalance(signer.address);

  console.log("Sepolia deployment and measurement");
  console.log("==================================\n");
  console.log(`network        ${net.name} (chain ID ${net.chainId})`);
  console.log(`deployer       ${signer.address}`);
  console.log(`balance        ${ethers.formatEther(startBalance)} ETH`);
  console.log(
    `gas price      ${ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei")} gwei`
  );
  console.log(`block          ${await ethers.provider.getBlockNumber()}\n`);

  // ---------- deployments ----------
  console.log("DEPLOYMENTS");
  const RegA = await ethers.getContractFactory("CertificateRegistry");
  const regA = await trackDeploy("deploy CertificateRegistry (A)", RegA);

  const RegB = await ethers.getContractFactory("BatchCertificateRegistry");
  const regB = await trackDeploy("deploy BatchCertificateRegistry (B)", RegB);

  const RegC = await ethers.getContractFactory("BulkCertificateRegistry");
  const regC = await trackDeploy("deploy BulkCertificateRegistry (C)", RegC);

  const RegS = await ethers.getContractFactory("SecureBatchCertificateRegistry");
  const regS = await trackDeploy("deploy SecureBatchRegistry", RegS);

  // ---------- prepare data ----------
  const leaves = [];
  for (let i = 0; i < 1000; i++) {
    leaves.push(ethers.keccak256(ethers.toUtf8Bytes(`sepolia-cert-${i}`)));
  }
  const layers = buildTree(leaves);
  const root = layers[layers.length - 1][0];

  const bulkHashes = leaves.slice(0, BULK_N);

  // ---------- transactions ----------
  console.log("\nREGISTRATION TRANSACTIONS");
  await track("A: registerCertificate (1 cert)", regA.registerCertificate(leaves[0]));
  await track("B: registerRoot (1000 certs)", regB.registerRoot(root, 1000));
  await track(
    `C: registerCertificateBatch (${BULK_N})`,
    regC.registerCertificateBatch(bulkHashes)
  );

  // Secure variant uses a domain-separated tree; register the same root value
  // purely to measure the registration path on a live network.
  await track("Secure: registerRoot (1000 certs)", regS.registerRoot(root, 1000));

  // ---------- summary ----------
  const endBalance = await ethers.provider.getBalance(signer.address);
  const spent = startBalance - endBalance;

  console.log("\nSUMMARY");
  console.log(`  total spent        ${ethers.formatEther(spent)} ETH`);
  console.log(`  remaining balance  ${ethers.formatEther(endBalance)} ETH`);

  console.log("\nDEPLOYED ADDRESSES");
  for (const r of records.filter((x) => x.address)) {
    console.log(`  ${r.label.padEnd(34)} ${r.address}`);
  }

  console.log("\nVERIFY ON ETHERSCAN");
  console.log(`  https://sepolia.etherscan.io/address/${signer.address}`);

  // ---------- write results ----------
  const outDir = path.join(__dirname, "..", "results");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  fs.writeFileSync(
    path.join(outDir, "sepolia_deployment.json"),
    JSON.stringify(
      {
        network: net.name,
        chainId: Number(net.chainId),
        deployer: signer.address,
        totalSpentEth: Number(ethers.formatEther(spent)),
        bulkBatchSize: BULK_N,
        timestamp: new Date().toISOString(),
        records,
      },
      null,
      2
    )
  );

  const header =
    "label,gas_used,gas_price_gwei,cost_eth,block,latency_seconds,tx_hash,address\n";
  const rows = records
    .map(
      (r) =>
        `"${r.label}",${r.gasUsed},${r.gasPriceGwei},${r.costEth},${r.block},` +
        `${r.latencySeconds},${r.txHash},${r.address ?? ""}`
    )
    .join("\n");
  fs.writeFileSync(path.join(outDir, "sepolia_deployment.csv"), header + rows + "\n");

  console.log("\nWritten to results/sepolia_deployment.json and .csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});