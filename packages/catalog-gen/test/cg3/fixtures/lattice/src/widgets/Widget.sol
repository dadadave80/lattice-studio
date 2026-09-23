// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {WidgetLib} from "@lattice/widgets/libraries/WidgetLib.sol";

contract Widget {
    function x() external view returns (uint256) {
        return WidgetLib.widgetStorage().x;
    }
}
