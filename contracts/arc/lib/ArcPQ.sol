// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// Arc native post-quantum verify: SLH-DSA-SHA2-128s precompile (FIPS 205).
/// Address from Arc docs: 0x1800..0004.
///
/// Calldata layout (no selector; protocol precompile):
///   pk (32) || digest (32) || signature (7856)  = 7920 bytes
/// Return: abi-encoded bool (32 bytes).
library ArcPQ {
    address internal constant PRECOMPILE = 0x1800000000000000000000000000000000000004;
    uint256 internal constant PK_LEN = 32;
    uint256 internal constant SIG_LEN = 7856;

    function pkId(bytes memory publicKey) internal pure returns (bytes32) {
        return keccak256(publicKey);
    }

    /// Fail closed: secp256k1 account keys (20/33/64/65) never authorize.
    function rejectClassicalKey(bytes memory publicKey) internal pure {
        require(
            publicKey.length != 20 && publicKey.length != 33 && publicKey.length != 64 && publicKey.length != 65,
            "ec-key-forbidden"
        );
    }

    /// Fail closed: secp256k1 ECDSA (64/65-byte sig, 20-byte account keys) never verifies.
    function rejectClassical(bytes memory publicKey, bytes memory signature) internal pure {
        require(signature.length != 64 && signature.length != 65, "ecdsa-forbidden");
        rejectClassicalKey(publicKey);
    }

    function verify(bytes memory publicKey, bytes32 digest, bytes memory signature) internal view returns (bool) {
        rejectClassical(publicKey, signature);
        require(publicKey.length == PK_LEN, "slh-pk");
        require(signature.length == SIG_LEN, "slh-sig");
        (bool ok, bytes memory out) = PRECOMPILE.staticcall(bytes.concat(publicKey, abi.encodePacked(digest), signature));
        require(ok && out.length >= 32, "arc-pq-precompile");
        return abi.decode(out, (bool));
    }
}
