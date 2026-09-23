// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ModuleManagerLib} from "@lattice/modules/libraries/ModuleManagerLib.sol";

/// @notice No dedicated `ModuleViewLib`: reads `ModuleManager`'s storage wholesale, so it inherits
///         everything `ModuleManager` itself touches, not just `ModuleManager`'s own namespace.
contract ModuleView {
    function isInstalled(address module) external view returns (bool) {
        return ModuleManagerLib.moduleManagerStorage().installed[module];
    }
}
