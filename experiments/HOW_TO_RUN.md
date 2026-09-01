# How to run the experiments

You **must** run every step in this document yourself before the defence. Every gas number, every Slither result, and every chart in your thesis was produced by code in this folder. The panel will assume you have personally produced these numbers; if you have not, you will not be able to answer follow-up questions about them. There is no acceptable substitute for direct experience.

Reproducing every measurement takes about five minutes on commodity hardware. The pre-defence cost of *not* doing it is a failed defence.

## Prerequisites

- **Node.js 18+** — check with `node --version`
- **Python 3.10+** — for Slither

## Step A — Run the benchmarks

```bash
cd experiments
npm install                 # one-time, ~30 sec
npm run compile             # compiles all five contracts
npm test                    # runs Hardhat correctness tests (5 groups, all should pass)
npm run benchmark           # original A vs B benchmark
npm run benchmark:extended  # A, B, C, revocation variants
npm run benchmark:offchain  # SHA-256 + Merkle tree timing
npm run cost:sensitivity    # EUR cost matrix at 9 market scenarios
```

Expected lines from `npm run benchmark:extended`:

```
[A] n=1000 total=47955536 avg=47955 verify=24015
[B] n=1000 register=48385 verify=37160 proofDepth=10
[C] n=500 register=12303268 ...
[C] n=1000 OUT_OF_GAS at 30M block gas limit
[D1] register=47979 revoke=50112 verify=26301
[E]  n=1000 register=48385 revoke=50134 verify=37220
```

## Step A2 — New experiments (June 14): real certificates & canonical hashing

These two experiments answer the "your dataset is synthetic / would your design
survive real files?" line of attack (see `../reviews/adversarial_review_14_06.md`, the
dataset and file-brittleness items). They require `pdf-lib`, installed by `npm install`.

```bash
npm run benchmark:canonical   # raw-file hash brittleness vs canonical-hash stability
npm run dataset               # generate 1000 REAL certificate PDFs + hash manifest
npm run benchmark:realistic   # register those real hashes on Arch A/B, compare to synthetic
```

What they prove:

1. **`benchmark:canonical`** renders the *same* certificate as four real PDFs
   (LibreOffice / Word / Chrome / re-save). All four raw-byte SHA-256 hashes
   **differ** (so hashing raw files would flag authentic docs as tampered), while the
   **canonical** hash (over normalized logical fields) is invariant across all
   renderings, key-order and whitespace noise — yet still changes when a real field
   is tampered. Also shows a **salted commitment** makes a low-entropy hash unlinkable
   while staying 32 bytes. Expected last line: `VERDICT: ALL CHECKS PASS`.

2. **`dataset`** generates 1000 real, varied certificate PDFs into `dataset/`
   (git-ignored) and writes `results/realistic_dataset_manifest.*`. All 1000 raw and
   all 1000 canonical hashes are distinct.

3. **`benchmark:realistic`** registers the real canonical hashes on Architecture A and
   B and compares gas to synthetic leaves at every batch size. Expected:

   ```
   [n=1000]  A real/syn=47955668/47955284 ≈ (Δ+384g)  |  B real/syn=48385/48385 IDENTICAL
   VERDICT: real and synthetic gas agree to within 0.05%
     largest real-vs-synthetic difference (Arch A): 0.0025%  (EIP-2028 calldata zero-byte pricing)
   ```

   The defence point: the dominant per-certificate cost (base tx + cold `SLOAD` +
   `SSTORE` + `LOG`) is **content-independent**; only the EIP-2028 calldata term
   (16 gas/non-zero byte, 4/zero byte of the 32-byte hash) varies, by ~0.001%. This is
   *why* synthetic data was a valid proxy — and you can now prove it empirically.

## Step A3 — Council-review solutions (June 14): Merkle hardening & non-blockchain baseline

These answer the two fatal items in `../reviews/adversarial_review_14_06.md` (A1 and B1).
Full write-ups and paste-ready prose are in `../solutions_14_06.md`.

```bash
npm run test:security      # Merkle second-preimage: forgery accepted by original, rejected by hardened
npm run benchmark:baseline # blockchain vs signed-DB vs Certificate-Transparency log
```

1. **`test:security`** builds a Merkle batch and shows the original
   `BatchCertificateRegistry` accepts an *internal node* as a forged certificate, while
   `SecureBatchCertificateRegistry` (0x00-leaf / 0x01-node domain separation) rejects the
   same forgery, still accepts legitimate proofs, and adds only **46 gas** to a
   verification. Expected: `3 passing`, with a line like
   `verify gas: original=26980  hardened=27026  overhead=46`.

2. **`benchmark:baseline`** compares per-certificate cost and trust model across a
   centralized signed-hash DB (Ed25519), a Certificate-Transparency-style Merkle log
   (RFC 6962), and Architectures A and B. Expected verdict: the baselines cost ~EUR 0/cert;
   the blockchain's only added property is removing the trusted operator (EUR 2.40/cert
   for A, EUR 0.0024/cert for B). Writes `results/baseline_comparison.*`.

## Step B — Find the measurements

After Step A, the following files exist or are overwritten in `experiments/results/`:

| File | Contents | Used in Chapter 5 |
|---|---|---|
| `gas_results.csv` / `.json` | Original A vs B at six batch sizes | §5.3, §5.4 (basis for Tables 5.2–5.5) |
| `extended_gas_results.csv` / `.json` | A, B, C, revocation variants | §5.9, §5.10 (basis for Tables 5.8, 5.9) |
| `offchain_results.csv` / `.json` | Hash, tree, proof timing up to n=10,000 | §5.11 (basis for Table 5.10) |
| `cost_sensitivity.csv` / `.json` | EUR cost across 3 gas prices × 3 ETH prices | §5.12 (basis for Table 5.11) |
| `canonicalization_results.csv` / `.json` | Raw vs canonical hashing, tamper + salt checks | NEW — proposed §5 subsection / §4.3 |
| `realistic_dataset_manifest.csv` / `.json` | 1000 real certificate PDFs + their raw & canonical hashes | NEW — evidence a real dataset was hashed |
| `realistic_gas_results.csv` / `.json` | Real-vs-synthetic gas per batch size | NEW — proves gas is content-independent |
| `baseline_comparison.csv` / `.json` | Blockchain vs signed-DB vs CT-log cost & trust | NEW — §5.18 (basis for Table 5.14, `fig_baseline_cost.png`) |

CSV columns and their meanings are documented at the top of each file.

## Step C — Run Slither (security analysis)

```bash
pip3 install --user slither-analyzer
solc-select install 0.8.24 && solc-select use 0.8.24

# If 'slither' is not on PATH, point at it directly:
export PATH="$HOME/Library/Python/3.10/bin:$PATH"
# or, on Linux:
# export PATH="$HOME/.local/bin:$PATH"

# Run on all five contracts
for c in CertificateRegistry BatchCertificateRegistry BulkCertificateRegistry \
         RevocableCertificateRegistry RevocableBatchCertificateRegistry; do
  slither "contracts/$c.sol" --solc-args "--optimize --optimize-runs 200"
done
```

Expected for each contract:

```
INFO:Slither:contracts/<name>.sol analyzed (1 contracts with 101 detectors), 0 result(s) found
```

For the human-summary printer that reproduces the §5.7 table:

```bash
slither contracts/CertificateRegistry.sol \
  --print human-summary --solc-args "--optimize --optimize-runs 200"
```

## Step D — Live demo

```bash
npx hardhat run scripts/demo.js
```

Runs through Architecture A registration + verification + tamper detection + access control, then a Merkle batch (N=10) registration + proof verification + forgery detection, then a numerical summary. Takes about 5 seconds. Use this if a panel member asks for a live demonstration.

## Step E — Regenerate the Chapter 5 charts (Fig. 5.1 and Fig. 5.2)

```bash
cd ../diagrams
pip3 install --user matplotlib   # one-time
python3 generate_charts.py
```

Reads `experiments/results/extended_gas_results.csv` and writes `fig_gas_growth.png` and `fig_verification_gas.png` next to the script.

## Files in this folder

```
experiments/
├── contracts/
│   ├── CertificateRegistry.sol            (Architecture A — single hash)
│   ├── BatchCertificateRegistry.sol       (Architecture B — Merkle batch)
│   ├── BulkCertificateRegistry.sol        (Architecture C — bulk array, NEW May 26)
│   ├── RevocableCertificateRegistry.sol   (A with revocation, NEW May 26)
│   ├── RevocableBatchCertificateRegistry.sol (B with revocation, NEW May 26)
│   └── SecureBatchCertificateRegistry.sol (B hardened, domain separation — NEW Jun 14)
├── scripts/
│   ├── benchmark.js                  (original A vs B)
│   ├── extended_benchmark.js         (A, B, C, revocation)
│   ├── offchain_benchmark.js         (SHA-256 + Merkle timing)
│   ├── cost_sensitivity.js           (EUR cost matrix)
│   ├── demo.js                       (defence live demo)
│   ├── merkle.js                     (off-chain helper)
│   ├── canonicalize.js               (canonical/salted hashing — NEW Jun 14)
│   ├── certpdf.js                    (real certificate PDF rendering — NEW Jun 14)
│   ├── canonicalization_benchmark.js (raw vs canonical brittleness — NEW Jun 14)
│   ├── generate_dataset.js           (1000 real certificate PDFs — NEW Jun 14)
│   ├── realistic_benchmark.js        (real-vs-synthetic gas — NEW Jun 14)
│   ├── merkle_ds.js                  (domain-separated off-chain tree — NEW Jun 14)
│   └── baseline_comparison.js        (blockchain vs non-blockchain — NEW Jun 14)
├── dataset/                          (generated real PDFs — git-ignored, NEW Jun 14)
├── test/
│   ├── registry.test.js          (Hardhat correctness/threat tests)
│   └── merkle_security.test.js   (second-preimage attack + fix — NEW Jun 14)
├── results/                      (overwritten on every benchmark run)
├── hardhat.config.js
└── package.json
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` is slow or fails | Make sure Node.js is 18+. Try `npm install --no-audit --no-fund` |
| `npx hardhat compile` complains about Solidity version | The config pins 0.8.24. Hardhat will download it the first time — give it a minute |
| `slither: command not found` | Run `export PATH="$HOME/Library/Python/3.10/bin:$PATH"` (macOS) or `$HOME/.local/bin` (Linux), or use `python3 -m slither` |
| Slither says it can't find solc | Make sure `solc-select use 0.8.24` ran successfully. Check with `solc --version` |
| Numbers slightly differ from the report (≤ 0.1 %) | Solidity/EVM patch versions occasionally change gas by 1–2 units. The thesis claim is about *order of magnitude* and *scaling behaviour*; both are robust to this |
| `npm test` fails with module-not-found | Make sure you ran `npm install` from the `experiments/` directory, not from the repo root |
