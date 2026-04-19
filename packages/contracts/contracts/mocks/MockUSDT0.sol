// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT0
 * @notice Local emulation of USDT0 (LayerZero OFT omnichain USDT on Conflux eSpace).
 *
 * Implements a minimal stub of the OFT interface so local contracts that call
 * sendFrom / estimateSendFee / token compile and behave predictably in tests.
 * No actual cross-chain bridge logic — messages are no-ops on localnet.
 *
 * Switch to the real USDT0 contract on testnet/mainnet via the network config
 * registry (packages/shared/src/network-config.ts).
 */
contract MockUSDT0 is ERC20 {
    address public   deployer;

    // ── Events (mirrors OFT interface) ─────────────────────────────────────
    event SendToChain(uint16 indexed dstChainId, address indexed from, bytes toAddress, uint256 amount);
    event ReceiveFromChain(uint16 indexed srcChainId, address indexed to, uint256 amount);

    constructor() ERC20("USD Token", "USDT0") {
        deployer = msg.sender;
        // Mint 10m USDT0 to deployer for dev/test seeding
        _mint(msg.sender, 10_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ── Dev mint ────────────────────────────────────────────────────────────
    function mint(address to, uint256 amount) external {
        require(msg.sender == deployer, "MockUSDT0: only deployer");
        _mint(to, amount);
    }

    // ── OFT interface stubs ─────────────────────────────────────────────────
    // These let contracts that import IOFT compile and call methods locally.
    // They do NOT send real cross-chain messages.

    function token() external view returns (address) {
        return address(this);
    }

    function estimateSendFee(
        uint16  /* dstChainId */,
        bytes calldata /* toAddress */,
        uint256 /* amount */,
        bool    /* useZro */,
        bytes calldata /* adapterParams */
    ) external pure returns (uint256 nativeFee, uint256 zroFee) {
        return (0, 0);
    }

    function sendFrom(
        address from,
        uint16  dstChainId,
        bytes calldata toAddress,
        uint256 amount,
        address payable /* refundAddress */,
        address /* zroPaymentAddress */,
        bytes calldata /* adapterParams */
    ) external payable {
        // Burn tokens on simulated send (no cross-chain, just local balance accounting)
        _burn(from, amount);
        emit SendToChain(dstChainId, from, toAddress, amount);
    }
}
