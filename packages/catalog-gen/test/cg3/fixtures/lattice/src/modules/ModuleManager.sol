// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ModuleManagerLib} from "@lattice/modules/libraries/ModuleManagerLib.sol";

contract ModuleManager {
    function install(address module) external {
        ModuleManagerLib.install(module);
    }
}
