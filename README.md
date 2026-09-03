# Quantifying Verification Cost Limits for Academic Certificate Registries on Ethereum


Solidity contracts, experiment scripts, measured results, and figures for the bachelor
thesis *"Quantifying Verification Cost Limits for Academic Certificate Registries on Ethereum
"*, Riga Technical
University, 2026. Author: Hasan Enes Turan.

The thesis compares three smart contract architectures for registering and verifying
hashes of academic certificates on Ethereum:

- **Architecture A (single hash)** — one transaction stores one certificate hash.
- **Architecture B (Merkle batch)** — one transaction stores one Merkle root for a batch
  of *n* certificates. Verification uses Merkle proofs, O(log n) per certificate.
- **Architecture C (bulk array)** — one transaction stores all *n* hashes in a loop.
  Included as a control case: it isolates storage writes, not transaction count, as the
  main cost driver.

All gas figures in the thesis come from this repository, measured on a local Hardhat
network with Solidity 0.8.24 and the optimizer enabled (200 runs). Gas usage on the EVM
is deterministic: the same bytecode and the same inputs produce the same `gasUsed` on any
machine or network.

## Repository layout

| Path | Contents |
|---|---|
| `experiments/contracts/` | The seven Solidity contracts under test. |
| `experiments/scripts/` | Dataset generation, Merkle tooling, benchmarks, demo, deployment. |
| `experiments/test/` | Hardhat correctness and Merkle security tests. |
| `experiments/results/` | Raw measured output (CSV + JSON) and Slither reports — the source data for every table and figure in the thesis. |
| `diagrams/` | Thesis figures (PNG) with their Mermaid sources and chart generation scripts. |
| `docs/` | Architecture explanation, Chapter 5 text, related work, drafted sections. |
| `defence/` | Defence preparation material: Q&A, presentation outline, live demo guide. |

## Contracts

| File | Purpose |
|---|---|
| `CertificateRegistry.sol` | Architecture A. Registers one certificate hash per transaction. Baseline of the comparison. |
| `BatchCertificateRegistry.sol` | Architecture B. Registers one Merkle root per batch and verifies individual certificates with Merkle proofs. |
| `BulkCertificateRegistry.sol` | Architecture C. Registers an array of hashes in a single transaction. Control case for the cost analysis. |
| `SecureBatchCertificateRegistry.sol` | Hardened Architecture B. Adds domain separation between leaf hashing and internal node hashing to close the Merkle second preimage weakness (CVE-2012-2459), at a measured overhead of about 46 gas. |
| `RevocableCertificateRegistry.sol` | Architecture A extended with individual certificate revocation. |
| `RevocableBatchCertificateRegistry.sol` | Architecture B extended with root level batch revocation. Basis for the revocation trade-off analysis. |
| `ScholarshipGates.sol` | Consuming contracts (`ScholarshipGateA` / `ScholarshipGateB`). Move verification on-chain into a real transaction, so the true cost of a verification that enters consensus can be measured. |

## Scripts

Data preparation:

| File | Purpose |
|---|---|
| `generate_dataset.js` | Generates the certificate dataset (1000 real PDFs plus hash manifest) used in the experiments. |
| `canonicalize.js` | Canonical JSON hashing (RFC 8785 / JCS), so the same certificate data always produces the same hash regardless of field order. |
| `certpdf.js` | Generates sample certificate PDF files for the dataset and the demo. |

Merkle tooling:

| File | Purpose |
|---|---|
| `merkle.js` | Merkle tree construction and proof generation, sorted pair convention. |
| `merkle_ds.js` | Merkle tree with domain separation (distinct prefixes for leaves and internal nodes). Off-chain counterpart of `SecureBatchCertificateRegistry.sol`. |

Benchmarks:

| File | Purpose |
|---|---|
| `benchmark.js` | Core gas benchmark of Architectures A and B across batch sizes. |
| `extended_benchmark.js` | Extended benchmark including Architecture C, larger batch sizes, and the revocation variants. |
| `baseline_comparison.js` | Direct side-by-side comparison of the architectures. |
| `canonicalization_benchmark.js` | Measures determinism and cost of canonical hashing across different field orderings. |
| `offchain_benchmark.js` | Off-chain costs: Merkle tree construction time and proof generation time. |
| `realistic_benchmark.js` | Simulates a realistic institutional issuance workload over the generated PDF dataset. |
| `consuming_contract_benchmark.js` | Measures verification cost inside a consuming contract, where the check enters consensus. |
| `cost_sensitivity.js` | Converts gas results to EUR under different gas price and ETH price scenarios. |

Demo and deployment:

| File | Purpose |
|---|---|
| `demo.js` | End-to-end walkthrough: canonicalize, hash, register, verify. Used for the live defence demo. |
| `sepolia_deployment.js` | Deploys the registries to the Sepolia public testnet and records real-network gas and cost. Requires a `.env` file, see `experiments/.env.example`. |

## Requirements

- **Node.js 18 or newer** (Hardhat 2.22 does not support Node 16; check with `node --version`)
- **Python 3.10+** — only for the optional Slither security analysis

## Reproducing the measurements

```bash
git clone https://github.com/hasanenes/Blockchainthesis.git
cd Blockchainthesis/experiments
npm install
npm run compile
npm test
npm run benchmark
npm run benchmark:extended
npm run benchmark:offchain
npm run cost:sensitivity
```

The canonical-hashing and realistic-workload experiments:

```bash
npm run benchmark:canonical
npm run dataset
npm run benchmark:realistic
```

Each script finishes within a few minutes on an ordinary laptop. Output is printed to the
terminal and written to `experiments/results/` as CSV and JSON. Those files are the source
data for the thesis tables and figures, and the gas values should match the thesis exactly.

### Deploying to Sepolia 

```bash
cp experiments/.env.example experiments/.env  
npm run deploy:sepolia
```

Use a throwaway test account. `.env` is gitignored and must never be committed.

### Reproducibility

The gas figures are deterministic. A clean checkout of this repository regenerates
`results/gas_results.csv` and `results/extended_gas_results.csv` **byte for byte**
identically to the committed files, which are the source of the tables in the thesis.
Off-chain timings (`offchain_results.*`) are wall-clock measurements and will vary with
hardware; the gas columns will not.

## Main measured results

- At n = 1000, Merkle batch registration reduces the registration cost per certificate by
  a factor of about 991 compared to single hash registration. Verification moves to
  O(log n) proof checks — the intended trade-off for a write-once, verify-many workload.
- The bulk array control shows that cost scales with storage writes, not with transaction
  count, and that single transaction bulk registration hits the per-transaction gas limit
  at large batch sizes.
- Domain separation closes CVE-2012-2459 at a measured cost of about 46 gas.
- Canonical hashing removes the file-level brittleness of hashing raw PDFs: the same
  certificate data yields the same hash regardless of serialisation.
