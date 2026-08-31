// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {PQPausable} from "./PQPausable.sol";

/// Pins live `extcodehash` values and the peer chain's code seal.
/// Rotations require owner + guardian SLH-DSA. ECDSA cannot pin or seal.
contract PQCodeAnchor is PQPausable {
    mapping(address => bytes32) public pinnedCodehash;
    bytes32 public expectedPeerSeal;

    event CodehashPinned(address indexed target, bytes32 codehash);
    event PeerSealSet(bytes32 seal);

    constructor(bytes memory owner, bytes memory guardian, bytes memory pauser)
        PQPausable(owner, guardian, pauser)
    {}

    function pinCodehashPayload(address target, bytes32 codehash) public pure returns (bytes32) {
        return keccak256(abi.encode("pinCodehash", target, codehash));
    }

    function setPeerSealPayload(bytes32 seal) public pure returns (bytes32) {
        return keccak256(abi.encode("setPeerSeal", seal));
    }

    function freezeLocalPayload() public pure returns (bytes32) {
        return keccak256("freezeLocal");
    }

    function pinCodehash(address target, bytes32 codehash, bytes calldata ownerSig, bytes calldata guardianSig)
        external
    {
        require(target != address(0), "zero");
        require(codehash != bytes32(0), "hash");
        _consumeCouncil(pinCodehashPayload(target, codehash), ownerSig, guardianSig);
        pinnedCodehash[target] = codehash;
        emit CodehashPinned(target, codehash);
    }

    function setPeerSeal(bytes32 seal, bytes calldata ownerSig, bytes calldata guardianSig) external {
        require(seal != bytes32(0), "seal");
        _consumeCouncil(setPeerSealPayload(seal), ownerSig, guardianSig);
        expectedPeerSeal = seal;
        emit PeerSealSet(seal);
    }

    function requirePinned(address target) public view {
        bytes32 expected = pinnedCodehash[target];
        require(expected != bytes32(0), "unpinned");
        require(target.codehash == expected, "codehash");
    }

    function requirePeerSeal(bytes32 seal) public view {
        require(expectedPeerSeal != bytes32(0), "peer-unpinned");
        require(seal == expectedPeerSeal, "peer-seal");
    }

    function _pin(address target) internal {
        bytes32 h = target.codehash;
        require(h != bytes32(0), "hash");
        pinnedCodehash[target] = h;
        emit CodehashPinned(target, h);
    }
}
