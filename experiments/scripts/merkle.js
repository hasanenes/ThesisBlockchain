const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
const crypto = require("crypto");

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest();
}

function makeCertificateLeaves(count, salt = "benchmark") {
  const leaves = [];
  for (let i = 0; i < count; i++) {
    const payload = `cert-${salt}-${i.toString().padStart(6, "0")}`;
    leaves.push(sha256Hex(payload));
  }
  return leaves;
}

function buildTree(leaves) {
  return new MerkleTree(leaves, keccak256, { sortPairs: true });
}

module.exports = { makeCertificateLeaves, buildTree, sha256Hex };
