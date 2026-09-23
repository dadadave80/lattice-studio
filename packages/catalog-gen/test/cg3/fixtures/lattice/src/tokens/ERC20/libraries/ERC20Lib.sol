// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev `keccak256(abi.encode(uint256(keccak256("fixture.storage.ERC20")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant ERC20_STORAGE_SLOT = 0x244d9891fa3a334747a8fd738d3bd398221bda9761683399c33fc8167f013e00;

/// @notice Storage struct for the ERC-20 module.
/// @custom:storage-location erc7201:fixture.storage.ERC20
struct ERC20Storage {
    mapping(address => uint256) balances;
}

library ERC20Lib {
    function erc20Storage() internal pure returns (ERC20Storage storage $) {
        assembly {
            $.slot := ERC20_STORAGE_SLOT
        }
    }

    function totalSupply() internal pure returns (uint256) {
        return 0;
    }
}
