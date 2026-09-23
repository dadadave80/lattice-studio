// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev `keccak256(abi.encode(uint256(keccak256("fixture.storage.Dup")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant A_STORAGE_SLOT = 0x1111111111111111111111111111111111111111111111111111111111111100;

/// @custom:storage-location erc7201:fixture.storage.Dup
struct AStorage {
    uint256 x;
}

library ALib {}
