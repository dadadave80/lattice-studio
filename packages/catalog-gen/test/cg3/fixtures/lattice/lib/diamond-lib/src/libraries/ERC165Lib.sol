// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev `keccak256(abi.encode(uint256(keccak256("diamond.lib.storage.ERC165")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant ERC165_STORAGE_LOCATION = 0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200;

/// @notice Struct for storing ERC165 interface support information.
/// @custom:storage-location erc7201:diamond.lib.storage.ERC165
struct ERC165Storage {
    mapping(bytes4 interfaceId => bool) supportedInterfaces;
}

library ERC165Lib {
    function erc165Storage() internal pure returns (ERC165Storage storage es_) {
        assembly {
            es_.slot := ERC165_STORAGE_LOCATION
        }
    }
}
