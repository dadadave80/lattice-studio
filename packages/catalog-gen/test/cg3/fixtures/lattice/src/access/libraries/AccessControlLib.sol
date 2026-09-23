// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev `keccak256(abi.encode(uint256(keccak256("fixture.storage.AccessControl")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant ACCESS_CONTROL_STORAGE_SLOT = 0x4bd7c7bcc4cbb414d2a39dc2ec177a93e50117c969ea6ef6a327f91790905f00;

/// @dev `keccak256(abi.encode(uint256(keccak256("diamond.lib.storage.ERC165")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant ERC165_STORAGE_LOCATION = 0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200;

/// @dev 0x22222222 is `type(IAccessControl).interfaceId`.
/// `keccak256(abi.encode(bytes4(0x22222222), 0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200))`.
bytes32 constant ERC165_MAP_IACCESSCONTROL_SLOT = 0xcdc608b90592c59d2859b2c0d719e5ca2a7a55998f32cbd610d165b957983ffc;

/// @notice Storage struct for the access-control module.
/// @custom:storage-location erc7201:fixture.storage.AccessControl
struct AccessControlStorage {
    mapping(bytes32 => mapping(address => bool)) roles;
}

library AccessControlLib {
    function accessControlStorage() internal pure returns (AccessControlStorage storage $) {
        assembly {
            $.slot := ACCESS_CONTROL_STORAGE_SLOT
        }
    }

    function checkRole(bytes32) internal pure {}
}
