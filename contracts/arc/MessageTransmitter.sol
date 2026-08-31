// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {PQCodeAnchor} from "./lib/PQCodeAnchor.sol";
import {Bytes} from "./lib/Bytes.sol";
import {MessageV2} from "./lib/MessageV2.sol";
import {ArcPQ} from "./lib/ArcPQ.sol";
import {IMessageHandler} from "./interfaces/IMessageHandler.sol";

/// CCTP-shaped MessageTransmitter for Arc.
/// Attestation is Arc SLH-DSA-SHA2-128s via the protocol precompile.
/// secp256k1 / ecrecover is not used: a broken ECDSA key must not mint,
/// unlock, pause, or re-key toward QRL.
contract MessageTransmitter is PQCodeAnchor {
    using Bytes for bytes;

    uint32 public immutable localDomain;
    uint32 public immutable version;
    uint256 public nextNonce;
    mapping(bytes32 => bool) public attesters;
    mapping(bytes32 => bool) public usedNonces;
    uint256 public immutable attestationThreshold;

    event AttesterEnabled(bytes32 indexed pkId);
    event AttesterDisabled(bytes32 indexed pkId);
    event MessageSent(bytes message);
    event MessageReceived(
        address indexed caller,
        uint32 sourceDomain,
        bytes32 indexed nonce,
        bytes sender,
        bytes messageBody
    );

    constructor(
        uint32 localDomain_,
        bytes memory owner,
        bytes memory guardian,
        bytes memory pauser,
        bytes memory attesterA,
        bytes memory attesterB
    ) PQCodeAnchor(owner, guardian, pauser) {
        require(ArcPQ.pkId(attesterA) != ArcPQ.pkId(attesterB), "same-attester");
        localDomain = localDomain_;
        version = MessageV2.VERSION;
        attestationThreshold = 2;
        _enableAttester(attesterA);
        _enableAttester(attesterB);
    }

    function enableAttesterPayload(bytes calldata publicKey) public pure returns (bytes32) {
        return keccak256(abi.encode("enableAttester", keccak256(publicKey)));
    }

    function disableAttesterPayload(bytes calldata publicKey) public pure returns (bytes32) {
        return keccak256(abi.encode("disableAttester", keccak256(publicKey)));
    }

    /// `publicKey` must be SLH-DSA-SHA2-128s (32 bytes). EC keys revert before
    /// the owner nonce is consumed.
    function enableAttester(bytes calldata publicKey, bytes calldata ownerSig, bytes calldata guardianSig)
        external
    {
        require(publicKey.length == ArcPQ.PK_LEN, "slh-pk");
        ArcPQ.rejectClassicalKey(publicKey);
        _consumeCouncil(enableAttesterPayload(publicKey), ownerSig, guardianSig);
        _enableAttester(publicKey);
    }

    function disableAttester(bytes calldata publicKey, bytes calldata ownerSig, bytes calldata guardianSig)
        external
    {
        require(publicKey.length == ArcPQ.PK_LEN, "slh-pk");
        _consumeCouncil(disableAttesterPayload(publicKey), ownerSig, guardianSig);
        bytes32 id = ArcPQ.pkId(publicKey);
        attesters[id] = false;
        emit AttesterDisabled(id);
    }

    function freezeLocal(bytes calldata ownerSig, bytes calldata guardianSig) external {
        _consumeCouncil(freezeLocalPayload(), ownerSig, guardianSig);
        _pin(address(this));
    }

    function sendMessage(
        uint32 destinationDomain,
        bytes calldata recipient,
        bytes calldata destinationCaller,
        uint32 minFinalityThreshold,
        bytes calldata messageBody
    ) external whenNotPaused returns (bytes32 nonce) {
        requirePinned(address(this));
        require(destinationDomain != localDomain, "same-domain");
        require(recipient.length == 64, "recipient");
        require(destinationCaller.length == 64, "caller");
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

    /// At least `attestationThreshold` distinct SLH-DSA attesters must sign.
    function receiveMessage(bytes calldata message, bytes[] calldata publicKeys, bytes[] calldata signatures)
        external
        whenNotPaused
        returns (bool)
    {
        requirePinned(address(this));
        _requireThreshold(message, publicKeys, signatures);
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

    function _enableAttester(bytes memory publicKey) private {
        require(publicKey.length == ArcPQ.PK_LEN, "slh-pk");
        ArcPQ.rejectClassicalKey(publicKey);
        bytes32 id = ArcPQ.pkId(publicKey);
        attesters[id] = true;
        emit AttesterEnabled(id);
    }

    function _requireThreshold(bytes calldata message, bytes[] calldata publicKeys, bytes[] calldata signatures)
        private
        view
    {
        require(publicKeys.length == signatures.length, "len");
        require(publicKeys.length >= attestationThreshold, "threshold");
        bytes32 digest = keccak256(message);
        for (uint256 i = 0; i < publicKeys.length; i++) {
            require(attesters[ArcPQ.pkId(publicKeys[i])], "attester");
            require(ArcPQ.verify(publicKeys[i], digest, signatures[i]), "pq-sig");
            for (uint256 j = 0; j < i; j++) {
                require(ArcPQ.pkId(publicKeys[i]) != ArcPQ.pkId(publicKeys[j]), "dup-attester");
            }
        }
    }
}
