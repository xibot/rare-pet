// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {RarePet} from "../src/RarePet.sol";

interface Vm {
    function warp(uint256) external;
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

contract MockCollection {
    mapping(uint256 => address) private _owners;
    error MissingToken();

    function setOwner(uint256 id, address owner) external {
        _owners[id] = owner;
    }

    function ownerOf(uint256 id) external view returns (address) {
        address owner = _owners[id];
        if (owner == address(0)) revert MissingToken();
        return owner;
    }
}

contract RarePetTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant DAY = 86400;
    uint256 private constant FOUR_HOURS = 14400;
    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant OWNER = address(0xB0B);
    address private constant BUYER = address(0xCAFE);
    RarePet private game;
    address private genesis;
    address private generations;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(20 * DAY + 3600);
        game = new RarePet(vm.addr(SIGNER_KEY));
        genesis = game.GENESIS();
        generations = game.GENERATIONS();
        MockCollection template = new MockCollection();
        vm.etch(genesis, address(template).code);
        vm.etch(generations, address(template).code);
        MockCollection(genesis).setOwner(1, OWNER);
        MockCollection(genesis).setOwner(2, OWNER);
        MockCollection(generations).setOwner(1, OWNER);
    }

    function testRejectsWrongDeploymentChain() public {
        vm.chainId(1);
        vm.expectRevert(RarePet.WrongChain.selector);
        new RarePet(address(0));
    }

    function testCollectionsArePinnedAndNonexistentTokenCannotAct() public {
        vm.expectRevert(RarePet.UnsupportedCollection.selector);
        game.pet(address(0xDEAD), 1);
        vm.expectRevert(MockCollection.MissingToken.selector);
        game.pet(genesis, 99);
    }

    function testPetCooldownDoesNotRefreshUntilExactly24Hours() public {
        _pet(genesis, 1);
        uint256 first = block.timestamp;
        vm.warp(first + DAY - 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePet.ActionNotReady.selector, first + DAY));
        game.pet(genesis, 1);
        _eq(game.getPet(genesis, 1).lastPetAt, first);
        vm.warp(first + DAY);
        _pet(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, 2);
        _eq(game.getPet(genesis, 1).streak, 2);
    }

    function testEpochZeroActionTimestampsAreNotUninitialized() public {
        vm.warp(0);
        _pet(genesis, 1);
        vm.prank(OWNER);
        game.feed(genesis, 1);
        vm.prank(OWNER);
        game.poop(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePet.ActionNotReady.selector, DAY));
        game.pet(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePet.ActionNotReady.selector, FOUR_HOURS));
        game.feed(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePet.ActionNotReady.selector, FOUR_HOURS));
        game.poop(genesis, 1);
        require(game.getPet(genesis, 1).hasPet, "missing pet flag");
        vm.warp(DAY);
        _pet(genesis, 1);
        _eq(game.getPet(genesis, 1).streak, 2);
    }

    function testMidnightDoesNotResetPetCooldown() public {
        vm.warp(21 * DAY - 60);
        _pet(genesis, 1);
        vm.warp(21 * DAY + 60);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePet.ActionNotReady.selector, 22 * DAY - 60));
        game.pet(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, 1);
    }

    function testExactGraceDeadlinePreservesStreak() public {
        _pet(genesis, 1);
        vm.warp(block.timestamp + DAY + game.PET_GRACE());
        _eq(game.getPet(genesis, 1).streak, 1);
        _pet(genesis, 1);
        _eq(game.getPet(genesis, 1).streak, 2);
    }

    function testOneSecondAfterGraceDecaysAndResetsBeforeNextPet() public {
        _pet(genesis, 1);
        vm.warp(block.timestamp + DAY + game.PET_GRACE() + 1);
        _eq(game.getPet(genesis, 1).kinship, 0);
        _eq(game.getPet(genesis, 1).streak, 0);
        _pet(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, 1);
        _eq(game.getPet(genesis, 1).streak, 1);
    }

    function testDecayPersistsOnceAcrossOtherActionsAndKeepsAccruing() public {
        _buildStreak(5);
        uint256 deadline = block.timestamp + DAY + game.PET_GRACE();
        vm.warp(deadline + 1);
        vm.prank(OWNER);
        game.feed(genesis, 1);
        vm.prank(OWNER);
        game.poop(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, 4);
        _eq(game.getPet(genesis, 1).decayApplied, 1);
        vm.warp(deadline + DAY);
        _eq(game.getPet(genesis, 1).kinship, 4);
        vm.warp(deadline + DAY + 1);
        _eq(game.getPet(genesis, 1).kinship, 3);
        vm.prank(OWNER);
        game.feed(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, 3);
    }

    function testLongAbsenceClampsKinshipToZero() public {
        _pet(genesis, 1);
        vm.warp(block.timestamp + 36500 * DAY);
        _eq(game.getPet(genesis, 1).kinship, 0);
        vm.prank(OWNER);
        game.poop(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, 0);
        _pet(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, 1);
    }

    function testRarityEverySevenStreakDaysAndFallsWhenBroken() public {
        _buildStreak(14);
        _eq(game.getPet(genesis, 1).rarity, 2);
        vm.warp(block.timestamp + DAY + game.PET_GRACE() + 1);
        _eq(game.getPet(genesis, 1).rarity, 0);
        _pet(genesis, 1);
        _eq(game.getPet(genesis, 1).rarity, 0);
        _eq(game.getPet(genesis, 1).streak, 1);
    }

    function testFeedAndPoopHaveIndependentFourHourCooldowns() public {
        vm.warp(21 * DAY - 60);
        uint256 first = block.timestamp;
        vm.prank(OWNER);
        game.feed(genesis, 1);
        vm.prank(OWNER);
        game.poop(genesis, 1);
        vm.warp(first + FOUR_HOURS - 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePet.ActionNotReady.selector, first + FOUR_HOURS));
        game.feed(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePet.ActionNotReady.selector, first + FOUR_HOURS));
        game.poop(genesis, 1);
        vm.warp(first + FOUR_HOURS);
        vm.prank(OWNER);
        game.feed(genesis, 1);
        vm.prank(OWNER);
        game.poop(genesis, 1);
        RarePet.Pet memory care = game.getPet(genesis, 1);
        _eq(care.strength, 2);
        _eq(care.stamina, 10);
        _eq(care.health, 2);
        _eq(care.lastFeedAt, first + FOUR_HOURS);
        _eq(care.lastPoopAt, first + FOUR_HOURS);
    }

    function testCollectionAndTokenIdentityAreSeparate() public {
        _pet(genesis, 1);
        vm.prank(OWNER);
        game.feed(genesis, 1);
        _eq(game.getPet(genesis, 2).kinship, 0);
        _eq(game.getPet(generations, 1).kinship, 0);
        require(!game.getPet(generations, 1).hasFed, "leaked collection cooldown");
        _pet(generations, 1);
        _eq(game.getPet(generations, 1).kinship, 1);
        _eq(game.getPet(genesis, 1).kinship, 1);
    }

    function testOwnershipTransferPreservesCareAndRevokesOldOwnerOnEveryWrite() public {
        _pet(genesis, 1);
        MockCollection(genesis).setOwner(1, BUYER);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.NotOwner.selector);
        game.pet(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.NotOwner.selector);
        game.feed(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.NotOwner.selector);
        game.poop(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.NotOwner.selector);
        game.play(genesis, 1, bytes32(0), block.timestamp, "");
        vm.prank(BUYER);
        game.feed(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, 1);
        _eq(game.getPet(genesis, 1).strength, 1);
    }

    function testPlayNeedsAttestationAndRejectsMalformedSignature() public {
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(genesis, 1, bytes32(uint256(1)), block.timestamp, "");
        _eq(game.getPet(genesis, 1).experience, 0);
        _play(bytes32(uint256(1)));
        _eq(game.getPet(genesis, 1).experience, 10);
    }

    function testPlaySlotsExpireIndividuallyAfterRolling24Hours() public {
        uint256 first = block.timestamp;
        _play(bytes32(uint256(1)));
        vm.warp(first + 3600);
        _play(bytes32(uint256(2)));
        vm.warp(first + 7200);
        _play(bytes32(uint256(3)));
        uint256 deadline = first + 2 * DAY;
        bytes memory sig = _signature(game, OWNER, genesis, 1, bytes32(uint256(4)), deadline);
        vm.warp(first + DAY - 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePet.ActionNotReady.selector, first + DAY));
        game.play(genesis, 1, bytes32(uint256(4)), deadline, sig);
        require(!game.usedRuns(bytes32(uint256(4))), "cooldown revert consumed run");
        _eq(game.getPet(genesis, 1).playCount, 3);
        vm.warp(first + DAY);
        _eq(game.getPet(genesis, 1).playCount, 2);
        vm.prank(OWNER);
        game.play(genesis, 1, bytes32(uint256(4)), deadline, sig);
        RarePet.Pet memory care = game.getPet(genesis, 1);
        _eq(care.experience, 40);
        _eq(care.playCount, 3);
        _eq(care.playTimes[0], first + 3600);
        _eq(care.playTimes[2], first + DAY);
        vm.warp(first + DAY + 3600);
        _eq(game.getPet(genesis, 1).playCount, 2);
    }

    function testThreeSameSecondEpochZeroPlaysConsumeThreeSlots() public {
        vm.warp(0);
        _play(bytes32(uint256(1)));
        _play(bytes32(uint256(2)));
        _play(bytes32(uint256(3)));
        _eq(game.getPet(genesis, 1).playCount, 3);
        vm.warp(DAY - 1);
        _eq(game.getPet(genesis, 1).playCount, 3);
        vm.warp(DAY);
        _eq(game.getPet(genesis, 1).playCount, 0);
        _eq(game.getPet(genesis, 1).experience, 30);
    }

    function testRunCannotReplayOnAnotherDayOrTokenOrCollection() public {
        bytes32 runId = bytes32(uint256(42));
        _play(runId);
        vm.warp(21 * DAY);
        bytes memory sig = _signature(game, OWNER, generations, 1, runId, block.timestamp);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.RunAlreadyUsed.selector);
        game.play(generations, 1, runId, block.timestamp, sig);
        sig = _signature(game, OWNER, genesis, 2, runId, block.timestamp);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.RunAlreadyUsed.selector);
        game.play(genesis, 2, runId, block.timestamp, sig);
        sig = _signature(game, OWNER, genesis, 1, runId, block.timestamp);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.RunAlreadyUsed.selector);
        game.play(genesis, 1, runId, block.timestamp, sig);
    }

    function testExpiredAttestationRejectedButExactDeadlineAllowed() public {
        uint256 deadline = block.timestamp;
        bytes memory sig = _signature(game, OWNER, genesis, 1, bytes32(uint256(1)), deadline);
        vm.warp(deadline + 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.ExpiredPlay.selector);
        game.play(genesis, 1, bytes32(uint256(1)), deadline, sig);
        _play(bytes32(uint256(2)));
    }

    function testSignatureBindsOwnerCollectionTokenRunAndDeadline() public {
        bytes32 runId = bytes32(uint256(7));
        uint256 deadline = block.timestamp + DAY;
        bytes memory sig = _signature(game, OWNER, genesis, 1, runId, deadline);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(generations, 1, runId, deadline, sig);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(genesis, 2, runId, deadline, sig);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(genesis, 1, bytes32(uint256(8)), deadline, sig);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(genesis, 1, runId, deadline + 1, sig);
        MockCollection(genesis).setOwner(1, BUYER);
        vm.prank(BUYER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(genesis, 1, runId, deadline, sig);
    }

    function testSignatureBindsDeploymentAndChain() public {
        bytes32 runId = bytes32(uint256(1));
        bytes memory sig = _signature(game, OWNER, genesis, 1, runId, block.timestamp);
        RarePet other = new RarePet(vm.addr(SIGNER_KEY));
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        other.play(genesis, 1, runId, block.timestamp, sig);
        vm.chainId(4664);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(genesis, 1, runId, block.timestamp, sig);
    }

    function testWrongSignerAndMalleableSignatureRejected() public {
        bytes32 runId = bytes32(uint256(1));
        bytes32 digest = game.playDigest(OWNER, genesis, 1, runId, block.timestamp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, digest);
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(genesis, 1, runId, block.timestamp, abi.encodePacked(r, s, v));
        (v, r, s) = vm.sign(SIGNER_KEY, digest);
        uint256 curveN = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes32 highS = bytes32(curveN - uint256(s));
        vm.prank(OWNER);
        vm.expectRevert(RarePet.InvalidSignature.selector);
        game.play(
            genesis, 1, runId, block.timestamp, abi.encodePacked(r, highS, v == 27 ? uint8(28) : uint8(27))
        );
    }

    function testZeroSignerDisablesPlayAndBrainStaysZero() public {
        RarePet disabled = new RarePet(address(0));
        vm.prank(OWNER);
        vm.expectRevert(RarePet.PlayDisabled.selector);
        disabled.play(genesis, 1, bytes32(0), block.timestamp, "");
        _eq(disabled.getPet(genesis, 1).brain, 0);
    }

    function testFuzzDecayDoesNotUnderflowOrApplyTwice(uint32 absence) public {
        _buildStreak(7);
        uint256 lastPet = block.timestamp;
        vm.warp(lastPet + uint256(absence));
        uint256 graceDeadline = DAY + game.PET_GRACE();
        uint256 missed = absence > graceDeadline ? (uint256(absence) - graceDeadline - 1) / DAY + 1 : 0;
        uint256 expected = missed >= 7 ? 0 : 7 - missed;
        _eq(game.getPet(genesis, 1).kinship, expected);
        vm.prank(OWNER);
        game.feed(genesis, 1);
        vm.prank(OWNER);
        game.poop(genesis, 1);
        _eq(game.getPet(genesis, 1).kinship, expected);
    }

    function _pet(address collection, uint256 id) private {
        vm.prank(OWNER);
        game.pet(collection, id);
    }

    function _buildStreak(uint256 count) private {
        for (uint256 i; i < count; ++i) {
            if (i > 0) vm.warp(block.timestamp + DAY);
            _pet(genesis, 1);
        }
    }

    function _play(bytes32 runId) private {
        bytes memory sig = _signature(game, OWNER, genesis, 1, runId, block.timestamp);
        vm.prank(OWNER);
        game.play(genesis, 1, runId, block.timestamp, sig);
    }

    function _signature(
        RarePet target,
        address owner,
        address collection,
        uint256 id,
        bytes32 runId,
        uint256 deadline
    ) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SIGNER_KEY, target.playDigest(owner, collection, id, runId, deadline));
        return abi.encodePacked(r, s, v);
    }

    function _eq(uint256 a, uint256 b) private pure {
        require(a == b, "assertion failed");
    }
}
