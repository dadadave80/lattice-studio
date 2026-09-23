// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library OwnableLib {
    /// @dev The owner slot is given by:
    /// `bytes32(~uint256(uint32(bytes4(keccak256("_OWNER_SLOT_NOT")))))`.
    /// A deliberately non-ERC-7201 slot (Solady-style), never annotated: `OwnableLib` owns no namespace.
    bytes32 internal constant _OWNER_SLOT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff74873927;

    function checkOwner() internal pure {}

    function transferOwnership(address) internal pure {}
}
