// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockAxCNH
 * @notice Local emulation of AxCNH (offshore CNH stablecoin on Conflux eSpace).
 *
 * AxCNH is believed to be CNHt0 — the Tether omnichain CNH stablecoin distributed
 * via the USDT0 network (LayerZero OFT standard). This mock uses the same minimal
 * OFT interface stub as MockUSDT0.
 *
 * Switch to the real AxCNH contract on testnet/mainnet via the network config
 * registry (packages/shared/src/network-config.ts).
 *
 * @dev decimals = 6 (standard Tether stablecoin precision).
 *      Update if the real contract uses a different value.
 */
contract MockAxCNH is ERC20 {
    address public   deployer;

    event SendToChain(uint16 indexed dstChainId, address indexed from, bytes toAddress, uint256 amount);
    event ReceiveFromChain(uint16 indexed srcChainId, address indexed to, uint256 amount);

    constructor() ERC20("Axelar Bridged CNH", "AxCNH") {
        deployer = msg.sender;
        // Mint 10m AxCNH to deployer for dev/test seeding — ~10m CNY ≈ ~1.38m USD
        _mint(msg.sender, 10_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == deployer, "MockAxCNH: only deployer");
        _mint(to, amount);
    }

    // ── OFT interface stubs ─────────────────────────────────────────────────
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
        _burn(from, amount);
        emit SendToChain(dstChainId, from, toAddress, amount);
    }
}
