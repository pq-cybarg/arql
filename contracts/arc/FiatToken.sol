// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {PQPausable} from "./lib/PQPausable.sol";

/// Circle-style FiatToken (USDC/RLUSD): 6 decimals, minter allowances, blacklist, pause.
/// QRVM twin is contracts/qrl/QRC20USDC.hyp (QRC-20). This Solidity
/// copy is the Arc-side test twin and the Foundry-executable reference.
/// Owner admin (master minter, blacklist, minter config) is SLH-DSA only.
contract FiatToken is PQPausable {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    string public currency;
    address public masterMinter;
    uint256 public totalSupply;

    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowed;
    mapping(address => bool) public minters;
    mapping(address => uint256) public minterAllowed;
    mapping(address => bool) public blacklisted;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Mint(address indexed minter, address indexed to, uint256 amount);
    event Burn(address indexed burner, uint256 amount);
    event MinterConfigured(address indexed minter, uint256 allowance);
    event MinterRemoved(address indexed minter);
    event MasterMinterChanged(address indexed newMasterMinter);
    event Blacklisted(address indexed account);
    event UnBlacklisted(address indexed account);

    modifier notBlacklisted(address account) {
        require(!blacklisted[account], "blacklisted");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        string memory currency_,
        address masterMinter_,
        bytes memory owner,
        bytes memory guardian,
        bytes memory pauser
    ) PQPausable(owner, guardian, pauser) {
        name = name_;
        symbol = symbol_;
        currency = currency_;
        masterMinter = masterMinter_;
    }

    function setMasterMinterPayload(address newMaster) public pure returns (bytes32) {
        return keccak256(abi.encode("setMasterMinter", newMaster));
    }

    function configureMinterPayload(address minter, uint256 allowedMint) public pure returns (bytes32) {
        return keccak256(abi.encode("configureMinter", minter, allowedMint));
    }

    function removeMinterPayload(address minter) public pure returns (bytes32) {
        return keccak256(abi.encode("removeMinter", minter));
    }

    function blacklistPayload(address account) public pure returns (bytes32) {
        return keccak256(abi.encode("blacklist", account));
    }

    function unBlacklistPayload(address account) public pure returns (bytes32) {
        return keccak256(abi.encode("unBlacklist", account));
    }

    function setMasterMinter(address newMaster, bytes calldata ownerSig, bytes calldata guardianSig) external {
        require(newMaster != address(0), "zero");
        _consumeCouncil(setMasterMinterPayload(newMaster), ownerSig, guardianSig);
        masterMinter = newMaster;
        emit MasterMinterChanged(newMaster);
    }

    function configureMinter(address minter, uint256 allowedMint, bytes calldata ownerSig, bytes calldata guardianSig)
        external
    {
        _consumeCouncil(configureMinterPayload(minter, allowedMint), ownerSig, guardianSig);
        minters[minter] = true;
        minterAllowed[minter] = allowedMint;
        emit MinterConfigured(minter, allowedMint);
    }

    function removeMinter(address minter, bytes calldata ownerSig, bytes calldata guardianSig) external {
        _consumeCouncil(removeMinterPayload(minter), ownerSig, guardianSig);
        minters[minter] = false;
        minterAllowed[minter] = 0;
        emit MinterRemoved(minter);
    }

    function blacklist(address account, bytes calldata ownerSig, bytes calldata guardianSig) external {
        _consumeCouncil(blacklistPayload(account), ownerSig, guardianSig);
        blacklisted[account] = true;
        emit Blacklisted(account);
    }

    function unBlacklist(address account, bytes calldata ownerSig, bytes calldata guardianSig) external {
        _consumeCouncil(unBlacklistPayload(account), ownerSig, guardianSig);
        blacklisted[account] = false;
        emit UnBlacklisted(account);
    }

    function mint(address to, uint256 amount)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(to)
    {
        require(minters[msg.sender], "minter");
        require(to != address(0), "zero");
        require(amount > 0, "amount");
        uint256 allowedMint = minterAllowed[msg.sender];
        require(amount <= allowedMint, "allowance");
        minterAllowed[msg.sender] = allowedMint - amount;
        totalSupply += amount;
        balances[to] += amount;
        emit Mint(msg.sender, to, amount);
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external whenNotPaused notBlacklisted(msg.sender) {
        require(minters[msg.sender], "minter");
        require(amount > 0, "amount");
        uint256 bal = balances[msg.sender];
        require(bal >= amount, "balance");
        balances[msg.sender] = bal - amount;
        totalSupply -= amount;
        emit Burn(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
    }

    function burnFrom(address from, uint256 amount)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(from)
    {
        require(minters[msg.sender], "minter");
        require(amount > 0, "amount");
        uint256 bal = balances[from];
        require(bal >= amount, "balance");
        uint256 a = allowed[from][msg.sender];
        require(a >= amount, "allowance");
        allowed[from][msg.sender] = a - amount;
        balances[from] = bal - amount;
        totalSupply -= amount;
        emit Burn(from, amount);
        emit Transfer(from, address(0), amount);
    }

    function transfer(address to, uint256 amount)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(to)
        returns (bool)
    {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(from)
        notBlacklisted(to)
        returns (bool)
    {
        uint256 a = allowed[from][msg.sender];
        require(a >= amount, "allowance");
        allowed[from][msg.sender] = a - amount;
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(spender)
        returns (bool)
    {
        allowed[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return allowed[owner][spender];
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero");
        uint256 bal = balances[from];
        require(bal >= amount, "balance");
        balances[from] = bal - amount;
        balances[to] += amount;
        emit Transfer(from, to, amount);
    }
}
