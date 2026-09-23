// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControlLib} from "@lattice/access/libraries/AccessControlLib.sol";

/// @dev `keccak256(abi.encode(uint256(keccak256("fixture.storage.Widget")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant WIDGET_STORAGE_SLOT = 0xa9e789f03ff5d9c6dc8db8a7738dbd7f4e4c404f8712a279f0cd6e8e7563f400;

/// @custom:storage-location erc7201:fixture.storage.Widget
struct WidgetStorage {
    uint256 x;
}

/// @notice A pure library, imported to fix a compiler warning about the unused symbol.
/// @dev Emits `IAccessControl.RoleGranted` (from AccessControlLib._grantRole) only through OTHER
///      facets, never here: this library never calls AccessControlLib itself, only mentions it in
///      NatSpec (mirroring EmergencyStopLib.sol:104's mention of AccessControlLib._grantRole).
library WidgetLib {
    function widgetStorage() internal pure returns (WidgetStorage storage $) {
        assembly {
            $.slot := WIDGET_STORAGE_SLOT
        }
    }
}
