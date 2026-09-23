// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Lattice Studio golden harness. golden/run.ts copies this file into a temporary folder under the Lattice
// checkout's test/ directory, runs it with `forge test` and deletes the folder again. It never writes files:
// every record goes to the test's logs as a `STUDIO_GOLDEN` line, which run.ts parses.
//
// Each test calls one recipe script's own `buildCuts(...)` and reports, in order:
//   STUDIO_GOLDEN recipe <Name> <script path> <buildCuts signature>
//   STUDIO_GOLDEN cut <index> <Add|Replace|Remove> <facet address> <runtime codehash> <name> <artifact> <sel,sel,...>
//   STUDIO_GOLDEN init <direct|MultiInit|none> <init address> <runtime codehash> <name> <artifact>
//   STUDIO_GOLDEN step <index> <init address> <runtime codehash> <name> <artifact> <function selector>
// Names come from matching runtime codehashes against FacetInventory (facets) and _initArtifacts() (inits);
// setUp fails if two candidates share a codehash, and an address that matches nothing is reported as `?`.

import {MultiInit} from "@diamond/initializers/MultiInit.sol";
import {FacetCut, FacetCutAction} from "@diamond/libraries/DiamondLib.sol";
import {DeployGovernedVault} from "@lattice-script/base/defi/DeployGovernedVault.s.sol";
import {DeploySafeDiamondCut} from "@lattice-script/base/governance/DeploySafeDiamondCut.s.sol";
import {DeployERC20} from "@lattice-script/base/tokens/DeployERC20.s.sol";
import {FacetInventory} from "@lattice-script/lib/FacetInventory.sol";
import {GovernedVaultParams} from "@lattice/defi/GovernedVaultInit.sol";
import {Test, console} from "forge-std/Test.sol";

contract StudioGoldenRoutingTest is Test {
    string private constant _TAG = "STUDIO_GOLDEN";

    /// @dev Codehash-to-name candidates: every FacetInventory facet, then every init below.
    string[] private _names;
    string[] private _artifacts;
    bytes32[] private _hashes;

    /// @dev Init contracts the v1 recipes deploy. Add a recipe's init here when its name shows as `?`.
    function _initArtifacts() private pure returns (string[] memory a) {
        a = new string[](6);
        a[0] = "MultiInit.sol:MultiInit";
        a[1] = "ERC20Init.sol:ERC20Init";
        a[2] = "DiamondIntrospectionInit.sol:DiamondIntrospectionInit";
        a[3] = "AccessControlInit.sol:AccessControlInit";
        a[4] = "GovernedVaultInit.sol:GovernedVaultInit";
        a[5] = "SafeDiamondCutInit.sol:SafeDiamondCutInit";
    }

    function setUp() public {
        (string[] memory names, string[] memory paths) = FacetInventory.inventory();
        for (uint256 i; i < names.length; ++i) {
            _candidate(names[i], paths[i]);
        }
        string[] memory inits = _initArtifacts();
        for (uint256 i; i < inits.length; ++i) {
            _candidate(_contractName(inits[i]), inits[i]);
        }
    }

    //*//////////////////////////////////////////////////////////////////////////
    //                                  RECIPES
    //////////////////////////////////////////////////////////////////////////*//

    /// @dev script/base/tokens/DeployERC20.s.sol, the default (immutable) overload `buildCuts(string,string)`.
    function test_ERC20() public {
        _recipe("ERC20", "script/base/tokens/DeployERC20.s.sol", "buildCuts(string,string)");
        DeployERC20 script = new DeployERC20();
        (FacetCut[] memory cuts, address init, bytes memory data) = script.buildCuts("Golden Token", "GOLD");
        _report(cuts, init, data);
    }

    /// @dev script/base/governance/DeploySafeDiamondCut.s.sol, `buildCuts(address,address,uint256)`.
    function test_SafeDiamondCut() public {
        _recipe(
            "SafeDiamondCut", "script/base/governance/DeploySafeDiamondCut.s.sol", "buildCuts(address,address,uint256)"
        );
        DeploySafeDiamondCut script = new DeploySafeDiamondCut();
        (FacetCut[] memory cuts, address init, bytes memory data) =
            script.buildCuts(makeAddr("admin"), makeAddr("safe"), 2);
        _report(cuts, init, data);
    }

    /// @dev script/base/defi/DeployGovernedVault.s.sol, `buildCuts(GovernedVaultParams)`.
    function test_GovernedVault() public {
        _recipe(
            "GovernedVault",
            "script/base/defi/DeployGovernedVault.s.sol",
            "buildCuts((address,string,string,uint8,uint256,uint48,uint32,uint256,uint256))"
        );
        DeployGovernedVault script = new DeployGovernedVault();
        GovernedVaultParams memory p = GovernedVaultParams({
            asset: makeAddr("asset"),
            name: "Golden Vault",
            symbol: "gVAULT",
            decimalsOffset: 0,
            minDelay: 2 days,
            votingDelay: 1 days,
            votingPeriod: 1 weeks,
            proposalThreshold: 0,
            quorumNumerator: 4
        });
        (FacetCut[] memory cuts, address init, bytes memory data) = script.buildCuts(p);
        _report(cuts, init, data);
    }

    //*//////////////////////////////////////////////////////////////////////////
    //                                 REPORTING
    //////////////////////////////////////////////////////////////////////////*//

    function _recipe(string memory name, string memory script, string memory buildCuts) private pure {
        console.log(string.concat(_TAG, " recipe ", name, " ", script, " ", buildCuts));
    }

    function _report(FacetCut[] memory cuts, address init, bytes memory data) private view {
        for (uint256 i; i < cuts.length; ++i) {
            FacetCut memory c = cuts[i];
            string memory sels;
            for (uint256 j; j < c.functionSelectors.length; ++j) {
                string memory s = vm.toString(abi.encodePacked(c.functionSelectors[j]));
                sels = j == 0 ? s : string.concat(sels, ",", s);
            }
            if (c.functionSelectors.length == 0) sels = "-";
            console.log(
                string.concat(_TAG, " cut ", vm.toString(i), " ", _action(c.action), " ", _who(c.facetAddress), " ", sels)
            );
        }

        if (init == address(0)) {
            console.log(string.concat(_TAG, " init none - - - -"));
            return;
        }
        bool multi = init.codehash == keccak256(vm.getDeployedCode("MultiInit.sol:MultiInit"))
            && data.length >= 4 && bytes4(data) == MultiInit.multiInit.selector;
        console.log(string.concat(_TAG, " init ", multi ? "MultiInit" : "direct", " ", _who(init)));
        if (!multi) {
            console.log(string.concat(_TAG, " step 0 ", _who(init), " ", _selectorOf(data)));
            return;
        }
        (address[] memory inits, bytes[] memory calldatas) = abi.decode(_slice(data, 4), (address[], bytes[]));
        require(inits.length == calldatas.length, "StudioGolden: MultiInit length mismatch");
        for (uint256 i; i < inits.length; ++i) {
            // MultiInit stops at the first zero address: nothing after it runs.
            if (inits[i] == address(0)) break;
            console.log(string.concat(_TAG, " step ", vm.toString(i), " ", _who(inits[i]), " ", _selectorOf(calldatas[i])));
        }
    }

    /// @dev `<address> <codehash> <name> <artifact>` for a deployed contract; `?` name and artifact when unknown.
    function _who(address a) private view returns (string memory) {
        if (a == address(0)) return string.concat(vm.toString(a), " - - -");
        bytes32 h = a.codehash;
        string memory name = "?";
        string memory artifact = "?";
        for (uint256 i; i < _hashes.length; ++i) {
            if (_hashes[i] == h) {
                name = _names[i];
                artifact = _artifacts[i];
                break;
            }
        }
        return string.concat(vm.toString(a), " ", vm.toString(h), " ", name, " ", artifact);
    }

    /// @dev Codehashes must be unique, or `_who` would silently report the first matching name.
    function _candidate(string memory name, string memory artifact) private {
        bytes32 h = keccak256(vm.getDeployedCode(artifact));
        for (uint256 i; i < _hashes.length; ++i) {
            require(
                _hashes[i] != h,
                string.concat("StudioGolden: ", artifact, " has the same runtime codehash as ", _artifacts[i])
            );
        }
        _names.push(name);
        _artifacts.push(artifact);
        _hashes.push(h);
    }

    function _action(FacetCutAction a) private pure returns (string memory) {
        if (a == FacetCutAction.Add) return "Add";
        if (a == FacetCutAction.Replace) return "Replace";
        return "Remove";
    }

    function _selectorOf(bytes memory data) private pure returns (string memory) {
        if (data.length < 4) return "-";
        return vm.toString(abi.encodePacked(bytes4(data)));
    }

    function _slice(bytes memory data, uint256 from) private pure returns (bytes memory out) {
        out = new bytes(data.length - from);
        for (uint256 i; i < out.length; ++i) {
            out[i] = data[i + from];
        }
    }

    /// @dev "Dir/File.sol:Name" -> "Name".
    function _contractName(string memory artifact) private pure returns (string memory) {
        bytes memory b = bytes(artifact);
        uint256 colon = b.length;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == ":") colon = i;
        }
        bytes memory out = new bytes(b.length - colon - 1);
        for (uint256 i; i < out.length; ++i) {
            out[i] = b[colon + 1 + i];
        }
        return string(out);
    }
}
