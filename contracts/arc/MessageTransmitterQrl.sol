// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Pausable} from "./lib/Pausable.sol";
import {Bytes} from "./lib/Bytes.sol";
import {MessageV2} from "./lib/MessageV2.sol";
import {IMessageHandler} from "./interfaces/IMessageHandler.sol";

/// QRVM MessageTransmitter twin. QRVM transactions are ML-DSA-87 signed, so the
/// attester is msg.sender (the Dilithium key that submitted receiveMessage).
/// There is no ecrecover on this path — ECDSA attestation is quantum-broken and
/// Arc-only. See contracts/qrl/MessageTransmitter.hyp for the Hyperion source.
contract MessageTransmitterQrl is Pausable {
    uint32 public immutable localDomain;
    uint32 public immutable version;
    uint256 public nextNonce;
    mapping(address => bool) public attesters;
    mapping(bytes32 => bool) public usedNonces;
    mapping(bytes32 => mapping(address => bool)) public voted;
    mapping(bytes32 => uint256) public votes;
    uint256 public attestationThreshold;

    event PartialAttestation(address indexed attester, bytes32 indexed messageId, uint256 count);

    event AttesterEnabled(address indexed attester);
    event AttesterDisabled(address indexed attester);
    event MessageSent(bytes message);
    event MessageReceived(
        address indexed caller,
        uint32 sourceDomain,
        bytes32 indexed nonce,
        bytes sender,
        bytes messageBody
    );

    constructor(uint32 localDomain_) {
        require(block.chainid != 5042002, "not-arc");
        localDomain = localDomain_;
        version = MessageV2.VERSION;
        attestationThreshold = 2;
        attesters[msg.sender] = true;
        emit AttesterEnabled(msg.sender);
    }

    function enableAttester(address attester) external onlyOwner {
        require(attester != address(0), "zero");
        attesters[attester] = true;
        emit AttesterEnabled(attester);
    }

    function disableAttester(address attester) external onlyOwner {
        attesters[attester] = false;
        emit AttesterDisabled(attester);
    }

    function sendMessage(
        uint32 destinationDomain,
        bytes calldata recipient,
        bytes calldata destinationCaller,
        uint32 minFinalityThreshold,
        bytes calldata messageBody
    ) external whenNotPaused returns (bytes32 nonce) {
        require(destinationDomain != localDomain, "same-domain");
        require(recipient.length == 64 && destinationCaller.length == 64, "addr64");
        nextNonce += 1;
        nonce = keccak256(abi.encodePacked(localDomain, destinationDomain, nextNonce, block.number, msg.sender));
        uint32 executed = minFinalityThreshold >= 2000 ? 2000 : 1000;
        bytes memory message = MessageV2.encodeHeader(
            localDomain,
            destinationDomain,
            nonce,
            Bytes.fromAddress20(msg.sender),
            recipient,
            destinationCaller,
            minFinalityThreshold,
            executed,
            messageBody
        );
        emit MessageSent(message);
    }

    function setAttestationThreshold(uint256 n) external onlyOwner {
        require(n >= 2, "threshold");
        attestationThreshold = n;
    }

    function receiveMessage(bytes calldata message) external whenNotPaused returns (bool) {
        require(attesters[msg.sender], "attester");
        bytes32 id = keccak256(message);
        require(!voted[id][msg.sender], "voted");
        voted[id][msg.sender] = true;
        votes[id] += 1;
        if (votes[id] < attestationThreshold) {
            emit PartialAttestation(msg.sender, id, votes[id]);
            return false;
        }
        MessageV2.validateHeader(message);
        require(MessageV2.destinationDomain(message) == localDomain, "dest");
        bytes memory caller64 = MessageV2.destinationCaller(message);
        if (!Bytes.isZero64(caller64)) {
            require(Bytes.toAddress20(caller64) == msg.sender, "caller");
        }
        bytes32 n = MessageV2.nonce(message);
        require(!usedNonces[n], "nonce");
        usedNonces[n] = true;
        bytes memory body = MessageV2.body(message);
        address recipient20 = Bytes.toAddress20(MessageV2.recipient(message));
        uint32 src = MessageV2.sourceDomain(message);
        bytes memory sender = MessageV2.sender(message);
        uint32 fin = MessageV2.finalityExecuted(message);
        bool ok = IMessageHandler(recipient20).handleReceiveFinalizedMessage(src, sender, fin, body);
        require(ok, "handler");
        emit MessageReceived(msg.sender, src, n, sender, body);
        return true;
    }
}
