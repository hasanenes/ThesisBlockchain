// Security test for the Merkle second-preimage / domain-separation issue.
//
// Demonstrates that the ORIGINAL BatchCertificateRegistry accepts an internal
// node value as a "certificate" (a forged membership proof), and that the
// hardened SecureBatchCertificateRegistry rejects the same forgery while still
// accepting legitimate proofs.

const { expect } = require("chai");
const hre = require("hardhat");
const crypto = require("crypto");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
const { buildDSTree, getProof, hex } = require("../scripts/merkle_ds");

function sha256(payload) {
  return crypto.createHash("sha256").update(payload).digest();
}

async function deploy(name) {
  const factory = await hre.ethers.getContractFactory(name);
  const c = await factory.deploy();
  await c.waitForDeployment();
  return c;
}

describe("Merkle domain separation (second-preimage hardening)", function () {
  // Four real certificate leaves (SHA-256 of canonical payloads).
  const leaves = [0, 1, 2, 3].map((i) => sha256(`cert-${i}`));

  it("ORIGINAL contract accepts an internal node as a forged certificate", async function () {
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const root = hex(tree.getRoot());
    const batch = await deploy("BatchCertificateRegistry");
    await (await batch.registerRoot(root, leaves.length)).wait();

    // Legitimate proof verifies (sanity).
    const legit = await batch.verifyCertificate(root, hex(leaves[0]), tree.getHexProof(leaves[0]));
    expect(legit).to.equal(true);

    // Forgery: present an INTERNAL node value as the "certificate hash".
    const layers = tree.getLayers(); // [leaves, internal, root]
    const internalNode = layers[1][0];
    const internalSibling = layers[1][1];
    const forged = await batch.verifyCertificate(root, hex(internalNode), [hex(internalSibling)]);

    // The vulnerability: the forged "certificate" verifies as true.
    expect(forged).to.equal(true);
  });

  it("HARDENED contract rejects the forgery and accepts legitimate proofs", async function () {
    const ds = buildDSTree(leaves);
    const root = hex(ds.root);
    const secure = await deploy("SecureBatchCertificateRegistry");
    await (await secure.registerRoot(root, leaves.length)).wait();

    // Legitimate proof still verifies.
    const proof0 = getProof(ds.layers, 0).map(hex);
    const legit = await secure.verifyCertificate(root, hex(leaves[0]), proof0);
    expect(legit).to.equal(true);

    // Same class of forgery: present a domain-separated internal node as a leaf.
    const internalNode = ds.layers[1][0];
    const internalSibling = ds.layers[1][1];
    const forged = await secure.verifyCertificate(root, hex(internalNode), [hex(internalSibling)]);

    // The fix: the forged "certificate" is rejected.
    expect(forged).to.equal(false);

    // A tampered certificate hash is also rejected.
    const tampered = sha256("cert-0-tampered");
    const stillRejected = await secure.verifyCertificate(root, hex(tampered), proof0);
    expect(stillRejected).to.equal(false);
  });

  it("reports the verification gas overhead of domain separation", async function () {
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const origRoot = hex(tree.getRoot());
    const batch = await deploy("BatchCertificateRegistry");
    await (await batch.registerRoot(origRoot, leaves.length)).wait();
    const origGas = await batch.verifyCertificate.estimateGas(origRoot, hex(leaves[0]), tree.getHexProof(leaves[0]));

    const ds = buildDSTree(leaves);
    const dsRoot = hex(ds.root);
    const secure = await deploy("SecureBatchCertificateRegistry");
    await (await secure.registerRoot(dsRoot, leaves.length)).wait();
    const dsGas = await secure.verifyCertificate.estimateGas(dsRoot, hex(leaves[0]), getProof(ds.layers, 0).map(hex));

    console.log(`        verify gas: original=${origGas}  hardened=${dsGas}  overhead=${Number(dsGas) - Number(origGas)}`);
    expect(Number(dsGas) - Number(origGas)).to.be.lessThan(2000); // domain separation is cheap
  });
});
