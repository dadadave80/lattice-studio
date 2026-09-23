// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DLib} from "@lattice/DLib.sol";

contract D {
    function y() external pure {
        DLib.y();
    }
}
