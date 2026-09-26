// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    RarePetLaunchRouter,
    Curve,
    Beneficiary,
    ILaunchCollection,
    ILaunchFriendAccount,
    ILaunchInitializer,
    ILaunchToken
} from "../src/RarePetLaunchRouter.sol";

interface ForkVm {
    function envOr(string calldata, bool) external returns (bool);
    function envOr(string calldata, uint256) external returns (uint256);
    function skip(bool) external;
    function prank(address) external;
    function expectRevert(bytes calldata) external;
}

interface CanonicalFriendExecute {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}

/// @notice Optional read-only mainnet fork rehearsal. Forge mutates local EVM state only; never broadcasts.
contract RarePetLaunchRouterForkTest {
    ForkVm constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant GENESIS = 0x116EaA62241751E0c98dA43d458600c6C17cD361;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    function testCanonicalFriendCanLaunchWithRealDopplerModules() public {
        if (!vm.envOr("RARE_LAUNCH_FORK", false)) {
            vm.skip(true);
            return;
        }
        uint256 forkBlock = vm.envOr("RARE_LAUNCH_FORK_BLOCK", uint256(0));
        require(forkBlock != 0, "pin a fork block");
        require(block.chainid == 4663 && block.number == forkBlock, "use the pinned --fork-url/--fork-block-number");
        address[] memory quotes = new address[](1);
        quotes[0] = WETH;
        // Fixture treasury exists only in the fork and is not an approved production treasury.
        RarePetLaunchRouter router = new RarePetLaunchRouter(address(0x900), 1e27, 8500, quotes);
        address owner = ILaunchCollection(GENESIS).ownerOf(2);
        address wallet = ILaunchCollection(GENESIS).tokenBoundAccount(2);
        require(owner != address(0) && ILaunchFriendAccount(wallet).owner() == owner, "fork NFT ownership invalid");
        Curve[] memory curves = new Curve[](1);
        curves[0] = Curve(-10000, 10000, 20, 1e18);
        RarePetLaunchRouter.LaunchRequest memory request = RarePetLaunchRouter.LaunchRequest(
            "RarePet fork rehearsal",
            "RFTEST",
            "data:application/json;base64,e30=",
            WETH,
            10000,
            curves,
            9800,
            bytes32(uint256(42))
        );
        bytes memory callData = abi.encodeCall(RarePetLaunchRouter.launch, (request));
        vm.prank(owner);
        bytes memory result = CanonicalFriendExecute(wallet).execute(address(router), 0, callData, 0);
        address asset = abi.decode(result, (address));
        require(
            router.launchedAsset(asset) && ILaunchToken(asset).totalSupply() == 1e27, "creation receipt not verified"
        );
        RarePetLaunchRouter.LaunchState memory state = router.getLaunch(GENESIS, 2);
        require(state.hasLaunched && state.brain == 1 && state.lastLaunchAt == block.timestamp, "Brain not credited");
        Beneficiary[] memory actual = ILaunchInitializer(router.INITIALIZER()).getBeneficiaries(asset);
        Beneficiary[] memory expected = router.feeBeneficiaries(wallet);
        require(keccak256(abi.encode(actual)) == keccak256(abi.encode(expected)), "real fees differ");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RarePetLaunchRouter.ActionNotReady.selector, block.timestamp + 1 days));
        CanonicalFriendExecute(wallet).execute(address(router), 0, callData, 0);
    }
}
