// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControlLib} from "@lattice/access/libraries/AccessControlLib.sol";

/// @dev `keccak256(abi.encode(uint256(keccak256("fixture.storage.ModuleManager")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant MODULE_MANAGER_STORAGE_SLOT = 0x4a5a1bb15d6a8aecdb835ce6590cfc227c3c7bfa62801f91d2e3a6f29abc5e00;

/// @notice Storage struct for installed modules.
/// @custom:storage-location erc7201:fixture.storage.ModuleManager
struct ModuleManagerStorage {
    mapping(address => bool) installed;
}

library ModuleManagerLib {
    function moduleManagerStorage() internal pure returns (ModuleManagerStorage storage $) {
        assembly {
            $.slot := MODULE_MANAGER_STORAGE_SLOT
        }
    }

    function install(address module) internal {
        AccessControlLib.checkRole(bytes32(0));
        moduleManagerStorage().installed[module] = true;
    }
}
