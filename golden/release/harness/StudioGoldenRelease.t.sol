// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Lattice Studio golden harness for shared-contract addresses. golden/release/run.ts copies this file into a
// temporary folder under the Lattice checkout's test/ directory, runs it with `forge test` and deletes the folder
// again. It never writes files: `release()` is driven as an external self-call exactly as ReleasePipelineTest
// does, never `run()`, which writes deployments/<chainid>/release-<version>.json into the checkout.
//
// It reports, as single-string log lines that run.ts parses:
//   STUDIO_RELEASE header <version> <registry owner> <codehash at Arachnid's proxy address> <mock-createx|no-createx>
//   STUDIO_RELEASE contract <Name> <address> <runtime codehash>
//   STUDIO_RELEASE code <Name> <creation code>
//   STUDIO_RELEASE library <Lib> <linked address> <runtime code there>
// one `contract` line for LatticeRegistry, LatticeFactory and every FacetInventory facet, in that order, then one
// `code` line (the creation code DeployRelease takes from `vm.getCode`) for each facet named in
// STUDIO_RELEASE_CODE (comma-separated): the ones whose catalog address links a library Lattice doesn't pin;
// then one `library` line per STUDIO_RELEASE_LIBRARIES entry.

import {DeployRelease} from "@lattice-script/deploy/DeployRelease.s.sol";
import {FacetInventory} from "@lattice-script/lib/FacetInventory.sol";
import {LatticeVersion} from "@lattice/LatticeVersion.sol";
import {Test, console} from "forge-std/Test.sol";

contract StudioGoldenReleaseTest is Test, DeployRelease {
    string private constant _TAG = "STUDIO_RELEASE";

    /// @dev Arachnid's deterministic deployment proxy and its runtime code (Foundry's default CREATE2 deployer).
    address private constant _ARACHNID = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes private constant _ARACHNID_RUNTIME =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    /// @dev CreateX's canonical address, and the start of DeployRelease's revert when nothing is there (at the pin).
    address private constant _CREATEX = 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed;
    string private constant _NO_CREATEX = "DeployRelease: CreateX has no code";

    function setUp() public {
        if (_ARACHNID.code.length == 0) vm.etch(_ARACHNID, _ARACHNID_RUNTIME);
    }

    /// @dev The release at the library's own version, with the owner run.ts passes (the catalog's registry owner),
    ///      else HANDOFF D6's placeholder so the file also runs on its own under `forge test`. Lattice's MockCreateX
    ///      is etched at CreateX's address only when DeployRelease refuses to run without CreateX's code.
    function test_Release() public {
        address owner = vm.envOr("STUDIO_RELEASE_OWNER", address(0x000000000000000000000000000000000000dEaD));
        string memory version = LatticeVersion.VERSION;

        DeployRelease.ReleaseOutput memory out;
        string memory createx = "no-createx";
        try this.release(version, owner) returns (DeployRelease.ReleaseOutput memory released) {
            out = released;
        } catch Error(string memory reason) {
            require(_startsWith(reason, _NO_CREATEX), reason);
            vm.etch(_CREATEX, deployCode("MockCreateX.sol:MockCreateX").code);
            createx = "mock-createx";
            out = this.release(version, owner);
        }

        _log(string.concat("header ", version, " ", vm.toString(owner), " ", vm.toString(_ARACHNID.codehash), " ", createx));
        _contract("LatticeRegistry", out.registry);
        _contract("LatticeFactory", out.factory);
        (string[] memory names, string[] memory paths) = FacetInventory.inventory();
        assertEq(out.facets.length, names.length, "release returned a facet list that doesn't match the inventory");
        for (uint256 i; i < names.length; ++i) {
            _contract(names[i], out.facets[i]);
        }

        string[] memory codeFor = vm.envOr("STUDIO_RELEASE_CODE", ",", new string[](0));
        for (uint256 j; j < codeFor.length; ++j) {
            if (bytes(codeFor[j]).length == 0) continue;
            uint256 i = _indexOf(names, codeFor[j]);
            _log(string.concat("code ", names[i], " ", vm.toString(vm.getCode(paths[i]))));
        }

        // Each entry is "<Lib>:<Facet>:<byte offset>": where the facet's creation code holds the library's linked
        // address (after a PUSH20). Reports the address forge linked there and the runtime code at that address
        // (a library's runtime starts with PUSH20 of its own address, so run.ts compares it, not the codehash).
        string[] memory libs = vm.envOr("STUDIO_RELEASE_LIBRARIES", ",", new string[](0));
        for (uint256 j; j < libs.length; ++j) {
            if (bytes(libs[j]).length == 0) continue;
            string[] memory f = vm.split(libs[j], ":");
            require(f.length == 3, string.concat("STUDIO_RELEASE_LIBRARIES entry ", libs[j], " isn't <Lib>:<Facet>:<offset>"));
            bytes memory code = vm.getCode(paths[_indexOf(names, f[1])]);
            uint256 offset = vm.parseUint(f[2]);
            require(offset >= 1 && offset + 20 <= code.length && code[offset - 1] == 0x73, "no PUSH20 at that offset");
            address linked;
            assembly ("memory-safe") {
                linked := shr(96, mload(add(add(code, 32), offset)))
            }
            _log(string.concat("library ", f[0], " ", vm.toString(linked), " ", vm.toString(linked.code)));
        }
    }

    function _contract(string memory name, address at) private {
        _log(string.concat("contract ", name, " ", vm.toString(at), " ", vm.toString(at.codehash)));
    }

    function _indexOf(string[] memory names, string memory name) private pure returns (uint256) {
        for (uint256 i; i < names.length; ++i) {
            if (keccak256(bytes(names[i])) == keccak256(bytes(name))) return i;
        }
        revert(string.concat("STUDIO_RELEASE_CODE names ", name, ", which isn't in FacetInventory"));
    }

    function _startsWith(string memory s, string memory prefix) private pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(prefix);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; ++i) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _log(string memory line) private pure {
        console.log(string.concat(_TAG, " ", line));
    }
}
