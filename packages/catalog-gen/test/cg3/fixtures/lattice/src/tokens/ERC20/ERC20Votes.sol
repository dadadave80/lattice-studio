// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20VotesLib} from "@lattice/tokens/ERC20/libraries/ERC20VotesLib.sol";

contract ERC20Votes {
    function registerInterface() external {
        ERC20VotesLib.registerInterface();
    }
}
