// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {PQCodeAnchor} from "./lib/PQCodeAnchor.sol";
import {ArcPQ} from "./lib/ArcPQ.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {ComplianceRegistry} from "./ComplianceRegistry.sol";

/// TokenMinter has two modes, matching what each chain can legally do:
///   LockUnlock — native Circle USDC on Arc cannot be burned by us, so we escrow it.
///   MintBurn   — QRC-20 USDC we issue on QRL is minted/burned 1:1 against that escrow.
/// Arc must never deploy a wrapped USDC token. This contract holds native USDC.
///
/// Owner and token controller are SLH-DSA public keys. An ECDSA `msg.sender`
/// cannot re-point the messenger, relink tokens, or drain locked USDC.
contract TokenMinter is PQCodeAnchor {
    enum TokenMode {
        Unset,
        LockUnlock,
        MintBurn
    }

    bytes public controllerPk;
    uint256 public controllerNonce;
    address public tokenMessenger;
    ComplianceRegistry public compliance;
    mapping(address => mapping(address => uint256)) public lockedOf;

    mapping(address => TokenMode) public tokenMode;
    mapping(uint32 => mapping(bytes32 => address)) public localToken; // remoteDomain => keccak(remoteToken64) => local
    mapping(address => mapping(uint32 => bytes)) public remoteToken; // local => remoteDomain => remoteToken64

    event TokenMessengerSet(address indexed messenger);
    event TokenControllerSet(bytes32 indexed controllerPkId);
    event TokenLinked(address indexed local, uint32 remoteDomain, bytes remoteToken, TokenMode mode);
    event Locked(address indexed token, address indexed from, uint256 amount);
    event Unlocked(address indexed token, address indexed to, uint256 amount);
    event ComplianceSet(address indexed registry);

    modifier onlyMessenger() {
        require(msg.sender == tokenMessenger, "messenger");
        _;
    }

    constructor(bytes memory owner, bytes memory guardian, bytes memory pauser)
        PQCodeAnchor(owner, guardian, pauser)
    {
        controllerPk = guardian;
        emit TokenControllerSet(ArcPQ.pkId(guardian));
    }

    function controllerDigest(bytes32 payload) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), controllerNonce, block.chainid, payload));
    }

    function setTokenMessengerPayload(address messenger) public pure returns (bytes32) {
        return keccak256(abi.encode("setTokenMessenger", messenger));
    }

    function setCompliancePayload(address registry) public pure returns (bytes32) {
        return keccak256(abi.encode("setCompliance", registry));
    }

    function setCompliance(address registry, bytes calldata ownerSig, bytes calldata guardianSig) external {
        require(registry != address(0), "zero");
        _consumeCouncil(setCompliancePayload(registry), ownerSig, guardianSig);
        compliance = ComplianceRegistry(registry);
        emit ComplianceSet(registry);
    }

    function setTokenControllerPayload(bytes calldata newControllerPk) public pure returns (bytes32) {
        return keccak256(abi.encode("setTokenController", keccak256(newControllerPk)));
    }

    function linkTokenPayload(address local, uint32 remoteDomain, bytes calldata remote, TokenMode mode)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode("linkToken", local, remoteDomain, keccak256(remote), uint8(mode)));
    }

    function setTokenMessenger(address messenger, bytes calldata ownerSig, bytes calldata guardianSig) external {
        require(messenger != address(0), "zero");
        _consumeCouncil(setTokenMessengerPayload(messenger), ownerSig, guardianSig);
        tokenMessenger = messenger;
        emit TokenMessengerSet(messenger);
    }

    function setTokenController(bytes calldata newControllerPk, bytes calldata ownerSig, bytes calldata guardianSig)
        external
    {
        require(newControllerPk.length == ArcPQ.PK_LEN, "slh-pk");
        ArcPQ.rejectClassicalKey(newControllerPk);
        _consumeCouncil(setTokenControllerPayload(newControllerPk), ownerSig, guardianSig);
        controllerPk = newControllerPk;
        emit TokenControllerSet(ArcPQ.pkId(newControllerPk));
    }

    function freezeLocal(bytes calldata ownerSig, bytes calldata guardianSig) external {
        require(tokenMessenger != address(0), "messenger");
        _consumeCouncil(freezeLocalPayload(), ownerSig, guardianSig);
        _pin(address(this));
        _pin(tokenMessenger);
    }

    function linkToken(
        address local,
        uint32 remoteDomain,
        bytes calldata remote,
        TokenMode mode,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        require(local != address(0), "local");
        require(remote.length == 64, "remote");
        require(mode != TokenMode.Unset, "mode");
        _consumeCouncil(linkTokenPayload(local, remoteDomain, remote, mode), ownerSig, guardianSig);
        tokenMode[local] = mode;
        localToken[remoteDomain][keccak256(remote)] = local;
        remoteToken[local][remoteDomain] = remote;
        emit TokenLinked(local, remoteDomain, remote, mode);
    }

    function getLocalToken(uint32 remoteDomain, bytes memory remote) public view returns (address) {
        require(remote.length == 64, "remote");
        return localToken[remoteDomain][keccak256(remote)];
    }

    /// Messenger already pulled `amount` of `token` into this contract.
    function lock(address token, address from, uint256 amount) external onlyMessenger whenNotPaused {
        _requireLocalCode();
        _screen(from);
        require(tokenMode[token] == TokenMode.LockUnlock, "mode");
        require(amount > 0, "amount");
        lockedOf[token][from] += amount;
        emit Locked(token, from, amount);
    }

    function unlock(address token, address to, uint256 amount) external onlyMessenger whenNotPaused {
        _requireLocalCode();
        _screen(to);
        require(tokenMode[token] == TokenMode.LockUnlock, "mode");
        require(amount > 0, "amount");
        require(IERC20(token).transfer(to, amount), "push");
        emit Unlocked(token, to, amount);
    }

    /// MintBurn local tokens implement mint(address,uint256) / burnFrom(address,uint256).
    function mint(address token, address to, uint256 amount) external onlyMessenger whenNotPaused {
        _requireLocalCode();
        _screen(to);
        require(tokenMode[token] == TokenMode.MintBurn, "mode");
        IMintable(token).mint(to, amount);
    }

    function burn(address token, address from, uint256 amount) external onlyMessenger whenNotPaused {
        _requireLocalCode();
        _screen(from);
        require(tokenMode[token] == TokenMode.MintBurn, "mode");
        IBurnable(token).burnFrom(from, amount);
    }

    function _screen(address account) internal view {
        require(address(compliance) != address(0), "compliance");
        compliance.requireClear(account);
    }

    function _requireLocalCode() internal view {
        requirePinned(address(this));
        requirePinned(tokenMessenger);
    }

}

interface IMintable {
    function mint(address to, uint256 amount) external;
}

interface IBurnable {
    function burnFrom(address from, uint256 amount) external;
}
