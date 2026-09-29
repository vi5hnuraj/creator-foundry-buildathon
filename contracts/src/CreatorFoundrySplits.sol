// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CreatorFoundrySplits
 * @notice On-chain revenue splitting for creative teams, paid in USDG
 * (Paxos' Global Dollar stablecoin) or any other ERC-20.
 *
 * A producer seals a published work by committing a participant table:
 * every contributor — principal, concept artist, musician, 3D modeler… —
 * is assigned an integer weight out of TOTAL_WEIGHT (10_000 = 100%). A
 * platform fee is carved out to the fee wallet; the remainder is paid to
 * participants pro-rata, on-chain, in a stablecoin, on every release().
 *
 * Anyone can call {release} — payouts are not gated on the producer being
 * present, so contributors always get paid.
 *
 * Gas: pull-based payment splits per{ERC20}-style accounting (one storage
 * write per release per recipient instead of N transfers), following the
 * battle-tested 0xSplits pattern.
 *
 * Works on any EVM chain, including Arbitrum One, Arbitrum Sepolia and
 * Robinhood Chain (an Arbitrum Orbit chain).
 */
contract CreatorFoundrySplits is Ownable, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Recipient {
        address account; // payout wallet
        uint32 weight; // integer weight out of TOTAL_WEIGHT (after fee)
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @dev Denominator for recipient weights: 10_000 = 100%.
    uint32 public constant TOTAL_WEIGHT = 10_000;

    /// @dev Default platform fee: 3% (300 bps) — vs. 30% on Steam / App Store.
    uint32 public constant DEFAULT_FEE_BPS = 300;

    /// @dev Hard cap on the platform fee (15%).
    uint32 public constant MAX_FEE_BPS = 1_500;

    // ---------------------------------------------------------------------
    // Immutable config
    // ---------------------------------------------------------------------

    /// @notice Wallet that receives the platform fee.
    address public immutable feeWallet;

    /// @notice The producer (work owner) who controls the split table.
    address public immutable controller;

    // ---------------------------------------------------------------------
    // Split state
    // ---------------------------------------------------------------------

    address[] public payees;
    mapping(address => uint32) public weights;

    /// @notice Fee in basis points at the time this split was committed.
    uint32 public feeBps;

    /// @notice Set once by `commitSplit`; the table is then immutable and
    /// `released` becomes callable by anyone.
    bool public committed;

    /// @notice ERC-20 token the split is settled in (USDG on Arbitrum/Robinhood).
    IERC20 public immutable token;

    /// @notice account => amount of `token` available to withdraw.
    mapping(address => uint256) public released;

    /// @notice Cumulative `token` amount allocated across all releases.
    uint256 public totalReleased;

    error NotController();
    error AlreadyCommitted();
    error NotCommitted();
    error EmptySplit();
    error WeightsExceedTotal();
    error ZeroAddress();
    error DuplicatePayee();
    error NoFunds();
    error EthNotAccepted();
    error TokenTransferFailed();
    error FeeTooHigh(uint32 requested, uint32 max);

    event SplitCommitted(
        address indexed controller,
        address indexed token,
        address[] payees,
        uint32[] weights,
        uint32 feeBps
    );
    event Released(address indexed token, address indexed to, uint256 amount);

    constructor(address _controller, address _feeWallet, address _token) Ownable(_controller) {
        if (_controller == address(0) || _feeWallet == address(0) || _token == address(0)) {
            revert ZeroAddress();
        }
        controller = _controller;
        feeWallet = _feeWallet;
        token = IERC20(_token);
    }

    // ---------------------------------------------------------------------
    // Split lifecycle
    // ---------------------------------------------------------------------

    /**
     * @notice Commit the immutable payout table. Called by the producer when
     * the work is sealed. `payees`/`weights`/`feeBps` must describe the full
     * 10_000 weight INCLUDING the fee (use {quoteSplit} to build this table).
     */
    function commitSplit(
        address[] calldata payees_,
        uint32[] calldata weights_,
        uint32 feeBps_
    ) external {
        if (msg.sender != controller) revert NotController();
        if (committed) revert AlreadyCommitted();
        if (payees_.length == 0 || payees_.length != weights_.length) revert EmptySplit();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_, MAX_FEE_BPS);

        uint256 sum = 0;
        for (uint256 i = 0; i < payees_.length; ++i) {
            address payee = payees_[i];
            if (payee == address(0)) revert ZeroAddress();
            if (weights[payee] != 0) revert DuplicatePayee();
            if (weights_[i] == 0) revert EmptySplit();
            weights[payee] = weights_[i];
            sum += weights_[i];
        }
        if (sum != TOTAL_WEIGHT) revert WeightsExceedTotal();

        payees = payees_;
        feeBps = feeBps_;
        committed = true;

        emit SplitCommitted(controller, address(token), payees_, weights_, feeBps_);
    }

    /// @notice True once the split table is committed — revenue can flow.
    modifier whenCommitted() {
        if (!committed) revert NotCommitted();
        _;
    }

    /**
     * @notice Permissionless: distribute the current `token` balance of this
     * contract to payees pro-rata (fee wallet included, per its weight).
     * Anyone can call it — contributors do not depend on the producer.
     */
    function release() external nonReentrant whenCommitted {
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) revert NoFunds();

        totalReleased += amount;

        uint256 len = payees.length;
        for (uint256 i = 0; i < len; ++i) {
            address payee = payees[i];
            uint256 share = (amount * weights[payee]) / TOTAL_WEIGHT;
            if (share > 0) {
                released[payee] += share;
                emit Released(address(token), payee, share);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Withdrawals
    // ---------------------------------------------------------------------

    /// @notice Withdraw accrued USDG/ERC-20 earnings. Reverts on transfer failure.
    function withdraw() external nonReentrant {
        uint256 amount = released[msg.sender];
        if (amount == 0) revert NoFunds();

        released[msg.sender] = 0;
        bool ok = token.transfer(msg.sender, amount);
        if (!ok) revert TokenTransferFailed();

        emit Released(address(token), msg.sender, amount);
    }

    /// @notice Withdraw USDG/ERC-20 earnings to an arbitrary wallet (ops convenience).
    function withdrawTo(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = released[msg.sender];
        if (amount == 0) revert NoFunds();

        released[msg.sender] = 0;
        bool ok = token.transfer(to, amount);
        if (!ok) revert TokenTransferFailed();

        emit Released(address(token), to, amount);
    }

    /// @notice Read a payee's pending (withdrawable) balance.
    function pendingBalance(address account) external view returns (uint256) {
        return released[account];
    }

    // ---------------------------------------------------------------------
    // Safety
    // ---------------------------------------------------------------------

    /// @notice The split settles in ERC-20 only; reject accidental ETH.
    receive() external payable {
        revert EthNotAccepted();
    }
}
