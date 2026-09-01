const { expect } = require("chai");
const { ethers } = require("hardhat");
const { makeCertificateLeaves, buildTree } = require("../scripts/merkle");
const { buildDSTree, getProof } = require("../scripts/merkle_ds");
function hex(buffer) {
  return "0x" + buffer.toString("hex");
}

describe("Certificate verification contracts", function () {
  it("Architecture A registers and verifies a certificate hash", async function () {
    const [issuer, attacker] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CertificateRegistry");
    const registry = await Registry.deploy();
    const hash = hex(makeCertificateLeaves(1, "test-A")[0]);

    await expect(registry.registerCertificate(hash))
      .to.emit(registry, "CertificateRegistered")
      .withArgs(hash, issuer.address);
    expect(await registry.verifyCertificate(hash)).to.equal(true);
    expect(await registry.verifyCertificate(hex(makeCertificateLeaves(1, "tampered-A")[0]))).to.equal(false);

    await expect(registry.connect(attacker).registerCertificate(hash)).to.be.revertedWithCustomError(
      registry,
      "NotIssuer"
    );
    await expect(registry.registerCertificate(hash)).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
  });

  it("Architecture B accepts a valid Merkle proof and rejects forged data", async function () {
    const [issuer, attacker] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("BatchCertificateRegistry");
    const registry = await Registry.deploy();
    const leaves = makeCertificateLeaves(10, "test-B");
    const tree = buildTree(leaves);
    const root = hex(tree.getRoot());

    await expect(registry.registerRoot(root, leaves.length))
      .to.emit(registry, "RootRegistered")
      .withArgs(root, issuer.address, leaves.length);

    const proof = tree.getHexProof(leaves[3]);
    expect(await registry.verifyCertificate(root, hex(leaves[3]), proof)).to.equal(true);
    expect(await registry.verifyCertificate(root, hex(makeCertificateLeaves(1, "fake-B")[0]), proof)).to.equal(false);
    expect(await registry.verifyCertificate(hex(makeCertificateLeaves(1, "wrong-root")[0]), hex(leaves[3]), proof)).to.equal(false);

    await expect(registry.connect(attacker).registerRoot(root, leaves.length)).to.be.revertedWithCustomError(
      registry,
      "NotIssuer"
    );
    await expect(registry.registerRoot(root, leaves.length)).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
  });

  it("Architecture C registers a whole array but still rejects duplicates", async function () {
    const Registry = await ethers.getContractFactory("BulkCertificateRegistry");
    const registry = await Registry.deploy();
    const leaves = makeCertificateLeaves(5, "test-C");
    const hashes = leaves.map(hex);

    await expect(registry.registerCertificateBatch(hashes))
      .to.emit(registry, "CertificateBatchRegistered")
      .withArgs((await ethers.getSigners())[0].address, hashes.length);

    expect(await registry.verifyCertificate(hashes[0])).to.equal(true);
    expect(await registry.verifyCertificate(hashes[4])).to.equal(true);
    await expect(registry.registerCertificateBatch([hashes[0]])).to.be.revertedWithCustomError(
      registry,
      "AlreadyRegistered"
    );
    await expect(registry.registerCertificateBatch([])).to.be.revertedWithCustomError(registry, "EmptyBatch");
  });

  it("Revocable single-hash registry invalidates a certificate after revocation", async function () {
    const Registry = await ethers.getContractFactory("RevocableCertificateRegistry");
    const registry = await Registry.deploy();
    const hash = hex(makeCertificateLeaves(1, "revocable-A")[0]);

    await registry.registerCertificate(hash);
    expect(await registry.verifyCertificate(hash)).to.equal(true);
    await expect(registry.revokeCertificate(hash)).to.emit(registry, "CertificateRevoked");
    expect(await registry.verifyCertificate(hash)).to.equal(false);
    await expect(registry.revokeCertificate(hash)).to.be.revertedWithCustomError(registry, "AlreadyRevoked");
  });

  it("Revocable Merkle registry invalidates a whole batch after root revocation", async function () {
    const Registry = await ethers.getContractFactory("RevocableBatchCertificateRegistry");
    const registry = await Registry.deploy();
    const leaves = makeCertificateLeaves(10, "revocable-B");
    const ds = buildDSTree(leaves);
    const root = hex(ds.root);
    const proof = getProof(ds.layers, 0).map(hex);

    await registry.registerRoot(root, leaves.length);
    expect(await registry.verifyCertificate(root, hex(leaves[0]), proof)).to.equal(true);
    await expect(registry.revokeRoot(root)).to.emit(registry, "RootRevoked");
    expect(await registry.verifyCertificate(root, hex(leaves[0]), proof)).to.equal(false);
    await expect(registry.revokeRoot(root)).to.be.revertedWithCustomError(registry, "AlreadyRevoked");
  });

    
  it("only the administrator can grant and withdraw issuer authorisation", async function () {
    const [, newIssuer, attacker] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CertificateRegistry");
    const registry = await Registry.deploy();
    const hash = hex(makeCertificateLeaves(1, "test-FR2")[0]);

    await expect(registry.connect(newIssuer).registerCertificate(hash))
      .to.be.revertedWithCustomError(registry, "NotIssuer");

    await expect(registry.connect(attacker).addIssuer(attacker.address))
      .to.be.revertedWithCustomError(registry, "NotAdmin");

    await expect(registry.addIssuer(newIssuer.address))
      .to.emit(registry, "IssuerAdded").withArgs(newIssuer.address);
    await expect(registry.connect(newIssuer).registerCertificate(hash))
      .to.emit(registry, "CertificateRegistered").withArgs(hash, newIssuer.address);

    await expect(registry.removeIssuer(newIssuer.address))
      .to.emit(registry, "IssuerRemoved").withArgs(newIssuer.address);
    await expect(registry.connect(newIssuer).registerCertificate(hex(makeCertificateLeaves(1, "test-FR2b")[0])))
      .to.be.revertedWithCustomError(registry, "NotIssuer");

    await expect(registry.connect(newIssuer).addIssuer(attacker.address))
      .to.be.revertedWithCustomError(registry, "NotAdmin");
  });
});
