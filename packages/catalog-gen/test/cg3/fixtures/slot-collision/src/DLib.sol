// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev `keccak256(abi.encode(uint256(keccak256("fixture.storage.D")) - 1)) & ~bytes32(uint256(0xff))`.
/// Deliberately declared to collide with CLib's (wrong) slot, to exercise the "or slot" half of contracts §4's
/// "no two catalog facets share a storage id or slot".
bytes32 constant D_STORAGE_SLOT = 0x3333333333333333333333333333333333333333333333333333333333333300;

/// @custom:storage-location erc7201:fixture.storage.D
struct DStorage {
    uint256 y;
}

library DLib {}
