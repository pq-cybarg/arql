// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// Anvil stand-in for Arc's SLH-DSA-SHA2-128s precompile at 0x1800..0004.
/// Production Arc runs the real precompile; this stub is only etched in tests.
/// Valid test signatures bind keccak256(pk || digest) into sig[0:32].
contract SLHPrecompileStub {
    fallback() external {
        require(msg.data.length == 32 + 32 + 7856, "slh-input");
        bytes32 pk;
        bytes32 digest;
        bytes32 head;
        assembly {
            pk := calldataload(0)
            digest := calldataload(32)
            head := calldataload(64)
        }
        bool valid = head == keccak256(abi.encodePacked(pk, digest));
        assembly {
            mstore(0x00, valid)
            return(0x00, 32)
        }
    }
}
