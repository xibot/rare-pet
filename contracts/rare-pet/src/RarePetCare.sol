// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IRarePetCareOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Permanent NFT-bound care records with delayed, prospective game-rule changes.
/// @dev Not a proxy. No administrator can replace code, erase records or set earned totals.
///      Current bond traits can decay; lifetime earned totals and action records cannot.
contract RarePetCare {
    uint256 public constant CHAIN_ID = 4663;
    uint256 public constant DAY = 1 days;
    uint256 public constant RULE_DELAY = 1 days;
    uint256 public constant MAX_DAILY_LIMIT = 32;
    uint256 public constant MAX_POINTS = 1_000_000;
    uint256 public constant MAX_COOLDOWN = 30 days;
    uint256 public constant MAX_PET_GRACE = 30 days;
    uint256 public constant MAX_DECAY_INTERVAL = 30 days;
    address public constant GENESIS = 0x116EaA62241751E0c98dA43d458600c6C17cD361;
    address public constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    bytes32 public constant PLAY_TYPEHASH = keccak256(
        "Play(address owner,address collection,uint256 tokenId,bytes32 runId,uint256 deadline,uint256 ruleVersion)"
    );
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant _SECP256K1_HALF_N =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    enum Action {
        Petting,
        Feeding,
        Playing,
        Pooping
    }

    struct ActionRule {
        uint32 points;
        uint32 secondaryPoints;
        uint32 cooldown;
        uint8 dailyLimit;
        bool enabled;
    }

    struct RuleSet {
        ActionRule[4] actions;
        uint32 petGrace;
        uint32 decayInterval;
        uint32 decayPoints;
        uint16 rarityEvery;
        uint32 rarityPoints;
        address playSigner;
    }

    /// @dev The dynamic play array is assembled from bounded history when reading.
    struct Pet {
        uint256 kinship;
        uint256 strength;
        uint256 stamina;
        uint256 health;
        uint256 experience;
        uint256 brain;
        uint256 streak;
        uint256 rarity;
        uint256 lastPetAt;
        uint256 lastFeedAt;
        uint256 lastPoopAt;
        uint256 lastLaunchAt;
        uint256[] playTimes;
        uint256 playCount;
        uint256 decayApplied;
        bool hasPet;
        bool hasFed;
        bool hasPooped;
        bool hasLaunched;
    }

    struct Lifetime {
        uint256 kinship;
        uint256 strength;
        uint256 stamina;
        uint256 health;
        uint256 experience;
        uint256 rarity;
        uint256 bestStreak;
        uint256[4] actionCounts;
    }

    struct CareRecord {
        uint8 action;
        uint256 timestamp;
        address owner;
        uint256 ruleVersion;
        uint256 points;
        uint256 secondaryPoints;
        uint256 rarityPoints;
    }

    struct History {
        uint256[32] times;
        uint256 nextAvailableAt;
        uint8 head;
        uint8 count;
    }

    struct BondSchedule {
        uint256 nextAvailableAt;
        uint256 graceDeadline;
        uint256 decayInterval;
        uint256 decayPoints;
        uint256 nextRarityAt;
        uint256 nextRarityPoints;
    }

    address public admin;
    address public pendingAdmin;
    uint256 public adminTransferReadyAt;
    uint256 public currentRuleVersion = 1;
    mapping(uint256 version => RuleSet) private _rules;
    RuleSet private _pendingRules;
    uint256 private _rulesReadyAt;
    uint256 private _pendingPredecessor;
    mapping(address collection => mapping(uint256 tokenId => Pet)) private _pets;
    mapping(address collection => mapping(uint256 tokenId => Lifetime)) private _lifetime;
    mapping(address collection => mapping(uint256 tokenId => BondSchedule)) private _bonds;
    mapping(address collection => mapping(uint256 tokenId => mapping(uint8 action => History))) private
        _history;
    mapping(address collection => mapping(uint256 tokenId => uint256)) public actionCount;
    mapping(address collection => mapping(uint256 tokenId => mapping(uint256 sequence => CareRecord))) private
        _records;
    mapping(bytes32 runId => bool) public usedRuns;

    error WrongChain();
    error UnsupportedCollection();
    error NotOwner();
    error NotAdmin();
    error InvalidAdmin();
    error InvalidRules();
    error InvalidRuleVersion();
    error InvalidAction();
    error InvalidRecord();
    error PendingRulesExist();
    error NoPendingRules();
    error DelayNotElapsed(uint256 readyAt);
    error ActionDisabled();
    error ActionNotReady(uint256 readyAt);
    error PlayDisabled();
    error ExpiredPlay();
    error RunAlreadyUsed();
    error InvalidSignature();

    event CaredFor(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed owner,
        Action action,
        uint256 timestamp
    );
    event ActionRecorded(
        address indexed collection,
        uint256 indexed tokenId,
        uint256 indexed sequence,
        address owner,
        uint8 action,
        uint256 ruleVersion,
        uint256 timestamp,
        uint256 points,
        uint256 secondaryPoints,
        uint256 rarityPoints
    );
    event PlayClaimed(bytes32 indexed runId, address indexed collection, uint256 indexed tokenId);
    event RulesScheduled(uint256 indexed predecessorVersion, uint256 executeAfter, RuleSet ruleSet);
    event RulesCancelled(uint256 indexed predecessorVersion);
    event RulesActivated(uint256 indexed version, RuleSet ruleSet);
    event AdminTransferScheduled(address indexed admin, address indexed nominee, uint256 readyAt);
    event AdminTransferCancelled(address indexed nominee);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    constructor(address admin_, address playSigner_) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (admin_ == address(0)) revert InvalidAdmin();
        admin = admin_;
        RuleSet memory initial;
        initial.actions[0] = ActionRule(1, 0, uint32(DAY), 1, true);
        initial.actions[1] = ActionRule(1, 5, 4 hours, 6, true);
        initial.actions[2] = ActionRule(10, 0, 0, 3, true);
        initial.actions[3] = ActionRule(1, 0, 4 hours, 6, true);
        initial.petGrace = uint32(DAY);
        initial.decayInterval = uint32(DAY);
        initial.decayPoints = 1;
        initial.rarityEvery = 7;
        initial.rarityPoints = 1;
        initial.playSigner = playSigner_;
        _rules[1] = initial;
        emit AdminTransferred(address(0), admin_);
        emit RulesActivated(1, initial);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _checkChain();
        _;
    }

    function currentRules() external view returns (RuleSet memory) {
        return _rules[currentRuleVersion];
    }

    function rules(uint256 version) external view returns (RuleSet memory) {
        if (version == 0 || version > currentRuleVersion) revert InvalidRuleVersion();
        return _rules[version];
    }

    function pendingRules()
        external
        view
        returns (RuleSet memory ruleSet, uint256 executeAfter, uint256 predecessorVersion)
    {
        return (_pendingRules, _rulesReadyAt, _pendingPredecessor);
    }

    function scheduleRules(RuleSet calldata next) external onlyAdmin {
        _validateRules(next);
        if (_rulesReadyAt != 0) revert PendingRulesExist();
        _pendingRules = next;
        _pendingPredecessor = currentRuleVersion;
        _rulesReadyAt = block.timestamp + RULE_DELAY;
        emit RulesScheduled(currentRuleVersion, _rulesReadyAt, next);
    }

    function cancelRules() external onlyAdmin {
        if (_rulesReadyAt == 0) revert NoPendingRules();
        _cancelRules();
    }

    /// @notice Anyone can activate the exact publicly scheduled rules once their delay has elapsed.
    function executeRules() external {
        _checkChain();
        if (_rulesReadyAt == 0) revert NoPendingRules();
        if (block.timestamp < _rulesReadyAt) revert DelayNotElapsed(_rulesReadyAt);
        if (_pendingPredecessor != currentRuleVersion) revert InvalidRuleVersion();
        uint256 version = ++currentRuleVersion;
        _rules[version] = _pendingRules;
        delete _pendingRules;
        _rulesReadyAt = 0;
        _pendingPredecessor = 0;
        emit RulesActivated(version, _rules[version]);
    }

    function scheduleAdmin(address nominee) external onlyAdmin {
        if (nominee == address(0) || nominee == admin) revert InvalidAdmin();
        if (pendingAdmin != address(0)) emit AdminTransferCancelled(pendingAdmin);
        pendingAdmin = nominee;
        adminTransferReadyAt = block.timestamp + RULE_DELAY;
        emit AdminTransferScheduled(admin, nominee, adminTransferReadyAt);
    }

    function cancelAdminTransfer() external onlyAdmin {
        if (pendingAdmin == address(0)) revert InvalidAdmin();
        emit AdminTransferCancelled(pendingAdmin);
        pendingAdmin = address(0);
        adminTransferReadyAt = 0;
    }

    function acceptAdmin() external {
        _checkChain();
        if (msg.sender != pendingAdmin || msg.sender == address(0)) revert InvalidAdmin();
        if (block.timestamp < adminTransferReadyAt) revert DelayNotElapsed(adminTransferReadyAt);
        address previous = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        adminTransferReadyAt = 0;
        if (_rulesReadyAt != 0) _cancelRules();
        emit AdminTransferred(previous, msg.sender);
    }

    function pet(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        _act(collection, tokenId, Action.Petting);
    }

    /// @notice Refuse a pending transaction if its reviewed policy changed before inclusion.
    function pet(address collection, uint256 tokenId, uint256 expectedVersion) external {
        _checkVersion(expectedVersion);
        _checkOwner(collection, tokenId);
        _act(collection, tokenId, Action.Petting);
    }

    function feed(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        _act(collection, tokenId, Action.Feeding);
    }

    function feed(address collection, uint256 tokenId, uint256 expectedVersion) external {
        _checkVersion(expectedVersion);
        _checkOwner(collection, tokenId);
        _act(collection, tokenId, Action.Feeding);
    }

    function poop(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        _act(collection, tokenId, Action.Pooping);
    }

    function poop(address collection, uint256 tokenId, uint256 expectedVersion) external {
        _checkVersion(expectedVersion);
        _checkOwner(collection, tokenId);
        _act(collection, tokenId, Action.Pooping);
    }

    /// @notice A trusted verifier must attest a completed run, not merely a browser game callback.
    function play(
        address collection,
        uint256 tokenId,
        bytes32 runId,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _checkOwner(collection, tokenId);
        address signer = _rules[currentRuleVersion].playSigner;
        if (signer == address(0)) revert PlayDisabled();
        if (block.timestamp > deadline) revert ExpiredPlay();
        if (usedRuns[runId]) revert RunAlreadyUsed();
        bytes32 digest = playDigest(msg.sender, collection, tokenId, runId, deadline, currentRuleVersion);
        if (_recover(digest, signature) != signer) revert InvalidSignature();
        _act(collection, tokenId, Action.Playing);
        usedRuns[runId] = true;
        emit PlayClaimed(runId, collection, tokenId);
    }

    function playDigest(
        address owner,
        address collection,
        uint256 tokenId,
        bytes32 runId,
        uint256 deadline,
        uint256 ruleVersion
    ) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH, keccak256("RarePetCare"), keccak256("1"), block.chainid, address(this)
            )
        );
        bytes32 claim =
            keccak256(abi.encode(PLAY_TYPEHASH, owner, collection, tokenId, runId, deadline, ruleVersion));
        return keccak256(abi.encodePacked("\x19\x01", domain, claim));
    }

    function getPet(address collection, uint256 tokenId) external view returns (Pet memory care) {
        _checkCollection(collection);
        care = _project(_pets[collection][tokenId], _bonds[collection][tokenId]);
        History storage history = _history[collection][tokenId][uint8(Action.Playing)];
        uint256[] memory recent = _recent(history);
        care.playTimes = recent;
        care.playCount = recent.length;
    }

    function getLifetime(address collection, uint256 tokenId) external view returns (Lifetime memory) {
        _checkCollection(collection);
        return _lifetime[collection][tokenId];
    }

    function getPetSchedule(address collection, uint256 tokenId)
        external
        view
        returns (BondSchedule memory schedule)
    {
        _checkCollection(collection);
        schedule = _bonds[collection][tokenId];
        if (_pets[collection][tokenId].hasPet && block.timestamp > schedule.graceDeadline) {
            schedule.nextRarityAt = 0;
            schedule.nextRarityPoints = 0;
        }
    }

    /// @notice One-based records are immutable after creation and retain their original rule version and deltas.
    function actionRecord(address collection, uint256 tokenId, uint256 sequence)
        external
        view
        returns (CareRecord memory)
    {
        _checkCollection(collection);
        if (sequence == 0 || sequence > actionCount[collection][tokenId]) revert InvalidRecord();
        return _records[collection][tokenId][sequence];
    }

    function actionAvailability(address collection, uint256 tokenId, uint8 action)
        public
        view
        returns (uint256 remaining, uint256 readyAt, bool enabled)
    {
        _checkCollection(collection);
        if (action > uint8(Action.Pooping)) revert InvalidAction();
        RuleSet storage config = _rules[currentRuleVersion];
        ActionRule storage rule = config.actions[action];
        enabled = rule.enabled && (action != uint8(Action.Playing) || config.playSigner != address(0));
        History storage history = _history[collection][tokenId][action];
        uint256[] memory recent = _recent(history);
        readyAt = history.nextAvailableAt > block.timestamp ? history.nextAvailableAt : block.timestamp;
        if (recent.length >= rule.dailyLimit) {
            uint256 capReadyAt = recent[recent.length - rule.dailyLimit] + DAY;
            if (capReadyAt > readyAt) readyAt = capReadyAt;
        }
        if (enabled && readyAt == block.timestamp) remaining = rule.dailyLimit - recent.length;
    }

    function _act(address collection, uint256 tokenId, Action action) private {
        (uint256 remaining, uint256 readyAt, bool enabled) =
            actionAvailability(collection, tokenId, uint8(action));
        if (!enabled) revert ActionDisabled();
        if (remaining == 0) revert ActionNotReady(readyAt);
        Pet storage care = _prepare(collection, tokenId);
        Lifetime storage lifetime = _lifetime[collection][tokenId];
        RuleSet storage config = _rules[currentRuleVersion];
        ActionRule storage rule = config.actions[uint8(action)];
        uint256 rarityAward;
        if (action == Action.Petting) {
            BondSchedule storage bond = _bonds[collection][tokenId];
            if (care.streak == 0) {
                bond.nextRarityAt = config.rarityEvery;
                bond.nextRarityPoints = config.rarityPoints;
            }
            ++care.streak;
            if (care.streak == bond.nextRarityAt) {
                rarityAward = bond.nextRarityPoints;
                care.rarity += rarityAward;
                lifetime.rarity += rarityAward;
                // A pending milestone honors its saved policy; the following milestone adopts current rules.
                bond.nextRarityAt = care.streak + config.rarityEvery;
                bond.nextRarityPoints = config.rarityPoints;
            }
            if (care.streak > lifetime.bestStreak) lifetime.bestStreak = care.streak;
            care.kinship += rule.points;
            lifetime.kinship += rule.points;
            care.lastPetAt = block.timestamp;
            care.hasPet = true;
            care.decayApplied = 0;
            bond.nextAvailableAt = block.timestamp + rule.cooldown;
            bond.graceDeadline = bond.nextAvailableAt + config.petGrace;
            bond.decayInterval = config.decayInterval;
            bond.decayPoints = config.decayPoints;
        } else if (action == Action.Feeding) {
            care.strength += rule.points;
            care.stamina += rule.secondaryPoints;
            lifetime.strength += rule.points;
            lifetime.stamina += rule.secondaryPoints;
            care.lastFeedAt = block.timestamp;
            care.hasFed = true;
        } else if (action == Action.Playing) {
            care.experience += rule.points;
            lifetime.experience += rule.points;
        } else {
            care.health += rule.points;
            lifetime.health += rule.points;
            care.lastPoopAt = block.timestamp;
            care.hasPooped = true;
        }
        ++lifetime.actionCounts[uint8(action)];
        History storage history = _history[collection][tokenId][uint8(action)];
        history.times[history.head] = block.timestamp;
        history.head = uint8((uint256(history.head) + 1) % MAX_DAILY_LIMIT);
        if (history.count < MAX_DAILY_LIMIT) ++history.count;
        history.nextAvailableAt = block.timestamp + rule.cooldown;
        uint256 sequence = ++actionCount[collection][tokenId];
        _records[collection][tokenId][sequence] = CareRecord(
            uint8(action),
            block.timestamp,
            msg.sender,
            currentRuleVersion,
            rule.points,
            rule.secondaryPoints,
            rarityAward
        );
        emit CaredFor(collection, tokenId, msg.sender, action, block.timestamp);
        emit ActionRecorded(
            collection,
            tokenId,
            sequence,
            msg.sender,
            uint8(action),
            currentRuleVersion,
            block.timestamp,
            rule.points,
            rule.secondaryPoints,
            rarityAward
        );
    }

    function _prepare(address collection, uint256 tokenId) private returns (Pet storage care) {
        care = _pets[collection][tokenId];
        Pet memory projected = _project(care, _bonds[collection][tokenId]);
        care.kinship = projected.kinship;
        care.streak = projected.streak;
        care.rarity = projected.rarity;
        care.decayApplied = projected.decayApplied;
    }

    function _project(Pet memory care, BondSchedule memory bond) private view returns (Pet memory) {
        if (care.hasPet && block.timestamp > bond.graceDeadline) {
            uint256 missed = (block.timestamp - bond.graceDeadline - 1) / bond.decayInterval + 1;
            uint256 pending = missed > care.decayApplied ? missed - care.decayApplied : 0;
            if (bond.decayPoints != 0) {
                care.kinship =
                    pending > care.kinship / bond.decayPoints ? 0 : care.kinship - pending * bond.decayPoints;
            }
            care.decayApplied = missed;
            care.streak = 0;
            care.rarity = 0;
        }
        return care;
    }

    function _recent(History storage history) private view returns (uint256[] memory result) {
        uint256 count;
        uint256 first = history.count == MAX_DAILY_LIMIT ? history.head : 0;
        for (uint256 i; i < history.count; ++i) {
            uint256 time = history.times[(first + i) % MAX_DAILY_LIMIT];
            if (block.timestamp < time + DAY) ++count;
        }
        result = new uint256[](count);
        uint256 write;
        for (uint256 i; i < history.count; ++i) {
            uint256 time = history.times[(first + i) % MAX_DAILY_LIMIT];
            if (block.timestamp < time + DAY) result[write++] = time;
        }
    }

    function _validateRules(RuleSet calldata next) private pure {
        // Daily petting remains the permanent bond cadence, including while Pet is disabled.
        if (next.actions[0].cooldown != DAY || next.actions[0].dailyLimit != 1) revert InvalidRules();
        for (uint256 i; i < 4; ++i) {
            ActionRule calldata rule = next.actions[i];
            if (
                rule.points > MAX_POINTS || rule.secondaryPoints > MAX_POINTS || rule.cooldown > MAX_COOLDOWN
                    || rule.dailyLimit == 0 || rule.dailyLimit > MAX_DAILY_LIMIT
                    || (i != uint8(Action.Feeding) && rule.secondaryPoints != 0)
            ) revert InvalidRules();
        }
        if (
            next.petGrace > MAX_PET_GRACE || next.decayInterval == 0
                || next.decayInterval > MAX_DECAY_INTERVAL || next.decayPoints > MAX_POINTS
                || next.rarityEvery == 0 || next.rarityPoints > MAX_POINTS
        ) revert InvalidRules();
    }

    function _cancelRules() private {
        emit RulesCancelled(_pendingPredecessor);
        delete _pendingRules;
        _rulesReadyAt = 0;
        _pendingPredecessor = 0;
    }

    function _checkOwner(address collection, uint256 tokenId) private view {
        _checkChain();
        _checkCollection(collection);
        if (IRarePetCareOwner(collection).ownerOf(tokenId) != msg.sender) revert NotOwner();
    }

    function _checkCollection(address collection) private pure {
        if (collection != GENESIS && collection != GENERATIONS) revert UnsupportedCollection();
    }

    function _checkChain() private view {
        if (block.chainid != CHAIN_ID) revert WrongChain();
    }

    function _checkVersion(uint256 expectedVersion) private view {
        if (expectedVersion != currentRuleVersion) revert InvalidRuleVersion();
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > _SECP256K1_HALF_N || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
