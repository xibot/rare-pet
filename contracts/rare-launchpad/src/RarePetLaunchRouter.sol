// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev ABI-only declarations for Doppler commit bda077cf05c834f3bb5eb311f5b86376910d7912.
struct Curve {
    int24 tickLower;
    int24 tickUpper;
    uint16 numPositions;
    uint256 shares;
}

struct Beneficiary {
    address beneficiary;
    uint96 shares;
}

struct VestingSchedule {
    uint64 cliff;
    uint64 duration;
}

struct DopplerInit {
    uint24 fee;
    int24 tickSpacing;
    int24 farTick;
    Curve[] curves;
    Beneficiary[] beneficiaries;
    address dopplerHook;
    bytes onInitializationDopplerHookCalldata;
    bytes graduationDopplerHookCalldata;
}

struct CreateParams {
    uint256 initialSupply;
    uint256 numTokensToSell;
    address numeraire;
    address tokenFactory;
    bytes tokenFactoryData;
    address governanceFactory;
    bytes governanceFactoryData;
    address poolInitializer;
    bytes poolInitializerData;
    address liquidityMigrator;
    bytes liquidityMigratorData;
    address integrator;
    bytes32 salt;
}

struct AssetData {
    address numeraire;
    address timelock;
    address governance;
    address liquidityMigrator;
    address poolInitializer;
    address pool;
    address migrationPool;
    uint256 numTokensToSell;
    uint256 totalSupply;
    address integrator;
}

interface ILaunchAirlock {
    function owner() external view returns (address);
    function getModuleState(address module) external view returns (uint8);
    function getAssetData(address asset) external view returns (AssetData memory);
    function create(CreateParams calldata params) external returns (address, address, address, address, address);
}

interface ILaunchInitializer {
    function getBeneficiaries(address asset) external view returns (Beneficiary[] memory);
}

interface ILaunchCollection {
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenBoundAccount(uint256 tokenId) external view returns (address);
}

interface ILaunchFriendAccount {
    function owner() external view returns (address);
    function token() external view returns (uint256, address, uint256);
}

interface ILaunchToken {
    function totalSupply() external view returns (uint256);
}

/**
 * @notice Immutable RarePet launch policy and NFT-bound Brain ledger.
 * @dev Draft integration, not deployed/audited. Owner calls their canonical RF account's
 * execute(router,0,launchCalldata,0) for NFT-bound launches. launchAsSelf records
 * direct creator launches separately and never awards NFT Brain.
 * No funds, approvals, arbitrary targets, minting authority or administrator setters.
 */
contract RarePetLaunchRouter {
    uint256 public constant CHAIN_ID = 4663;
    uint256 public constant COOLDOWN = 1 days;
    uint256 public constant WAD = 1e18;
    int24 public constant TICK_SPACING = 200;
    address public constant GENESIS = 0x116EaA62241751E0c98dA43d458600c6C17cD361;
    address public constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    address public constant AIRLOCK = 0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862;
    address public constant TOKEN_FACTORY = 0x1B37D3a72082029c44B35B604Ea473617580b69a;
    address public constant INITIALIZER = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
    address public constant GOVERNANCE = 0x85f37f74Ef2478A770318bc810177a9835911aD7;
    address public constant MIGRATOR = 0xba2F330EDb16cD8056f5988d8CE19BbC63475A0e;
    uint96 public constant PROTOCOL_SHARES = 0.05e18;
    address public immutable treasury;
    uint256 public immutable totalSupply;
    uint96 public immutable friendShares;
    uint96 public immutable treasuryShares;
    mapping(address quote => bool allowed) public allowedQuote;
    address[] private _quotes;

    struct LaunchState {
        uint256 brain;
        uint256 lastLaunchAt;
        bool hasLaunched;
    }
    mapping(address collection => mapping(uint256 tokenId => LaunchState state)) private _launches;
    mapping(address asset => bool recorded) public launchedAsset;
    mapping(address creator => uint256 count) public selfLaunchCount;
    bool private _entered;

    struct LaunchRequest {
        string name;
        string symbol;
        string tokenURI;
        address quote;
        uint24 fee;
        Curve[] curves;
        int24 farTick;
        bytes32 salt;
    }
    error WrongChain();
    error InvalidConfiguration();
    error InvalidFriend();
    error InvalidLaunch();
    error ActionNotReady(uint256 readyAt);
    error ReentrantCall();
    error UnverifiedLaunch();
    event LaunchRecorded(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed asset,
        address friendWallet,
        address owner,
        address quote,
        uint24 fee,
        bytes32 metadataHash,
        uint256 timestamp
    );
    event SelfLaunchRecorded(
        address indexed creator,
        address indexed asset,
        address quote,
        uint24 fee,
        bytes32 metadataHash,
        uint256 timestamp
    );

    /// @param friendFeeBps Creator allocation must be 8500: 85% creator, 10% treasury, 5% Doppler.
    constructor(address treasury_, uint256 supply_, uint16 friendFeeBps, address[] memory quotes_) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (
            treasury_ == address(0) || supply_ < 1e18 || supply_ > 1e36 || friendFeeBps != 8500 || quotes_.length == 0
                || quotes_.length > 256
        ) revert InvalidConfiguration();
        treasury = treasury_;
        totalSupply = supply_;
        friendShares = uint96(uint256(friendFeeBps) * 1e14);
        treasuryShares = uint96(WAD - PROTOCOL_SHARES - friendShares);
        _checkModules();
        for (uint256 i; i < quotes_.length; ++i) {
            address quote = quotes_[i];
            if (quote == address(0) || quote.code.length == 0 || allowedQuote[quote]) revert InvalidConfiguration();
            allowedQuote[quote] = true;
            _quotes.push(quote);
        }
    }

    function quoteTokens() external view returns (address[] memory) {
        return _quotes;
    }

    function getLaunch(address collection, uint256 tokenId) external view returns (LaunchState memory) {
        if (collection != GENESIS && collection != GENERATIONS) revert InvalidFriend();
        return _launches[collection][tokenId];
    }

    function feeBeneficiaries(address friendWallet) public view returns (Beneficiary[] memory result) {
        address protocol = ILaunchAirlock(AIRLOCK).owner();
        if (friendWallet == address(0) || protocol == address(0)) revert InvalidConfiguration();
        Beneficiary[] memory sorted = new Beneficiary[](3);
        sorted[0] = Beneficiary(friendWallet, friendShares);
        sorted[1] = Beneficiary(treasury, treasuryShares);
        sorted[2] = Beneficiary(protocol, PROTOCOL_SHARES);
        for (uint256 i = 1; i < 3; ++i) {
            for (uint256 j = i; j > 0 && sorted[j].beneficiary < sorted[j - 1].beneficiary; --j) {
                (sorted[j], sorted[j - 1]) = (sorted[j - 1], sorted[j]);
            }
        }
        uint256 count = 1;
        for (uint256 i = 1; i < 3; ++i) {
            if (sorted[i].beneficiary != sorted[i - 1].beneficiary) ++count;
        }
        result = new Beneficiary[](count);
        result[0] = sorted[0];
        uint256 index;
        for (uint256 i = 1; i < 3; ++i) {
            if (sorted[i].beneficiary == result[index].beneficiary) result[index].shares += sorted[i].shares;
            else result[++index] = sorted[i];
        }
    }
    modifier launchGuard() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        if (block.chainid != CHAIN_ID) revert WrongChain();
        _;
        _entered = false;
    }

    function launch(LaunchRequest calldata request) external launchGuard returns (address asset) {
        (address collection, uint256 tokenId, address owner) = _friend(msg.sender);
        _validate(request);
        _checkModules();
        LaunchState storage state = _launches[collection][tokenId];
        if (state.hasLaunched && block.timestamp < state.lastLaunchAt + COOLDOWN) {
            revert ActionNotReady(state.lastLaunchAt + COOLDOWN);
        }
        // All effects roll back with Airlock failure or failed receipt validation.
        state.lastLaunchAt = block.timestamp;
        state.hasLaunched = true;
        state.brain += 1;
        asset = _create(request, msg.sender, collection, tokenId, state.brain);
        // A callback may not move the NFT while crediting a stale owner.
        if (
            ILaunchCollection(collection).ownerOf(tokenId) != owner || ILaunchFriendAccount(msg.sender).owner() != owner
        ) revert InvalidFriend();
        emit LaunchRecorded(
            collection,
            tokenId,
            asset,
            msg.sender,
            owner,
            request.quote,
            request.fee,
            keccak256(bytes(request.tokenURI)),
            block.timestamp
        );
    }

    /// @notice Direct caller-owned launch, without an NFT, Brain reward or daily limit.
    function launchAsSelf(LaunchRequest calldata request) external launchGuard returns (address asset) {
        _validate(request);
        _checkModules();
        uint256 count = ++selfLaunchCount[msg.sender];
        // The zero collection separates this salt domain from both canonical NFT collections.
        asset = _create(request, msg.sender, address(0), 0, count);
        emit SelfLaunchRecorded(
            msg.sender, asset, request.quote, request.fee, keccak256(bytes(request.tokenURI)), block.timestamp
        );
    }

    function _create(
        LaunchRequest calldata request,
        address creator,
        address collection,
        uint256 tokenId,
        uint256 count
    ) private returns (address asset) {
        Beneficiary[] memory beneficiaries = feeBeneficiaries(creator);
        CreateParams memory params = _params(request, creator, collection, tokenId, count, beneficiaries);
        address pool;
        (asset, pool,,,) = ILaunchAirlock(AIRLOCK).create(params);
        _verifyCreated(asset, pool, request.quote, beneficiaries);
        if (launchedAsset[asset]) revert UnverifiedLaunch();
        launchedAsset[asset] = true;
    }

    function _friend(address account) private view returns (address collection, uint256 tokenId, address owner) {
        if (account.code.length == 0) revert InvalidFriend();
        uint256 chainId;
        (chainId, collection, tokenId) = ILaunchFriendAccount(account).token();
        if (chainId != CHAIN_ID || (collection != GENESIS && collection != GENERATIONS)) revert InvalidFriend();
        if (ILaunchCollection(collection).tokenBoundAccount(tokenId) != account) revert InvalidFriend();
        owner = ILaunchCollection(collection).ownerOf(tokenId);
        if (owner == address(0) || ILaunchFriendAccount(account).owner() != owner) revert InvalidFriend();
    }

    function _checkModules() private view {
        if (
            AIRLOCK.code.length == 0 || TOKEN_FACTORY.code.length == 0 || INITIALIZER.code.length == 0
                || GOVERNANCE.code.length == 0 || MIGRATOR.code.length == 0
        ) revert InvalidConfiguration();
        ILaunchAirlock lock = ILaunchAirlock(AIRLOCK);
        if (
            lock.getModuleState(TOKEN_FACTORY) != 1 || lock.getModuleState(GOVERNANCE) != 2
                || lock.getModuleState(INITIALIZER) != 3 || lock.getModuleState(MIGRATOR) != 4
        ) revert InvalidConfiguration();
    }

    function _validate(LaunchRequest calldata request) private view {
        bytes memory name = bytes(request.name);
        bytes memory symbol = bytes(request.symbol);
        bytes memory uri = bytes(request.tokenURI);
        if (
            !allowedQuote[request.quote] || (request.fee != 3000 && request.fee != 10000 && request.fee != 20000)
                || name.length == 0 || name.length > 64 || symbol.length == 0 || symbol.length > 12 || uri.length > 4096
                || (!_prefix(uri, bytes("ipfs://")) && !_prefix(uri, bytes("data:application/json;base64,")))
                || request.curves.length == 0 || request.curves.length > 8
        ) revert InvalidLaunch();
        for (uint256 i; i < name.length; ++i) {
            if (uint8(name[i]) < 32 || uint8(name[i]) == 127) revert InvalidLaunch();
        }
        for (uint256 i; i < symbol.length; ++i) {
            if (!((symbol[i] >= 0x41 && symbol[i] <= 0x5a) || (symbol[i] >= 0x30 && symbol[i] <= 0x39))) {
                revert InvalidLaunch();
            }
        }
        uint256 shares;
        uint256 positions;
        int24 lower = 887272;
        int24 upper = -887272;
        for (uint256 i; i < request.curves.length; ++i) {
            Curve calldata curve = request.curves[i];
            if (
                curve.tickLower < -887200 || curve.tickUpper > 887200 || curve.tickLower >= curve.tickUpper
                    || curve.tickLower % TICK_SPACING != 0 || curve.tickUpper % TICK_SPACING != 0
                    || curve.numPositions == 0 || curve.shares == 0
            ) revert InvalidLaunch();
            shares += curve.shares;
            positions += curve.numPositions;
            if (curve.tickLower < lower) lower = curve.tickLower;
            if (curve.tickUpper > upper) upper = curve.tickUpper;
        }
        if (
            shares != WAD || positions > 100 || request.farTick < lower || request.farTick >= upper
                || request.farTick % TICK_SPACING != 0
        ) revert InvalidLaunch();
    }

    function _prefix(bytes memory data, bytes memory prefix) private pure returns (bool) {
        if (data.length <= prefix.length) return false;
        for (uint256 i; i < prefix.length; ++i) {
            if (data[i] != prefix[i]) return false;
        }
        return true;
    }

    function _params(
        LaunchRequest calldata request,
        address account,
        address collection,
        uint256 tokenId,
        uint256 count,
        Beneficiary[] memory beneficiaries
    ) private view returns (CreateParams memory params) {
        // No vesting allocations, mint controller, balance restrictions or creator allocation.
        params.tokenFactoryData = _tokenData(request);
        DopplerInit memory init = DopplerInit(
            request.fee, TICK_SPACING, request.farTick, request.curves, beneficiaries, address(0), bytes(""), bytes("")
        );
        params.initialSupply = totalSupply;
        params.numTokensToSell = totalSupply;
        params.numeraire = request.quote;
        params.tokenFactory = TOKEN_FACTORY;
        params.governanceFactory = GOVERNANCE;
        params.governanceFactoryData = bytes("");
        params.poolInitializer = INITIALIZER;
        params.poolInitializerData = abi.encode(init);
        params.liquidityMigrator = MIGRATOR;
        params.liquidityMigratorData = bytes("");
        params.integrator = treasury;
        params.salt = keccak256(abi.encode(CHAIN_ID, address(this), account, collection, tokenId, count, request.salt));
    }

    function _tokenData(LaunchRequest calldata request) private pure returns (bytes memory) {
        return abi.encode(
            request.name,
            request.symbol,
            new VestingSchedule[](0),
            new address[](0),
            new uint256[](0),
            new uint256[](0),
            request.tokenURI,
            uint256(0),
            uint48(0),
            address(0),
            new address[](0)
        );
    }

    function _verifyCreated(address asset, address pool, address quote, Beneficiary[] memory expected) private view {
        if (asset.code.length == 0 || pool != asset || ILaunchToken(asset).totalSupply() != totalSupply) {
            revert UnverifiedLaunch();
        }
        AssetData memory data = ILaunchAirlock(AIRLOCK).getAssetData(asset);
        if (
            data.numeraire != quote || data.pool != pool || data.poolInitializer != INITIALIZER
                || data.liquidityMigrator != MIGRATOR || data.numTokensToSell != totalSupply
                || data.totalSupply != totalSupply || data.integrator != treasury || data.governance != address(0xdead)
                || data.timelock != address(0xdead) || data.migrationPool != 0xdeaDDeADDEaDdeaDdEAddEADDEAdDeadDEADDEaD
        ) revert UnverifiedLaunch();
        Beneficiary[] memory actual = ILaunchInitializer(INITIALIZER).getBeneficiaries(asset);
        if (actual.length != expected.length) revert UnverifiedLaunch();
        for (uint256 i; i < expected.length; ++i) {
            if (actual[i].beneficiary != expected[i].beneficiary || actual[i].shares != expected[i].shares) {
                revert UnverifiedLaunch();
            }
        }
    }
}
