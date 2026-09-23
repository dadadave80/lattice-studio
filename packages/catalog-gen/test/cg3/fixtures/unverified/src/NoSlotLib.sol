// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Storage struct with no accompanying slot constant at all (a drift this generator must not hide).
/// @custom:storage-location erc7201:fixture.storage.NoSlot
struct NoSlotStorage {
    uint256 x;
}

library NoSlotLib {}
