
const hre = require("hardhat");
const { makeCertificateLeaves, buildTree } = require("./merkle");

function divider(title) {
  console.log("\n" + "=".repeat(70));
  console.log("  " + title);
  console.log("=".repeat(70));
}

async function main() {
  const [issuer, attacker] = await hre.ethers.getSigners();

  divider("ARCHITECTURE A — Single hash registration");

  const A = await hre.ethers.getContractFactory("CertificateRegistry");
  const a = await A.deploy();
  await a.waitForDeployment();
  console.log("Deployed CertificateRegistry at", await a.getAddress());

  const certHash = "0x" + makeCertificateLeaves(1, "live-demo")[0].toString("hex");
  console.log("\nCertificate SHA-256 hash:");
  console.log(" ", certHash);

  console.log("\nRegistering certificate as the issuer...");
  const tx1 = await a.connect(issuer).registerCertificate(certHash);
  const r1 = await tx1.wait();
  console.log("  registerCertificate gas:", r1.gasUsed.toString());

  let ok = await a.verifyCertificate(certHash);
  console.log("\n  verifyCertificate(authentic file) →", ok);

  const tampered = "0x" + makeCertificateLeaves(1, "live-demo-tampered")[0].toString("hex");
  ok = await a.verifyCertificate(tampered);
  console.log("  verifyCertificate(tampered file) →", ok);

  console.log("\nAttacker tries to register a fake certificate...");
  try {
    await a.connect(attacker).registerCertificate(tampered);
    console.log("  ❌ Should have reverted!");
  } catch (e) {
    console.log("  ✓ Reverted as expected:", e.shortMessage || "NotIssuer()");
  }

  divider("ARCHITECTURE B — Merkle batch registration (N = 10)");

  const B = await hre.ethers.getContractFactory("BatchCertificateRegistry");
  const b = await B.deploy();
  await b.waitForDeployment();
  console.log("Deployed BatchCertificateRegistry at", await b.getAddress());

  const N = 10;
  const leaves = makeCertificateLeaves(N, "graduation-2026");
  const tree = buildTree(leaves);
  const root = "0x" + tree.getRoot().toString("hex");
  console.log("\nBuilt Merkle tree off-chain:");
  console.log("  Leaves :", N);
  console.log("  Root   :", root);

  console.log("\nRegistering ROOT only (one transaction for all 10)...");
  const tx2 = await b.connect(issuer).registerRoot(root, N);
  const r2 = await tx2.wait();
  console.log("  registerRoot gas:", r2.gasUsed.toString());
  console.log("  → Same single-transaction cost regardless of batch size.");

  const realLeaf = "0x" + leaves[3].toString("hex");
  const realProof = tree.getHexProof(leaves[3]);
  const realResult = await b.verifyCertificate(root, realLeaf, realProof);
  console.log("\nVerifying certificate #3 (real):");
  console.log("  proof depth:", realProof.length);
  console.log("  result     :", realResult);

  const fakeLeaf = "0x" + makeCertificateLeaves(1, "forged")[0].toString("hex");
  const fakeResult = await b.verifyCertificate(root, fakeLeaf, realProof);
  console.log("\nVerifying a forged certificate (wrong leaf, real proof):");
  console.log("  result     :", fakeResult, "  ← false: forgery detected");

  divider("SUMMARY");
  console.log("Architecture A: registered 1 certificate at", r1.gasUsed.toString(), "gas");
  console.log("Architecture B: registered", N, "certificates at", r2.gasUsed.toString(), "gas total");
  console.log(
    "  → Per-certificate cost ratio (A:B) =",
    (Number(r1.gasUsed) / (Number(r2.gasUsed) / N)).toFixed(2) + "×"
  );
  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
