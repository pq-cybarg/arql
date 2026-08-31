// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {Bytes} from "../arc/lib/Bytes.sol";
import {MessageV2} from "../arc/lib/MessageV2.sol";
import {PQOwnable} from "../arc/lib/PQOwnable.sol";
import {PQPausable} from "../arc/lib/PQPausable.sol";
import {MessageTransmitter} from "../arc/MessageTransmitter.sol";
import {MessageTransmitterQrl} from "../arc/MessageTransmitterQrl.sol";
import {TokenMinter} from "../arc/TokenMinter.sol";
import {TokenMessenger} from "../arc/TokenMessenger.sol";
import {FiatToken} from "../arc/FiatToken.sol";
import {ComplianceRegistry} from "../arc/ComplianceRegistry.sol";
import {ArcPQ} from "../arc/lib/ArcPQ.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {SLHPrecompileStub} from "./SLHPrecompileStub.sol";

contract TokenMessengerQrl is TokenMessenger {
    constructor(
        uint32 localDomain_,
        address transmitter_,
        TokenMinter minter_,
        bytes memory owner,
        bytes memory guardian,
        bytes memory pauser
    ) TokenMessenger(localDomain_, MessageTransmitter(transmitter_), minter_, owner, guardian, pauser) {}
}

contract BridgeTest is Test {
    uint32 constant ARC_DOMAIN = 26;
    uint32 constant QRL_DOMAIN = 42424;
    uint32 constant FINALIZED = 2000;
    bytes32 constant MESSAGE_SENT = keccak256("MessageSent(bytes)");

    address attester;
    address attester2 = address(0xA77E57);

    bytes slhOwner;
    bytes slhGuardian;
    bytes slhPauser;
    bytes slhAttestA;
    bytes slhAttestB;
    bytes slhUser;
    bytes slhPk;
    bytes slhCompliance;
    ComplianceRegistry compliance;

    MockUSDC arcUsdc;
    FiatToken qrlUsdc;

    MessageTransmitter arcTx;
    MessageTransmitterQrl qrlTx;
    TokenMinter arcMinter;
    TokenMinter qrlMinter;
    TokenMessenger arcMsgr;
    TokenMessengerQrl qrlMsgr;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    bytes _lastOwner;
    bytes _lastGuard;

    function setUp() public {
        attester = address(this);
        slhOwner = abi.encodePacked(bytes32(uint256(0x51d5a87)));
        slhGuardian = abi.encodePacked(bytes32(uint256(0x51d5a88)));
        slhPauser = abi.encodePacked(bytes32(uint256(0x51d5a89)));
        slhAttestA = abi.encodePacked(bytes32(uint256(0xA77E571)));
        slhAttestB = abi.encodePacked(bytes32(uint256(0xA77E572)));
        slhUser = abi.encodePacked(bytes32(uint256(0xA11CE51)));
        slhPk = slhUser;
        slhCompliance = abi.encodePacked(bytes32(uint256(0xC0DE51)));
        vm.etch(ArcPQ.PRECOMPILE, type(SLHPrecompileStub).runtimeCode);

        arcUsdc = new MockUSDC();
        qrlUsdc = new FiatToken("USD Coin", "USDC", "USD", address(this), slhOwner, slhGuardian, slhPauser);

        arcTx = new MessageTransmitter(ARC_DOMAIN, slhOwner, slhGuardian, slhPauser, slhAttestA, slhAttestB);
        qrlTx = new MessageTransmitterQrl(QRL_DOMAIN);
        qrlTx.enableAttester(attester2);

        arcMinter = new TokenMinter(slhOwner, slhGuardian, slhPauser);
        qrlMinter = new TokenMinter(slhOwner, slhGuardian, slhPauser);
        arcMsgr = new TokenMessenger(ARC_DOMAIN, arcTx, arcMinter, slhOwner, slhGuardian, slhPauser);
        qrlMsgr = new TokenMessengerQrl(QRL_DOMAIN, address(qrlTx), qrlMinter, slhOwner, slhGuardian, slhPauser);

        _council(arcMinter, arcMinter.setTokenMessengerPayload(address(arcMsgr)));
        arcMinter.setTokenMessenger(address(arcMsgr), _lastOwner, _lastGuard);
        _council(qrlMinter, qrlMinter.setTokenMessengerPayload(address(qrlMsgr)));
        qrlMinter.setTokenMessenger(address(qrlMsgr), _lastOwner, _lastGuard);

        bytes memory qrlUsdc64 = Bytes.fromAddress20(address(qrlUsdc));
        bytes memory arcUsdc64 = Bytes.fromAddress20(address(arcUsdc));
        _council(
            arcMinter,
            arcMinter.linkTokenPayload(address(arcUsdc), QRL_DOMAIN, qrlUsdc64, TokenMinter.TokenMode.LockUnlock)
        );
        arcMinter.linkToken(
            address(arcUsdc), QRL_DOMAIN, qrlUsdc64, TokenMinter.TokenMode.LockUnlock, _lastOwner, _lastGuard
        );
        _council(
            qrlMinter,
            qrlMinter.linkTokenPayload(address(qrlUsdc), ARC_DOMAIN, arcUsdc64, TokenMinter.TokenMode.MintBurn)
        );
        qrlMinter.linkToken(
            address(qrlUsdc), ARC_DOMAIN, arcUsdc64, TokenMinter.TokenMode.MintBurn, _lastOwner, _lastGuard
        );

        bytes memory qrlMsgr64 = Bytes.fromAddress20(address(qrlMsgr));
        bytes memory arcMsgr64 = Bytes.fromAddress20(address(arcMsgr));
        _council(arcMsgr, arcMsgr.setRemoteTokenMessengerPayload(QRL_DOMAIN, qrlMsgr64));
        arcMsgr.setRemoteTokenMessenger(QRL_DOMAIN, qrlMsgr64, _lastOwner, _lastGuard);
        _council(qrlMsgr, qrlMsgr.setRemoteTokenMessengerPayload(ARC_DOMAIN, arcMsgr64));
        qrlMsgr.setRemoteTokenMessenger(ARC_DOMAIN, arcMsgr64, _lastOwner, _lastGuard);

        _council(qrlUsdc, qrlUsdc.configureMinterPayload(address(qrlMinter), type(uint256).max));
        qrlUsdc.configureMinter(address(qrlMinter), type(uint256).max, _lastOwner, _lastGuard);

        _council(arcTx, arcTx.freezeLocalPayload());
        arcTx.freezeLocal(_lastOwner, _lastGuard);
        _council(arcMinter, arcMinter.freezeLocalPayload());
        arcMinter.freezeLocal(_lastOwner, _lastGuard);
        _council(qrlMinter, qrlMinter.freezeLocalPayload());
        qrlMinter.freezeLocal(_lastOwner, _lastGuard);
        _council(arcMsgr, arcMsgr.freezeLocalPayload());
        arcMsgr.freezeLocal(_lastOwner, _lastGuard);
        _council(qrlMsgr, qrlMsgr.freezeLocalPayload());
        qrlMsgr.freezeLocal(_lastOwner, _lastGuard);

        _council(arcMsgr, arcMsgr.setPeerSealPayload(qrlMsgr.localSeal()));
        arcMsgr.setPeerSeal(qrlMsgr.localSeal(), _lastOwner, _lastGuard);
        _council(qrlMsgr, qrlMsgr.setPeerSealPayload(arcMsgr.localSeal()));
        qrlMsgr.setPeerSeal(arcMsgr.localSeal(), _lastOwner, _lastGuard);

        compliance = new ComplianceRegistry(slhOwner, slhGuardian, slhPauser, slhCompliance);
        _bindCompliance(arcMsgr);
        _bindCompliance(qrlMsgr);
        _bindMinterCompliance(arcMinter);
        _bindMinterCompliance(qrlMinter);

        _register(arcMsgr, alice);
        _register(qrlMsgr, bob);

        arcUsdc.mint(alice, 1_000_000_000);
        vm.prank(alice);
        arcUsdc.approve(address(arcMsgr), type(uint256).max);
    }

    function _pk(bytes memory key, bytes32 digest) internal pure returns (bytes memory sig) {
        bytes32 head = keccak256(abi.encodePacked(key, digest));
        sig = new bytes(7856);
        assembly {
            mstore(add(sig, 32), head)
        }
    }

    function _slhOn(bytes32 digest) internal view returns (bytes memory) {
        return _pk(slhUser, digest);
    }

    function _council(PQOwnable c, bytes32 payload) internal {
        bytes32 d = c.ownerDigest(payload);
        _lastOwner = _pk(slhOwner, d);
        _lastGuard = _pk(slhGuardian, d);
    }

    function _bindCompliance(TokenMessenger msgr) internal {
        _council(msgr, msgr.setCompliancePayload(address(compliance)));
        msgr.setCompliance(address(compliance), _lastOwner, _lastGuard);
    }

    function _bindMinterCompliance(TokenMinter minter_) internal {
        _council(minter_, minter_.setCompliancePayload(address(compliance)));
        minter_.setCompliance(address(compliance), _lastOwner, _lastGuard);
    }

    function _register(TokenMessenger msgr, address user) internal {
        bytes32 digest =
            keccak256(abi.encode(address(msgr), user, keccak256(slhUser), block.chainid, "register"));
        vm.prank(user);
        msgr.registerAccount(slhUser, _pk(slhUser, digest));
    }

    function _qrlReceive(bytes memory message) internal {
        vm.prank(attester);
        qrlTx.receiveMessage(message);
        vm.prank(attester2);
        qrlTx.receiveMessage(message);
    }

    function _arcReceive(bytes memory message) internal {
        bytes[] memory pks = new bytes[](2);
        bytes[] memory sigs = new bytes[](2);
        pks[0] = slhAttestA;
        pks[1] = slhAttestB;
        bytes32 digest = keccak256(message);
        sigs[0] = _pk(slhAttestA, digest);
        sigs[1] = _pk(slhAttestB, digest);
        arcTx.receiveMessage(message, pks, sigs);
    }

    function testAddressPadRoundTrip() public pure {
        bytes memory a64 = Bytes.fromAddress20(address(0xA11CE));
        assertEq(a64.length, 64);
        assertEq(Bytes.toAddress20(a64), address(0xA11CE));
        assertTrue(Bytes.isZero64(new bytes(64)));
        assertFalse(Bytes.isZero64(a64));
    }

    function testWideAddressRejectedOnArc() public {
        bytes memory wide = new bytes(64);
        wide[0] = 0x01;
        vm.expectRevert(bytes("wide-addr"));
        this.externalToAddress20(wide);
    }

    function externalToAddress20(bytes memory a) external pure returns (address) {
        return Bytes.toAddress20(a);
    }

    function testMessageCodecRoundTrip() public view {
        bytes memory sender = Bytes.fromAddress20(address(arcMsgr));
        bytes memory recipient = Bytes.fromAddress20(address(qrlMsgr));
        bytes memory caller = new bytes(64);
        bytes memory body = MessageV2.encodeBurnBody(
            Bytes.fromAddress20(address(arcUsdc)),
            Bytes.fromAddress20(bob),
            1_000_000,
            Bytes.fromAddress20(alice),
            0,
            0,
            0,
            abi.encodePacked(arcMsgr.localSeal())
        );
        bytes memory encoded = MessageV2.encodeHeader(
            ARC_DOMAIN, QRL_DOMAIN, bytes32(uint256(7)), sender, recipient, caller, FINALIZED, FINALIZED, body
        );
        assertEq(MessageV2.version(encoded), 2);
        assertEq(MessageV2.hookSeal(MessageV2.body(encoded)), arcMsgr.localSeal());
    }

    function testArcToQrlLockAndMint() public {
        uint256 amount = 5_000_000;
        vm.recordLogs();
        _deposit(arcMsgr, alice, amount, QRL_DOMAIN, bob, address(arcUsdc));
        assertEq(arcUsdc.balanceOf(alice), 1_000_000_000 - amount);
        assertEq(arcUsdc.balanceOf(address(arcMinter)), amount);
        _qrlReceive(_lastMessageSent());
        assertEq(qrlUsdc.balanceOf(bob), amount);
        assertEq(qrlUsdc.totalSupply(), amount);
    }

    function testQrlBurnUnlocksArc() public {
        testArcToQrlLockAndMint();
        uint256 amount = 5_000_000;
        vm.prank(bob);
        qrlUsdc.approve(address(qrlMinter), amount);
        vm.recordLogs();
        _deposit(qrlMsgr, bob, amount, ARC_DOMAIN, alice, address(qrlUsdc));
        assertEq(qrlUsdc.totalSupply(), 0);
        _arcReceive(_lastMessageSent());
        assertEq(arcUsdc.balanceOf(alice), 1_000_000_000);
        assertEq(arcUsdc.balanceOf(address(arcMinter)), 0);
    }

    function testReplayRejected() public {
        vm.recordLogs();
        _deposit(arcMsgr, alice, 1_000_000, QRL_DOMAIN, bob, address(arcUsdc));
        bytes memory message = _lastMessageSent();
        _qrlReceive(message);
        qrlTx.enableAttester(address(0x333));
        vm.prank(address(0x333));
        vm.expectRevert(bytes("nonce"));
        qrlTx.receiveMessage(message);
    }

    function testWrongAttesterRejected() public {
        vm.recordLogs();
        _deposit(arcMsgr, alice, 1_000_000, QRL_DOMAIN, bob, address(arcUsdc));
        vm.prank(bob);
        vm.expectRevert(bytes("attester"));
        qrlTx.receiveMessage(_lastMessageSent());
    }

    function testZeroAmountRejected() public {
        vm.prank(alice);
        bytes memory to = Bytes.fromAddress20(bob);
        bytes32 action = _userAction(arcMsgr, alice, 0, QRL_DOMAIN, to, address(arcUsdc));
        vm.expectRevert(bytes("amount"));
        arcMsgr.depositForBurn(0, QRL_DOMAIN, to, address(arcUsdc), new bytes(64), 0, FINALIZED, slhUser, _slhOn(action));
    }

    function testDepositRejectsEcdsaKey() public {
        bytes memory to = Bytes.fromAddress20(bob);
        vm.prank(alice);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        arcMsgr.depositForBurn(
            1_000_000, QRL_DOMAIN, to, address(arcUsdc), new bytes(64), 0, FINALIZED, slhUser, new bytes(65)
        );
    }

    function testUnregisteredCannotDeposit() public {
        address eve = address(0xE1E);
        arcUsdc.mint(eve, 1_000_000);
        vm.prank(eve);
        arcUsdc.approve(address(arcMsgr), 1_000_000);
        bytes memory to = Bytes.fromAddress20(bob);
        bytes32 action = _userAction(arcMsgr, eve, 1_000_000, QRL_DOMAIN, to, address(arcUsdc));
        vm.prank(eve);
        vm.expectRevert(bytes("unregistered"));
        arcMsgr.depositForBurn(
            1_000_000, QRL_DOMAIN, to, address(arcUsdc), new bytes(64), 0, FINALIZED, slhUser, _pk(slhUser, action)
        );
    }

    function testEnableAttesterRejectsEcKey() public {
        vm.expectRevert(bytes("slh-pk"));
        arcTx.enableAttester(abi.encodePacked(alice), new bytes(7856), new bytes(7856));
    }

    function testUnknownRemoteMessengerRejected() public {
        TokenMessenger rogue =
            new TokenMessenger(ARC_DOMAIN, arcTx, arcMinter, slhOwner, slhGuardian, slhPauser);
        _council(arcMinter, arcMinter.setTokenMessengerPayload(address(rogue)));
        arcMinter.setTokenMessenger(address(rogue), _lastOwner, _lastGuard);
        bytes memory qrlMsgr64 = Bytes.fromAddress20(address(qrlMsgr));
        _council(rogue, rogue.setRemoteTokenMessengerPayload(QRL_DOMAIN, qrlMsgr64));
        rogue.setRemoteTokenMessenger(QRL_DOMAIN, qrlMsgr64, _lastOwner, _lastGuard);
        _council(arcMinter, arcMinter.freezeLocalPayload());
        arcMinter.freezeLocal(_lastOwner, _lastGuard);
        _council(rogue, rogue.freezeLocalPayload());
        rogue.freezeLocal(_lastOwner, _lastGuard);
        _bindCompliance(rogue);
        _register(rogue, alice);
        vm.prank(alice);
        arcUsdc.approve(address(rogue), 1_000_000);
        vm.recordLogs();
        _deposit(rogue, alice, 1_000_000, QRL_DOMAIN, bob, address(arcUsdc));
        bytes memory message = _lastMessageSent();
        vm.prank(attester);
        qrlTx.receiveMessage(message);
        vm.prank(attester2);
        vm.expectRevert(bytes("peer-seal"));
        qrlTx.receiveMessage(message);
        _council(arcMinter, arcMinter.setTokenMessengerPayload(address(arcMsgr)));
        arcMinter.setTokenMessenger(address(arcMsgr), _lastOwner, _lastGuard);
        _council(arcMinter, arcMinter.freezeLocalPayload());
        arcMinter.freezeLocal(_lastOwner, _lastGuard);
    }

    function testFiatTokenBlacklistBlocksMintPath() public {
        _council(qrlUsdc, qrlUsdc.blacklistPayload(bob));
        qrlUsdc.blacklist(bob, _lastOwner, _lastGuard);
        vm.recordLogs();
        _deposit(arcMsgr, alice, 1_000_000, QRL_DOMAIN, bob, address(arcUsdc));
        bytes memory message = _lastMessageSent();
        vm.prank(attester);
        qrlTx.receiveMessage(message);
        vm.prank(attester2);
        vm.expectRevert(bytes("blacklisted"));
        qrlTx.receiveMessage(message);
    }

    function testPauseStopsDeposit() public {
        bytes memory sig = _pk(slhPauser, PQPausable(address(arcMsgr)).pauserDigest(arcMsgr.pausePayload()));
        arcMsgr.pause(sig);
        vm.prank(alice);
        vm.expectRevert(bytes("paused"));
        arcMsgr.depositForBurn(
            1_000_000,
            QRL_DOMAIN,
            Bytes.fromAddress20(bob),
            address(arcUsdc),
            new bytes(64),
            0,
            FINALIZED,
            slhUser,
            _slhOn(bytes32(0))
        );
    }

    function testArcRejectsEcdsaAttestation() public {
        testArcToQrlLockAndMint();
        uint256 amount = 5_000_000;
        vm.prank(bob);
        qrlUsdc.approve(address(qrlMinter), amount);
        vm.recordLogs();
        _deposit(qrlMsgr, bob, amount, ARC_DOMAIN, alice, address(qrlUsdc));
        bytes memory message = _lastMessageSent();
        bytes[] memory pks = new bytes[](2);
        bytes[] memory sigs = new bytes[](2);
        pks[0] = slhAttestA;
        pks[1] = slhAttestB;
        sigs[0] = new bytes(65);
        sigs[1] = new bytes(65);
        vm.expectRevert(bytes("ecdsa-forbidden"));
        arcTx.receiveMessage(message, pks, sigs);
    }

    function testSingleAttesterCannotUnlock() public {
        testArcToQrlLockAndMint();
        uint256 amount = 5_000_000;
        vm.prank(bob);
        qrlUsdc.approve(address(qrlMinter), amount);
        vm.recordLogs();
        _deposit(qrlMsgr, bob, amount, ARC_DOMAIN, alice, address(qrlUsdc));
        bytes memory message = _lastMessageSent();
        bytes[] memory pks = new bytes[](1);
        bytes[] memory sigs = new bytes[](1);
        pks[0] = slhAttestA;
        sigs[0] = _pk(slhAttestA, keccak256(message));
        vm.expectRevert(bytes("threshold"));
        arcTx.receiveMessage(message, pks, sigs);
    }

    function testFuzzRoundTrip(uint64 raw) public {
        uint256 amount = bound(uint256(raw), 1, 500_000_000);
        vm.recordLogs();
        _deposit(arcMsgr, alice, amount, QRL_DOMAIN, bob, address(arcUsdc));
        _qrlReceive(_lastMessageSent());
        assertEq(qrlUsdc.balanceOf(bob), amount);
        vm.prank(bob);
        qrlUsdc.approve(address(qrlMinter), amount);
        vm.recordLogs();
        _deposit(qrlMsgr, bob, amount, ARC_DOMAIN, alice, address(qrlUsdc));
        _arcReceive(_lastMessageSent());
        assertEq(arcUsdc.balanceOf(alice), 1_000_000_000);
        assertEq(qrlUsdc.totalSupply(), 0);
    }

    function _userAction(
        TokenMessenger msgr,
        address user,
        uint256 amount,
        uint32 dest,
        bytes memory mintTo,
        address token
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(address(msgr), user, amount, dest, keccak256(mintTo), token, block.chainid));
    }

    function _deposit(
        TokenMessenger msgr,
        address user,
        uint256 amount,
        uint32 dest,
        address mintTo,
        address token
    ) internal {
        bytes memory to = Bytes.fromAddress20(mintTo);
        bytes32 action = _userAction(msgr, user, amount, dest, to, token);
        vm.prank(user);
        msgr.depositForBurn(amount, dest, to, token, new bytes(64), 0, FINALIZED, slhUser, _pk(slhUser, action));
    }

    function _lastMessageSent() internal returns (bytes memory) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].topics[0] == MESSAGE_SENT) {
                return abi.decode(logs[i - 1].data, (bytes));
            }
        }
        revert("no MessageSent");
    }
}
