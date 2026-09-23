// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev `keccak256(abi.encode(uint256(keccak256("fixture.storage.C")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant C_STORAGE_SLOT = 0x3333333333333333333333333333333333333333333333333333333333333300;

/// @custom:storage-location erc7201:fixture.storage.C
struct CStorage {
    uint256 x;
}

library CLib {}
