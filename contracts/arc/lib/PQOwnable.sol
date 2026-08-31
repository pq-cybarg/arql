// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {ArcPQ} from "./ArcPQ.sol";

/// Dual SLH-DSA control: owner + guardian must both sign high-impact changes.
/// A third pauser key can halt, but cannot unpause or re-key alone.
/// No secp256k1 address is an authority.
contract PQOwnable {
    bytes public ownerPk;
    bytes public guardianPk;
    bytes public pauserPk;
    uint256 public ownerNonce;
    uint256 public pauserNonce;

    event OwnershipTransferred(bytes32 indexed previousPkId, bytes32 indexed newPkId);
    event GuardianRotated(bytes32 indexed previousPkId, bytes32 indexed newPkId);
    event PauserRotated(bytes32 indexed previousPkId, bytes32 indexed newPkId);

    constructor(bytes memory owner, bytes memory guardian, bytes memory pauser) {
        _writeOwner(owner);
        _writeGuardian(guardian);
        _writePauser(pauser);
        _requireDistinct();
    }

    function ownerPkId() public view returns (bytes32) {
        return ArcPQ.pkId(ownerPk);
    }

    function ownerDigest(bytes32 payload) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), ownerNonce, block.chainid, payload));
    }

    function pauserDigest(bytes32 payload) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), pauserNonce, block.chainid, payload));
    }

    function transferOwnershipPayload(bytes calldata newOwnerPk) public pure returns (bytes32) {
        return keccak256(abi.encode("transferOwnership", keccak256(newOwnerPk)));
    }

    function transferGuardianPayload(bytes calldata newGuardianPk) public pure returns (bytes32) {
        return keccak256(abi.encode("transferGuardian", keccak256(newGuardianPk)));
    }

    function transferPauserPayload(bytes calldata newPauserPk) public pure returns (bytes32) {
        return keccak256(abi.encode("transferPauser", keccak256(newPauserPk)));
    }

    function transferOwnership(bytes calldata newOwnerPk, bytes calldata ownerSig, bytes calldata guardianSig)
        external
    {
        _requireSlh(newOwnerPk);
        _consumeCouncil(transferOwnershipPayload(newOwnerPk), ownerSig, guardianSig);
        _writeOwner(newOwnerPk);
        _requireDistinct();
    }

    function transferGuardian(bytes calldata newGuardianPk, bytes calldata ownerSig, bytes calldata guardianSig)
        external
    {
        _requireSlh(newGuardianPk);
        _consumeCouncil(transferGuardianPayload(newGuardianPk), ownerSig, guardianSig);
        _writeGuardian(newGuardianPk);
        _requireDistinct();
    }

    function transferPauser(bytes calldata newPauserPk, bytes calldata ownerSig, bytes calldata guardianSig)
        external
    {
        _requireSlh(newPauserPk);
        _consumeCouncil(transferPauserPayload(newPauserPk), ownerSig, guardianSig);
        _writePauser(newPauserPk);
        _requireDistinct();
    }

    function _consumeCouncil(bytes32 payload, bytes calldata ownerSig, bytes calldata guardianSig) internal {
        bytes32 digest = ownerDigest(payload);
        require(ArcPQ.verify(ownerPk, digest, ownerSig), "pq-owner");
        require(ArcPQ.verify(guardianPk, digest, guardianSig), "pq-guardian");
        ownerNonce += 1;
    }

    function _consumePauser(bytes32 payload, bytes calldata pauserSig) internal {
        require(ArcPQ.verify(pauserPk, pauserDigest(payload), pauserSig), "pq-pauser");
        pauserNonce += 1;
    }

    function _requireSlh(bytes memory slhPk) internal pure {
        require(slhPk.length == ArcPQ.PK_LEN, "slh-pk");
        ArcPQ.rejectClassicalKey(slhPk);
    }

    function _writeOwner(bytes memory slhPk) private {
        _requireSlh(slhPk);
        bytes32 prev = ownerPk.length == 0 ? bytes32(0) : ArcPQ.pkId(ownerPk);
        ownerPk = slhPk;
        emit OwnershipTransferred(prev, ArcPQ.pkId(slhPk));
    }

    function _writeGuardian(bytes memory slhPk) private {
        _requireSlh(slhPk);
        bytes32 prev = guardianPk.length == 0 ? bytes32(0) : ArcPQ.pkId(guardianPk);
        guardianPk = slhPk;
        emit GuardianRotated(prev, ArcPQ.pkId(slhPk));
    }

    function _writePauser(bytes memory slhPk) private {
        _requireSlh(slhPk);
        bytes32 prev = pauserPk.length == 0 ? bytes32(0) : ArcPQ.pkId(pauserPk);
        pauserPk = slhPk;
        emit PauserRotated(prev, ArcPQ.pkId(slhPk));
    }

    function _requireDistinct() private view {
        require(ArcPQ.pkId(ownerPk) != ArcPQ.pkId(guardianPk), "same-key");
        require(ArcPQ.pkId(ownerPk) != ArcPQ.pkId(pauserPk), "same-key");
        require(ArcPQ.pkId(guardianPk) != ArcPQ.pkId(pauserPk), "same-key");
    }
}
