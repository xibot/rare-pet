// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {RarePetCare} from "../src/RarePetCare.sol";

interface CareVm {
    function warp(uint256) external;
    function getBlockTimestamp() external view returns (uint256);
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function deal(address, uint256) external;
}

contract CareMockCollection {
    mapping(uint256 => address) private _owners;
    error MissingToken();

    function setOwner(uint256 id, address owner) external {
        _owners[id] = owner;
    }

    function ownerOf(uint256 id) external view returns (address) {
        if (_owners[id] == address(0)) revert MissingToken();
        return _owners[id];
    }
}

contract RarePetCareTest {
    CareVm private constant vm = CareVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant DAY = 86400;
    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant SECOND_SIGNER_KEY = 0xD0D0;
    address private constant OWNER = address(0xB0B);
    address private constant BUYER = address(0xCAFE);
    RarePetCare private game;
    address private genesis;
    address private generations;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(20 * DAY);
        game = new RarePetCare(address(this), vm.addr(SIGNER_KEY));
        genesis = game.GENESIS();
        generations = game.GENERATIONS();
        CareMockCollection template = new CareMockCollection();
        vm.etch(genesis, address(template).code);
        vm.etch(generations, address(template).code);
        CareMockCollection(genesis).setOwner(1, OWNER);
        CareMockCollection(genesis).setOwner(2, OWNER);
        CareMockCollection(generations).setOwner(1, OWNER);
    }

    function testDefaultsAndEmptyRecords() public view {
        RarePetCare.RuleSet memory r = game.currentRules();
        _eq(game.currentRuleVersion(), 1);
        _eq(r.actions[0].cooldown, DAY);
        _eq(r.actions[0].dailyLimit, 1);
        _eq(r.actions[1].cooldown, 4 hours);
        _eq(r.actions[1].dailyLimit, 6);
        _eq(r.actions[1].points, 1);
        _eq(r.actions[1].secondaryPoints, 5);
        _eq(r.actions[2].points, 10);
        _eq(r.actions[2].dailyLimit, 3);
        _eq(r.actions[3].cooldown, 4 hours);
        _eq(r.actions[3].dailyLimit, 6);
        _eq(r.petGrace, DAY);
        _eq(r.decayInterval, DAY);
        _eq(r.decayPoints, 1);
        _eq(r.rarityEvery, 7);
        _eq(r.rarityPoints, 1);
        _eq(game.getPet(genesis, 1).brain, 0);
        _eq(game.getPetSchedule(genesis, 1).graceDeadline, 0);
        _eq(game.actionCount(genesis, 1), 0);
        _eq(game.getLifetime(genesis, 1).kinship, 0);
    }

    function testDeploymentRejectsZeroAdminAndWrongChain() public {
        vm.expectRevert(RarePetCare.InvalidAdmin.selector);
        new RarePetCare(address(0), address(0));
        vm.chainId(1);
        vm.expectRevert(RarePetCare.WrongChain.selector);
        new RarePetCare(address(this), address(0));
    }

    function testAllWritesCheckCurrentOwnerAndCollections() public {
        vm.expectRevert(RarePetCare.UnsupportedCollection.selector);
        game.pet(address(0xDEAD), 1);
        vm.expectRevert(CareMockCollection.MissingToken.selector);
        game.pet(genesis, 99);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.pet(genesis, 1);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.feed(genesis, 1);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.poop(genesis, 1);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.play(genesis, 1, bytes32(0), vm.getBlockTimestamp(), "");
        _eq(game.actionCount(genesis, 1), 0);
    }

    function testUnknownRecordsActionsAndRuleVersionsReject() public {
        vm.expectRevert(RarePetCare.InvalidRuleVersion.selector);
        game.rules(0);
        vm.expectRevert(RarePetCare.InvalidRuleVersion.selector);
        game.rules(2);
        vm.expectRevert(RarePetCare.InvalidRecord.selector);
        game.actionRecord(genesis, 1, 0);
        vm.expectRevert(RarePetCare.InvalidRecord.selector);
        game.actionRecord(genesis, 1, 1);
        vm.expectRevert(RarePetCare.InvalidAction.selector);
        game.actionAvailability(genesis, 1, 4);
    }

    function testRulesRequireAdminAndPublicDelayAndRetainHistory() public {
        RarePetCare.RuleSet memory previous = game.currentRules();
        RarePetCare.RuleSet memory next = game.currentRules();
        next.actions[1].points = 7;
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.NotAdmin.selector);
        game.scheduleRules(next);
        game.scheduleRules(next);
        (, uint256 executeAfter, uint256 predecessor) = game.pendingRules();
        _eq(predecessor, 1);
        _eq(executeAfter, vm.getBlockTimestamp() + DAY);
        _eq(game.currentRules().actions[1].points, 1);
        vm.warp(executeAfter - 1);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.DelayNotElapsed.selector, executeAfter));
        game.executeRules();
        vm.warp(executeAfter);
        vm.prank(BUYER);
        game.executeRules();
        _eq(game.currentRuleVersion(), 2);
        _eq(game.currentRules().actions[1].points, 7);
        require(keccak256(abi.encode(game.rules(1))) == keccak256(abi.encode(previous)), "past rules changed");
        (, executeAfter, predecessor) = game.pendingRules();
        _eq(executeAfter, 0);
        _eq(predecessor, 0);
        vm.expectRevert(RarePetCare.NoPendingRules.selector);
        game.executeRules();
    }

    function testPendingRulesCannotOverwriteAndCancellationIsAdminOnly() public {
        RarePetCare.RuleSet memory next = game.currentRules();
        game.scheduleRules(next);
        vm.expectRevert(RarePetCare.PendingRulesExist.selector);
        game.scheduleRules(next);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.NotAdmin.selector);
        game.cancelRules();
        game.cancelRules();
        vm.warp(vm.getBlockTimestamp() + DAY);
        vm.expectRevert(RarePetCare.NoPendingRules.selector);
        game.executeRules();
        vm.expectRevert(RarePetCare.NoPendingRules.selector);
        game.cancelRules();
        _eq(game.currentRuleVersion(), 1);
    }

    function testRuleBoundsRejectAllInvalidDimensions() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        for (uint256 i; i < 4; ++i) {
            r = game.currentRules();
            r.actions[i].points = 1_000_001;
            _badRules(r);
            r = game.currentRules();
            r.actions[i].cooldown = 30 days + 1;
            _badRules(r);
            r = game.currentRules();
            r.actions[i].dailyLimit = 0;
            _badRules(r);
            r = game.currentRules();
            r.actions[i].dailyLimit = 33;
            _badRules(r);
            if (i != 1) {
                r = game.currentRules();
                r.actions[i].secondaryPoints = 1;
                _badRules(r);
            }
        }
        r = game.currentRules();
        r.actions[1].secondaryPoints = 1_000_001;
        _badRules(r);
        r = game.currentRules();
        r.petGrace = 30 days + 1;
        _badRules(r);
        r = game.currentRules();
        r.decayInterval = 0;
        _badRules(r);
        r = game.currentRules();
        r.decayInterval = 30 days + 1;
        _badRules(r);
        r = game.currentRules();
        r.decayPoints = 1_000_001;
        _badRules(r);
        r = game.currentRules();
        r.rarityEvery = 0;
        _badRules(r);
        r = game.currentRules();
        r.rarityPoints = 1_000_001;
        _badRules(r);
        _eq(game.currentRuleVersion(), 1);
    }

    function testMaximumRulesAreAcceptedAndZeroRewardsAllowed() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        for (uint256 i; i < 4; ++i) {
            r.actions[i] = RarePetCare.ActionRule(1_000_000, 0, 30 days, 32, true);
        }
        r.actions[0].cooldown = uint32(DAY);
        r.actions[0].dailyLimit = 1;
        r.actions[1].secondaryPoints = 1_000_000;
        r.petGrace = 30 days;
        r.decayInterval = 30 days;
        r.decayPoints = 1_000_000;
        r.rarityEvery = type(uint16).max;
        r.rarityPoints = 1_000_000;
        _activate(r);
        _feed();
        _eq(game.getLifetime(genesis, 1).strength, 1_000_000);
        r.actions[0].points = 0;
        r.rarityPoints = 0;
        r.decayPoints = 0;
        _activate(r);
        _pet();
        _eq(game.getLifetime(genesis, 1).kinship, 0);
        _eq(game.getLifetime(genesis, 1).actionCounts[0], 1);
    }

    function testPetCadenceIsImmutableEvenWhileDisabled() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[0].cooldown = 0;
        _badRules(r);
        r.actions[0].cooldown = uint32(DAY - 1);
        _badRules(r);
        r.actions[0].cooldown = uint32(DAY + 1);
        _badRules(r);
        r.actions[0].cooldown = uint32(DAY);
        r.actions[0].dailyLimit = 2;
        _badRules(r);
        r.actions[0].enabled = false;
        _badRules(r);
        r.actions[0].dailyLimit = 1;
        r.actions[0].cooldown = 0;
        _badRules(r);
        r.actions[0].cooldown = uint32(DAY);
        r.actions[0].points = 7;
        _activate(r);
        _eq(game.currentRules().actions[0].points, 7);
        require(!game.currentRules().actions[0].enabled, "valid disabled pet rejected");
    }

    function testAdminTransferDelayedTwoStepAndClearsPendingRules() public {
        RarePetCare.RuleSet memory next = game.currentRules();
        next.actions[0].points = 400;
        game.scheduleRules(next);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.NotAdmin.selector);
        game.scheduleAdmin(BUYER);
        game.scheduleAdmin(BUYER);
        uint256 ready = game.adminTransferReadyAt();
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidAdmin.selector);
        game.acceptAdmin();
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.DelayNotElapsed.selector, ready));
        game.acceptAdmin();
        vm.warp(ready);
        vm.prank(BUYER);
        game.acceptAdmin();
        require(game.admin() == BUYER, "admin did not transfer");
        require(game.pendingAdmin() == address(0), "nominee retained");
        _eq(game.adminTransferReadyAt(), 0);
        _eq(game.currentRuleVersion(), 1);
        vm.expectRevert(RarePetCare.NoPendingRules.selector);
        game.executeRules();
        vm.expectRevert(RarePetCare.NotAdmin.selector);
        game.scheduleRules(next);
        vm.prank(BUYER);
        game.scheduleRules(next);
        (, uint256 freshReady,) = game.pendingRules();
        _eq(freshReady, vm.getBlockTimestamp() + DAY);
    }

    function testAdminNomineeReplacementAndCancellationRestartDelay() public {
        vm.expectRevert(RarePetCare.InvalidAdmin.selector);
        game.scheduleAdmin(address(0));
        vm.expectRevert(RarePetCare.InvalidAdmin.selector);
        game.scheduleAdmin(address(this));
        game.scheduleAdmin(BUYER);
        vm.warp(vm.getBlockTimestamp() + 12 hours);
        game.scheduleAdmin(OWNER);
        _eq(game.adminTransferReadyAt(), vm.getBlockTimestamp() + DAY);
        vm.prank(BUYER);
        vm.expectRevert(RarePetCare.InvalidAdmin.selector);
        game.acceptAdmin();
        game.cancelAdminTransfer();
        vm.warp(vm.getBlockTimestamp() + DAY);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidAdmin.selector);
        game.acceptAdmin();
        require(game.admin() == address(this), "cancel changed admin");
    }

    function testIndependentExactCooldownsAndEpochZero() public {
        vm.warp(0);
        _pet();
        _feed();
        _poop();
        _eq(game.actionCount(genesis, 1), 3);
        RarePetCare.Pet memory care = game.getPet(genesis, 1);
        require(care.hasPet && care.hasFed && care.hasPooped, "zero time flags lost");
        _eq(care.lastPetAt, 0);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.ActionNotReady.selector, DAY));
        game.pet(genesis, 1);
        vm.warp(4 hours - 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.ActionNotReady.selector, 4 hours));
        game.feed(genesis, 1);
        vm.warp(4 hours);
        _feed();
        _poop();
        _eq(game.getPet(genesis, 1).strength, 2);
        _eq(game.getPet(genesis, 1).stamina, 10);
        _eq(game.getPet(genesis, 1).health, 2);
        vm.warp(DAY);
        _pet();
        _eq(game.getPet(genesis, 1).streak, 2);
    }

    function testMidnightNeverResetsAnyWindow() public {
        vm.warp(21 * DAY - 1);
        _pet();
        _feed();
        _poop();
        _play(1);
        _play(2);
        _play(3);
        vm.warp(21 * DAY);
        (uint256 remaining, uint256 ready,) = game.actionAvailability(genesis, 1, 0);
        _eq(remaining, 0);
        _eq(ready, 22 * DAY - 1);
        (remaining, ready,) = game.actionAvailability(genesis, 1, 2);
        _eq(remaining, 0);
        _eq(ready, 22 * DAY - 1);
        (remaining, ready,) = game.actionAvailability(genesis, 1, 1);
        _eq(remaining, 0);
        _eq(ready, 21 * DAY + 4 hours - 1);
    }

    function testExactGraceDeadlineThenDecayPersistsOnlyOnce() public {
        _streak(5);
        uint256 deadline = vm.getBlockTimestamp() + 2 * DAY;
        vm.warp(deadline);
        _eq(game.getPet(genesis, 1).streak, 5);
        _eq(game.getPet(genesis, 1).kinship, 5);
        vm.warp(deadline + 1);
        _eq(game.getPet(genesis, 1).kinship, 4);
        _eq(game.getPet(genesis, 1).streak, 0);
        _feed();
        _poop();
        _eq(game.getPet(genesis, 1).kinship, 4);
        _eq(game.getPet(genesis, 1).decayApplied, 1);
        _eq(game.getLifetime(genesis, 1).kinship, 5);
        vm.warp(deadline + DAY);
        _eq(game.getPet(genesis, 1).kinship, 4);
        vm.warp(deadline + DAY + 1);
        _eq(game.getPet(genesis, 1).kinship, 3);
        _pet();
        _eq(game.getPet(genesis, 1).kinship, 4);
        _eq(game.getPet(genesis, 1).streak, 1);
        _eq(game.getLifetime(genesis, 1).kinship, 6);
    }

    function testExactGracePetMaintainsStreak() public {
        _pet();
        vm.warp(vm.getBlockTimestamp() + 2 * DAY);
        _pet();
        _eq(game.getPet(genesis, 1).streak, 2);
    }

    function testLifetimeRarityAndBestStreakNeverReset() public {
        _streak(14);
        _eq(game.getPet(genesis, 1).rarity, 2);
        _eq(game.getLifetime(genesis, 1).rarity, 2);
        _eq(game.getLifetime(genesis, 1).bestStreak, 14);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        _eq(game.getPet(genesis, 1).rarity, 0);
        _eq(game.getPet(genesis, 1).kinship, 0);
        _pet();
        _eq(game.getPet(genesis, 1).streak, 1);
        _eq(game.getLifetime(genesis, 1).rarity, 2);
        _eq(game.getLifetime(genesis, 1).kinship, 15);
        _eq(game.getLifetime(genesis, 1).bestStreak, 14);
    }

    function testPolicyChangeNeverRestatesPastPointsRecordsOrRuleHistory() public {
        _pet();
        _feed();
        _poop();
        _play(1);
        bytes32 firstRecord = keccak256(abi.encode(game.actionRecord(genesis, 1, 1)));
        bytes32 firstRules = keccak256(abi.encode(game.rules(1)));
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[0].points = 9;
        r.actions[1].points = 7;
        r.actions[1].secondaryPoints = 30;
        r.actions[2].points = 300;
        r.actions[3].points = 22;
        _activate(r);
        RarePetCare.Lifetime memory before = game.getLifetime(genesis, 1);
        _eq(before.kinship, 1);
        _eq(before.strength, 1);
        _eq(before.stamina, 5);
        _eq(before.experience, 10);
        _eq(before.health, 1);
        _pet();
        _feed();
        _poop();
        _play(2);
        RarePetCare.Lifetime memory afterCare = game.getLifetime(genesis, 1);
        _eq(afterCare.kinship, 10);
        _eq(afterCare.strength, 8);
        _eq(afterCare.stamina, 35);
        _eq(afterCare.experience, 310);
        _eq(afterCare.health, 23);
        for (uint256 i; i < 4; ++i) {
            _eq(afterCare.actionCounts[i], 2);
        }
        _eq(game.actionCount(genesis, 1), 8);
        require(firstRecord == keccak256(abi.encode(game.actionRecord(genesis, 1, 1))), "record rewritten");
        require(firstRules == keccak256(abi.encode(game.rules(1))), "rule rewritten");
        RarePetCare.CareRecord memory record = game.actionRecord(genesis, 1, 6);
        _eq(record.action, 1);
        _eq(record.ruleVersion, 2);
        _eq(record.points, 7);
        _eq(record.secondaryPoints, 30);
        require(record.owner == OWNER, "wrong record owner");
    }

    function testPreviousCooldownAndBondRemainSnapshotAcrossPolicyChange() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.petGrace = 0;
        r.decayInterval = 1;
        r.decayPoints = 1_000_000;
        game.scheduleRules(r);
        (, uint256 activateAt,) = game.pendingRules();
        vm.warp(activateAt - 1);
        _pet();
        uint256 originalPetAt = vm.getBlockTimestamp();
        vm.warp(activateAt);
        game.executeRules();
        RarePetCare.BondSchedule memory schedule = game.getPetSchedule(genesis, 1);
        _eq(schedule.nextAvailableAt, originalPetAt + DAY);
        _eq(schedule.graceDeadline, originalPetAt + 2 * DAY);
        _eq(schedule.decayInterval, DAY);
        _eq(schedule.decayPoints, 1);
        (uint256 remaining, uint256 ready,) = game.actionAvailability(genesis, 1, 0);
        _eq(remaining, 0);
        _eq(ready, originalPetAt + DAY);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.ActionNotReady.selector, originalPetAt + DAY));
        game.pet(genesis, 1);
        vm.warp(originalPetAt + DAY);
        _pet();
        schedule = game.getPetSchedule(genesis, 1);
        _eq(schedule.graceDeadline, vm.getBlockTimestamp() + DAY);
        _eq(schedule.decayInterval, 1);
        _eq(schedule.decayPoints, 1_000_000);
        vm.warp(vm.getBlockTimestamp() + DAY + 1);
        _eq(game.getPet(genesis, 1).kinship, 0);
        _eq(game.getLifetime(genesis, 1).kinship, 2);
    }

    function testLongerNewCooldownDoesNotExtendExistingCooldown() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[1].cooldown = 30 days;
        game.scheduleRules(r);
        (, uint256 activateAt,) = game.pendingRules();
        vm.warp(activateAt - 1);
        _feed();
        uint256 first = vm.getBlockTimestamp();
        vm.warp(activateAt);
        game.executeRules();
        (, uint256 ready,) = game.actionAvailability(genesis, 1, 1);
        _eq(ready, first + 4 hours);
        vm.warp(ready);
        _feed();
        (, ready,) = game.actionAvailability(genesis, 1, 1);
        _eq(ready, vm.getBlockTimestamp() + 30 days);
    }

    function testSavedRarityMilestoneHonoredThenNewPolicyStartsNextMilestone() public {
        _streak(5);
        RarePetCare.RuleSet memory r = game.currentRules();
        r.rarityEvery = 2;
        r.rarityPoints = 10;
        _activate(r);
        _pet(); // Sixth pet uses version two but the original seven-step milestone remains.
        _eq(game.getPetSchedule(genesis, 1).nextRarityAt, 7);
        _eq(game.getPetSchedule(genesis, 1).nextRarityPoints, 1);
        vm.warp(vm.getBlockTimestamp() + DAY);
        _pet();
        _eq(game.getPet(genesis, 1).rarity, 1);
        _eq(game.actionRecord(genesis, 1, 7).rarityPoints, 1);
        _eq(game.getPetSchedule(genesis, 1).nextRarityAt, 9);
        _eq(game.getPetSchedule(genesis, 1).nextRarityPoints, 10);
        vm.warp(vm.getBlockTimestamp() + DAY);
        _pet();
        _eq(game.getPet(genesis, 1).rarity, 1);
        vm.warp(vm.getBlockTimestamp() + DAY);
        _pet();
        _eq(game.getPet(genesis, 1).rarity, 11);
        _eq(game.getLifetime(genesis, 1).rarity, 11);
        _eq(game.actionRecord(genesis, 1, 9).rarityPoints, 10);
    }

    function testBrokenStreakStartsNewRarityPolicyWithoutRestatingEarnedTotal() public {
        _streak(7);
        RarePetCare.RuleSet memory r = game.currentRules();
        r.rarityEvery = 1;
        r.rarityPoints = 9;
        _activate(r);
        vm.warp(vm.getBlockTimestamp() + 2 * DAY);
        _eq(game.getPetSchedule(genesis, 1).nextRarityAt, 0);
        _pet();
        _eq(game.getPet(genesis, 1).rarity, 9);
        _eq(game.getLifetime(genesis, 1).rarity, 10);
        _eq(game.getLifetime(genesis, 1).bestStreak, 7);
    }

    function testPlayRollingSlotsExpireIndividuallyAndFailedClaimDoesNotConsumeRun() public {
        uint256 first = vm.getBlockTimestamp();
        _play(1);
        vm.warp(first + 3600);
        _play(2);
        vm.warp(first + 7200);
        _play(3);
        vm.warp(first + DAY - 1);
        bytes memory signature = _signature(
            game,
            OWNER,
            genesis,
            1,
            bytes32(uint256(4)),
            vm.getBlockTimestamp(),
            game.currentRuleVersion(),
            SIGNER_KEY
        );
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.ActionNotReady.selector, first + DAY));
        game.play(genesis, 1, bytes32(uint256(4)), vm.getBlockTimestamp(), signature);
        require(!game.usedRuns(bytes32(uint256(4))), "failed run consumed");
        _eq(game.actionCount(genesis, 1), 3);
        vm.warp(first + DAY);
        _eq(game.getPet(genesis, 1).playCount, 2);
        _play(4);
        RarePetCare.Pet memory care = game.getPet(genesis, 1);
        _eq(care.playCount, 3);
        _eq(care.playTimes[0], first + 3600);
        _eq(care.playTimes[2], first + DAY);
        _eq(care.experience, 40);
    }

    function testThirtyTwoSameSecondActionsThenRingWrapWithoutQuotaBypass() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[1].dailyLimit = 32;
        r.actions[1].cooldown = 0;
        _activate(r);
        uint256 first = vm.getBlockTimestamp();
        for (uint256 i; i < 32; ++i) {
            _feed();
        }
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.ActionNotReady.selector, first + DAY));
        game.feed(genesis, 1);
        _eq(game.getLifetime(genesis, 1).actionCounts[1], 32);
        vm.warp(first + DAY);
        for (uint256 i; i < 32; ++i) {
            _feed();
        }
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.ActionNotReady.selector, first + 2 * DAY));
        game.feed(genesis, 1);
        _eq(game.actionCount(genesis, 1), 64);
        _eq(game.actionRecord(genesis, 1, 1).timestamp, first);
        _eq(game.actionRecord(genesis, 1, 64).timestamp, first + DAY);
    }

    function testReducedCapIncludesEveryRetainedRecentAction() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[2].dailyLimit = 32;
        _activate(r);
        r.actions[2].dailyLimit = 1;
        game.scheduleRules(r);
        (, uint256 at,) = game.pendingRules();
        vm.warp(at - 3);
        _play(1);
        vm.warp(at - 2);
        _play(2);
        vm.warp(at - 1);
        _play(3);
        vm.warp(at);
        game.executeRules();
        (uint256 remaining, uint256 ready,) = game.actionAvailability(genesis, 1, 2);
        _eq(remaining, 0);
        _eq(ready, at - 1 + DAY);
        vm.warp(at - 3 + DAY);
        (remaining, ready,) = game.actionAvailability(genesis, 1, 2);
        _eq(remaining, 0);
        _eq(ready, at - 1 + DAY);
        vm.warp(ready);
        _play(4);
        _eq(game.getPet(genesis, 1).playCount, 1);
        _eq(game.getLifetime(genesis, 1).experience, 40);
    }

    function testIncreasedCapKeepsExistingHistoryAndSavedCooldown() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[1].dailyLimit = 32;
        r.actions[1].cooldown = 0;
        game.scheduleRules(r);
        (, uint256 at,) = game.pendingRules();
        vm.warp(at - 1);
        _feed();
        vm.warp(at);
        game.executeRules();
        (uint256 remaining, uint256 ready,) = game.actionAvailability(genesis, 1, 1);
        _eq(remaining, 0);
        _eq(ready, at - 1 + 4 hours);
        vm.warp(ready);
        (remaining,,) = game.actionAvailability(genesis, 1, 1);
        _eq(remaining, 31);
        for (uint256 i; i < 31; ++i) {
            _feed();
        }
        (remaining, ready,) = game.actionAvailability(genesis, 1, 1);
        _eq(remaining, 0);
        _eq(ready, at - 1 + DAY);
    }

    function testRingWrapWithStaggeredEntriesUsesOldestUnexpiredAction() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[1].dailyLimit = 32;
        r.actions[1].cooldown = 0;
        _activate(r);
        uint256 first = vm.getBlockTimestamp();
        for (uint256 i; i < 32; ++i) {
            vm.warp(first + i);
            _feed();
        }
        vm.warp(first + DAY);
        _feed();
        (uint256 remaining, uint256 ready,) = game.actionAvailability(genesis, 1, 1);
        _eq(remaining, 0);
        _eq(ready, first + DAY + 1);
        vm.warp(ready);
        _feed();
        (remaining, ready,) = game.actionAvailability(genesis, 1, 1);
        _eq(remaining, 0);
        _eq(ready, first + DAY + 2);
        _eq(game.actionCount(genesis, 1), 34);
    }

    function testDisabledActionDoesNotConsumeQuotaOrPointsAndPreservesTimer() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[1].cooldown = 30 days;
        _activate(r);
        _feed();
        uint256 originalReady = vm.getBlockTimestamp() + 30 days;
        r.actions[1].enabled = false;
        _activate(r);
        (uint256 remaining, uint256 ready, bool enabled) = game.actionAvailability(genesis, 1, 1);
        require(!enabled, "disabled action marked enabled");
        _eq(remaining, 0);
        _eq(ready, originalReady);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.ActionDisabled.selector);
        game.feed(genesis, 1);
        _eq(game.actionCount(genesis, 1), 1);
        r.actions[1].enabled = true;
        r.actions[1].cooldown = 0;
        _activate(r);
        (remaining, ready, enabled) = game.actionAvailability(genesis, 1, 1);
        require(enabled, "reenabled action disabled");
        _eq(remaining, 0);
        _eq(ready, originalReady);
    }

    function testTransferKeepsTotalsHistoryAndRejectsPreviousOwner() public {
        _pet();
        _feed();
        _play(1);
        bytes32 priorRecord = keccak256(abi.encode(game.actionRecord(genesis, 1, 1)));
        CareMockCollection(genesis).setOwner(1, BUYER);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.pet(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.feed(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.poop(genesis, 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.play(genesis, 1, bytes32(0), vm.getBlockTimestamp(), "");
        vm.prank(BUYER);
        game.poop(genesis, 1);
        _eq(game.getLifetime(genesis, 1).kinship, 1);
        _eq(game.getLifetime(genesis, 1).experience, 10);
        (uint256 remaining,,) = game.actionAvailability(genesis, 1, 0);
        _eq(remaining, 0);
        (remaining,,) = game.actionAvailability(genesis, 1, 2);
        _eq(remaining, 2);
        require(
            priorRecord == keccak256(abi.encode(game.actionRecord(genesis, 1, 1))), "transfer rewrote history"
        );
        require(game.actionRecord(genesis, 1, 4).owner == BUYER, "new owner record wrong");
    }

    function testCollectionAndTokenIsolation() public {
        _pet();
        _feed();
        vm.prank(OWNER);
        game.poop(generations, 1);
        vm.prank(OWNER);
        game.feed(genesis, 2);
        _eq(game.getLifetime(genesis, 1).health, 0);
        _eq(game.getLifetime(generations, 1).kinship, 0);
        _eq(game.getLifetime(genesis, 2).kinship, 0);
        _eq(game.actionCount(genesis, 1), 2);
        _eq(game.actionCount(generations, 1), 1);
        _eq(game.actionCount(genesis, 2), 1);
    }

    function testZeroSignerDisablesPlayAndCanOnlyBeEnabledAfterDelay() public {
        RarePetCare disabled = new RarePetCare(address(this), address(0));
        (uint256 remaining,, bool enabled) = disabled.actionAvailability(genesis, 1, 2);
        _eq(remaining, 0);
        require(!enabled, "zero signer enabled");
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.PlayDisabled.selector);
        disabled.play(genesis, 1, bytes32(0), vm.getBlockTimestamp(), "");
        RarePetCare.RuleSet memory r = disabled.currentRules();
        r.playSigner = vm.addr(SIGNER_KEY);
        disabled.scheduleRules(r);
        vm.warp(vm.getBlockTimestamp() + DAY);
        disabled.executeRules();
        bytes memory sig = _signature(
            disabled, OWNER, genesis, 1, bytes32(uint256(1)), vm.getBlockTimestamp(), 2, SIGNER_KEY
        );
        vm.prank(OWNER);
        disabled.play(genesis, 1, bytes32(uint256(1)), vm.getBlockTimestamp(), sig);
        _eq(disabled.getLifetime(genesis, 1).experience, 10);
    }

    function testPlayReceiptVersionInvalidatesAcrossRotationAndSignerRestoration() public {
        uint256 deadline = vm.getBlockTimestamp() + 10 * DAY;
        bytes32 run = bytes32(uint256(7));
        bytes memory old = _signature(game, OWNER, genesis, 1, run, deadline, 1, SIGNER_KEY);
        RarePetCare.RuleSet memory r = game.currentRules();
        r.playSigner = vm.addr(SECOND_SIGNER_KEY);
        _activate(r);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 1, run, deadline, old);
        r.playSigner = vm.addr(SIGNER_KEY);
        _activate(r);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 1, run, deadline, old);
        bytes memory fresh = _signature(game, OWNER, genesis, 1, run, deadline, 3, SIGNER_KEY);
        vm.prank(OWNER);
        game.play(genesis, 1, run, deadline, fresh);
        require(game.usedRuns(run), "fresh receipt failed");
    }

    function testAnyPolicyChangeRequiresFreshPlayReceiptEvenWithSameSigner() public {
        uint256 deadline = vm.getBlockTimestamp() + 3 * DAY;
        bytes memory old = _signature(game, OWNER, genesis, 1, bytes32(uint256(1)), deadline, 1, SIGNER_KEY);
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[2].points = 1_000_000;
        _activate(r);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 1, bytes32(uint256(1)), deadline, old);
        _eq(game.getLifetime(genesis, 1).experience, 0);
    }

    function testRunsCannotReplayAcrossVersionsTokensCollectionsOrOwners() public {
        _play(42);
        RarePetCare.RuleSet memory r = game.currentRules();
        _activate(r);
        bytes32 run = bytes32(uint256(42));
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.RunAlreadyUsed.selector);
        game.play(genesis, 1, run, vm.getBlockTimestamp(), "");
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.RunAlreadyUsed.selector);
        game.play(genesis, 2, run, vm.getBlockTimestamp(), "");
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.RunAlreadyUsed.selector);
        game.play(generations, 1, run, vm.getBlockTimestamp(), "");
        CareMockCollection(genesis).setOwner(1, BUYER);
        vm.prank(BUYER);
        vm.expectRevert(RarePetCare.RunAlreadyUsed.selector);
        game.play(genesis, 1, run, vm.getBlockTimestamp(), "");
        _eq(game.getLifetime(genesis, 1).experience, 10);
    }

    function testReceiptBindsEveryFieldAndDeployment() public {
        bytes32 run = bytes32(uint256(7));
        uint256 deadline = vm.getBlockTimestamp() + DAY;
        bytes memory sig = _signature(game, OWNER, genesis, 1, run, deadline, 1, SIGNER_KEY);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(generations, 1, run, deadline, sig);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 2, run, deadline, sig);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 1, bytes32(uint256(8)), deadline, sig);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 1, run, deadline + 1, sig);
        RarePetCare other = new RarePetCare(address(this), vm.addr(SIGNER_KEY));
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        other.play(genesis, 1, run, deadline, sig);
        CareMockCollection(genesis).setOwner(1, BUYER);
        vm.prank(BUYER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 1, run, deadline, sig);
    }

    function testExpiryMalformedAndMalleableSignaturesRejected() public {
        uint256 deadline = vm.getBlockTimestamp();
        bytes32 run = bytes32(uint256(1));
        bytes memory sig = _signature(game, OWNER, genesis, 1, run, deadline, 1, SIGNER_KEY);
        vm.warp(deadline + 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.ExpiredPlay.selector);
        game.play(genesis, 1, run, deadline, sig);
        deadline = vm.getBlockTimestamp();
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 1, run, deadline, "");
        bytes32 digest = game.playDigest(OWNER, genesis, 1, run, deadline, 1);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        uint256 curveN = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(
            genesis,
            1,
            run,
            deadline,
            abi.encodePacked(rr, bytes32(curveN - uint256(s)), v == 27 ? uint8(28) : uint8(27))
        );
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidSignature.selector);
        game.play(genesis, 1, run, deadline, abi.encodePacked(rr, s, uint8(1)));
        _play(1); // Exact deadline is accepted with a fresh valid signature.
    }

    function testWrongChainBlocksWritesAndChangesPlayDomain() public {
        bytes32 original = game.playDigest(OWNER, genesis, 1, bytes32(0), vm.getBlockTimestamp(), 1);
        vm.chainId(4664);
        require(
            original != game.playDigest(OWNER, genesis, 1, bytes32(0), vm.getBlockTimestamp(), 1),
            "domain omitted chain"
        );
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.WrongChain.selector);
        game.pet(genesis, 1);
        vm.expectRevert(RarePetCare.WrongChain.selector);
        game.executeRules();
    }

    function testNoAdministrativePointSetterProxyOrPayableEntrypoint() public {
        _pet();
        (bool ok,) = address(game)
            .call(abi.encodeWithSignature("setPoints(address,uint256,uint256)", genesis, 1, 100000));
        require(!ok, "point setter exists");
        (ok,) = address(game).call(abi.encodeWithSignature("upgradeTo(address)", address(this)));
        require(!ok, "upgrade exists");
        vm.deal(address(this), 1 ether);
        (ok,) = address(game).call{value: 1}(abi.encodeWithSignature("pet(address,uint256)", genesis, 1));
        require(!ok, "care accepted ETH");
        (ok,) = address(game).call{value: 1}("");
        require(!ok, "receive accepted ETH");
        _eq(game.getLifetime(genesis, 1).kinship, 1);
    }

    function testExpectedVersionEntrypointsRejectPolicyChangesBeforeInclusion() public {
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[0].points = 8;
        _activate(r);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidRuleVersion.selector);
        game.pet(genesis, 1, 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidRuleVersion.selector);
        game.feed(genesis, 1, 1);
        vm.prank(OWNER);
        vm.expectRevert(RarePetCare.InvalidRuleVersion.selector);
        game.poop(genesis, 1, 1);
        _eq(game.actionCount(genesis, 1), 0);
        _eq(game.getLifetime(genesis, 1).kinship, 0);
        vm.prank(OWNER);
        game.pet(genesis, 1, 2);
        vm.prank(OWNER);
        game.feed(genesis, 1, 2);
        vm.prank(OWNER);
        game.poop(genesis, 1, 2);
        _eq(game.actionCount(genesis, 1), 3);
        _eq(game.getLifetime(genesis, 1).kinship, 8);
        _eq(game.actionRecord(genesis, 1, 1).ruleVersion, 2);
        vm.prank(BUYER);
        vm.expectRevert(RarePetCare.NotOwner.selector);
        game.pet(genesis, 1, 2);
    }

    function testFuzzDecayNeverReducesLifetimeOrAppliesTwice(uint32 absence) public {
        _streak(7);
        uint256 last = vm.getBlockTimestamp();
        vm.warp(last + uint256(absence));
        uint256 missed = absence > 2 * DAY ? (uint256(absence) - 2 * DAY - 1) / DAY + 1 : 0;
        uint256 expected = missed >= 7 ? 0 : 7 - missed;
        _eq(game.getPet(genesis, 1).kinship, expected);
        _feed();
        _poop();
        _eq(game.getPet(genesis, 1).kinship, expected);
        _eq(game.getLifetime(genesis, 1).kinship, 7);
        _eq(game.getLifetime(genesis, 1).rarity, 1);
        _eq(game.getLifetime(genesis, 1).bestStreak, 7);
    }

    function testFuzzRollingCapNeverAdmitsAnExtraAction(uint8 capSeed) public {
        uint8 cap = uint8(uint256(capSeed) % 32 + 1);
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[3].cooldown = 0;
        r.actions[3].dailyLimit = cap;
        _activate(r);
        uint256 first = vm.getBlockTimestamp();
        for (uint256 i; i < cap; ++i) {
            _poop();
        }
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(RarePetCare.ActionNotReady.selector, first + DAY));
        game.poop(genesis, 1);
        _eq(game.getLifetime(genesis, 1).actionCounts[3], cap);
        vm.warp(first + DAY - 1);
        (uint256 remaining,,) = game.actionAvailability(genesis, 1, 3);
        _eq(remaining, 0);
        vm.warp(first + DAY);
        (remaining,,) = game.actionAvailability(genesis, 1, 3);
        _eq(remaining, cap);
        _poop();
        _eq(game.getLifetime(genesis, 1).health, uint256(cap) + 1);
    }

    function testFuzzFutureRewardAmountsNeverRecomputeOldAwards(uint32 pointsSeed, uint32 staminaSeed)
        public
    {
        _feed();
        RarePetCare.RuleSet memory r = game.currentRules();
        r.actions[1].points = pointsSeed % 1_000_001;
        r.actions[1].secondaryPoints = staminaSeed % 1_000_001;
        _activate(r);
        _feed();
        RarePetCare.Lifetime memory lifetime = game.getLifetime(genesis, 1);
        _eq(lifetime.strength, 1 + uint256(r.actions[1].points));
        _eq(lifetime.stamina, 5 + uint256(r.actions[1].secondaryPoints));
        _eq(game.actionRecord(genesis, 1, 1).points, 1);
        _eq(game.actionRecord(genesis, 1, 1).secondaryPoints, 5);
        _eq(game.actionRecord(genesis, 1, 2).ruleVersion, 2);
    }

    function _badRules(RarePetCare.RuleSet memory r) private {
        vm.expectRevert(RarePetCare.InvalidRules.selector);
        game.scheduleRules(r);
    }

    function _activate(RarePetCare.RuleSet memory r) private {
        game.scheduleRules(r);
        vm.warp(vm.getBlockTimestamp() + DAY);
        game.executeRules();
    }

    function _pet() private {
        vm.prank(OWNER);
        game.pet(genesis, 1);
    }

    function _feed() private {
        vm.prank(OWNER);
        game.feed(genesis, 1);
    }

    function _poop() private {
        vm.prank(OWNER);
        game.poop(genesis, 1);
    }

    function _streak(uint256 count) private {
        for (uint256 i; i < count; ++i) {
            if (i > 0) vm.warp(vm.getBlockTimestamp() + DAY);
            _pet();
        }
    }

    function _play(uint256 run) private {
        bytes memory sig = _signature(
            game,
            OWNER,
            genesis,
            1,
            bytes32(run),
            vm.getBlockTimestamp(),
            game.currentRuleVersion(),
            SIGNER_KEY
        );
        vm.prank(OWNER);
        game.play(genesis, 1, bytes32(run), vm.getBlockTimestamp(), sig);
    }

    function _signature(
        RarePetCare target,
        address owner,
        address collection,
        uint256 id,
        bytes32 run,
        uint256 deadline,
        uint256 version,
        uint256 key
    ) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, target.playDigest(owner, collection, id, run, deadline, version));
        return abi.encodePacked(r, s, v);
    }

    function _eq(uint256 a, uint256 b) private pure {
        require(a == b, "assertion failed");
    }
}
