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
    uint256 public constant MAX_FEEDS = 5;
    uint256 public constant MAX_PLAYS = 3;
    uint256 public constant MAX_POOPS = 3;
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
        uint256 careDay;
        uint256 feedsToday;
        uint256 playsToday;
        uint256 poopsToday;
    }

    struct StoredPet {
        Pet pet;
        uint256 appliedDecay;
        bool hasPet;
    }

    enum Action {
        Petting,
        Feeding,
        Playing,
        Pooping
    }

    mapping(address collection => mapping(uint256 tokenId => StoredPet)) private _pets;
    mapping(bytes32 runId => bool) public usedRuns;

    error WrongChain();
    error UnsupportedCollection();
    error NotOwner();
    error DailyLimit();
    error PlayDisabled();
    error ExpiredPlay();
    error RunAlreadyUsed();
    error InvalidSignature();

    event CaredFor(
        address indexed collection, uint256 indexed tokenId, address indexed owner, Action action, uint256 day
    );
    event PlayClaimed(bytes32 indexed runId, address indexed collection, uint256 indexed tokenId);

    constructor(address playSigner_) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        playSigner = playSigner_;
    }

    /// @notice Refresh care at any time; earn +1 kinship and one streak day at most once per UTC day.
    /// @dev Exactly 24 hours is on time. After that, the projected streak has already reset.
    function pet(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        StoredPet storage stored = _prepare(collection, tokenId);
        Pet storage care = stored.pet;
        if (!stored.hasPet || care.lastPetAt / DAY < care.careDay) {
            care.kinship += 1;
            care.streak += 1;
            care.rarity = care.streak / 7;
        }
        care.lastPetAt = block.timestamp;
        stored.hasPet = true;
        stored.appliedDecay = 0;
        emit CaredFor(collection, tokenId, msg.sender, Action.Petting, care.careDay);
    }

    /// @notice Each meal grants +1 Strength and +5 Stamina, up to five meals per UTC day.
    function feed(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        Pet storage care = _prepare(collection, tokenId).pet;
        if (care.feedsToday == MAX_FEEDS) revert DailyLimit();
        care.feedsToday += 1;
        care.strength += 1;
        care.stamina += 5;
        emit CaredFor(collection, tokenId, msg.sender, Action.Feeding, care.careDay);
    }

    /// @notice Each poop grants +1 Health, up to three per UTC day.
    function poop(address collection, uint256 tokenId) external {
        _checkOwner(collection, tokenId);
        Pet storage care = _prepare(collection, tokenId).pet;
        if (care.poopsToday == MAX_POOPS) revert DailyLimit();
        care.poopsToday += 1;
        care.health += 1;
        emit CaredFor(collection, tokenId, msg.sender, Action.Pooping, care.careDay);
    }

    /// @notice Claim +10 Experience for one attested Rare Rush completion; at most three claims per UTC day.
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
        Pet storage care = _prepare(collection, tokenId).pet;
        if (care.playsToday == MAX_PLAYS) revert DailyLimit();
        usedRuns[runId] = true;
        care.playsToday += 1;
        care.experience += 10;
        emit CaredFor(collection, tokenId, msg.sender, Action.Playing, care.careDay);
        emit PlayClaimed(runId, collection, tokenId);
    }

    /// @notice Current care, including overdue decay and quota resets even without a keeper transaction.
    function getPet(address collection, uint256 tokenId) external view returns (Pet memory care) {
        _checkCollection(collection);
        StoredPet storage stored = _pets[collection][tokenId];
        (care,) = _project(stored);
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

    function _prepare(address collection, uint256 tokenId) private returns (StoredPet storage stored) {
        stored = _pets[collection][tokenId];
        (Pet memory care, uint256 decay) = _project(stored);
        stored.pet = care;
        stored.appliedDecay = decay;
    }

    function _project(StoredPet storage stored) private view returns (Pet memory care, uint256 decay) {
        care = stored.pet;
        decay = stored.appliedDecay;
        uint256 today = block.timestamp / DAY;
        if (care.careDay != today) {
            care.careDay = today;
            care.feedsToday = 0;
            care.playsToday = 0;
            care.poopsToday = 0;
        }
        if (stored.hasPet && block.timestamp > care.lastPetAt + DAY) {
            // Decay starts one second past the deadline, then repeats every 24 hours.
            uint256 missed = (block.timestamp - care.lastPetAt - 1) / DAY;
            uint256 pending = missed - decay;
            care.kinship = pending >= care.kinship ? 0 : care.kinship - pending;
            care.streak = 0;
            care.rarity = 0;
            decay = missed;
        }
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
