// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {PQOwnable} from "./PQOwnable.sol";

contract PQPausable is PQOwnable {
    bool public paused;

    event Pause();
    event Unpause();

    constructor(bytes memory owner, bytes memory guardian, bytes memory pauser)
        PQOwnable(owner, guardian, pauser)
    {}

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    function pausePayload() public pure returns (bytes32) {
        return keccak256("pause");
    }

    function unpausePayload() public pure returns (bytes32) {
        return keccak256("unpause");
    }

    /// Pauser may halt. Cannot unpause or re-key.
    function pause(bytes calldata pauserSig) external {
        _consumePauser(pausePayload(), pauserSig);
        paused = true;
        emit Pause();
    }

    /// Owner + guardian must both sign to resume.
    function unpause(bytes calldata ownerSig, bytes calldata guardianSig) external {
        _consumeCouncil(unpausePayload(), ownerSig, guardianSig);
        paused = false;
        emit Unpause();
    }
}
