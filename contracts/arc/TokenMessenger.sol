// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {PQCodeAnchor} from "./lib/PQCodeAnchor.sol";
import {Bytes} from "./lib/Bytes.sol";
import {MessageV2} from "./lib/MessageV2.sol";
import {IMessageHandler} from "./interfaces/IMessageHandler.sol";
import {TokenMinter} from "./TokenMinter.sol";
import {MessageTransmitter} from "./MessageTransmitter.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {ArcPQ} from "./lib/ArcPQ.sol";
import {ComplianceRegistry} from "./ComplianceRegistry.sol";

/// CCTP-shaped TokenMessenger. On Arc this locks native USDC (Circle's minter
/// is the only party that can burn official USDC). On a MintBurn chain it burns.
/// Admin (setMinter / setRemoteTokenMessenger / pause / pin / peer seal)
/// is SLH-DSA only. ECDSA cannot re-point or replace this contract.
contract TokenMessenger is PQCodeAnchor, IMessageHandler {
    using Bytes for bytes;

    uint32 public immutable localDomain;
    MessageTransmitter public immutable transmitter;
    TokenMinter public minter;
    mapping(uint32 => bytes) public remoteTokenMessengers; // domain => 64-byte messenger
    mapping(address => bytes) public accountPk;
    ComplianceRegistry public compliance;

    event AccountRegistered(address indexed account, bytes32 pkId);
    event ComplianceSet(address indexed registry);

    event RemoteTokenMessengerSet(uint32 indexed domain, bytes messenger);
    event DepositForBurn(
        uint256 amount,
        uint32 indexed destinationDomain,
        bytes mintRecipient,
        address indexed burnToken,
        bytes destinationCaller,
        address indexed depositor,
        bytes32 nonce
    );
    event MintAndWithdraw(address indexed mintRecipient, uint256 amount, address indexed mintToken);

    modifier onlyTransmitter() {
        require(msg.sender == address(transmitter), "transmitter");
        _;
    }

    constructor(
        uint32 localDomain_,
        MessageTransmitter transmitter_,
        TokenMinter minter_,
        bytes memory owner,
        bytes memory guardian,
        bytes memory pauser
    ) PQCodeAnchor(owner, guardian, pauser) {
        localDomain = localDomain_;
        transmitter = transmitter_;
        minter = minter_;
    }

    function setMinterPayload(TokenMinter minter_) public pure returns (bytes32) {
        return keccak256(abi.encode("setMinter", address(minter_)));
    }

    function setRemoteTokenMessengerPayload(uint32 domain, bytes calldata messenger) public pure returns (bytes32) {
        return keccak256(abi.encode("setRemoteTokenMessenger", domain, keccak256(messenger)));
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

    function setMinter(TokenMinter minter_, bytes calldata ownerSig, bytes calldata guardianSig) external {
        require(address(minter_) != address(0), "zero");
        _consumeCouncil(setMinterPayload(minter_), ownerSig, guardianSig);
        minter = minter_;
    }

    function setRemoteTokenMessenger(
        uint32 domain,
        bytes calldata messenger,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        require(messenger.length == 64, "addr64");
        _consumeCouncil(setRemoteTokenMessengerPayload(domain, messenger), ownerSig, guardianSig);
        remoteTokenMessengers[domain] = messenger;
        emit RemoteTokenMessengerSet(domain, messenger);
    }

    function freezeLocal(bytes calldata ownerSig, bytes calldata guardianSig) external {
        _consumeCouncil(freezeLocalPayload(), ownerSig, guardianSig);
        _pin(address(this));
        _pin(address(minter));
        _pin(address(transmitter));
    }

    function registerDigest(bytes memory slhPk) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), msg.sender, keccak256(slhPk), block.chainid, "register"));
    }

    /// Bind this EOA to one SLH-DSA key. Stolen ECDSA of the account cannot
    /// deposit unless it also holds this registered key.
    function registerAccount(bytes calldata slhPk, bytes calldata pqSig) external {
        require(accountPk[msg.sender].length == 0, "registered");
        require(slhPk.length == ArcPQ.PK_LEN, "slh-pk");
        ArcPQ.rejectClassicalKey(slhPk);
        require(ArcPQ.verify(slhPk, registerDigest(slhPk), pqSig), "pq-sig");
        accountPk[msg.sender] = slhPk;
        emit AccountRegistered(msg.sender, ArcPQ.pkId(slhPk));
    }

    /// Bind addresses and extcodehashes so a second deploy of the same
    /// bytecode cannot impersonate the pinned messenger.
    function localSeal() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(this).codehash,
                address(minter),
                address(minter).codehash,
                address(transmitter),
                address(transmitter).codehash
            )
        );
    }

    function _requireLocalCode() internal view {
        requirePinned(address(this));
        requirePinned(address(minter));
        requirePinned(address(transmitter));
    }

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes calldata mintRecipient,
        address burnToken,
        bytes calldata destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata pqPk,
        bytes calldata pqSig
    ) external whenNotPaused returns (bytes32 nonce) {
        _requirePQ(
            pqPk,
            pqSig,
            keccak256(
                abi.encode(
                    address(this),
                    msg.sender,
                    amount,
                    destinationDomain,
                    keccak256(mintRecipient),
                    burnToken,
                    block.chainid
                )
            )
        );
        return _depositForBurn(
            amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, ""
        );
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes calldata mintRecipient,
        address burnToken,
        bytes calldata destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData,
        bytes calldata pqPk,
        bytes calldata pqSig
    ) external whenNotPaused returns (bytes32 nonce) {
        _requirePQ(
            pqPk,
            pqSig,
            keccak256(
                abi.encode(
                    address(this),
                    msg.sender,
                    amount,
                    destinationDomain,
                    keccak256(mintRecipient),
                    burnToken,
                    block.chainid,
                    keccak256(hookData)
                )
            )
        );
        return _depositForBurn(
            amount,
            destinationDomain,
            mintRecipient,
            burnToken,
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            hookData
        );
    }

    function _requirePQ(bytes calldata pqPk, bytes calldata pqSig, bytes32 action) internal view {
        require(accountPk[msg.sender].length == ArcPQ.PK_LEN, "unregistered");
        require(keccak256(pqPk) == keccak256(accountPk[msg.sender]), "account-pk");
        require(ArcPQ.verify(pqPk, action, pqSig), "pq-sig");
    }

    function _depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes calldata mintRecipient,
        address burnToken,
        bytes calldata destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes memory hookData
    ) internal returns (bytes32 nonce) {
        require(amount > 0, "amount");
        require(mintRecipient.length == 64 && !Bytes.isZero64(mintRecipient), "mint-to");
        require(destinationCaller.length == 64, "caller");
        require(maxFee < amount, "max-fee");
        bytes memory remoteMessenger = remoteTokenMessengers[destinationDomain];
        require(remoteMessenger.length == 64, "remote-msgr");

        _requireLocalCode();
        _screen(msg.sender);
        _screenWire(mintRecipient);

        TokenMinter.TokenMode mode = minter.tokenMode(burnToken);
        if (mode == TokenMinter.TokenMode.LockUnlock) {
            require(IERC20(burnToken).transferFrom(msg.sender, address(minter), amount), "pull");
            minter.lock(burnToken, msg.sender, amount);
        } else if (mode == TokenMinter.TokenMode.MintBurn) {
            minter.burn(burnToken, msg.sender, amount);
        } else {
            revert("token");
        }

        bytes memory sealedHook = abi.encodePacked(localSeal(), hookData);
        bytes memory body = MessageV2.encodeBurnBody(
            Bytes.fromAddress20(burnToken),
            mintRecipient,
            amount,
            Bytes.fromAddress20(msg.sender),
            maxFee,
            0,
            0,
            sealedHook
        );

        nonce = transmitter.sendMessage(
            destinationDomain, remoteMessenger, destinationCaller, minFinalityThreshold, body
        );
        emit DepositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, msg.sender, nonce);
    }

    function handleReceiveFinalizedMessage(
        uint32 remoteDomain,
        bytes calldata sender,
        uint32,
        bytes calldata messageBody
    ) external onlyTransmitter returns (bool) {
        _requireLocalCode();
        requirePeerSeal(MessageV2.hookSeal(messageBody));
        require(Bytes.eq(sender, remoteTokenMessengers[remoteDomain]), "remote-msgr");
        MessageV2.validateBurn(messageBody);
        uint256 amount = MessageV2.amount(messageBody);
        require(amount > 0, "amount");
        bytes memory remoteToken = MessageV2.burnToken(messageBody);
        address local = minter.getLocalToken(remoteDomain, remoteToken);
        require(local != address(0), "local-token");
        bytes memory mintTo = MessageV2.mintRecipient(messageBody);
        _screenWire(mintTo);
        address to = Bytes.toAddress20(mintTo);
        _screen(to);

        TokenMinter.TokenMode mode = minter.tokenMode(local);
        if (mode == TokenMinter.TokenMode.LockUnlock) {
            minter.unlock(local, to, amount);
        } else if (mode == TokenMinter.TokenMode.MintBurn) {
            minter.mint(local, to, amount);
        } else {
            revert("token");
        }
        emit MintAndWithdraw(to, amount, local);
        return true;
    }

    function _screen(address account) internal view {
        require(address(compliance) != address(0), "compliance");
        compliance.requireClear(account);
    }

    function _screenWire(bytes memory addr64) internal view {
        require(address(compliance) != address(0), "compliance");
        compliance.requireClearWire(addr64);
    }
}
