// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Revocation extension for individual certificate hashes.
/// This models a real-world requirement where issued credentials may later
/// need to be invalidated because of administrative error or fraud.
contract RevocableCertificateRegistry {
    mapping(address => bool) public issuers;
    mapping(bytes32 => bool) public registeredCertificates;
    mapping(bytes32 => bool) public revokedCertificates;
    address public immutable admin;

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);
    event CertificateRegistered(bytes32 indexed hash, address indexed issuer);
    event CertificateRevoked(bytes32 indexed hash, address indexed issuer);

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

    function registerCertificate(bytes32 hash) external onlyIssuer {
        if (registeredCertificates[hash]) revert AlreadyRegistered();
        registeredCertificates[hash] = true;
        emit CertificateRegistered(hash, msg.sender);
    }

    function revokeCertificate(bytes32 hash) external onlyIssuer {
        if (!registeredCertificates[hash]) revert NotRegistered();
        if (revokedCertificates[hash]) revert AlreadyRevoked();
        revokedCertificates[hash] = true;
        emit CertificateRevoked(hash, msg.sender);
    }

    function verifyCertificate(bytes32 hash) external view returns (bool) {
        return registeredCertificates[hash] && !revokedCertificates[hash];
    }
}
