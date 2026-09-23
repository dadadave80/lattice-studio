// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControlLib} from "@lattice/access/libraries/AccessControlLib.sol";

contract AccessControl {
    function hasRole(bytes32 role) external {
        AccessControlLib.checkRole(role);
    }
}
