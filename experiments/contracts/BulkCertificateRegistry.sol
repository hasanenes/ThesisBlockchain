// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Architecture C: register many certificate hashes in one transaction.
/// This reduces transaction overhead but still stores every hash on-chain.
contract BulkCertificateRegistry {
    mapping(address => bool) public issuers;
    mapping(bytes32 => bool) public registeredCertificates;
    address public immutable admin;

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);
    event CertificateRegistered(bytes32 indexed hash, address indexed issuer);
    event CertificateBatchRegistered(address indexed issuer, uint256 count);

    error NotAdmin();
    error NotIssuer();
    error AlreadyRegistered();
    error EmptyBatch();

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

    function registerCertificateBatch(bytes32[] calldata hashes) external onlyIssuer {
        if (hashes.length == 0) revert EmptyBatch();
        for (uint256 i = 0; i < hashes.length; ++i) {
            bytes32 hash = hashes[i];
            if (registeredCertificates[hash]) revert AlreadyRegistered();
            registeredCertificates[hash] = true;
            emit CertificateRegistered(hash, msg.sender);
        }
        emit CertificateBatchRegistered(msg.sender, hashes.length);
    }

    function verifyCertificate(bytes32 hash) external view returns (bool) {
        return registeredCertificates[hash];
    }
}
