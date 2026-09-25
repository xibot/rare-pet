// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IRareFriendOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice NFT-bound care points. Does not modify the original NFT's metadata or hold funds.
/// @dev Rare Rush completion is attested by an immutable signer; care itself is owner-operated.
contract RarePet {
    uint256 public constant CHAIN_ID = 4663;
    uint256 public constant DAY = 1 days;
    address public constant GENESIS = 0x116EaA62241751E0c98dA43d458600c6C17cD361;
    address public constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    uint256 public constant FOUR_HOURS = 4 hours;
    uint256 public constant PET_GRACE = 1 days;
    uint256 public constant MAX_PLAYS = 3;
    bytes32 public constant PLAY_TYPEHASH =
        keccak256("Play(address owner,address collection,uint256 tokenId,bytes32 runId,uint256 deadline)");
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant _SECP256K1_HALF_N =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    /// @dev Zero disables play rewards. There is no privileged signer replacement or upgrade.
    address public immutable playSigner;

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
        uint256[3] playTimes;
        uint256 playCount;
        uint256 decayApplied;
        bool hasPet;
        bool hasFed;
        bool hasPooped;
        bool hasLaunched;
    }

    enum Action {
        Petting,
        Feeding,
        Playing,
        Pooping
    }

    mapping(address collection => mapping(uint256 tokenId => Pet)) private _pets;
    mapping(bytes32 runId => bool) public usedRuns;

    error WrongChain();
    error UnsupportedCollection();
    error NotOwner();
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
    event PlayClaimed(bytes32 indexed runId, address indexed collection, uint256 indexed tokenId);

    constructor(address playSigner_) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        playSigner = playSigner_;
    }

    /// @notice +1 Kinship and one streak step every 24h, with 24h grace after unlock.
    function pet(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        Pet storage care = _prepare(collection, tokenId);
        if (care.hasPet && block.timestamp < care.lastPetAt + DAY) {
            revert ActionNotReady(care.lastPetAt + DAY);
        }
        care.kinship += 1;
        care.streak += 1;
        care.rarity = care.streak / 7;
        care.lastPetAt = block.timestamp;
        care.hasPet = true;
        care.decayApplied = 0;
        emit CaredFor(collection, tokenId, msg.sender, Action.Petting, block.timestamp);
    }

    /// @notice Each meal grants +1 Strength and +5 Stamina, once every four hours.
    function feed(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        Pet storage care = _prepare(collection, tokenId);
        if (care.hasFed && block.timestamp < care.lastFeedAt + FOUR_HOURS) {
            revert ActionNotReady(care.lastFeedAt + FOUR_HOURS);
        }
        care.lastFeedAt = block.timestamp;
        care.hasFed = true;
        care.strength += 1;
        care.stamina += 5;
        emit CaredFor(collection, tokenId, msg.sender, Action.Feeding, block.timestamp);
    }

    /// @notice Each poop grants +1 Health, once every four hours.
    function poop(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        Pet storage care = _prepare(collection, tokenId);
        if (care.hasPooped && block.timestamp < care.lastPoopAt + FOUR_HOURS) {
            revert ActionNotReady(care.lastPoopAt + FOUR_HOURS);
        }
        care.lastPoopAt = block.timestamp;
        care.hasPooped = true;
        care.health += 1;
        emit CaredFor(collection, tokenId, msg.sender, Action.Pooping, block.timestamp);
    }

    /// @notice Claim +10 Experience for one attested Rare Rush completion; at most three claims in any rolling 24h.
    /// @dev The attestor must verify the run and selected Friend; opening the game is never sufficient proof.
    function play(
        address collection,
        uint256 tokenId,
        bytes32 runId,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _checkOwner(collection, tokenId);
        if (playSigner == address(0)) revert PlayDisabled();
        if (block.timestamp > deadline) revert ExpiredPlay();
        if (usedRuns[runId]) revert RunAlreadyUsed();
        bytes32 digest = playDigest(msg.sender, collection, tokenId, runId, deadline);
        if (_recover(digest, signature) != playSigner) revert InvalidSignature();
        Pet storage care = _prepare(collection, tokenId);
        if (care.playCount == MAX_PLAYS) revert ActionNotReady(care.playTimes[0] + DAY);
        usedRuns[runId] = true;
        care.playTimes[care.playCount] = block.timestamp;
        care.playCount += 1;
        care.experience += 10;
        emit CaredFor(collection, tokenId, msg.sender, Action.Playing, block.timestamp);
        emit PlayClaimed(runId, collection, tokenId);
    }

    /// @notice Current care, including overdue decay and expiring play slots even without a keeper transaction.
    function getPet(address collection, uint256 tokenId) external view returns (Pet memory care) {
        _checkCollection(collection);
        care = _project(_pets[collection][tokenId]);
    }

    /// @notice EIP-712 hash to be signed by the trusted completion service, never a wallet ownership proof.
    function playDigest(address owner, address collection, uint256 tokenId, bytes32 runId, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 domain = keccak256(
            abi.encode(_DOMAIN_TYPEHASH, keccak256("RarePet"), keccak256("1"), block.chainid, address(this))
        );
        bytes32 claim = keccak256(abi.encode(PLAY_TYPEHASH, owner, collection, tokenId, runId, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domain, claim));
    }

    function _prepare(address collection, uint256 tokenId) private returns (Pet storage care) {
        _pets[collection][tokenId] = _project(_pets[collection][tokenId]);
        care = _pets[collection][tokenId];
    }

    function _project(Pet memory care) private view returns (Pet memory) {
        uint256 count;
        for (uint256 i; i < care.playCount; ++i) {
            if (block.timestamp < care.playTimes[i] + DAY) care.playTimes[count++] = care.playTimes[i];
        }
        for (uint256 i = count; i < MAX_PLAYS; ++i) {
            care.playTimes[i] = 0;
        }
        care.playCount = count;
        uint256 deadline = care.lastPetAt + DAY + PET_GRACE;
        if (care.hasPet && block.timestamp > deadline) {
            // The exact grace deadline is on time. Decay begins one second later.
            uint256 missed = (block.timestamp - deadline - 1) / DAY + 1;
            uint256 pending = missed > care.decayApplied ? missed - care.decayApplied : 0;
            care.kinship = pending >= care.kinship ? 0 : care.kinship - pending;
            care.streak = 0;
            care.rarity = 0;
            care.decayApplied = missed;
        }
        return care;
    }

    function _checkOwner(address collection, uint256 tokenId) private view {
        _checkCollection(collection);
        if (IRareFriendOwner(collection).ownerOf(tokenId) != msg.sender) revert NotOwner();
    }

    function _checkCollection(address collection) private pure {
        if (collection != GENESIS && collection != GENERATIONS) revert UnsupportedCollection();
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > _SECP256K1_HALF_N || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
