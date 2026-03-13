// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ── Moonwell Interfaces ──

interface IMToken {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function borrow(uint256 borrowAmount) external returns (uint256);
    function repayBorrow(uint256 repayAmount) external returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
    function underlying() external view returns (address);
    function getAccountSnapshot(address account) external view returns (uint256, uint256, uint256, uint256);
}

interface IComptroller {
    function enterMarkets(address[] calldata mTokens) external returns (uint256[] memory);
    function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);
}

// ── Uniswap V3 Interface ──

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path; // Encoded path for multi-hop (tokenA, fee, tokenB, fee, tokenC)
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

// TODO: Uniswap V4 integration — needs Universal Router interface
// V4 uses a different routing pattern with PoolManager + hooks
// For now V3 SwapRouter covers the MVP; V4 can be added via upgrade or new strategy

/**
 * @title SherwoodStrategy
 * @notice Composable DeFi action space for autonomous agents.
 *
 *   Agents construct batches of actions off-chain and submit them atomically.
 *   The contract provides primitive operations (deposit, borrow, repay, withdraw, swap)
 *   that can be composed in any order within a single transaction.
 *
 *   Protection layers:
 *     - Slippage: enforced per-swap via amountOutMinimum (CLI computes from quote)
 *     - Spread: CLI uses Uniswap SDK to find optimal route before submitting
 *     - Position health: agent monitors via getAccountLiquidity before acting
 *     - Caps: vault enforces syndicate + agent limits on assetAmount
 *
 *   Called exclusively by the SyndicateVault via executeStrategy().
 */
contract SherwoodStrategy {
    using SafeERC20 for IERC20;

    // ── Action Types ──
    enum ActionType {
        DEPOSIT_COLLATERAL, // Deposit into Moonwell as collateral
        BORROW, // Borrow from Moonwell
        REPAY, // Repay Moonwell borrow
        WITHDRAW_COLLATERAL, // Withdraw from Moonwell
        SWAP_EXACT_IN, // Uniswap V3 exact input single-hop
        SWAP_EXACT_IN_MULTI // Uniswap V3 exact input multi-hop (path routing)
    }

    struct Action {
        ActionType actionType;
        bytes params; // ABI-encoded params per action type
    }

    // ── Immutables ──
    address public immutable vault;
    IComptroller public immutable comptroller;
    ISwapRouter public immutable swapRouter;

    // ── Markets entered (track to avoid re-entering) ──
    mapping(address => bool) public marketEntered;

    // ── Events ──
    event CollateralDeposited(address indexed mToken, uint256 amount);
    event Borrowed(address indexed mToken, uint256 amount);
    event Repaid(address indexed mToken, uint256 amount);
    event CollateralWithdrawn(address indexed mToken, uint256 amount);
    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event SwappedMultiHop(address indexed tokenIn, uint256 amountIn, uint256 amountOut);
    event BatchExecuted(uint256 actionCount);

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }

    constructor(address vault_, address comptroller_, address swapRouter_) {
        require(vault_ != address(0), "Invalid vault");
        require(comptroller_ != address(0), "Invalid comptroller");
        require(swapRouter_ != address(0), "Invalid router");

        vault = vault_;
        comptroller = IComptroller(comptroller_);
        swapRouter = ISwapRouter(swapRouter_);
    }

    // ==================== BATCH EXECUTION ====================

    /// @notice Execute a batch of DeFi actions atomically
    /// @dev Called by vault.executeStrategy(). If any action fails, entire batch reverts.
    /// @param actions Array of actions to execute in order
    function executeBatch(Action[] calldata actions) external onlyVault {
        for (uint256 i = 0; i < actions.length; i++) {
            _executeAction(actions[i]);
        }
        emit BatchExecuted(actions.length);
    }

    // ==================== INTERNAL DISPATCH ====================

    function _executeAction(Action calldata action) internal {
        if (action.actionType == ActionType.DEPOSIT_COLLATERAL) {
            _depositCollateral(action.params);
        } else if (action.actionType == ActionType.BORROW) {
            _borrow(action.params);
        } else if (action.actionType == ActionType.REPAY) {
            _repay(action.params);
        } else if (action.actionType == ActionType.WITHDRAW_COLLATERAL) {
            _withdrawCollateral(action.params);
        } else if (action.actionType == ActionType.SWAP_EXACT_IN) {
            _swapExactIn(action.params);
        } else if (action.actionType == ActionType.SWAP_EXACT_IN_MULTI) {
            _swapExactInMulti(action.params);
        } else {
            revert("Unknown action type");
        }
    }

    // ==================== MOONWELL ACTIONS ====================

    /// @dev params: abi.encode(address mToken, uint256 amount)
    function _depositCollateral(bytes calldata params) internal {
        (address mToken, uint256 amount) = abi.decode(params, (address, uint256));

        address underlying = IMToken(mToken).underlying();

        // Pull from vault
        IERC20(underlying).safeTransferFrom(vault, address(this), amount);

        // Approve and mint mTokens
        IERC20(underlying).approve(mToken, amount);
        uint256 err = IMToken(mToken).mint(amount);
        require(err == 0, "Moonwell: mint failed");

        // Enter market if not already (enables as collateral)
        if (!marketEntered[mToken]) {
            address[] memory markets = new address[](1);
            markets[0] = mToken;
            uint256[] memory errors = comptroller.enterMarkets(markets);
            require(errors[0] == 0, "Moonwell: enterMarkets failed");
            marketEntered[mToken] = true;
        }

        emit CollateralDeposited(mToken, amount);
    }

    /// @dev params: abi.encode(address mToken, uint256 amount)
    function _borrow(bytes calldata params) internal {
        (address mToken, uint256 amount) = abi.decode(params, (address, uint256));

        // Check account liquidity before borrowing
        (uint256 errLiq, uint256 liquidity, uint256 shortfall) = comptroller.getAccountLiquidity(address(this));
        require(errLiq == 0, "Moonwell: liquidity check failed");
        require(shortfall == 0, "Moonwell: account underwater");
        require(liquidity > 0, "Moonwell: no borrowing capacity");

        uint256 err = IMToken(mToken).borrow(amount);
        require(err == 0, "Moonwell: borrow failed");

        // Send borrowed funds back to vault
        address underlying = IMToken(mToken).underlying();
        IERC20(underlying).safeTransfer(vault, amount);

        emit Borrowed(mToken, amount);
    }

    /// @dev params: abi.encode(address mToken, uint256 amount)
    ///      Pass type(uint256).max for full repay
    function _repay(bytes calldata params) internal {
        (address mToken, uint256 amount) = abi.decode(params, (address, uint256));

        address underlying = IMToken(mToken).underlying();

        // Get actual borrow balance if repaying max
        uint256 repayAmount = amount;
        if (amount == type(uint256).max) {
            repayAmount = IMToken(mToken).borrowBalanceCurrent(address(this));
        }

        // Pull from vault and repay
        IERC20(underlying).safeTransferFrom(vault, address(this), repayAmount);
        IERC20(underlying).approve(mToken, repayAmount);

        uint256 err = IMToken(mToken).repayBorrow(repayAmount);
        require(err == 0, "Moonwell: repay failed");

        emit Repaid(mToken, repayAmount);
    }

    /// @dev params: abi.encode(address mToken, uint256 amount)
    function _withdrawCollateral(bytes calldata params) internal {
        (address mToken, uint256 amount) = abi.decode(params, (address, uint256));

        uint256 err = IMToken(mToken).redeemUnderlying(amount);
        require(err == 0, "Moonwell: redeem failed");

        // Send back to vault
        address underlying = IMToken(mToken).underlying();
        IERC20(underlying).safeTransfer(vault, amount);

        emit CollateralWithdrawn(mToken, amount);
    }

    // ==================== UNISWAP ACTIONS ====================

    /// @notice Single-hop swap with slippage protection
    /// @dev params: abi.encode(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMinimum)
    ///      amountOutMinimum is computed by CLI from Uniswap SDK quote with slippage tolerance
    function _swapExactIn(bytes calldata params) internal {
        (address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMinimum) =
            abi.decode(params, (address, address, uint24, uint256, uint256));

        require(amountOutMinimum > 0, "Swap: minOut must be > 0");

        // Pull tokenIn from vault
        IERC20(tokenIn).safeTransferFrom(vault, address(this), amountIn);
        IERC20(tokenIn).approve(address(swapRouter), amountIn);

        uint256 amountOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: vault, // Output goes directly to vault
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        emit Swapped(tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Multi-hop swap for better routing (e.g., USDC → WETH → memecoin)
    /// @dev params: abi.encode(bytes path, address tokenIn, uint256 amountIn, uint256 amountOutMinimum)
    ///      path is Uniswap V3 encoded path (tokenA, fee, tokenB, fee, tokenC)
    ///      CLI uses Uniswap SDK findBestRoute() to compute path and amountOutMinimum
    function _swapExactInMulti(bytes calldata params) internal {
        (bytes memory path, address tokenIn, uint256 amountIn, uint256 amountOutMinimum) =
            abi.decode(params, (bytes, address, uint256, uint256));

        require(amountOutMinimum > 0, "Swap: minOut must be > 0");

        // Pull tokenIn from vault
        IERC20(tokenIn).safeTransferFrom(vault, address(this), amountIn);
        IERC20(tokenIn).approve(address(swapRouter), amountIn);

        uint256 amountOut = swapRouter.exactInput(
            ISwapRouter.ExactInputParams({
                path: path,
                recipient: vault, // Output goes directly to vault
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum
            })
        );

        emit SwappedMultiHop(tokenIn, amountIn, amountOut);
    }

    // ==================== VIEW HELPERS ====================

    /// @notice Get this strategy's position in a Moonwell market
    function getPosition(address mToken)
        external
        view
        returns (uint256 mTokenBalance, uint256 borrowBalance, uint256 exchangeRate)
    {
        (uint256 err, uint256 bal, uint256 borrows, uint256 rate) = IMToken(mToken).getAccountSnapshot(address(this));
        require(err == 0, "Snapshot failed");
        return (bal, borrows, rate);
    }

    /// @notice Get overall account health from Moonwell comptroller
    /// @return liquidity USD value available to borrow (18 decimal mantissa)
    /// @return shortfall USD value of shortfall if underwater (18 decimal mantissa)
    function getHealth() external view returns (uint256 liquidity, uint256 shortfall) {
        (uint256 err, uint256 liq, uint256 sf) = comptroller.getAccountLiquidity(address(this));
        require(err == 0, "Liquidity check failed");
        return (liq, sf);
    }

    // TODO: Add Uniswap V4 Universal Router support
    // V4 uses PoolManager with hooks — different routing pattern
    // Needs: IUniversalRouter interface, PathKey struct, Actions enum
    // CLI will need to detect pool version and route accordingly

    // TODO: Add reward claiming (comptroller.claimReward())
    // WELL token rewards for suppliers/borrowers — send to vault

    // TODO: Flash loan support for capital-efficient leverage loops
    // Moonwell doesn't have native flash loans but Aave/Morpho on Base do
    // Pattern: flash borrow → deposit collateral → borrow → repay flash
}
