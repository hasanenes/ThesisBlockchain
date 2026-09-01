
const keccak256 = require("keccak256");

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function leafHash(certHash) {
  return keccak256(Buffer.concat([LEAF_PREFIX, certHash]));
}

function nodeHash(a, b) {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return keccak256(Buffer.concat([NODE_PREFIX, lo, hi]));
}

function buildDSTree(certHashes) {
  let level = certHashes.map(leafHash);
  const layers = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(nodeHash(level[i], level[i + 1]));
      else next.push(level[i]); 
    }
    layers.push(next);
    level = next;
  }
  return { root: layers[layers.length - 1][0], layers };
}

function getProof(layers, index) {
  const proof = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const sib = idx ^ 1;
    if (sib < layer.length) proof.push(layer[sib]);
    idx = idx >> 1;
  }
  return proof;
}

function hex(buf) {
  return "0x" + buf.toString("hex");
}

module.exports = { leafHash, nodeHash, buildDSTree, getProof, hex };
