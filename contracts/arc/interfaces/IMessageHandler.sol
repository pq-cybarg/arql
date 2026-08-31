// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

interface IMessageHandler {
    function handleReceiveFinalizedMessage(
        uint32 remoteDomain,
        bytes calldata sender,
        uint32 finalityThresholdExecuted,
        bytes calldata messageBody
    ) external returns (bool);
}
