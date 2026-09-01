// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Revocation extension for Merkle batches.
/// Revoking a root invalidates the whole batch. Per-certificate revocation
/// would require an additional nullifier/revocation list and is evaluated as
/// a design trade-off in the thesis discussion.
contract RevocableBatchCertificateRegistry {
    mapping(address => bool) public issuers;
    mapping(bytes32 => bool) public registeredRoots;
    mapping(bytes32 => bool) public revokedRoots;
    address public immutable admin;

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);
    event RootRegistered(bytes32 indexed root, address indexed issuer, uint256 batchSize);
    event RootRevoked(bytes32 indexed root, address indexed issuer);

    error NotAdmin();
    error NotIssuer();
    error AlreadyRegistered();
    error NotRegistered();
    error AlreadyRevoked();

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

    function revokeRoot(bytes32 root) external onlyIssuer {
        if (!registeredRoots[root]) revert NotRegistered();
        if (revokedRoots[root]) revert AlreadyRevoked();
        revokedRoots[root] = true;
        emit RootRevoked(root, msg.sender);
    }

    function verifyProof(
        bytes32 root,
        bytes32 certHash,
        bytes32[] calldata proof
    ) public pure returns (bool) {
        bytes32 computed = keccak256(abi.encodePacked(bytes1(0x00), certHash));
        for (uint256 i = 0; i < proof.length; ++i) {
            bytes32 sibling = proof[i];
            if (computed < sibling) {
                computed = keccak256(abi.encodePacked(bytes1(0x01), computed, sibling));
            } else {
                computed = keccak256(abi.encodePacked(bytes1(0x01), sibling, computed));
            }
        }
        return computed == root;
    }

    function verifyCertificate(
        bytes32 root,
        bytes32 certHash,
        bytes32[] calldata proof
    ) external view returns (bool) {
        if (!registeredRoots[root] || revokedRoots[root]) return false;
        return verifyProof(root, certHash, proof);
    }
}