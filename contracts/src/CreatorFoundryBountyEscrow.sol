// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CreatorFoundryBountyEscrow
 * @notice Bounty money is locked BEFORE the work starts, not promised after.
 *
 * The problem this fixes: without escrow, a bounty reward is only a producer's
 * intention. If the producer never signs, the artist is unpaid and has no
 * recourse. With escrow, the producer deposits USDG into this contract when the
 * bounty is opened, and the money is the artist's the moment the review clock
 * expires.
 *
 * Neither side can grief the other — there are TWO clocks, both set by the
 * producer when a contributor is assigned:
 *
 *   1. deliveryWindow — if the contributor never attests a delivery before this
 *      expires, the producer reclaims the reward (refund).
 *   2. reviewWindow   — starts the moment the contributor attests a delivery.
 *      If the producer never reviews it, ANYONE can push the money to the
 *      contributor (autoRelease). The producer cannot simply go quiet.
 *
 * Windows rather than a single deadline is the whole point: a one-sided timer
 * would let a bad actor on either side wait out the clock and take the money.
 *
 * @dev Attestations. `fund` locks the hash of the brief, and `attestDelivery`
 * locks the hash of the delivered artifact. Both hashes end up in the
 * DeliveryAttested / BountyReleased events, so "what was asked for" and "what
 * was actually delivered" are bound together on-chain under the producer's
 * signature — the critic's numeric score is then citable rather than a claim.
 *
 * @dev Denominations. Amounts are in the escrow token's base units; USDG
 * (Paxos Global Dollar) uses 6 decimals, so 2.5 USDG = 2_500_000.
 *
 * @dev No platform fee is taken on bounty payouts — the 3% fee applies to copy
 * sales through CreatorFoundrySplits. Contributors receive 100% of the reward.
 */
contract CreatorFoundryBountyEscrow is ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Immutable config
    // ---------------------------------------------------------------------

    /// @notice The stablecoin bounties are escrowed in (USDG on Arbitrum / Robinhood Chain).
    IERC20 public immutable token;

    /// @dev Bounds on the producer-chosen windows (5 minutes .. 90 days).
    /// The floor is low on purpose: a testnet demo needs a window short enough
    /// to watch the SLA actually fire, and the two-sided design means a short
    /// window is never a one-way advantage.
    uint64 public constant MIN_WINDOW = 5 minutes;
    uint64 public constant MAX_WINDOW = 90 days;

    // ---------------------------------------------------------------------
    // Escrow state
    // ---------------------------------------------------------------------

    struct Escrow {
        address producer; // funder + reviewer, the only one who can release
        address contributor; // assigned payee (address(0) until assigned)
        uint256 amount; // locked token base units
        uint64 fundedAt;
        uint64 deliveryDeadline; // contributor must attest before this
        uint64 reviewDeadline; // 0 until attested; producer must review before this
        bool attested;
        bool released; // set once the money has left (release or autoRelease)
        bool refunded; // the producer reclaimed it; the bounty can be re-funded
        bytes32 briefHash; // hash of the brief as funded
        bytes32 deliveryHash; // hash of the artifact the contributor attested
        uint16 criticScore; // producer-attested critic score (0..100)
    }

    /// @notice bountyId => escrow. The key is keccak256 of the off-chain bounty id.
    mapping(bytes32 => Escrow) public escrows;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error AlreadyFunded();
    error NotFunded();
    error NotProducer();
    error NotContributor();
    error ContributorUnset();
    error ContributorAlreadySet();
    error AlreadyAttested();
    error NotAttested();
    error AlreadyReleased();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidWindow();
    error DeliveryWindowOpen(); // too early to refund
    error DeliveryWindowMissed(); // too late to attest
    error ReviewWindowOpen(); // too early to auto-release
    error ScoreOutOfRange();
    error EthNotAccepted();
    error TokenTransferFailed();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event BountyFunded(
        bytes32 indexed key,
        address indexed producer,
        uint256 amount,
        bytes32 briefHash
    );
    event ContributorAssigned(
        bytes32 indexed key,
        address indexed contributor,
        uint64 deliveryDeadline,
        uint64 reviewDeadline
    );
    event DeliveryAttested(
        bytes32 indexed key,
        address indexed contributor,
        bytes32 deliveryHash,
        uint64 reviewDeadline
    );
    event BountyReleased(
        bytes32 indexed key,
        address indexed contributor,
        address indexed reviewer,
        uint256 amount,
        bytes32 briefHash,
        bytes32 deliveryHash,
        uint16 criticScore,
        bool automatic
    );
    event BountyRefunded(bytes32 indexed key, address indexed producer, uint256 amount);

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    constructor(address _token) {
        if (_token == address(0)) revert ZeroAddress();
        token = IERC20(_token);
    }

    /// @dev BountyId string hashed into the mapping key (matches the client's keccak256(toBytes(id))).
    function keyFor(string calldata bountyId) external pure returns (bytes32) {
        return keccak256(bytes(bountyId));
    }

    /**
     * @notice Lock the reward. The producer must have approved `amount` of
     * `token` to this contract first (ERC-20 allowance), then this pulls it in.
     * @param key       keccak256 of the off-chain bounty id.
     * @param amount    reward in token base units (USDG: 6 decimals).
     * @param briefHash hash of the brief/instructions the money is buying.
     */
    function fund(bytes32 key, uint256 amount, bytes32 briefHash) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Escrow storage e = escrows[key];
        if (e.fundedAt != 0) {
            // A refunded escrow means the producer took their money back and the
            // bounty reopened for someone else — allow a fresh round on the same
            // key. A PAID escrow is terminal: re-funding it would let one bounty
            // pay out twice for the same delivery.
            if (!e.refunded) revert AlreadyFunded();
            delete escrows[key];
            e = escrows[key];
        }

        e.producer = msg.sender;
        e.amount = amount;
        e.fundedAt = uint64(block.timestamp);
        e.briefHash = briefHash;

        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TokenTransferFailed();

        emit BountyFunded(key, msg.sender, amount, briefHash);
    }

    /**
     * @notice Name the contributor who will be paid, and start the delivery
     * clock. Only the producer can do this (it is the payout decision).
     * @param deliveryWindow seconds the contributor has to attest a delivery.
     * @param reviewWindow   seconds the producer has to review it afterwards.
     */
    function assignContributor(
        bytes32 key,
        address contributor,
        uint64 deliveryWindow,
        uint64 reviewWindow
    ) external {
        if (contributor == address(0)) revert ZeroAddress();
        if (
            deliveryWindow < MIN_WINDOW ||
            deliveryWindow > MAX_WINDOW ||
            reviewWindow < MIN_WINDOW ||
            reviewWindow > MAX_WINDOW
        ) revert InvalidWindow();

        Escrow storage e = escrows[key];
        if (e.fundedAt == 0) revert NotFunded();
        if (msg.sender != e.producer) revert NotProducer();
        if (e.contributor != address(0)) revert ContributorAlreadySet();
        if (e.released) revert AlreadyReleased();

        e.contributor = contributor;
        e.deliveryDeadline = uint64(block.timestamp) + deliveryWindow;
        // Provisional: overwritten with the real review deadline on attestation.
        e.reviewDeadline = e.deliveryDeadline + reviewWindow;

        emit ContributorAssigned(key, contributor, e.deliveryDeadline, e.reviewDeadline);
    }

    /**
     * @notice The contributor records what they delivered. This is what starts
     * the producer's review clock — until this happens the producer can still
     * reclaim the reward after deliveryDeadline.
     */
    function attestDelivery(bytes32 key, bytes32 deliveryHash) external {
        Escrow storage e = escrows[key];
        if (e.fundedAt == 0) revert NotFunded();
        if (e.contributor == address(0)) revert ContributorUnset();
        if (msg.sender != e.contributor) revert NotContributor();
        if (e.attested) revert AlreadyAttested();
        if (e.released) revert AlreadyReleased();
        if (block.timestamp > e.deliveryDeadline) revert DeliveryWindowMissed();

        e.attested = true;
        e.deliveryHash = deliveryHash;
        // restart the clock from the actual delivery, preserving the window length
        uint64 reviewWindow = e.reviewDeadline - e.deliveryDeadline;
        e.reviewDeadline = uint64(block.timestamp) + reviewWindow;

        emit DeliveryAttested(key, msg.sender, deliveryHash, e.reviewDeadline);
    }

    /**
     * @notice The producer accepts the delivery: money goes straight to the
     * contributor and the critic score is recorded against the brief hash.
     * This is the fast path; autoRelease is the backstop.
     *
     * @dev Deliberately does NOT require attestDelivery first. The producer is
     * only ever moving money to the contributor here, so the extra requirement
     * would just add a way for a failed attest tx to strand the payout.
     */
    function release(bytes32 key, uint16 criticScore) external nonReentrant {
        if (criticScore > 100) revert ScoreOutOfRange();

        Escrow storage e = escrows[key];
        if (e.fundedAt == 0) revert NotFunded();
        if (msg.sender != e.producer) revert NotProducer();
        if (e.contributor == address(0)) revert ContributorUnset();
        if (e.released) revert AlreadyReleased();

        e.criticScore = criticScore;
        _payout(key, e, false);
    }

    /**
     * @notice SLA backstop: once the review window closes with no producer
     * signature, ANYONE can pay the contributor. Permissionless on purpose —
     * the artist never depends on the producer showing up.
     */
    function autoRelease(bytes32 key) external nonReentrant {
        Escrow storage e = escrows[key];
        if (e.fundedAt == 0) revert NotFunded();
        if (!e.attested) revert NotAttested();
        if (e.released) revert AlreadyReleased();
        if (block.timestamp <= e.reviewDeadline) revert ReviewWindowOpen();

        _payout(key, e, true);
    }

    /**
     * @notice The producer reclaims the reward when the contributor never
     * delivered. Only possible after deliveryDeadline and only while no
     * delivery has been attested — a producer cannot claw back reviewed work.
     */
    function refund(bytes32 key) external nonReentrant {
        Escrow storage e = escrows[key];
        if (e.fundedAt == 0) revert NotFunded();
        if (msg.sender != e.producer) revert NotProducer();
        if (e.released) revert AlreadyReleased();
        if (e.attested) revert AlreadyAttested();
        if (e.contributor == address(0)) revert ContributorUnset();
        if (block.timestamp <= e.deliveryDeadline) revert DeliveryWindowOpen();

        uint256 amount = e.amount;
        e.released = true;
        e.refunded = true;

        bool ok = token.transfer(e.producer, amount);
        if (!ok) revert TokenTransferFailed();

        emit BountyRefunded(key, e.producer, amount);
    }

    /// @dev Shared payout path. `released` is the only re-entry guard we need:
    /// the balance lives in the contract, not per-escrow, so the flag prevents a
    /// second drain for the same key.
    function _payout(bytes32 key, Escrow storage e, bool automatic) private {
        uint256 amount = e.amount;
        e.released = true;

        bool ok = token.transfer(e.contributor, amount);
        if (!ok) revert TokenTransferFailed();

        emit BountyReleased(
            key,
            e.contributor,
            automatic ? address(0) : msg.sender,
            amount,
            e.briefHash,
            e.deliveryHash,
            e.criticScore,
            automatic
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Seconds left before the producer may no longer reclaim (0 once passed).
    function deliveryTimeLeft(bytes32 key) external view returns (uint64) {
        Escrow storage e = escrows[key];
        if (e.fundedAt == 0 || e.contributor == address(0)) return 0;
        if (block.timestamp >= e.deliveryDeadline) return 0;
        return e.deliveryDeadline - uint64(block.timestamp);
    }

    /// @notice Seconds left before anyone can auto-release to the contributor.
    function reviewTimeLeft(bytes32 key) external view returns (uint64) {
        Escrow storage e = escrows[key];
        if (!e.attested || e.released) return 0;
        if (block.timestamp >= e.reviewDeadline) return 0;
        return e.reviewDeadline - uint64(block.timestamp);
    }

    /// @notice True when the contributor can already pull the money themselves.
    /// @dev Used by the UI to surface the SLA button before anyone signs.
    function releasable(bytes32 key) external view returns (bool) {
        Escrow storage e = escrows[key];
        return e.fundedAt != 0 && e.attested && !e.released && block.timestamp > e.reviewDeadline;
    }

    /// @dev Escrow settles in ERC-20 only; reject accidental ETH.
    receive() external payable {
        revert EthNotAccepted();
    }
}
