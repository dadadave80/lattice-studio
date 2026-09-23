// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev `keccak256(abi.encode(uint256(keccak256("diamond.lib.storage")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant DIAMOND_STORAGE_LOCATION = 0x6d5a93fec60e12d72b781fe97b2b5406e385b9eaa23d3ec2fbfa067f9d0dc000;

/// @notice Struct representing the diamond's own bookkeeping.
/// @custom:storage-location erc7201:diamond.lib.storage
struct DiamondStorage {
    address[] facetAddresses;
}

library DiamondLib {
    function diamondStorage() internal pure returns (DiamondStorage storage ds_) {
        assembly {
            ds_.slot := DIAMOND_STORAGE_LOCATION
        }
    }

    function diamondCut() internal pure {}
}
