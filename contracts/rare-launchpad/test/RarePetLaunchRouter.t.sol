// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    RarePetLaunchRouter,
    Curve,
    Beneficiary,
    VestingSchedule,
    DopplerInit,
    CreateParams,
    AssetData
} from "../src/RarePetLaunchRouter.sol";

interface Vm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
}

contract MockCollection {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public tokenBoundAccount;

    function set(uint256 id, address owner, address account) external {
        ownerOf[id] = owner;
        tokenBoundAccount[id] = account;
    }

    function transfer(uint256 id, address owner) external {
        ownerOf[id] = owner;
    }
}

contract MockFriend {
    uint256 public boundChain;
    address public collection;
    uint256 public id;

    constructor(uint256 chain, address collection_, uint256 id_) {
        boundChain = chain;
        collection = collection_;
        id = id_;
    }

    function token() external view returns (uint256, address, uint256) {
        return (boundChain, collection, id);
    }

    function owner() public view returns (address) {
        return MockCollection(collection).ownerOf(id);
    }

    function execute(RarePetLaunchRouter router, RarePetLaunchRouter.LaunchRequest memory request)
        external
        returns (address)
    {
        require(msg.sender == owner(), "not account owner");
        return router.launch(request);
    }
}

contract MockToken {
    uint256 public totalSupply;

    constructor(uint256 supply) {
        totalSupply = supply;
    }
}

contract MockInitializer {
    mapping(address => Beneficiary[]) private _beneficiaries;

    function set(address asset, Beneficiary[] memory values) external {
        delete _beneficiaries[asset];
        for (uint256 i; i < values.length; ++i) {
            _beneficiaries[asset].push(values[i]);
        }
    }

    function getBeneficiaries(address asset) external view returns (Beneficiary[] memory) {
        return _beneficiaries[asset];
    }
}

contract MockAirlock {
    address public owner;
    mapping(address => uint8) public getModuleState;
    mapping(address => AssetData) private _assets;
    bytes public lastParams;
    uint256 public failure;
    address public priorAsset;
    address public callbackTarget;
    bytes public callbackData;

    function configure(address protocol, address factory, address governance, address initializer, address migrator)
        external
    {
        owner = protocol;
        getModuleState[factory] = 1;
        getModuleState[governance] = 2;
        getModuleState[initializer] = 3;
        getModuleState[migrator] = 4;
    }

    function setFailure(uint256 mode) external {
        failure = mode;
    }

    function setModule(address module, uint8 state) external {
        getModuleState[module] = state;
    }

    function setCallback(address target, bytes memory data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function getAssetData(address asset) external view returns (AssetData memory) {
        return _assets[asset];
    }

    function create(CreateParams calldata p)
        external
        returns (address asset, address pool, address governance, address timelock, address migrationPool)
    {
        require(failure != 1, "airlock failure");
        lastParams = abi.encode(p);
        asset = failure == 9 ? priorAsset : address(new MockToken(failure == 2 ? p.initialSupply - 1 : p.initialSupply));
        pool = failure == 5 ? address(0x111) : asset;
        governance = address(0xdead);
        timelock = address(0xdead);
        migrationPool = 0xdeaDDeADDEaDdeaDdEAddEADDEAdDeadDEADDEaD;
        _assets[asset] = AssetData(
            failure == 3 ? address(0x333) : p.numeraire,
            timelock,
            failure == 6 ? address(0x666) : governance,
            p.liquidityMigrator,
            p.poolInitializer,
            pool,
            failure == 7 ? address(0x777) : migrationPool,
            p.numTokensToSell,
            p.initialSupply,
            p.integrator
        );
        DopplerInit memory init = abi.decode(p.poolInitializerData, (DopplerInit));
        if (failure == 4) init.beneficiaries[0].shares += 1;
        if (failure == 8) init.beneficiaries[0].beneficiary = address(0x888);
        MockInitializer(p.poolInitializer).set(asset, init.beneficiaries);
        priorAsset = asset;
        if (callbackTarget != address(0)) {
            (bool ok, bytes memory reason) = callbackTarget.call(callbackData);
            if (!ok) assembly { revert(add(reason, 32), mload(reason)) }
        }
    }
}

contract RarePetLaunchRouterTest {
    struct TokenConfig {
        string name;
        string symbol;
        VestingSchedule[] schedules;
        address[] receivers;
        uint256[] scheduleIds;
        uint256[] amounts;
        string uri;
        uint256 maxBalance;
        uint48 balanceEnd;
        address controller;
        address[] exclusions;
    }
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant SUPPLY = 1e27;
    uint256 constant DAY = 86400;
    address constant GENESIS = 0x116EaA62241751E0c98dA43d458600c6C17cD361;
    address constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    address constant AIRLOCK = 0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862;
    address constant FACTORY = 0x1B37D3a72082029c44B35B604Ea473617580b69a;
    address constant INITIALIZER = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
    address constant GOVERNANCE = 0x85f37f74Ef2478A770318bc810177a9835911aD7;
    address constant MIGRATOR = 0xba2F330EDb16cD8056f5988d8CE19BbC63475A0e;
    address constant QUOTE = address(0x600);
    address constant TREASURY = address(0x900);
    address constant PROTOCOL = address(0x100);
    address constant OWNER = address(0xCAFE);
    address constant BUYER = address(0xBEEF);
    RarePetLaunchRouter router;
    MockFriend friend;
    MockFriend second;
    MockAirlock lock;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(100 * DAY);
        vm.etch(GENESIS, address(new MockCollection()).code);
        vm.etch(GENERATIONS, address(new MockCollection()).code);
        vm.etch(AIRLOCK, address(new MockAirlock()).code);
        vm.etch(INITIALIZER, address(new MockInitializer()).code);
        vm.etch(FACTORY, hex"00");
        vm.etch(GOVERNANCE, hex"00");
        vm.etch(MIGRATOR, hex"00");
        vm.etch(QUOTE, hex"00");
        lock = MockAirlock(AIRLOCK);
        lock.configure(PROTOCOL, FACTORY, GOVERNANCE, INITIALIZER, MIGRATOR);
        router = new RarePetLaunchRouter(TREASURY, SUPPLY, 8500, _quotes());
        friend = new MockFriend(4663, GENESIS, 0);
        second = new MockFriend(4663, GENERATIONS, 42);
        MockCollection(GENESIS).set(0, OWNER, address(friend));
        MockCollection(GENERATIONS).set(42, OWNER, address(second));
    }

    function testFullIssuerCatalogStoresEveryQuoteAndRejectsExtras() public {
        address[] memory quotes = new address[](196);
        for (uint256 i; i < quotes.length; ++i) {
            quotes[i] = address(uint160(0x10000 + i));
            vm.etch(quotes[i], hex"00");
        }
        RarePetLaunchRouter catalogRouter = new RarePetLaunchRouter(TREASURY, SUPPLY, 8500, quotes);
        address[] memory stored = catalogRouter.quoteTokens();
        require(stored.length == quotes.length, "catalog truncated");
        for (uint256 i; i < quotes.length; ++i) {
            require(stored[i] == quotes[i] && catalogRouter.allowedQuote(quotes[i]), "quote missing");
        }
        require(!catalogRouter.allowedQuote(QUOTE), "unlisted quote allowed");
        RarePetLaunchRouter.LaunchRequest memory request = _request();
        request.quote = quotes[quotes.length - 1];
        vm.prank(OWNER);
        require(catalogRouter.launchAsSelf(request) != address(0), "last quote cannot launch");
        request.quote = QUOTE;
        vm.prank(OWNER);
        vm.expectRevert(RarePetLaunchRouter.InvalidLaunch.selector);
        catalogRouter.launchAsSelf(request);
    }

    function testQuoteCatalogBoundsAndDuplicatesFailClosed() public {
        address[] memory tooMany = new address[](257);
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        new RarePetLaunchRouter(TREASURY, SUPPLY, 8500, tooMany);
        address[] memory duplicate = new address[](196);
        for (uint256 i; i < duplicate.length; ++i) {
            duplicate[i] = QUOTE;
        }
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        new RarePetLaunchRouter(TREASURY, SUPPLY, 8500, duplicate);
    }

    function _quotes() private pure returns (address[] memory quotes) {
        quotes = new address[](1);
        quotes[0] = QUOTE;
    }

    function _request() private pure returns (RarePetLaunchRouter.LaunchRequest memory r) {
        Curve[] memory curves = new Curve[](1);
        curves[0] = Curve(-10000, 10000, 20, 1e18);
        r = RarePetLaunchRouter.LaunchRequest(
            "Rare Friend",
            "RARE1",
            "data:application/json;base64,e30=",
            QUOTE,
            10000,
            curves,
            9800,
            bytes32(uint256(42))
        );
    }

    function _launch(MockFriend account) private returns (address) {
        vm.prank(OWNER);
        return account.execute(router, _request());
    }

    function _invalid(RarePetLaunchRouter.LaunchRequest memory request) private {
        vm.prank(address(friend));
        vm.expectRevert(RarePetLaunchRouter.InvalidLaunch.selector);
        router.launch(request);
    }

    function _noCredit() private view {
        require(
            router.getLaunch(GENESIS, 0).brain == 0 && !router.getLaunch(GENESIS, 0).hasLaunched,
            "credited failed launch"
        );
    }

    function testLaunchCreditsBrainOnlyAfterVerifiedCreationAndKeepsTokenIdZero() public {
        address asset = _launch(friend);
        RarePetLaunchRouter.LaunchState memory state = router.getLaunch(GENESIS, 0);
        require(
            state.brain == 1 && state.lastLaunchAt == block.timestamp && state.hasLaunched
                && router.launchedAsset(asset),
            "missing receipt"
        );
    }

    function testCooldownExact24HoursAndIndependentNFTs() public {
        _launch(friend);
        _launch(second);
        uint256 first = block.timestamp;
        vm.warp(first + DAY - 1);
        vm.prank(address(friend));
        vm.expectRevert(abi.encodeWithSelector(RarePetLaunchRouter.ActionNotReady.selector, first + DAY));
        router.launch(_request());
        vm.warp(first + DAY);
        _launch(friend);
        require(router.getLaunch(GENESIS, 0).brain == 2, "boundary rejected");
    }

    function testEpochZeroIsNotUninitialized() public {
        vm.warp(0);
        _launch(friend);
        vm.prank(address(friend));
        vm.expectRevert(abi.encodeWithSelector(RarePetLaunchRouter.ActionNotReady.selector, DAY));
        router.launch(_request());
    }

    function testTransferPreservesNFTBrainAndCooldown() public {
        _launch(friend);
        uint256 ready = block.timestamp + DAY;
        MockCollection(GENESIS).transfer(0, BUYER);
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(RarePetLaunchRouter.ActionNotReady.selector, ready));
        friend.execute(router, _request());
        vm.warp(ready);
        vm.prank(BUYER);
        friend.execute(router, _request());
        require(router.getLaunch(GENESIS, 0).brain == 2, "transfer lost brain");
    }

    function testOwnerCannotSkipCanonicalWalletAndImpersonatorCannotBind() public {
        vm.prank(OWNER);
        vm.expectRevert(RarePetLaunchRouter.InvalidFriend.selector);
        router.launch(_request());
        MockFriend impostor = new MockFriend(4663, GENESIS, 0);
        vm.prank(address(impostor));
        vm.expectRevert(RarePetLaunchRouter.InvalidFriend.selector);
        router.launch(_request());
        _noCredit();
    }

    function testWrongBoundChainAndCollectionFail() public {
        MockFriend wrong = new MockFriend(1, GENESIS, 0);
        MockCollection(GENESIS).set(0, OWNER, address(wrong));
        vm.prank(address(wrong));
        vm.expectRevert(RarePetLaunchRouter.InvalidFriend.selector);
        router.launch(_request());
        wrong = new MockFriend(4663, address(0x999), 0);
        vm.prank(address(wrong));
        vm.expectRevert(RarePetLaunchRouter.InvalidFriend.selector);
        router.launch(_request());
    }

    function testTransferredOldOwnerCannotExecute() public {
        MockCollection(GENESIS).transfer(0, BUYER);
        vm.prank(OWNER);
        vm.expectRevert(bytes("not account owner"));
        friend.execute(router, _request());
        _noCredit();
    }

    function test100PercentPoolNoInsiderAllocationNoHooksAndPinnedModules() public {
        _launch(friend);
        CreateParams memory p = abi.decode(lock.lastParams(), (CreateParams));
        require(p.initialSupply == SUPPLY && p.numTokensToSell == SUPPLY, "not full supply");
        require(
            p.tokenFactory == FACTORY && p.poolInitializer == INITIALIZER && p.governanceFactory == GOVERNANCE
                && p.liquidityMigrator == MIGRATOR,
            "wrong module"
        );
        require(
            p.governanceFactoryData.length == 0 && p.liquidityMigratorData.length == 0 && p.integrator == TREASURY,
            "opaque configuration"
        );
        // Factory data is eleven top-level values; prefix its struct offset to inspect without stack-heavy locals.
        TokenConfig memory token = abi.decode(abi.encodePacked(uint256(32), p.tokenFactoryData), (TokenConfig));
        require(
            keccak256(bytes(token.name)) == keccak256("Rare Friend")
                && keccak256(bytes(token.symbol)) == keccak256("RARE1") && bytes(token.uri).length > 0,
            "metadata lost"
        );
        require(
            token.schedules.length == 0 && token.receivers.length == 0 && token.scheduleIds.length == 0
                && token.amounts.length == 0 && token.exclusions.length == 0,
            "allocation present"
        );
        require(
            token.maxBalance == 0 && token.balanceEnd == 0 && token.controller == address(0),
            "token restrictions present"
        );
        DopplerInit memory init = abi.decode(p.poolInitializerData, (DopplerInit));
        require(
            init.dopplerHook == address(0) && init.onInitializationDopplerHookCalldata.length == 0
                && init.graduationDopplerHookCalldata.length == 0,
            "custom hook present"
        );
        require(init.fee == 10000 && init.tickSpacing == 200 && init.beneficiaries.length == 3, "pool policy mismatch");
        require(
            p.salt
                == keccak256(
                    abi.encode(
                        uint256(4663),
                        address(router),
                        address(friend),
                        GENESIS,
                        uint256(0),
                        uint256(1),
                        _request().salt
                    )
                ),
            "wrong salt namespace"
        );
    }

    function testConfirmed85Creator10Treasury5ProtocolPolicyIsSorted() public {
        _checkFees(router, 0.85e18, 0.1e18);
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        new RarePetLaunchRouter(TREASURY, SUPPLY, 8550, _quotes());
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        new RarePetLaunchRouter(TREASURY, SUPPLY, 9000, _quotes());
    }

    function _checkFees(RarePetLaunchRouter target, uint96 friendShare, uint96 treasuryShare) private view {
        Beneficiary[] memory b = target.feeBeneficiaries(address(friend));
        uint256 total;
        for (uint256 i; i < b.length; ++i) {
            total += b[i].shares;
            if (i > 0) require(b[i].beneficiary > b[i - 1].beneficiary, "unsorted");
            require(
                b[i].shares
                    == (b[i].beneficiary == address(friend)
                            ? friendShare
                            : b[i].beneficiary == TREASURY ? treasuryShare : 0.05e18),
                "fee policy changed"
            );
        }
        require(total == 1e18, "invalid fee total");
    }

    function testQuoteFeeMetadataAndTickerValidation() public {
        RarePetLaunchRouter.LaunchRequest memory r = _request();
        r.quote = address(0xBAD);
        _invalid(r);
        r = _request();
        r.fee = 0;
        _invalid(r);
        r.fee = 9999;
        _invalid(r);
        r = _request();
        r.symbol = "lower";
        _invalid(r);
        r.symbol = "TOO_LONG_TICKER";
        _invalid(r);
        r = _request();
        r.name = "bad\nname";
        _invalid(r);
        r.name = "";
        _invalid(r);
        r = _request();
        r.tokenURI = "blob:https://rarepet.app/image";
        _invalid(r);
        r.tokenURI = "ipfs://";
        _invalid(r);
        r.tokenURI = string(new bytes(4097));
        _invalid(r);
    }

    function testIPFSAndEveryApprovedTradingFee() public {
        RarePetLaunchRouter.LaunchRequest memory r = _request();
        r.tokenURI = "ipfs://bafy-image-metadata";
        r.fee = 3000;
        vm.prank(address(friend));
        router.launch(r);
        vm.warp(block.timestamp + DAY);
        r.fee = 20000;
        vm.prank(address(friend));
        router.launch(r);
        require(router.getLaunch(GENESIS, 0).brain == 2, "valid fee rejected");
    }

    function testInvalidCurveWeightsTicksAndPositionCount() public {
        RarePetLaunchRouter.LaunchRequest memory r = _request();
        r.curves[0].shares -= 1;
        _invalid(r);
        r = _request();
        r.curves[0].tickLower += 1;
        _invalid(r);
        r = _request();
        r.curves[0].numPositions = 101;
        _invalid(r);
        r = _request();
        r.curves[0].numPositions = 0;
        _invalid(r);
        r = _request();
        r.farTick = 10000;
        _invalid(r);
        r.farTick = -10200;
        _invalid(r);
    }

    function testFuzzWrongCurveWeightsNeverCredit(uint256 shares) public {
        if (shares == 1e18) return;
        RarePetLaunchRouter.LaunchRequest memory r = _request();
        r.curves[0].shares = shares;
        _invalid(r);
        _noCredit();
    }

    function testAirlockFailureRollsBackBrainAndCooldown() public {
        lock.setFailure(1);
        vm.prank(address(friend));
        vm.expectRevert(bytes("airlock failure"));
        router.launch(_request());
        _noCredit();
        lock.setFailure(0);
        _launch(friend);
        require(router.getLaunch(GENESIS, 0).brain == 1, "retry blocked");
    }

    function testFuzzInvalidReceiptNeverCredits(uint8 choice) public {
        uint256 mode = 2 + uint256(choice) % 7;
        lock.setFailure(mode);
        vm.prank(address(friend));
        vm.expectRevert(RarePetLaunchRouter.UnverifiedLaunch.selector);
        router.launch(_request());
        _noCredit();
    }

    function testDuplicateAssetCannotEarnSecondBrain() public {
        _launch(friend);
        vm.warp(block.timestamp + DAY);
        lock.setFailure(9);
        vm.prank(address(friend));
        vm.expectRevert(RarePetLaunchRouter.UnverifiedLaunch.selector);
        router.launch(_request());
        require(router.getLaunch(GENESIS, 0).brain == 1, "replayed asset credited");
    }

    function testCallbackCannotTransferNFTAndCreditPriorOwner() public {
        lock.setCallback(GENESIS, abi.encodeCall(MockCollection.transfer, (0, BUYER)));
        vm.prank(address(friend));
        vm.expectRevert(RarePetLaunchRouter.InvalidFriend.selector);
        router.launch(_request());
        _noCredit();
        require(MockCollection(GENESIS).ownerOf(0) == OWNER, "transfer survived revert");
    }

    function testReentrantLaunchRejectedAndAllEffectsReverted() public {
        lock.setCallback(address(router), abi.encodeCall(RarePetLaunchRouter.launch, (_request())));
        vm.prank(address(friend));
        vm.expectRevert(RarePetLaunchRouter.ReentrantCall.selector);
        router.launch(_request());
        _noCredit();
    }

    function testModuleRevocationFailsClosedBeforeLaunch() public {
        lock.setModule(INITIALIZER, 0);
        vm.prank(address(friend));
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        router.launch(_request());
        _noCredit();
    }

    function testWrongChainFailsClosedOnDeployAndUse() public {
        vm.chainId(1);
        vm.expectRevert(RarePetLaunchRouter.WrongChain.selector);
        new RarePetLaunchRouter(TREASURY, SUPPLY, 8500, _quotes());
        vm.prank(address(friend));
        vm.expectRevert(RarePetLaunchRouter.WrongChain.selector);
        router.launch(_request());
    }

    function testInvalidDeploymentConfiguration() public {
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        new RarePetLaunchRouter(address(0), SUPPLY, 8500, _quotes());
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        new RarePetLaunchRouter(TREASURY, SUPPLY, 9500, _quotes());
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        new RarePetLaunchRouter(TREASURY, 0, 8500, _quotes());
        address[] memory duplicates = new address[](2);
        duplicates[0] = QUOTE;
        duplicates[1] = QUOTE;
        vm.expectRevert(RarePetLaunchRouter.InvalidConfiguration.selector);
        new RarePetLaunchRouter(TREASURY, SUPPLY, 8500, duplicates);
    }

    function testSelfLaunchNeedsNoNFTAndHasNoDailyLimitOrBrain() public {
        vm.prank(BUYER);
        address first = router.launchAsSelf(_request());
        vm.prank(BUYER);
        address secondAsset = router.launchAsSelf(_request());
        require(first != secondAsset && router.selfLaunchCount(BUYER) == 2, "self limit or duplicate");
        _noCredit();
        require(router.getLaunch(GENERATIONS, 42).brain == 0, "self credited other NFT");
        CreateParams memory p = abi.decode(lock.lastParams(), (CreateParams));
        require(
            p.salt
                == keccak256(
                    abi.encode(
                        uint256(4663), address(router), BUYER, address(0), uint256(0), uint256(2), _request().salt
                    )
                ),
            "self salt mismatch"
        );
        DopplerInit memory init = abi.decode(p.poolInitializerData, (DopplerInit));
        bool hasCreator;
        for (uint256 i; i < init.beneficiaries.length; ++i) {
            if (init.beneficiaries[i].beneficiary == BUYER) {
                hasCreator = true;
                require(init.beneficiaries[i].shares == router.friendShares(), "creator fee mismatch");
            }
        }
        require(hasCreator, "self fees not assigned to caller");
    }

    function testSelfRouteCannotEarnOrBypassNftBrainCooldownEvenThroughFriend() public {
        _launch(friend);
        uint256 readyAt = block.timestamp + DAY;
        vm.prank(address(friend));
        router.launchAsSelf(_request());
        vm.prank(OWNER);
        router.launchAsSelf(_request());
        require(
            router.getLaunch(GENESIS, 0).brain == 1 && router.selfLaunchCount(address(friend)) == 1
                && router.selfLaunchCount(OWNER) == 1,
            "mixed ledgers"
        );
        vm.prank(address(friend));
        vm.expectRevert(abi.encodeWithSelector(RarePetLaunchRouter.ActionNotReady.selector, readyAt));
        router.launch(_request());
    }

    function testSelfFailureRollsBackCountAndCrossModeReentry() public {
        lock.setFailure(4);
        vm.prank(BUYER);
        vm.expectRevert(RarePetLaunchRouter.UnverifiedLaunch.selector);
        router.launchAsSelf(_request());
        require(router.selfLaunchCount(BUYER) == 0, "failed self counted");
        lock.setFailure(0);
        lock.setCallback(address(router), abi.encodeCall(RarePetLaunchRouter.launch, (_request())));
        vm.prank(BUYER);
        vm.expectRevert(RarePetLaunchRouter.ReentrantCall.selector);
        router.launchAsSelf(_request());
        require(router.selfLaunchCount(BUYER) == 0, "reentrant self counted");
        _noCredit();
    }

    function testSelfCannotChangePoolPolicyOrQuote() public {
        RarePetLaunchRouter.LaunchRequest memory r = _request();
        r.quote = address(0xBAD);
        vm.prank(BUYER);
        vm.expectRevert(RarePetLaunchRouter.InvalidLaunch.selector);
        router.launchAsSelf(r);
        require(router.selfLaunchCount(BUYER) == 0, "invalid self counted");
    }

    function testSelfTreasuryCreatorMergesFeesWithoutChangingTotal() public {
        vm.prank(TREASURY);
        router.launchAsSelf(_request());
        CreateParams memory p = abi.decode(lock.lastParams(), (CreateParams));
        DopplerInit memory init = abi.decode(p.poolInitializerData, (DopplerInit));
        require(init.beneficiaries.length == 2, "duplicate beneficiary");
        require(
            init.beneficiaries[0].beneficiary == PROTOCOL && init.beneficiaries[0].shares == 0.05e18,
            "protocol share wrong"
        );
        require(
            init.beneficiaries[1].beneficiary == TREASURY && init.beneficiaries[1].shares == 0.95e18,
            "combined share wrong"
        );
    }
}
