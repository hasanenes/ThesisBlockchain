// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRegistryA {
    function verifyCertificate(bytes32 hash) external view returns (bool);
}

interface IRegistryB {
    function verifyCertificate(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool);
}

/// Consuming contract for Architecture A. Verification runs inside the
/// transaction, so it enters consensus and is paid for.
contract ScholarshipGateA {
    IRegistryA public immutable registry;
    mapping(bytes32 => bool) public claimed;

    error InvalidCertificate();
    error AlreadyClaimed();

    constructor(address registryAddress) {
        registry = IRegistryA(registryAddress);
    }

    function claim(bytes32 hash) external {
        if (claimed[hash]) revert AlreadyClaimed();
        if (!registry.verifyCertificate(hash)) revert InvalidCertificate();
        claimed[hash] = true;
    }

    // Identical minus the registry call; the difference isolates verification.
    function claimWithoutVerification(bytes32 hash) external {
        if (claimed[hash]) revert AlreadyClaimed();
        claimed[hash] = true;
    }
}

/// Consuming contract for Architecture B. Same structure, Merkle proof instead.
contract ScholarshipGateB {
    IRegistryB public immutable registry;
    mapping(bytes32 => bool) public claimed;

    error InvalidCertificate();
    error AlreadyClaimed();

    constructor(address registryAddress) {
        registry = IRegistryB(registryAddress);
    }

    function claim(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external {
        if (claimed[leaf]) revert AlreadyClaimed();
        if (!registry.verifyCertificate(root, leaf, proof)) revert InvalidCertificate();
        claimed[leaf] = true;
    }

    // Same signature so calldata cost matches; unused params left unnamed.
    function claimWithoutVerification(
        bytes32,
        bytes32 leaf,
        bytes32[] calldata
    ) external {
        if (claimed[leaf]) revert AlreadyClaimed();
        claimed[leaf] = true;
    }
}