// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20Lib} from "@lattice/tokens/ERC20/libraries/ERC20Lib.sol";

contract ERC20 {
    function totalSupply() external view returns (uint256) {
        return ERC20Lib.totalSupply();
    }
}
