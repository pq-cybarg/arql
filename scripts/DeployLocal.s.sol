// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {Bytes} from "../contracts/arc/lib/Bytes.sol";
import {ArcPQ} from "../contracts/arc/lib/ArcPQ.sol";
import {PQOwnable} from "../contracts/arc/lib/PQOwnable.sol";
import {MessageTransmitter} from "../contracts/arc/MessageTransmitter.sol";
import {MessageTransmitterQrl} from "../contracts/arc/MessageTransmitterQrl.sol";
import {TokenMinter} from "../contracts/arc/TokenMinter.sol";
import {TokenMessenger} from "../contracts/arc/TokenMessenger.sol";
import {FiatToken} from "../contracts/arc/FiatToken.sol";
import {TestnetUSDC} from "../contracts/arc/TestnetUSDC.sol";
import {ComplianceRegistry} from "../contracts/arc/ComplianceRegistry.sol";
import {SLHPrecompileStub} from "../contracts/test/SLHPrecompileStub.sol";

contract DeployLocal is Script {
    uint32 constant ARC_DOMAIN = 26;
    uint32 constant QRL_DOMAIN = 42424;

    bytes ownerPk;
    bytes guardianPk;
    bytes pauserPk;
    bytes attestA;
    bytes attestB;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address attester = vm.addr(pk);
        ownerPk = abi.encodePacked(bytes32(uint256(0x51d5a87)));
        guardianPk = abi.encodePacked(bytes32(uint256(0x51d5a88)));
        pauserPk = abi.encodePacked(bytes32(uint256(0x51d5a89)));
        attestA = abi.encodePacked(bytes32(uint256(0xA77E571)));
        attestB = abi.encodePacked(bytes32(uint256(0xA77E572)));
        vm.etch(ArcPQ.PRECOMPILE, type(SLHPrecompileStub).runtimeCode);

        vm.startBroadcast(pk);

        TestnetUSDC arcUsdc = new TestnetUSDC();
        FiatToken qrlUsdc = new FiatToken("USD Coin", "USDC", "USD", attester, ownerPk, guardianPk, pauserPk);

        MessageTransmitter arcTx =
            new MessageTransmitter(ARC_DOMAIN, ownerPk, guardianPk, pauserPk, attestA, attestB);
        MessageTransmitterQrl qrlTx = new MessageTransmitterQrl(QRL_DOMAIN);
        qrlTx.enableAttester(0x70997970C51812dc3A010C7d01b50e0d17dc79C8);

        TokenMinter arcMinter = new TokenMinter(ownerPk, guardianPk, pauserPk);
        TokenMinter qrlMinter = new TokenMinter(ownerPk, guardianPk, pauserPk);
        TokenMessenger arcMsgr =
            new TokenMessenger(ARC_DOMAIN, arcTx, arcMinter, ownerPk, guardianPk, pauserPk);
        TokenMessenger qrlMsgr = new TokenMessenger(
            QRL_DOMAIN, MessageTransmitter(address(qrlTx)), qrlMinter, ownerPk, guardianPk, pauserPk
        );

        (bytes memory o, bytes memory g) = _c(arcMinter, arcMinter.setTokenMessengerPayload(address(arcMsgr)));
        arcMinter.setTokenMessenger(address(arcMsgr), o, g);
        (o, g) = _c(qrlMinter, qrlMinter.setTokenMessengerPayload(address(qrlMsgr)));
        qrlMinter.setTokenMessenger(address(qrlMsgr), o, g);

        bytes memory qrlUsdc64 = Bytes.fromAddress20(address(qrlUsdc));
        bytes memory arcUsdc64 = Bytes.fromAddress20(address(arcUsdc));
        (o, g) = _c(
            arcMinter,
            arcMinter.linkTokenPayload(address(arcUsdc), QRL_DOMAIN, qrlUsdc64, TokenMinter.TokenMode.LockUnlock)
        );
        arcMinter.linkToken(
            address(arcUsdc), QRL_DOMAIN, qrlUsdc64, TokenMinter.TokenMode.LockUnlock, o, g
        );
        (o, g) = _c(
            qrlMinter,
            qrlMinter.linkTokenPayload(address(qrlUsdc), ARC_DOMAIN, arcUsdc64, TokenMinter.TokenMode.MintBurn)
        );
        qrlMinter.linkToken(
            address(qrlUsdc), ARC_DOMAIN, arcUsdc64, TokenMinter.TokenMode.MintBurn, o, g
        );

        bytes memory qrlMsgr64 = Bytes.fromAddress20(address(qrlMsgr));
        bytes memory arcMsgr64 = Bytes.fromAddress20(address(arcMsgr));
        (o, g) = _c(arcMsgr, arcMsgr.setRemoteTokenMessengerPayload(QRL_DOMAIN, qrlMsgr64));
        arcMsgr.setRemoteTokenMessenger(QRL_DOMAIN, qrlMsgr64, o, g);
        (o, g) = _c(qrlMsgr, qrlMsgr.setRemoteTokenMessengerPayload(ARC_DOMAIN, arcMsgr64));
        qrlMsgr.setRemoteTokenMessenger(ARC_DOMAIN, arcMsgr64, o, g);

        (o, g) = _c(qrlUsdc, qrlUsdc.configureMinterPayload(address(qrlMinter), type(uint256).max));
        qrlUsdc.configureMinter(address(qrlMinter), type(uint256).max, o, g);

        (o, g) = _c(arcTx, arcTx.freezeLocalPayload());
        arcTx.freezeLocal(o, g);
        (o, g) = _c(arcMinter, arcMinter.freezeLocalPayload());
        arcMinter.freezeLocal(o, g);
        (o, g) = _c(qrlMinter, qrlMinter.freezeLocalPayload());
        qrlMinter.freezeLocal(o, g);
        (o, g) = _c(arcMsgr, arcMsgr.freezeLocalPayload());
        arcMsgr.freezeLocal(o, g);
        (o, g) = _c(qrlMsgr, qrlMsgr.freezeLocalPayload());
        qrlMsgr.freezeLocal(o, g);
        (o, g) = _c(arcMsgr, arcMsgr.setPeerSealPayload(qrlMsgr.localSeal()));
        arcMsgr.setPeerSeal(qrlMsgr.localSeal(), o, g);
        (o, g) = _c(qrlMsgr, qrlMsgr.setPeerSealPayload(arcMsgr.localSeal()));
        qrlMsgr.setPeerSeal(arcMsgr.localSeal(), o, g);

        bytes memory compliancePk = abi.encodePacked(bytes32(uint256(0xC0DE51)));
        ComplianceRegistry reg = new ComplianceRegistry(ownerPk, guardianPk, pauserPk, compliancePk);
        (o, g) = _c(arcMsgr, arcMsgr.setCompliancePayload(address(reg)));
        arcMsgr.setCompliance(address(reg), o, g);
        (o, g) = _c(qrlMsgr, qrlMsgr.setCompliancePayload(address(reg)));
        qrlMsgr.setCompliance(address(reg), o, g);
        (o, g) = _c(arcMinter, arcMinter.setCompliancePayload(address(reg)));
        arcMinter.setCompliance(address(reg), o, g);
        (o, g) = _c(qrlMinter, qrlMinter.setCompliancePayload(address(reg)));
        qrlMinter.setCompliance(address(reg), o, g);

        arcUsdc.mint(attester, 1_000_000_000_000);

        vm.stopBroadcast();

        string memory json = string.concat(
            '{"arcDomain":26,"qrlDomain":42424,"chainId":31337,',
            '"arcUsdc":"',
            vm.toString(address(arcUsdc)),
            '",',
            '"qrlUsdc":"',
            vm.toString(address(qrlUsdc)),
            '",',
            '"arcTransmitter":"',
            vm.toString(address(arcTx)),
            '",',
            '"qrlTransmitter":"',
            vm.toString(address(qrlTx)),
            '",',
            '"arcMinter":"',
            vm.toString(address(arcMinter)),
            '",',
            '"qrlMinter":"',
            vm.toString(address(qrlMinter)),
            '",',
            '"arcMessenger":"',
            vm.toString(address(arcMsgr)),
            '",',
            '"qrlMessenger":"',
            vm.toString(address(qrlMsgr)),
            '",',
            '"attester":"',
            vm.toString(attester),
            '",',
            '"arcSeal":"',
            vm.toString(arcMsgr.localSeal()),
            '",',
            '"qrlSeal":"',
            vm.toString(qrlMsgr.localSeal()),
            '",',
            '"compliance":"',
            vm.toString(address(reg)),
            '"}'
        );
        vm.writeFile("deployments/local.json", json);
        console2.log(json);
    }

    function _c(PQOwnable c, bytes32 payload) internal view returns (bytes memory o, bytes memory g) {
        bytes32 d = c.ownerDigest(payload);
        o = _raw(ownerPk, d);
        g = _raw(guardianPk, d);
    }

    function _raw(bytes memory key, bytes32 digest) internal pure returns (bytes memory sig) {
        bytes32 head = keccak256(abi.encodePacked(key, digest));
        sig = new bytes(7856);
        assembly {
            mstore(add(sig, 32), head)
        }
    }
}
