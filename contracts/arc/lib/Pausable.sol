// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Ownable} from "./Ownable.sol";

contract Pausable is Ownable {
    bool public paused;

    event Pause();
    event Unpause();

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Pause();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpause();
    }
}
