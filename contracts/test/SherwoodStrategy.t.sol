// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {SherwoodStrategy} from "../src/SherwoodStrategy.sol";
import {ERC20Mock} from "./mocks/ERC20Mock.sol";
import {MockMToken} from "./mocks/MockMToken.sol";
import {MockComptroller} from "./mocks/MockComptroller.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";

contract SherwoodStrategyTest is Test {
    SherwoodStrategy public strategy;
    ERC20Mock public usdc;
    ERC20Mock public weth;
    ERC20Mock public meme;
    MockMToken public mUSDC;
    MockMToken public mWETH;
    MockComptroller public comptroller;
    MockSwapRouter public swapRouter;

    address public vault = makeAddr("vault");

    function setUp() public {
        // Deploy tokens (USDC 6 decimals, WETH 18, meme 18)
        usdc = new ERC20Mock("USD Coin", "USDC", 6);
        weth = new ERC20Mock("Wrapped Ether", "WETH", 18);
        meme = new ERC20Mock("Memecoin", "MEME", 18);

        // Deploy Moonwell mocks
        mUSDC = new MockMToken(address(usdc), "Moonwell USDC", "mUSDC");
        mWETH = new MockMToken(address(weth), "Moonwell WETH", "mWETH");
        comptroller = new MockComptroller();
        swapRouter = new MockSwapRouter();

        // Deploy strategy
        strategy = new SherwoodStrategy(vault, address(comptroller), address(swapRouter));

        // Fund mTokens with underlying for borrow liquidity
        usdc.mint(address(mUSDC), 1_000_000e6);
        usdc.mint(address(mWETH), 1_000_000e6);
        weth.mint(address(mWETH), 1_000e18);

        // Fund vault with assets
        usdc.mint(vault, 100_000e6);
        weth.mint(vault, 50e18);

        // Fund swap router with tokens for swap output
        weth.mint(address(swapRouter), 1_000e18);
        meme.mint(address(swapRouter), 1_000_000e18);
        usdc.mint(address(swapRouter), 1_000_000e6);

        // Vault approves strategy to pull assets
        vm.startPrank(vault);
        usdc.approve(address(strategy), type(uint256).max);
        weth.approve(address(strategy), type(uint256).max);
        vm.stopPrank();
    }

    // ==================== SINGLE ACTIONS ====================

    function test_depositCollateral() public {
        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.DEPOSIT_COLLATERAL, params: abi.encode(address(mUSDC), 10_000e6)
        });

        vm.prank(vault);
        strategy.executeBatch(actions);

        // Strategy should hold mTokens
        assertEq(mUSDC.balanceOf(address(strategy)), 10_000e6);
        // Market should be entered
        assertTrue(strategy.marketEntered(address(mUSDC)));
    }

    function test_borrow() public {
        // First deposit collateral
        _depositCollateral(address(mUSDC), 10_000e6);

        // Then borrow
        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.BORROW, params: abi.encode(address(mUSDC), 5_000e6)
        });

        uint256 vaultBalBefore = usdc.balanceOf(vault);
        vm.prank(vault);
        strategy.executeBatch(actions);

        // Borrowed funds should go back to vault
        assertEq(usdc.balanceOf(vault), vaultBalBefore + 5_000e6);
    }

    function test_repay() public {
        _depositCollateral(address(mUSDC), 10_000e6);
        _borrow(address(mUSDC), 5_000e6);

        // Repay
        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.REPAY, params: abi.encode(address(mUSDC), 5_000e6)
        });

        vm.prank(vault);
        strategy.executeBatch(actions);

        assertEq(mUSDC.borrowBalance(), 0);
    }

    function test_withdrawCollateral() public {
        _depositCollateral(address(mUSDC), 10_000e6);

        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.WITHDRAW_COLLATERAL, params: abi.encode(address(mUSDC), 5_000e6)
        });

        uint256 vaultBalBefore = usdc.balanceOf(vault);
        vm.prank(vault);
        strategy.executeBatch(actions);

        assertEq(usdc.balanceOf(vault), vaultBalBefore + 5_000e6);
    }

    function test_swapExactIn() public {
        // Mock router: 1:1 rate (1e6 scale). 1000 USDC in → 1000 units out
        // We just want to verify the flow works, not realistic pricing
        swapRouter.setExchangeRate(1e6); // 1:1

        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.SWAP_EXACT_IN,
            params: abi.encode(address(usdc), address(weth), uint24(3000), uint256(1000e6), uint256(1))
        });

        uint256 vaultWethBefore = weth.balanceOf(vault);
        vm.prank(vault);
        strategy.executeBatch(actions);

        // Vault should have received WETH (1000e6 at 1:1 = 1000e6 WETH wei)
        assertEq(weth.balanceOf(vault), vaultWethBefore + 1000e6);
    }

    function test_swapExactIn_slippageProtection() public {
        // Set exchange rate very low — should fail slippage check
        swapRouter.setExchangeRate(1); // almost zero output

        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.SWAP_EXACT_IN,
            params: abi.encode(address(usdc), address(weth), uint24(3000), uint256(1000e6), uint256(1e18))
        });

        vm.prank(vault);
        vm.expectRevert("Slippage exceeded");
        strategy.executeBatch(actions);
    }

    function test_swapZeroMinOut_reverts() public {
        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.SWAP_EXACT_IN,
            params: abi.encode(address(usdc), address(weth), uint24(3000), uint256(1000e6), uint256(0))
        });

        vm.prank(vault);
        vm.expectRevert("Swap: minOut must be > 0");
        strategy.executeBatch(actions);
    }

    // ==================== BATCH EXECUTION ====================

    function test_leveragedLong_batch() public {
        // Full leveraged long: deposit USDC collateral → borrow more USDC → swap to WETH
        swapRouter.setExchangeRate(500_000); // 1 USDC = 0.5 WETH (for test simplicity)

        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](3);

        // Step 1: Deposit 10k USDC as collateral
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.DEPOSIT_COLLATERAL, params: abi.encode(address(mUSDC), 10_000e6)
        });

        // Step 2: Borrow 5k USDC against collateral
        actions[1] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.BORROW, params: abi.encode(address(mUSDC), 5_000e6)
        });

        // Step 3: Swap 5k USDC → WETH
        actions[2] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.SWAP_EXACT_IN,
            params: abi.encode(address(usdc), address(weth), uint24(3000), uint256(5_000e6), uint256(1))
        });

        vm.prank(vault);
        strategy.executeBatch(actions);

        // Verify: strategy has mTokens (collateral)
        assertEq(mUSDC.balanceOf(address(strategy)), 10_000e6);
        // Verify: strategy has borrow
        assertEq(mUSDC.borrowBalance(), 5_000e6);
        // Verify: vault received WETH from swap
        assertGt(weth.balanceOf(vault), 0);
    }

    function test_unwindPosition_batch() public {
        // Setup: create a leveraged position first
        _depositCollateral(address(mUSDC), 10_000e6);
        _borrow(address(mUSDC), 5_000e6);

        // Unwind: Swap WETH → USDC, repay borrow, withdraw collateral
        // Mock rate: input amount * rate / 1e6 = output
        // We need ≥5000e6 USDC out. Input 5000e6 WETH-wei at 1:1 rate.
        swapRouter.setExchangeRate(1e6); // 1:1

        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](3);

        // Step 1: Swap WETH → USDC (5000e6 WETH-wei → 5000e6 USDC)
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.SWAP_EXACT_IN,
            params: abi.encode(address(weth), address(usdc), uint24(3000), uint256(5_000e6), uint256(1))
        });

        // Step 2: Repay full borrow
        actions[1] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.REPAY, params: abi.encode(address(mUSDC), 5_000e6)
        });

        // Step 3: Withdraw collateral
        actions[2] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.WITHDRAW_COLLATERAL, params: abi.encode(address(mUSDC), 10_000e6)
        });

        vm.prank(vault);
        strategy.executeBatch(actions);

        // Verify: no more borrow
        assertEq(mUSDC.borrowBalance(), 0);
        // Verify: no more mTokens
        assertEq(mUSDC.balanceOf(address(strategy)), 0);
    }

    function test_batchFails_allRevert() public {
        // If borrow fails mid-batch, collateral deposit should also revert
        _depositCollateral(address(mUSDC), 10_000e6);

        // Set comptroller to report no liquidity
        comptroller.setLiquidity(0);

        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](2);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.DEPOSIT_COLLATERAL, params: abi.encode(address(mUSDC), 5_000e6)
        });
        actions[1] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.BORROW, params: abi.encode(address(mUSDC), 5_000e6)
        });

        vm.prank(vault);
        vm.expectRevert("Moonwell: no borrowing capacity");
        strategy.executeBatch(actions);
    }

    function test_onlyVault() public {
        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](0);

        vm.prank(makeAddr("attacker"));
        vm.expectRevert("Only vault");
        strategy.executeBatch(actions);
    }

    // ==================== VIEW HELPERS ====================

    function test_getPosition() public {
        _depositCollateral(address(mUSDC), 10_000e6);
        _borrow(address(mUSDC), 3_000e6);

        (uint256 mTokenBal, uint256 borrowBal, uint256 exchangeRate) = strategy.getPosition(address(mUSDC));
        assertEq(mTokenBal, 10_000e6);
        assertEq(borrowBal, 3_000e6);
        assertEq(exchangeRate, 1e18);
    }

    function test_getHealth() public {
        (uint256 liquidity, uint256 shortfall) = strategy.getHealth();
        assertEq(liquidity, 100_000e18); // Default mock value
        assertEq(shortfall, 0);
    }

    function test_getHealth_underwater() public {
        comptroller.setShortfall(5_000e18);

        (uint256 liquidity, uint256 shortfall) = strategy.getHealth();
        assertEq(liquidity, 0);
        assertEq(shortfall, 5_000e18);
    }

    // ==================== HELPERS ====================

    function _depositCollateral(address mToken, uint256 amount) internal {
        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.DEPOSIT_COLLATERAL, params: abi.encode(mToken, amount)
        });
        vm.prank(vault);
        strategy.executeBatch(actions);
    }

    function _borrow(address mToken, uint256 amount) internal {
        SherwoodStrategy.Action[] memory actions = new SherwoodStrategy.Action[](1);
        actions[0] = SherwoodStrategy.Action({
            actionType: SherwoodStrategy.ActionType.BORROW, params: abi.encode(mToken, amount)
        });
        vm.prank(vault);
        strategy.executeBatch(actions);
    }
}
