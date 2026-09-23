// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DiamondLib} from "@diamond/libraries/DiamondLib.sol";
import {OwnableLib} from "@diamond/libraries/OwnableLib.sol";

contract DiamondCutFacet {
    function diamondCut() external {
        OwnableLib.checkOwner();
        DiamondLib.diamondCut();
    }
}
