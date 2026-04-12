// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PayableVault (DevKit)
 * @notice A simple vault that accepts deposits of any ERC-20 token or native CFX.
 *
 * Use cases on the local devnet:
 *   - Test token transfers (deposit + withdraw any token)
 *   - Verify ERC-20 approve/transferFrom flow
 *   - Confirm native CFX send/receive works
 *   - Serve as a "sink" for swapped tokens in DEX testing
 *
 * Emits events for easy off-chain tracking. No access control — anyone can
 * deposit, and each user can only withdraw their own balance.
 */
contract PayableVault {
    using SafeERC20 for IERC20;

    /// @dev token address → user address → balance
    mapping(address => mapping(address => uint256)) public balances;

    /// @dev Native CFX uses address(0) as the token key
    address public constant NATIVE = address(0);

    event Deposited(address indexed token, address indexed user, uint256 amount);
    event Withdrawn(address indexed token, address indexed user, uint256 amount);

    /**
     * @notice Deposit ERC-20 tokens into the vault.
     * @param token The ERC-20 token address.
     * @param amount The amount to transfer from msg.sender.
     */
    function deposit(address token, uint256 amount) external {
        require(token != address(0), "Use depositNative() for CFX");
        require(amount > 0, "Amount must be > 0");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[token][msg.sender] += amount;
        emit Deposited(token, msg.sender, amount);
    }

    /**
     * @notice Deposit native CFX into the vault.
     */
    function depositNative() external payable {
        require(msg.value > 0, "Amount must be > 0");
        balances[NATIVE][msg.sender] += msg.value;
        emit Deposited(NATIVE, msg.sender, msg.value);
    }

    /**
     * @notice Withdraw ERC-20 tokens from the vault.
     * @param token The ERC-20 token address.
     * @param amount The amount to withdraw.
     */
    function withdraw(address token, uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(balances[token][msg.sender] >= amount, "Insufficient balance");
        balances[token][msg.sender] -= amount;
        if (token == NATIVE) {
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            require(ok, "CFX transfer failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit Withdrawn(token, msg.sender, amount);
    }

    /**
     * @notice Get a user's balance of a specific token in the vault.
     * @param token The token address (address(0) for native CFX).
     * @param user The user address.
     */
    function balanceOf(address token, address user) external view returns (uint256) {
        return balances[token][user];
    }

    /// @notice Accept native CFX directly (routes to depositNative logic).
    receive() external payable {
        balances[NATIVE][msg.sender] += msg.value;
        emit Deposited(NATIVE, msg.sender, msg.value);
    }
}
