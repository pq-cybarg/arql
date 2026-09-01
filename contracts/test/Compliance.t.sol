// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {BridgeTest} from "./Bridge.t.sol";
import {Bytes} from "../arc/lib/Bytes.sol";

/// Sanctions gates must not break 1:1: a rejected mint leaves USDC in the
/// TokenMinter, and the registry cannot drain that pool.
contract ComplianceTest is BridgeTest {
    address carol = address(0xCA201);

    function _complianceSig(bytes32 payload) internal view returns (bytes memory) {
        return _pk(slhCompliance, compliance.complianceDigest(payload));
    }

    function testRoundTripWithComplianceAttached() public {
        testArcToQrlLockAndMint();
    }

    function testSanctionedDepositorCannotLock() public {
        compliance.sanction(alice, _complianceSig(compliance.sanctionPayload(alice)));
        vm.prank(alice);
        bytes memory to = Bytes.fromAddress20(bob);
        bytes32 action = _userAction(arcMsgr, alice, 1_000_000, QRL_DOMAIN, to, address(arcUsdc));
        vm.expectRevert(bytes("sanctioned"));
        arcMsgr.depositForBurn(
            1_000_000, QRL_DOMAIN, to, address(arcUsdc), new bytes(64), 0, FINALIZED, slhUser, _pk(slhUser, action)
        );
        assertEq(arcUsdc.balanceOf(alice), 1_000_000_000);
        assertEq(arcUsdc.balanceOf(address(arcMinter)), 0);
    }

    function testSanctionedRecipientCannotBeMintedTo() public {
        bytes memory bob64 = Bytes.fromAddress20(bob);
        compliance.sanction(bob, _complianceSig(compliance.sanctionPayload(bob)));
        vm.prank(alice);
        bytes32 action = _userAction(arcMsgr, alice, 1_000_000, QRL_DOMAIN, bob64, address(arcUsdc));
        vm.expectRevert(bytes("sanctioned"));
        arcMsgr.depositForBurn(
            1_000_000, QRL_DOMAIN, bob64, address(arcUsdc), new bytes(64), 0, FINALIZED, slhUser, _pk(slhUser, action)
        );
        assertEq(arcUsdc.balanceOf(address(arcMinter)), 0);
    }

    function testMintRejectedAfterLockConservesArcUsdc() public {
        vm.recordLogs();
        _deposit(arcMsgr, alice, 2_000_000, QRL_DOMAIN, bob, address(arcUsdc));
        assertEq(arcUsdc.balanceOf(address(arcMinter)), 2_000_000);
        compliance.sanction(bob, _complianceSig(compliance.sanctionPayload(bob)));
        bytes memory message = _lastMessageSent();
        vm.prank(attester);
        qrlTx.receiveMessage(message);
        vm.prank(attester2);
        vm.expectRevert(bytes("sanctioned"));
        qrlTx.receiveMessage(message);
        assertEq(qrlUsdc.balanceOf(bob), 0);
        assertEq(arcUsdc.balanceOf(address(arcMinter)), 2_000_000);
        assertEq(arcUsdc.balanceOf(alice), 1_000_000_000 - 2_000_000);
    }

    function testEcdsaCannotSanction() public {
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        compliance.sanction(bob, new bytes(65));
    }

    function testComplianceCannotUnsanction() public {
        compliance.sanction(bob, _complianceSig(compliance.sanctionPayload(bob)));
        bytes memory sig = _complianceSig(compliance.unsanctionPayload(bob));
        vm.expectRevert();
        this.externalUnsanction(bob, sig, sig);
        assertTrue(compliance.sanctioned(bob));
        _council(compliance, compliance.unsanctionPayload(bob));
        compliance.unsanction(bob, _lastOwner, _lastGuard);
        assertFalse(compliance.sanctioned(bob));
    }

    function externalUnsanction(address account, bytes calldata a, bytes calldata b) external {
        compliance.unsanction(account, a, b);
    }

    function testFrozenRecipientBlockedOnUnlock() public {
        testArcToQrlLockAndMint();
        uint256 amount = 5_000_000;
        vm.prank(bob);
        qrlUsdc.approve(address(qrlMinter), amount);
        vm.recordLogs();
        _deposit(qrlMsgr, bob, amount, ARC_DOMAIN, alice, address(qrlUsdc));
        compliance.freeze(alice, _complianceSig(compliance.freezePayload(alice)));
        bytes memory message = _lastMessageSent();
        vm.expectRevert(bytes("sanctioned"));
        _arcReceive(message);
        assertEq(arcUsdc.balanceOf(address(arcMinter)), amount);
        assertEq(qrlUsdc.totalSupply(), 0);
    }

    function testWireSanctionBlocksPaddedRecipient() public {
        bytes memory carol64 = Bytes.fromAddress20(carol);
        compliance.sanctionWire(carol64, _complianceSig(compliance.sanctionWirePayload(keccak256(carol64))));
        vm.prank(alice);
        bytes32 action = _userAction(arcMsgr, alice, 1_000_000, QRL_DOMAIN, carol64, address(arcUsdc));
        vm.expectRevert(bytes("sanctioned"));
        arcMsgr.depositForBurn(
            1_000_000, QRL_DOMAIN, carol64, address(arcUsdc), new bytes(64), 0, FINALIZED, slhUser, _pk(slhUser, action)
        );
    }
}
