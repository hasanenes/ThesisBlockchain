// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Architecture B: store one Merkle root per issuance batch.
/// Verification is done by submitting the certificate hash + Merkle proof.
contract BatchCertificateRegistry {
    mapping(address => bool) public issuers;
    mapping(bytes32 => bool) public registeredRoots;
    address public immutable admin;

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);
    event RootRegistered(bytes32 indexed root, address indexed issuer, uint256 batchSize);

    error NotAdmin();
    error NotIssuer();
    error AlreadyRegistered();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyIssuer() {
        if (!issuers[msg.sender]) revert NotIssuer();
        _;
    }

    constructor() {
        admin = msg.sender;
        issuers[msg.sender] = true;
        emit IssuerAdded(msg.sender);
    }

    function addIssuer(address account) external onlyAdmin {
        issuers[account] = true;
        emit IssuerAdded(account);
    }

    function removeIssuer(address account) external onlyAdmin {
        issuers[account] = false;
        emit IssuerRemoved(account);
    }

    function registerRoot(bytes32 root, uint256 batchSize) external onlyIssuer {
        if (registeredRoots[root]) revert AlreadyRegistered();
        registeredRoots[root] = true;
        emit RootRegistered(root, msg.sender, batchSize);
    }

    /// Standard Merkle proof verification: pair-and-keccak with sorted concatenation.
    function verifyProof(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata proof
    ) public pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; ++i) {
            bytes32 sibling = proof[i];
            if (computed < sibling) {
                computed = keccak256(abi.encodePacked(computed, sibling));
            } else {
                computed = keccak256(abi.encodePacked(sibling, computed));
            }
        }
        return computed == root;
    }

    function verifyCertificate(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        if (!registeredRoots[root]) return false;
        return verifyProof(root, leaf, proof);
    }
}
