// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Lattice Studio golden harness for shared-contract addresses. golden/release/run.ts copies this file into a
// temporary folder under the Lattice checkout's test/ directory, runs it with `forge test` and deletes the folder
// again. It never writes files: `release()` is driven as an external self-call exactly as ReleasePipelineTest
// does, never `run()`, which writes deployments/<chainid>/release-<version>.json into the checkout.
//
// It reports, as single-string log lines that run.ts parses:
//   STUDIO_RELEASE header <version> <registry owner> <codehash at Arachnid's proxy address>
//   STUDIO_RELEASE contract <Name> <address> <runtime codehash>
// one `contract` line for LatticeRegistry, LatticeFactory and every FacetInventory facet, in that order.

import {DeployRelease} from "@lattice-script/deploy/DeployRelease.s.sol";
import {CreateXDeployer} from "@lattice-script/lib/CreateXDeployer.sol";
import {FacetInventory} from "@lattice-script/lib/FacetInventory.sol";
import {MockCreateX} from "@lattice-test/helpers/MockCreateX.sol";
import {LatticeVersion} from "@lattice/LatticeVersion.sol";
import {Test, console} from "forge-std/Test.sol";

contract StudioGoldenReleaseTest is Test, DeployRelease {
    string private constant _TAG = "STUDIO_RELEASE";

    /// @dev Arachnid's deterministic deployment proxy and its runtime code (Foundry's default CREATE2 deployer).
    address private constant _ARACHNID = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes private constant _ARACHNID_RUNTIME =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    function setUp() public {
        // DeployRelease requires CreateX's code at its canonical address at the pin; the Lattice tests etch the
        // mock there too. Arachnid's proxy is etched only when the test chain lacks it.
        vm.etch(address(CreateXDeployer.CREATEX), address(new MockCreateX()).code);
        if (_ARACHNID.code.length == 0) vm.etch(_ARACHNID, _ARACHNID_RUNTIME);
    }

    /// @dev The release at the library's own version, with the owner run.ts passes (the catalog's registry owner).
    function test_Release() public {
        address owner = vm.envAddress("STUDIO_RELEASE_OWNER");
        string memory version = LatticeVersion.VERSION;
        _log(string.concat("header ", version, " ", vm.toString(owner), " ", vm.toString(_ARACHNID.codehash)));

        DeployRelease.ReleaseOutput memory out = this.release(version, owner);

        _contract("LatticeRegistry", out.registry);
        _contract("LatticeFactory", out.factory);
        (string[] memory names,) = FacetInventory.inventory();
        assertEq(out.facets.length, names.length, "release returned a facet list that doesn't match the inventory");
        for (uint256 i; i < names.length; ++i) {
            _contract(names[i], out.facets[i]);
        }
    }

    function _contract(string memory name, address at) private {
        _log(string.concat("contract ", name, " ", vm.toString(at), " ", vm.toString(at.codehash)));
    }

    function _log(string memory line) private pure {
        console.log(string.concat(_TAG, " ", line));
    }
}
