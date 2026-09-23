// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CLib} from "@lattice/CLib.sol";

contract C {
    function x() external pure {
        CLib.x();
    }
}
