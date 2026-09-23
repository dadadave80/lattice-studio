// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Trimmed from Lattice's script/lib/FacetInventory.sol at f4a32c8 for CG1's unit tests: the same shape
// (two index-aligned string array literals, comments inside them), three entries instead of 100.

/// @title FacetInventory
/// @notice The (contract name, `"<file>:<Name>"` artifact path) list of every facet that ships in a release.
library FacetInventory {
    /// @notice The release facets as (contract name, `"<file>:<Name>"` deploy path) pairs.
    function inventory() internal pure returns (string[] memory names, string[] memory paths) {
        string[3] memory n = [
            "ERC20",
            "Receive",
            // diamond-lib core facets
            "DiamondCutFacet"
        ];
        string[3] memory p = [
            "src/tokens/ERC20/ERC20.sol:ERC20",
            "src/Receive.sol:Receive",
            // basename identifiers: the dir-qualified "lib/..." form does not resolve for vm.getCode/deployCode.
            "DiamondCutFacet.sol:DiamondCutFacet"
        ];
        names = new string[](3);
        paths = new string[](3);
        for (uint256 i; i < 3; ++i) {
            names[i] = n[i];
            paths[i] = p[i];
        }
    }
}
