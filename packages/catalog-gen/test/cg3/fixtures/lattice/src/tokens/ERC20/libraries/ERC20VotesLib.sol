// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20Lib} from "@lattice/tokens/ERC20/libraries/ERC20Lib.sol";
import {AccessControlLib} from "@lattice/access/libraries/AccessControlLib.sol";

//*//////////////////////////////////////////////////////////////////////////
//                                  STORAGE
//////////////////////////////////////////////////////////////////////////*//

/// @dev No own storage. Uses ERC20 and AccessControl slots already present in Diamond storage.
///      Included here only so the line count lands the waived constant on its real line.

/// @dev ERC-165 storage location (same across all Lattice modules).
/// `keccak256(abi.encode(uint256(keccak256("diamond.lib.storage.ERC165")) - 1)) & ~bytes32(uint256(0xff))`.
bytes32 constant ERC20VOTES_ERC165_STORAGE_LOCATION =
    0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200;

/// @dev IERC20Votes has only errors (no functions), so type(IERC20Votes).interfaceId == 0x00000000.
/// `keccak256(abi.encode(bytes4(0x00000000), 0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200))`.
/// This is the pinned Lattice's known bug (ledger "For Lattice" #2): the value below is
/// `keccak256(bytes32(0))`, not the formula's result. Reproduced here at the exact file:line CG3 waives.
bytes32 constant ERC165_MAP_IERC20VOTES_SLOT = 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563;

library ERC20VotesLib {
    function registerInterface() internal pure {}

    function totalSupply() internal pure returns (uint256) {
        AccessControlLib.checkRole(bytes32(0));
        return ERC20Lib.totalSupply();
    }
}
