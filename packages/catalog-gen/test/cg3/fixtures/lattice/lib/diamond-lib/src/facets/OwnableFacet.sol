// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OwnableLib} from "@diamond/libraries/OwnableLib.sol";

contract OwnableFacet {
    function transferOwnership(address newOwner) external {
        OwnableLib.transferOwnership(newOwner);
    }
}
