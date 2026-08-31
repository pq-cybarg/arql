// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {PQOwnable} from "./lib/PQOwnable.sol";
import {ArcPQ} from "./lib/ArcPQ.sol";

/// Sanctions and freeze list shared by TokenMessenger and TokenMinter.
///
/// Compliance SLH can add names (hot path for OFAC updates). Removing a name
/// or setting the seizure treasury requires owner + guardian. ECDSA cannot
/// list, unlist, or seize. Circle FiatToken blacklist remains independently
/// enforced on official USDC; this registry is ARQL's own gate so a sanctioned
/// mintRecipient is refused before lock or mint.
contract ComplianceRegistry is PQOwnable {
    bytes public compliancePk;
    uint256 public complianceNonce;
    address public seizureTreasury;

    mapping(address => bool) public sanctioned;
    mapping(bytes32 => bool) public sanctionedWire;
    mapping(address => bool) public frozen;

    event Sanctioned(address indexed account);
    event Unsanctioned(address indexed account);
    event WireSanctioned(bytes32 indexed id);
    event WireUnsanctioned(bytes32 indexed id);
    event Frozen(address indexed account);
    event Unfrozen(address indexed account);
    event TreasurySet(address indexed treasury);
    event ComplianceRotated(bytes32 indexed previousPkId, bytes32 indexed newPkId);

    constructor(bytes memory owner, bytes memory guardian, bytes memory pauser, bytes memory compliance)
        PQOwnable(owner, guardian, pauser)
    {
        _writeCompliance(compliance);
        _requireComplianceDistinct();
    }

    function complianceDigest(bytes32 payload) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), complianceNonce, block.chainid, payload));
    }

    function sanctionPayload(address account) public pure returns (bytes32) {
        return keccak256(abi.encode("sanction", account));
    }

    function freezePayload(address account) public pure returns (bytes32) {
        return keccak256(abi.encode("freeze", account));
    }

    function sanctionWirePayload(bytes32 id) public pure returns (bytes32) {
        return keccak256(abi.encode("sanctionWire", id));
    }

    function unsanctionPayload(address account) public pure returns (bytes32) {
        return keccak256(abi.encode("unsanction", account));
    }

    function unfreezePayload(address account) public pure returns (bytes32) {
        return keccak256(abi.encode("unfreeze", account));
    }

    function setTreasuryPayload(address treasury) public pure returns (bytes32) {
        return keccak256(abi.encode("setTreasury", treasury));
    }

    function transferCompliancePayload(bytes calldata newPk) public pure returns (bytes32) {
        return keccak256(abi.encode("transferCompliance", keccak256(newPk)));
    }

    function blocked(address account) public view returns (bool) {
        if (account == address(0)) return true;
        return sanctioned[account] || frozen[account];
    }

    function blockedWire(bytes memory addr64) public view returns (bool) {
        if (addr64.length != 64) return true;
        if (sanctionedWire[keccak256(addr64)]) return true;
        for (uint256 i = 0; i < 44; i++) {
            if (addr64[i] != 0) return false;
        }
        uint160 v;
        for (uint256 i = 0; i < 20; i++) {
            v = (v << 8) | uint8(addr64[44 + i]);
        }
        return blocked(address(v));
    }

    function requireClear(address account) public view {
        require(!blocked(account), "sanctioned");
    }

    function requireClearWire(bytes memory addr64) public view {
        require(!blockedWire(addr64), "sanctioned");
    }

    /// OFAC add: compliance SLH only.
    function sanction(address account, bytes calldata complianceSig) external {
        require(account != address(0), "zero");
        _consumeCompliance(sanctionPayload(account), complianceSig);
        sanctioned[account] = true;
        emit Sanctioned(account);
    }

    function freeze(address account, bytes calldata complianceSig) external {
        require(account != address(0), "zero");
        _consumeCompliance(freezePayload(account), complianceSig);
        frozen[account] = true;
        emit Frozen(account);
    }

    function sanctionWire(bytes calldata addr64, bytes calldata complianceSig) external {
        require(addr64.length == 64, "addr64");
        bytes32 id = keccak256(addr64);
        _consumeCompliance(sanctionWirePayload(id), complianceSig);
        sanctionedWire[id] = true;
        emit WireSanctioned(id);
    }

    /// Removal is council-only so a compromised compliance key cannot clear a name.
    function unsanction(address account, bytes calldata ownerSig, bytes calldata guardianSig) external {
        _consumeCouncil(unsanctionPayload(account), ownerSig, guardianSig);
        sanctioned[account] = false;
        emit Unsanctioned(account);
    }

    function unfreeze(address account, bytes calldata ownerSig, bytes calldata guardianSig) external {
        _consumeCouncil(unfreezePayload(account), ownerSig, guardianSig);
        frozen[account] = false;
        emit Unfrozen(account);
    }

    function unsanctionWire(bytes calldata addr64, bytes calldata ownerSig, bytes calldata guardianSig) external {
        require(addr64.length == 64, "addr64");
        _consumeCouncil(keccak256(abi.encode("unsanctionWire", keccak256(addr64))), ownerSig, guardianSig);
        bytes32 id = keccak256(addr64);
        sanctionedWire[id] = false;
        emit WireUnsanctioned(id);
    }

    function setTreasury(address treasury, bytes calldata ownerSig, bytes calldata guardianSig) external {
        require(treasury != address(0), "zero");
        require(!blocked(treasury), "sanctioned");
        _consumeCouncil(setTreasuryPayload(treasury), ownerSig, guardianSig);
        seizureTreasury = treasury;
        emit TreasurySet(treasury);
    }

    function transferCompliance(bytes calldata newPk, bytes calldata ownerSig, bytes calldata guardianSig) external {
        _requireSlh(newPk);
        _consumeCouncil(transferCompliancePayload(newPk), ownerSig, guardianSig);
        _writeCompliance(newPk);
        _requireComplianceDistinct();
    }

    function _consumeCompliance(bytes32 payload, bytes calldata complianceSig) internal {
        require(ArcPQ.verify(compliancePk, complianceDigest(payload), complianceSig), "pq-compliance");
        complianceNonce += 1;
    }

    function _writeCompliance(bytes memory slhPk) private {
        _requireSlh(slhPk);
        bytes32 prev = compliancePk.length == 0 ? bytes32(0) : ArcPQ.pkId(compliancePk);
        compliancePk = slhPk;
        emit ComplianceRotated(prev, ArcPQ.pkId(slhPk));
    }

    function _requireComplianceDistinct() private view {
        bytes32 c = ArcPQ.pkId(compliancePk);
        require(c != ArcPQ.pkId(ownerPk), "same-key");
        require(c != ArcPQ.pkId(guardianPk), "same-key");
        require(c != ArcPQ.pkId(pauserPk), "same-key");
    }
}
