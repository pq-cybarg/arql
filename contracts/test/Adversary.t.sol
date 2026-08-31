// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {BridgeTest} from "./Bridge.t.sol";
import {TokenMessenger} from "../arc/TokenMessenger.sol";
import {TokenMinter} from "../arc/TokenMinter.sol";
import {PQPausable} from "../arc/lib/PQPausable.sol";
import {Bytes} from "../arc/lib/Bytes.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// Adversarial cases: ECDSA must not govern the Arc bridge, and a corrupted
/// elliptic-curve consensus that swaps bytecode must not move value.
contract AdversaryTest is BridgeTest {
    function testEcdsaCannotPause() public {
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        arcMsgr.pause(new bytes(65));
    }

    function testEcdsaCannotSetTokenMessenger() public {
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        arcMinter.setTokenMessenger(alice, new bytes(65), new bytes(65));
    }

    function testEcdsaCannotSetPeerSeal() public {
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        arcMsgr.setPeerSeal(bytes32(uint256(1)), new bytes(65), new bytes(65));
    }

    function testEcdsaCannotPinCodehash() public {
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        arcMsgr.pinCodehash(address(arcMsgr), bytes32(uint256(1)), new bytes(65), new bytes(65));
    }

    function testEcdsaCannotTransferOwnership() public {
        vm.prank(alice);
        vm.expectRevert(bytes("slh-pk"));
        arcMsgr.transferOwnership(abi.encodePacked(alice), new bytes(65), new bytes(65));
    }

    function testEcdsaCannotEnableAttester() public {
        vm.prank(alice);
        vm.expectRevert(bytes("slh-pk"));
        arcTx.enableAttester(abi.encodePacked(uint160(alice)), new bytes(65), new bytes(65));
    }

    function testEcdsaCannotSetRemoteMessenger() public {
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        arcMsgr.setRemoteTokenMessenger(QRL_DOMAIN, Bytes.fromAddress20(alice), new bytes(65), new bytes(65));
    }

    function testEcdsaCannotLinkToken() public {
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        arcMinter.linkToken(
            address(arcUsdc),
            QRL_DOMAIN,
            Bytes.fromAddress20(address(qrlUsdc)),
            TokenMinter.TokenMode.LockUnlock,
            new bytes(65),
            new bytes(65)
        );
    }

    function testEcdsaCannotBlacklist() public {
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        qrlUsdc.blacklist(bob, new bytes(65), new bytes(65));
    }

    function testOwnerAloneCannotSetPeerSeal() public {
        bytes32 d = arcMsgr.ownerDigest(arcMsgr.setPeerSealPayload(bytes32(uint256(0x51))));
        bytes memory ownerSig = _pk(slhOwner, d);
        bytes memory wrongGuard = _pk(slhOwner, d);
        vm.expectRevert(bytes("pq-guardian"));
        arcMsgr.setPeerSeal(bytes32(uint256(0x51)), ownerSig, wrongGuard);
    }

    function testWrongSlhPauserCannotPause() public {
        bytes32 digest = PQPausable(address(arcMsgr)).pauserDigest(arcMsgr.pausePayload());
        vm.expectRevert(bytes("pq-pauser"));
        arcMsgr.pause(_pk(slhOwner, digest));
    }

    function testPauserSigReplayRejected() public {
        bytes32 digest = PQPausable(address(arcMsgr)).pauserDigest(arcMsgr.pausePayload());
        bytes memory sig = _pk(slhPauser, digest);
        arcMsgr.pause(sig);
        _council(arcMsgr, arcMsgr.unpausePayload());
        arcMsgr.unpause(_lastOwner, _lastGuard);
        vm.expectRevert(bytes("pq-pauser"));
        arcMsgr.pause(sig);
    }

    function testEtchedTransmitterCannotDeposit() public {
        vm.etch(address(arcTx), hex"00");
        vm.prank(alice);
        bytes memory to = Bytes.fromAddress20(bob);
        bytes32 action = _userAction(arcMsgr, alice, 1_000_000, QRL_DOMAIN, to, address(arcUsdc));
        vm.expectRevert(bytes("codehash"));
        arcMsgr.depositForBurn(
            1_000_000, QRL_DOMAIN, to, address(arcUsdc), new bytes(64), 0, FINALIZED, slhUser, _pk(slhUser, action)
        );
    }

    function testEtchedMessengerCannotUnlock() public {
        testArcToQrlLockAndMint();
        uint256 amount = 5_000_000;
        vm.prank(bob);
        qrlUsdc.approve(address(qrlMinter), amount);
        vm.recordLogs();
        _deposit(qrlMsgr, bob, amount, ARC_DOMAIN, alice, address(qrlUsdc));
        bytes memory message = _lastMessageSent();
        vm.etch(address(arcMinter), type(MockUSDC).runtimeCode);
        vm.expectRevert(bytes("codehash"));
        _arcReceive(message);
    }

    function testWrongPeerSealRejectedOnArc() public {
        testArcToQrlLockAndMint();
        uint256 amount = 5_000_000;
        vm.prank(bob);
        qrlUsdc.approve(address(qrlMinter), amount);
        vm.recordLogs();
        _deposit(qrlMsgr, bob, amount, ARC_DOMAIN, alice, address(qrlUsdc));
        bytes memory message = _lastMessageSent();
        _council(arcMsgr, arcMsgr.setPeerSealPayload(bytes32(uint256(0xDEAD))));
        arcMsgr.setPeerSeal(bytes32(uint256(0xDEAD)), _lastOwner, _lastGuard);
        vm.expectRevert(bytes("peer-seal"));
        _arcReceive(message);
        assertEq(arcUsdc.balanceOf(address(arcMinter)), amount);
    }

    function testWrongPeerSealRejectedOnQrl() public {
        vm.recordLogs();
        _deposit(arcMsgr, alice, 1_000_000, QRL_DOMAIN, bob, address(arcUsdc));
        bytes memory message = _lastMessageSent();
        _council(qrlMsgr, qrlMsgr.setPeerSealPayload(bytes32(uint256(0xBEEF))));
        qrlMsgr.setPeerSeal(bytes32(uint256(0xBEEF)), _lastOwner, _lastGuard);
        vm.prank(attester);
        qrlTx.receiveMessage(message);
        vm.prank(attester2);
        vm.expectRevert(bytes("peer-seal"));
        qrlTx.receiveMessage(message);
        assertEq(qrlUsdc.balanceOf(bob), 0);
    }

    function testEcKeyCannotBecomeOwner() public {
        vm.expectRevert(bytes("slh-pk"));
        arcMsgr.transferOwnership(abi.encodePacked(bytes20(alice)), _pk(slhOwner, bytes32(0)), _pk(slhGuardian, bytes32(0)));
    }

    function testCloneMessengerHasDistinctSeal() public {
        TokenMessenger clone =
            new TokenMessenger(ARC_DOMAIN, arcTx, arcMinter, slhOwner, slhGuardian, slhPauser);
        assertTrue(clone.localSeal() != arcMsgr.localSeal());
    }

    function testPqCouncilCanRotatePeerSealThenResume() public {
        bytes32 newSeal = bytes32(uint256(0x51));
        _council(arcMsgr, arcMsgr.setPeerSealPayload(newSeal));
        arcMsgr.setPeerSeal(newSeal, _lastOwner, _lastGuard);
        assertEq(arcMsgr.expectedPeerSeal(), newSeal);
        _council(arcMsgr, arcMsgr.setPeerSealPayload(qrlMsgr.localSeal()));
        arcMsgr.setPeerSeal(qrlMsgr.localSeal(), _lastOwner, _lastGuard);
        testArcToQrlLockAndMint();
    }
}
